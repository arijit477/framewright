//! The timeline model: tracks, clips and the editing operations on them.
//!
//! All times are integer **microseconds** ([`Micros`]), the same unit WebCodecs
//! uses for `VideoFrame.timestamp`, so no float drift accumulates and no unit
//! conversion is needed at the decoder boundary. See `docs/adr/0001-time-in-microseconds.md`.
//!
//! Invariants kept by every operation:
//! - clips on a track are sorted by `start` and never overlap (half-open `[start, end)`),
//! - every clip is at least [`MIN_CLIP_DURATION`] long,
//! - a clip never references media outside `0..source_duration`.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::color::{ColorAdjust, ColorError, LutRef};
use crate::keyframe::{self, Easing, Keyframe, KeyframeError, ResolvedTransform};
use crate::text::{TextContent, TextError};
use crate::transform::{Transform, TransformError};
use crate::transition::{LayerTransition, Transition, TransitionError};

/// Time in microseconds.
pub type Micros = i64;

/// Shortest clip allowed (10 ms, a bit under one frame at 60 fps).
pub const MIN_CLIP_DURATION: Micros = 10_000;

pub type ClipId = u32;
pub type TrackId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: ClipId,
    pub asset_id: String,
    /// Position on the timeline.
    pub start: Micros,
    /// Length on the timeline.
    pub duration: Micros,
    /// Offset into the source media where this clip begins.
    pub source_in: Micros,
    /// Total length of the source media (bounds for trimming).
    pub source_duration: Micros,
    /// Audio gain in percent: 100 is unchanged, 0 is silent, up to [`MAX_VOLUME_PERCENT`].
    /// An integer so projects compare and serialise exactly.
    #[serde(default = "default_volume")]
    pub volume_percent: u16,
    #[serde(default)]
    pub muted: bool,
    /// Playback speed in percent (100 = normal, 25-400). `duration` is the
    /// length on the timeline; it covers `duration × speed` of source media.
    #[serde(default = "default_speed", skip_serializing_if = "is_normal_speed")]
    pub speed_percent: u16,
    /// Set for text clips, which show this text instead of media.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextContent>,
    /// Where a media clip appears in the frame. Omitted from saved projects
    /// when unchanged, so old projects and plain clips stay compact.
    #[serde(default, skip_serializing_if = "Transform::is_identity")]
    pub transform: Transform,
    /// Animation of the transform, in source-time order. While there are any,
    /// they decide the transform and `transform` is unused.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keyframes: Vec<Keyframe>,
    /// Colour adjustments of a media clip; omitted when unchanged.
    #[serde(default, skip_serializing_if = "ColorAdjust::is_neutral")]
    pub color: ColorAdjust,
    /// A LUT applied before the colour adjustments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lut: Option<LutRef>,
    /// Transition from the clip directly before this one on the same track.
    /// Inactive (ignored) while the clips aren't touching.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_in: Option<Transition>,
}

pub const MAX_VOLUME_PERCENT: u16 = 200;

/// Text clips have no media: they use this asset id...
pub const TEXT_ASSET_ID: &str = "";
/// ...and an effectively unlimited "source", so they can be trimmed to any length.
pub const TEXT_SOURCE_DURATION: Micros = 24 * 3600 * 1_000_000;

fn default_volume() -> u16 {
    100
}

pub const MIN_SPEED_PERCENT: u16 = 25;
pub const MAX_SPEED_PERCENT: u16 = 400;

fn default_speed() -> u16 {
    100
}

fn is_normal_speed(percent: &u16) -> bool {
    *percent == 100
}

/// `value × num / den`, rounded to the nearest microsecond (halves away from zero).
fn scale(value: Micros, num: u16, den: u16) -> Micros {
    let (n, d) = (i128::from(value) * i128::from(num), i128::from(den));
    let rounded = if n >= 0 {
        (n + d / 2) / d
    } else {
        (n - d / 2) / d
    };
    rounded as Micros
}

impl Clip {
    pub fn end(&self) -> Micros {
        self.start + self.duration
    }

    /// Source media covered by a stretch of the timeline, at this clip's speed.
    pub fn to_source(&self, timeline_span: Micros) -> Micros {
        scale(timeline_span, self.speed_percent, 100)
    }

    /// Timeline length of a stretch of source media, at this clip's speed.
    pub fn to_timeline(&self, source_span: Micros) -> Micros {
        scale(source_span, 100, self.speed_percent)
    }

    /// The source time shown at timeline time `at` (may lie outside the clip).
    pub fn source_at(&self, at: Micros) -> Micros {
        self.source_in + self.to_source(at - self.start)
    }

    /// Where the clip's media ends in the source.
    pub fn source_end(&self) -> Micros {
        self.source_in + self.to_source(self.duration)
    }

    /// The longest the clip can be on the timeline from `source_in`, at
    /// `speed_percent`, without running past the end of its media. Rounded
    /// down, so `source_in + to_source(max)` never exceeds the media.
    fn max_duration(&self, source_in: Micros, speed_percent: u16) -> Micros {
        let remaining = i128::from(self.source_duration - source_in);
        (remaining * 100 / i128::from(speed_percent)) as Micros
    }

    fn overlaps(&self, start: Micros, end: Micros) -> bool {
        self.start < end && start < self.end()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: TrackId,
    pub kind: TrackKind,
    pub clips: Vec<Clip>,
}

impl Track {
    fn is_free(&self, start: Micros, end: Micros, ignore: Option<ClipId>) -> bool {
        self.clips
            .iter()
            .filter(|c| Some(c.id) != ignore)
            .all(|c| !c.overlaps(start, end))
    }

    fn insert_sorted(&mut self, clip: Clip) {
        let at = self.clips.partition_point(|c| c.start < clip.start);
        self.clips.insert(at, clip);
    }
}

/// A clip on the clipboard: where it came from, with `clip.start` relative to
/// the earliest copied clip. Its `id` is replaced when pasted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiedClip {
    pub track_id: TrackId,
    pub track_kind: TrackKind,
    pub clip: Clip,
}

/// Which edge of a clip a trim moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Edge {
    Start,
    End,
}

/// One clip visible at a given moment, as the renderer needs it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    /// Index of the track; higher indices are drawn on top.
    pub track_index: usize,
    pub clip_id: ClipId,
    pub asset_id: String,
    /// The time inside the source media to show.
    pub source_time: Micros,
    /// Time since the clip started, and its length (for text animations).
    pub clip_time: Micros,
    pub clip_duration: Micros,
    /// Set for text clips: what to draw instead of a video frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextContent>,
    /// Placement of a media clip at this moment (identity for text, which uses
    /// its style). Fractional while keyframes animate it.
    pub transform: ResolvedTransform,
    /// Colour adjustments (omitted when unchanged).
    #[serde(default, skip_serializing_if = "ColorAdjust::is_neutral")]
    pub color: ColorAdjust,
    /// LUT, applied before `color` (omitted when none).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lut: Option<LutRef>,
    /// Set while the layer is part of a transition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<LayerTransition>,
}

/// One audible stretch of a clip, as the audio mixer needs it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSegment {
    pub clip_id: ClipId,
    pub asset_id: String,
    /// Timeline position and length.
    pub start: Micros,
    pub duration: Micros,
    /// Where in the source the segment begins.
    pub source_in: Micros,
    /// Source media played per unit of timeline time (1.0 = normal speed).
    pub speed: f32,
    /// Linear gain (1.0 = unchanged).
    pub gain: f32,
    /// Gain ramps up from silence over this range (a transition into the clip).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_in: Option<AudioFade>,
    /// Gain ramps down to silence over this range (a transition out of the clip).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_out: Option<AudioFade>,
}

/// A gain ramp over a timeline range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFade {
    pub start: Micros,
    pub end: Micros,
    pub curve: FadeCurve,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FadeCurve {
    /// Straight ramp: for fades to and from silence (dip).
    Linear,
    /// sin/cos ramps whose powers sum to 1: a crossfade between two different
    /// sounds keeps a steady loudness instead of dipping ~3 dB in the middle.
    EqualPower,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EditError {
    #[error("track {0} not found")]
    TrackNotFound(TrackId),
    #[error("clip {0} not found")]
    ClipNotFound(ClipId),
    #[error("the clip would overlap another clip on the track")]
    Overlap,
    #[error(
        "the operation would make the clip shorter than the minimum or longer than its source"
    )]
    InvalidDuration,
    #[error("time {0} is outside the clip")]
    OutOfRange(Micros),
    #[error("a {0:?} clip cannot be placed on a {1:?} track")]
    KindMismatch(TrackKind, TrackKind),
    #[error("volume {0}% is out of range (0-200%)")]
    InvalidVolume(u16),
    #[error("speed {0}% is out of range ({MIN_SPEED_PERCENT}-{MAX_SPEED_PERCENT}%)")]
    InvalidSpeed(u16),
    #[error("a clip runs across the insertion point, so there's no room to insert there")]
    SpaceCrossesClip(Micros),
    #[error(
        "there isn't room for the slower clip: make space after it, or turn on ripple editing"
    )]
    NoRoomToSlowDown,
    #[error("invalid project data: {0}")]
    InvalidProject(String),
    #[error("invalid text: {0}")]
    InvalidText(#[from] TextError),
    #[error("clip {0} is not a text clip")]
    NotText(ClipId),
    #[error("text can only go on a video track")]
    TextNeedsVideoTrack,
    #[error("invalid transform: {0}")]
    InvalidTransform(#[from] TransformError),
    #[error(
        "text clips have no transform, keyframes or colour adjustments: style the text instead"
    )]
    NotMedia,
    #[error("invalid transition: {0}")]
    InvalidTransition(#[from] TransitionError),
    #[error("invalid colour adjustment: {0}")]
    InvalidColor(#[from] ColorError),
    #[error("keyframe: {0}")]
    InvalidKeyframe(#[from] KeyframeError),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub tracks: Vec<Track>,
    next_id: u32,
}

impl Timeline {
    pub fn new() -> Self {
        Self::default()
    }

    fn alloc_id(&mut self) -> u32 {
        self.next_id += 1;
        self.next_id
    }

    /// Total length: the end of the last clip on any track.
    pub fn duration(&self) -> Micros {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.last())
            .map(Clip::end)
            .max()
            .unwrap_or(0)
    }

    pub fn add_track(&mut self, kind: TrackKind) -> TrackId {
        let id = self.alloc_id();
        self.tracks.push(Track {
            id,
            kind,
            clips: Vec::new(),
        });
        id
    }

    /// Remove empty tracks, keeping at least one track of each kind (the first
    /// empty one, if a kind has no content at all). Returns the removed ids in
    /// track order. Called after edits that can leave a track empty.
    pub fn prune_empty_tracks(&mut self) -> Vec<TrackId> {
        let mut doomed: Vec<TrackId> = Vec::new();
        for kind in [TrackKind::Video, TrackKind::Audio] {
            let has_content = self
                .tracks
                .iter()
                .any(|t| t.kind == kind && !t.clips.is_empty());
            let mut empties = self
                .tracks
                .iter()
                .filter(|t| t.kind == kind && t.clips.is_empty())
                .map(|t| t.id);
            if !has_content {
                empties.next(); // keep one track of this kind
            }
            doomed.extend(empties);
        }
        let removed: Vec<TrackId> = self
            .tracks
            .iter()
            .map(|t| t.id)
            .filter(|id| doomed.contains(id))
            .collect();
        self.tracks.retain(|t| !doomed.contains(&t.id));
        removed
    }

    pub fn remove_track(&mut self, track_id: TrackId) -> Result<(), EditError> {
        let index = self.track_index(track_id)?;
        self.tracks.remove(index);
        Ok(())
    }

    pub fn add_clip(
        &mut self,
        track_id: TrackId,
        asset_id: &str,
        start: Micros,
        duration: Micros,
        source_in: Micros,
        source_duration: Micros,
    ) -> Result<ClipId, EditError> {
        if duration < MIN_CLIP_DURATION || source_in < 0 || source_in + duration > source_duration {
            return Err(EditError::InvalidDuration);
        }
        self.insert_clip(
            track_id,
            asset_id,
            start,
            duration,
            source_in,
            source_duration,
            None,
        )
    }

    /// Add a text clip (a title or caption) to a video track.
    pub fn add_text_clip(
        &mut self,
        track_id: TrackId,
        start: Micros,
        duration: Micros,
        content: TextContent,
    ) -> Result<ClipId, EditError> {
        content.validate()?;
        let index = self.track_index(track_id)?;
        if self.tracks[index].kind != TrackKind::Video {
            return Err(EditError::TextNeedsVideoTrack);
        }
        if !(MIN_CLIP_DURATION..=TEXT_SOURCE_DURATION).contains(&duration) {
            return Err(EditError::InvalidDuration);
        }
        self.insert_clip(
            track_id,
            TEXT_ASSET_ID,
            start,
            duration,
            0,
            TEXT_SOURCE_DURATION,
            Some(content),
        )
    }

    /// Replace a text clip's content and style.
    pub fn set_clip_text(
        &mut self,
        clip_id: ClipId,
        content: TextContent,
    ) -> Result<(), EditError> {
        content.validate()?;
        let (t, c) = self.locate(clip_id)?;
        let clip = &mut self.tracks[t].clips[c];
        if clip.text.is_none() {
            return Err(EditError::NotText(clip_id));
        }
        clip.text = Some(content);
        Ok(())
    }

    /// Set or clear the transition from the clip directly before this one.
    pub fn set_clip_transition(
        &mut self,
        clip_id: ClipId,
        transition: Option<Transition>,
    ) -> Result<(), EditError> {
        let (t, c) = self.locate(clip_id)?;
        if let Some(transition) = transition {
            transition.validate()?;
            let track = &self.tracks[t];
            let clip = &track.clips[c];
            let previous = c
                .checked_sub(1)
                .map(|p| &track.clips[p])
                .filter(|p| p.end() == clip.start)
                .ok_or(TransitionError::NoPreviousClip)?;
            if clip.text.is_some() || previous.text.is_some() {
                return Err(TransitionError::NotVideo.into());
            }
            if transition.duration() > clip.duration.min(previous.duration) {
                return Err(TransitionError::TooLong.into());
            }
        }
        self.tracks[t].clips[c].transition_in = transition;
        Ok(())
    }

    /// Set where a media clip appears in the frame.
    pub fn set_clip_transform(
        &mut self,
        clip_id: ClipId,
        transform: Transform,
    ) -> Result<(), EditError> {
        transform.validate()?;
        self.media_clip_mut(clip_id)?.transform = transform;
        Ok(())
    }

    /// Add a keyframe at `source_time` (a time in the clip's media, inside the
    /// clip) or change the transform of the one already there, keeping its easing.
    pub fn set_keyframe(
        &mut self,
        clip_id: ClipId,
        source_time: Micros,
        transform: Transform,
    ) -> Result<(), EditError> {
        transform.validate()?;
        let clip = self.media_clip_mut(clip_id)?;
        if source_time < clip.source_in || source_time > clip.source_end() {
            return Err(EditError::OutOfRange(source_time));
        }
        let keys = &mut clip.keyframes;
        let at = keys.partition_point(|k| k.source_time < source_time);
        match keys.get_mut(at) {
            Some(k) if k.source_time == source_time => k.transform = transform,
            _ => {
                if keys.len() >= keyframe::MAX_KEYFRAMES {
                    return Err(KeyframeError::TooMany.into());
                }
                keys.insert(
                    at,
                    Keyframe {
                        source_time,
                        transform,
                        easing: Easing::default(),
                    },
                );
            }
        }
        Ok(())
    }

    /// Set how the transform moves from the keyframe at `source_time` to the next.
    pub fn set_keyframe_easing(
        &mut self,
        clip_id: ClipId,
        source_time: Micros,
        easing: Easing,
    ) -> Result<(), EditError> {
        let clip = self.media_clip_mut(clip_id)?;
        let key = clip
            .keyframes
            .iter_mut()
            .find(|k| k.source_time == source_time)
            .ok_or(KeyframeError::NotFound)?;
        key.easing = easing;
        Ok(())
    }

    pub fn remove_keyframe(
        &mut self,
        clip_id: ClipId,
        source_time: Micros,
    ) -> Result<(), EditError> {
        let clip = self.media_clip_mut(clip_id)?;
        let index = clip
            .keyframes
            .iter()
            .position(|k| k.source_time == source_time)
            .ok_or(KeyframeError::NotFound)?;
        clip.keyframes.remove(index);
        Ok(())
    }

    /// Stop animating: the clip keeps its static `transform`.
    pub fn clear_keyframes(&mut self, clip_id: ClipId) -> Result<(), EditError> {
        self.media_clip_mut(clip_id)?.keyframes.clear();
        Ok(())
    }

    /// Set a media clip's brightness, contrast and saturation.
    pub fn set_clip_color(&mut self, clip_id: ClipId, color: ColorAdjust) -> Result<(), EditError> {
        color.validate()?;
        self.media_clip_mut(clip_id)?.color = color;
        Ok(())
    }

    /// Apply (or remove, with `None`) a LUT on a media clip.
    pub fn set_clip_lut(&mut self, clip_id: ClipId, lut: Option<LutRef>) -> Result<(), EditError> {
        if let Some(lut) = &lut {
            lut.validate()?;
        }
        self.media_clip_mut(clip_id)?.lut = lut;
        Ok(())
    }

    /// A media clip's transform at timeline time `at` (animated if it has
    /// keyframes; held before the first and after the last).
    pub fn clip_transform_at(
        &self,
        clip_id: ClipId,
        at: Micros,
    ) -> Result<ResolvedTransform, EditError> {
        let (t, c) = self.locate(clip_id)?;
        let clip = &self.tracks[t].clips[c];
        if clip.text.is_some() {
            return Err(EditError::NotMedia);
        }
        Ok(clip_transform(clip, at))
    }

    /// A clip that can have a transform, keyframes and colour adjustments (not text).
    fn media_clip_mut(&mut self, clip_id: ClipId) -> Result<&mut Clip, EditError> {
        let (t, c) = self.locate(clip_id)?;
        let clip = &mut self.tracks[t].clips[c];
        if clip.text.is_some() {
            return Err(EditError::NotMedia);
        }
        Ok(clip)
    }

    /// Shared by media and text clips: overlap check, id allocation, sorted insert.
    #[allow(clippy::too_many_arguments)]
    fn insert_clip(
        &mut self,
        track_id: TrackId,
        asset_id: &str,
        start: Micros,
        duration: Micros,
        source_in: Micros,
        source_duration: Micros,
        text: Option<TextContent>,
    ) -> Result<ClipId, EditError> {
        let start = start.max(0);
        let index = self.track_index(track_id)?;
        if !self.tracks[index].is_free(start, start + duration, None) {
            return Err(EditError::Overlap);
        }
        let id = self.alloc_id();
        self.tracks[index].insert_sorted(Clip {
            id,
            asset_id: asset_id.to_owned(),
            start,
            duration,
            source_in,
            source_duration,
            volume_percent: default_volume(),
            muted: false,
            speed_percent: default_speed(),
            text,
            transform: Transform::default(),
            keyframes: Vec::new(),
            color: ColorAdjust::default(),
            lut: None,
            transition_in: None,
        });
        Ok(id)
    }

    /// Append a clip right after the last clip of the track.
    pub fn append_clip(
        &mut self,
        track_id: TrackId,
        asset_id: &str,
        source_duration: Micros,
    ) -> Result<ClipId, EditError> {
        let index = self.track_index(track_id)?;
        let start = self.tracks[index].clips.last().map_or(0, Clip::end);
        self.add_clip(
            track_id,
            asset_id,
            start,
            source_duration,
            0,
            source_duration,
        )
    }

    pub fn remove_clip(&mut self, clip_id: ClipId) -> Result<Clip, EditError> {
        let (t, c) = self.locate(clip_id)?;
        Ok(self.tracks[t].clips.remove(c))
    }

    /// Remove a clip and close the space it leaves: later clips on its track
    /// move back by its length (other gaps and tracks are left as they are).
    pub fn ripple_delete(&mut self, clip_id: ClipId) -> Result<Clip, EditError> {
        let (t, c) = self.locate(clip_id)?;
        let clip = self.tracks[t].clips.remove(c);
        self.shift_from(t, c, -clip.duration);
        Ok(clip)
    }

    /// Open a gap of `length` at timeline time `at` on the given tracks: every
    /// clip starting at or after `at` moves later by `length` (ripple insert).
    /// Refused if a clip on one of them runs across `at`, since it can't be
    /// split implicitly.
    pub fn insert_space(
        &mut self,
        track_ids: &[TrackId],
        at: Micros,
        length: Micros,
    ) -> Result<(), EditError> {
        if length <= 0 {
            return Err(EditError::InvalidDuration);
        }
        let mut indices = Vec::with_capacity(track_ids.len());
        for &id in track_ids {
            let t = self.track_index(id)?;
            if self.tracks[t]
                .clips
                .iter()
                .any(|c| c.start < at && at < c.end())
            {
                return Err(EditError::SpaceCrossesClip(at));
            }
            if !indices.contains(&t) {
                indices.push(t);
            }
        }
        for t in indices {
            let from = self.tracks[t].clips.partition_point(|c| c.start < at);
            self.shift_from(t, from, length);
        }
        Ok(())
    }

    /// Move the clips of track `t` from index `from` onwards by `delta`.
    ///
    /// Callers only shift the clips after an edited clip by exactly how much
    /// its end moved, so order is kept and nothing can overlap or go below 0.
    fn shift_from(&mut self, t: usize, from: usize, delta: Micros) {
        if delta == 0 {
            return;
        }
        for clip in &mut self.tracks[t].clips[from..] {
            clip.start += delta;
            debug_assert!(clip.start >= 0, "ripple moved a clip before 0");
        }
    }

    /// Move a clip to `new_start`, optionally onto another track of the same kind.
    pub fn move_clip(
        &mut self,
        clip_id: ClipId,
        new_start: Micros,
        to_track: Option<TrackId>,
    ) -> Result<(), EditError> {
        let (t, c) = self.locate(clip_id)?;
        let target = match to_track {
            Some(id) => self.track_index(id)?,
            None => t,
        };
        let (from_kind, to_kind) = (self.tracks[t].kind, self.tracks[target].kind);
        if from_kind != to_kind {
            return Err(EditError::KindMismatch(from_kind, to_kind));
        }
        let new_start = new_start.max(0);
        let duration = self.tracks[t].clips[c].duration;
        if !self.tracks[target].is_free(new_start, new_start + duration, Some(clip_id)) {
            return Err(EditError::Overlap);
        }
        let mut clip = self.tracks[t].clips.remove(c);
        clip.start = new_start;
        self.tracks[target].insert_sorted(clip);
        Ok(())
    }

    /// Move several clips by the same amount of time, keeping their tracks.
    /// All or nothing: refused if any would start before 0 or overlap a clip
    /// that isn't moving.
    pub fn move_clips(&mut self, clip_ids: &[ClipId], delta: Micros) -> Result<(), EditError> {
        for &id in clip_ids {
            self.locate(id)?;
        }
        if delta == 0 {
            return Ok(());
        }
        for track in &self.tracks {
            let mut spans: Vec<(Micros, Micros)> = track
                .clips
                .iter()
                .map(|c| {
                    let shift = if clip_ids.contains(&c.id) { delta } else { 0 };
                    (c.start + shift, c.end() + shift)
                })
                .collect();
            if let Some(&(start, _)) = spans.iter().find(|(start, _)| *start < 0) {
                return Err(EditError::OutOfRange(start));
            }
            spans.sort_unstable();
            if spans.windows(2).any(|w| w[0].1 > w[1].0) {
                return Err(EditError::Overlap);
            }
        }
        for track in &mut self.tracks {
            for clip in track.clips.iter_mut().filter(|c| clip_ids.contains(&c.id)) {
                clip.start += delta;
            }
            track.clips.sort_by_key(|c| c.start);
        }
        Ok(())
    }

    /// Copy clips for pasting later: each keeps its track, and starts are made
    /// relative to the earliest copied clip. Ordered by track, then time.
    pub fn copy_clips(&self, clip_ids: &[ClipId]) -> Result<Vec<CopiedClip>, EditError> {
        let mut copied = Vec::with_capacity(clip_ids.len());
        for track in &self.tracks {
            for clip in track.clips.iter().filter(|c| clip_ids.contains(&c.id)) {
                copied.push(CopiedClip {
                    track_id: track.id,
                    track_kind: track.kind,
                    clip: clip.clone(),
                });
            }
        }
        if copied.len() != clip_ids.len() {
            let missing = clip_ids
                .iter()
                .find(|id| !copied.iter().any(|c| c.clip.id == **id));
            return Err(EditError::ClipNotFound(*missing.unwrap_or(&0)));
        }
        let earliest = copied.iter().map(|c| c.clip.start).min().unwrap_or(0);
        for c in &mut copied {
            c.clip.start -= earliest;
        }
        Ok(copied)
    }

    /// Paste copied clips with the earliest at timeline time `at`, keeping
    /// their spacing. Each original track gets its clips back if it still
    /// exists and has room for all of them; otherwise they go on a new track
    /// of the same kind (a new top layer for video, a new bottom row for
    /// audio), so a paste never overwrites anything. Returns the new clip ids.
    pub fn paste_clips(
        &mut self,
        copied: &[CopiedClip],
        at: Micros,
    ) -> Result<Vec<ClipId>, EditError> {
        let at = at.max(0);
        for c in copied {
            if c.clip.start < 0 || c.clip.duration < MIN_CLIP_DURATION {
                return Err(EditError::InvalidDuration);
            }
        }
        // Group by original track, in the order they were copied.
        let mut groups: Vec<(TrackId, TrackKind, Vec<&CopiedClip>)> = Vec::new();
        for c in copied {
            match groups.iter_mut().find(|(id, _, _)| *id == c.track_id) {
                Some((_, _, clips)) => clips.push(c),
                None => groups.push((c.track_id, c.track_kind, vec![c])),
            }
        }
        // Plan every group before changing anything: all or nothing.
        let plan: Vec<(Option<usize>, TrackKind, Vec<&CopiedClip>)> = groups
            .into_iter()
            .map(|(track_id, kind, clips)| {
                let target = self.tracks.iter().position(|t| {
                    t.id == track_id
                        && t.kind == kind
                        && clips.iter().all(|c| {
                            let start = at + c.clip.start;
                            t.is_free(start, start + c.clip.duration, None)
                        })
                });
                (target, kind, clips)
            })
            .collect();
        let mut ids = Vec::with_capacity(copied.len());
        for (target, kind, clips) in plan {
            let t = match target {
                Some(t) => t,
                None => {
                    self.add_track(kind);
                    self.tracks.len() - 1
                }
            };
            for c in clips {
                let mut clip = c.clip.clone();
                clip.id = self.alloc_id();
                clip.start = at + c.clip.start;
                ids.push(clip.id);
                self.tracks[t].insert_sorted(clip);
            }
        }
        Ok(ids)
    }

    /// Move one edge of a clip to the timeline time `at`.
    pub fn trim_clip(&mut self, clip_id: ClipId, edge: Edge, at: Micros) -> Result<(), EditError> {
        self.trim(clip_id, edge, at, false)
    }

    /// Trim with ripple: the clip stays where it starts and the later clips on
    /// its track follow its end. Trimming the start edge to `at` cuts (or, to
    /// the left, restores) that much of the clip's beginning.
    pub fn trim_clip_ripple(
        &mut self,
        clip_id: ClipId,
        edge: Edge,
        at: Micros,
    ) -> Result<(), EditError> {
        self.trim(clip_id, edge, at, true)
    }

    fn trim(
        &mut self,
        clip_id: ClipId,
        edge: Edge,
        at: Micros,
        ripple: bool,
    ) -> Result<(), EditError> {
        let (t, c) = self.locate(clip_id)?;
        let clip = self.tracks[t].clips[c].clone();
        let (start, duration, source_in) = match edge {
            Edge::Start => {
                // The furthest the head can extend is to source time 0 (and,
                // without ripple, to timeline time 0).
                let earliest = clip.start - clip.to_timeline(clip.source_in);
                let at = if ripple {
                    at.max(earliest)
                } else {
                    at.max(earliest).max(0)
                };
                let duration = clip.end() - at;
                let start = if ripple { clip.start } else { at };
                (start, duration, clip.source_at(at).max(0))
            }
            Edge::End => (clip.start, at - clip.start, clip.source_in),
        };
        if duration < MIN_CLIP_DURATION
            || duration > clip.max_duration(source_in, clip.speed_percent)
        {
            return Err(EditError::InvalidDuration);
        }
        if !ripple && !self.tracks[t].is_free(start, start + duration, Some(clip_id)) {
            return Err(EditError::Overlap);
        }
        let edited = &mut self.tracks[t].clips[c];
        edited.start = start;
        edited.duration = duration;
        edited.source_in = source_in;
        // Without ripple, the overlap check keeps the order; with it, the later
        // clips move by exactly as much as the end did.
        if ripple {
            self.shift_from(t, c + 1, start + duration - clip.end());
        }
        Ok(())
    }

    /// Split a clip in two at timeline time `at`. Returns the id of the new right-hand clip.
    pub fn split_clip(&mut self, clip_id: ClipId, at: Micros) -> Result<ClipId, EditError> {
        let (t, c) = self.locate(clip_id)?;
        let clip = &self.tracks[t].clips[c];
        if at - clip.start < MIN_CLIP_DURATION || clip.end() - at < MIN_CLIP_DURATION {
            return Err(EditError::OutOfRange(at));
        }
        let left_duration = at - clip.start;
        let mut right = clip.clone();
        right.transition_in = None; // the halves of a split simply cut together
        right.start = at;
        right.duration = clip.duration - left_duration;
        right.source_in = clip.source_at(at);
        right.id = self.alloc_id();
        let right_id = right.id;
        self.tracks[t].clips[c].duration = left_duration;
        self.tracks[t].clips.insert(c + 1, right);
        Ok(right_id)
    }

    /// Find the clip under timeline time `at` on a given track.
    pub fn clip_at(&self, track_id: TrackId, at: Micros) -> Option<&Clip> {
        let track = self.tracks.iter().find(|t| t.id == track_id)?;
        track.clips.iter().find(|c| c.start <= at && at < c.end())
    }

    /// Every video clip visible at timeline time `at`, bottom layer first.
    /// During a transition a track contributes both clips: outgoing, then incoming.
    ///
    /// This runs on every frame during playback, so it binary-searches each track
    /// and only looks at the clips either side of `at` for transitions.
    pub fn resolve(&self, at: Micros) -> Vec<Layer> {
        let mut layers = Vec::new();
        for (track_index, track) in self.tracks.iter().enumerate() {
            if track.kind != TrackKind::Video {
                continue;
            }
            let i = track.clips.partition_point(|c| c.end() <= at);
            // `at` is either in an incoming clip's head (i) or an outgoing clip's tail (i + 1).
            let transition = [i, i + 1].into_iter().find_map(|incoming| {
                let (outgoing, clip, duration) = active_transition(track, incoming)?;
                let window_start = clip.start - duration / 2;
                (window_start <= at && at < window_start + duration).then_some((
                    outgoing,
                    clip,
                    duration,
                    window_start,
                ))
            });
            if let Some((outgoing, incoming, duration, window_start)) = transition {
                let kind = incoming.transition_in.expect("active transition").kind;
                let progress = ((at - window_start) * 1000 / duration) as u16;
                for (clip, is_outgoing) in [(outgoing, true), (incoming, false)] {
                    layers.push(clip_layer(
                        track_index,
                        clip,
                        at,
                        Some(LayerTransition {
                            kind,
                            outgoing: is_outgoing,
                            progress,
                        }),
                    ));
                }
            } else if let Some(clip) = track.clips.get(i).filter(|c| c.start <= at) {
                layers.push(clip_layer(track_index, clip, at, None));
            }
        }
        layers
    }

    /// Every audible clip overlapping `[from, to)`, on any track, in timeline order.
    ///
    /// The audio mixer calls this for its look-ahead window. Video clips are
    /// included because their embedded audio plays too; muted and silent clips
    /// are left out so the mixer never decodes them.
    pub fn audio_segments(&self, from: Micros, to: Micros) -> Vec<AudioSegment> {
        let mut segments = Vec::new();
        for track in &self.tracks {
            for (index, clip) in track.clips.iter().enumerate() {
                // Titles have no sound; muted and silent clips are never decoded.
                if clip.text.is_some() || clip.muted || clip.volume_percent == 0 {
                    continue;
                }
                let segment = audio_segment(track, index, clip);
                if segment.start < to && from < segment.start + segment.duration {
                    segments.push(segment);
                }
            }
        }
        segments.sort_by_key(|s| (s.start, s.clip_id));
        segments
    }

    pub fn set_clip_volume(&mut self, clip_id: ClipId, percent: u16) -> Result<(), EditError> {
        if percent > MAX_VOLUME_PERCENT {
            return Err(EditError::InvalidVolume(percent));
        }
        let (t, c) = self.locate(clip_id)?;
        self.tracks[t].clips[c].volume_percent = percent;
        Ok(())
    }

    /// Change a media clip's speed, keeping the same media: the clip gets
    /// shorter when faster and longer when slower (if there is room after it).
    pub fn set_clip_speed(&mut self, clip_id: ClipId, percent: u16) -> Result<(), EditError> {
        self.set_speed(clip_id, percent, false)
    }

    /// Change speed with ripple: the later clips on the track follow the
    /// clip's new end, so slowing down always has room.
    pub fn set_clip_speed_ripple(
        &mut self,
        clip_id: ClipId,
        percent: u16,
    ) -> Result<(), EditError> {
        self.set_speed(clip_id, percent, true)
    }

    fn set_speed(&mut self, clip_id: ClipId, percent: u16, ripple: bool) -> Result<(), EditError> {
        if !(MIN_SPEED_PERCENT..=MAX_SPEED_PERCENT).contains(&percent) {
            return Err(EditError::InvalidSpeed(percent));
        }
        let (t, c) = self.locate(clip_id)?;
        let clip = &self.tracks[t].clips[c];
        if clip.text.is_some() {
            return Err(EditError::NotMedia);
        }
        let media = clip.source_end() - clip.source_in;
        let duration = scale(media, 100, percent).min(clip.max_duration(clip.source_in, percent));
        if duration < MIN_CLIP_DURATION {
            return Err(EditError::InvalidDuration);
        }
        if !ripple && !self.tracks[t].is_free(clip.start, clip.start + duration, Some(clip_id)) {
            return Err(EditError::NoRoomToSlowDown);
        }
        let delta = duration - clip.duration;
        let clip = &mut self.tracks[t].clips[c];
        clip.speed_percent = percent;
        clip.duration = duration;
        if ripple {
            self.shift_from(t, c + 1, delta);
        }
        Ok(())
    }

    pub fn set_clip_muted(&mut self, clip_id: ClipId, muted: bool) -> Result<(), EditError> {
        let (t, c) = self.locate(clip_id)?;
        self.tracks[t].clips[c].muted = muted;
        Ok(())
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("timeline is always serialisable")
    }

    pub fn from_json(json: &str) -> Result<Self, EditError> {
        let mut timeline: Self =
            serde_json::from_str(json).map_err(|e| EditError::InvalidProject(e.to_string()))?;
        // Edits keep keyframes in order; a hand-edited file might not.
        for clip in timeline.tracks.iter_mut().flat_map(|t| t.clips.iter_mut()) {
            keyframe::normalize(&mut clip.keyframes);
        }
        Ok(timeline)
    }

    /// Whether a clip's transition is in effect (it touches the clip before it).
    pub fn transition_active(&self, track_id: TrackId, clip_id: ClipId) -> bool {
        self.tracks
            .iter()
            .find(|t| t.id == track_id)
            .and_then(|track| {
                let index = track.clips.iter().position(|c| c.id == clip_id)?;
                active_transition(track, index)
            })
            .is_some()
    }

    fn track_index(&self, track_id: TrackId) -> Result<usize, EditError> {
        self.tracks
            .iter()
            .position(|t| t.id == track_id)
            .ok_or(EditError::TrackNotFound(track_id))
    }

    fn locate(&self, clip_id: ClipId) -> Result<(usize, usize), EditError> {
        self.tracks
            .iter()
            .enumerate()
            .find_map(|(t, track)| {
                track
                    .clips
                    .iter()
                    .position(|c| c.id == clip_id)
                    .map(|c| (t, c))
            })
            .ok_or(EditError::ClipNotFound(clip_id))
    }
}

/// The transition into the clip at `incoming`, if it's in effect: the clip
/// before it touches it, and both are media. Returns (outgoing, incoming,
/// effective duration). The duration is clamped to the clips' lengths, since
/// either may have been trimmed after the transition was added.
fn active_transition(track: &Track, incoming: usize) -> Option<(&Clip, &Clip, Micros)> {
    let clip = track.clips.get(incoming)?;
    let transition = clip.transition_in?;
    let outgoing = track.clips.get(incoming.checked_sub(1)?)?;
    if outgoing.end() != clip.start || clip.text.is_some() || outgoing.text.is_some() {
        return None;
    }
    let duration = transition
        .duration()
        .min(clip.duration)
        .min(outgoing.duration);
    (duration > 0).then_some((outgoing, clip, duration))
}

/// A clip's audio, including fades for the transitions into and out of it,
/// matching the picture (the same `active_transition` rule decides both).
///
/// Crossfade, slide and wipe use an equal-power crossfade centred on the cut:
/// the outgoing sound runs on past the cut and the incoming one starts before
/// it, as far as each file has media there (audio can't "hold a frame"), with
/// each fade spanning what's available. Dip fades out to the cut and in after
/// it, like the picture going through black.
fn audio_segment(track: &Track, index: usize, clip: &Clip) -> AudioSegment {
    let mut segment = AudioSegment {
        clip_id: clip.id,
        asset_id: clip.asset_id.clone(),
        start: clip.start,
        duration: clip.duration,
        source_in: clip.source_in,
        speed: f32::from(clip.speed_percent) / 100.0,
        gain: f32::from(clip.volume_percent) / 100.0,
        fade_in: None,
        fade_out: None,
    };
    if let Some((_, _, duration)) = active_transition(track, index) {
        let cut = clip.start;
        let half = duration / 2;
        segment.fade_in = Some(if is_dip(clip) {
            fade(cut, cut + half, FadeCurve::Linear)
        } else {
            let early = half.min(clip.to_timeline(clip.source_in));
            segment.start -= early;
            segment.duration += early;
            segment.source_in = (clip.source_in - clip.to_source(early)).max(0);
            fade(cut - early, cut + half, FadeCurve::EqualPower)
        });
    }
    if let Some((_, next, duration)) = active_transition(track, index + 1) {
        let cut = clip.end();
        let half = duration / 2;
        segment.fade_out = Some(if is_dip(next) {
            fade(cut - half, cut, FadeCurve::Linear)
        } else {
            let remaining = clip.to_timeline(clip.source_duration - clip.source_end());
            let late = half.min(remaining.max(0));
            segment.duration += late;
            fade(cut - half, cut + late, FadeCurve::EqualPower)
        });
    }
    segment
}

fn is_dip(incoming: &Clip) -> bool {
    matches!(
        incoming.transition_in.map(|t| t.kind),
        Some(crate::transition::TransitionKind::Dip)
    )
}

fn fade(start: Micros, end: Micros, curve: FadeCurve) -> AudioFade {
    AudioFade { start, end, curve }
}

/// A clip's transform at timeline time `at`, following its media.
fn clip_transform(clip: &Clip, at: Micros) -> ResolvedTransform {
    keyframe::evaluate(&clip.keyframes, clip.source_at(at)).unwrap_or_else(|| clip.transform.into())
}

/// A clip's layer at timeline time `at` (which may be just outside the clip
/// during a transition: the source time is then past its out-point or before
/// its in-point, and is clamped at the start of the media).
fn clip_layer(
    track_index: usize,
    clip: &Clip,
    at: Micros,
    transition: Option<LayerTransition>,
) -> Layer {
    Layer {
        track_index,
        clip_id: clip.id,
        asset_id: clip.asset_id.clone(),
        source_time: clip.source_at(at).max(0),
        clip_time: at - clip.start,
        clip_duration: clip.duration,
        text: clip.text.clone(),
        transform: clip_transform(clip, at),
        color: clip.color,
        lut: clip.lut.clone(),
        transition,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    const S: Micros = 1_000_000;

    fn timeline_with_clip() -> (Timeline, TrackId, ClipId) {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        let clip = tl.add_clip(track, "a", 2 * S, 4 * S, 0, 10 * S).unwrap();
        (tl, track, clip)
    }

    #[test]
    fn append_places_clips_back_to_back() {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        tl.append_clip(track, "a", 3 * S).unwrap();
        tl.append_clip(track, "b", 2 * S).unwrap();
        let starts: Vec<_> = tl.tracks[0].clips.iter().map(|c| c.start).collect();
        assert_eq!(starts, vec![0, 3 * S]);
        assert_eq!(tl.duration(), 5 * S);
    }

    #[test]
    fn rejects_overlapping_clips() {
        let (mut tl, track, _) = timeline_with_clip();
        assert_eq!(
            tl.add_clip(track, "b", 5 * S, 2 * S, 0, 2 * S),
            Err(EditError::Overlap)
        );
        // Touching edges are fine (half-open intervals).
        assert!(tl.add_clip(track, "b", 6 * S, 2 * S, 0, 2 * S).is_ok());
    }

    #[test]
    fn split_keeps_source_continuous() {
        let (mut tl, _, clip) = timeline_with_clip();
        let right = tl.split_clip(clip, 3 * S).unwrap();
        let clips = &tl.tracks[0].clips;
        assert_eq!(
            (clips[0].start, clips[0].duration, clips[0].source_in),
            (2 * S, S, 0)
        );
        assert_eq!(clips[1].id, right);
        assert_eq!(
            (clips[1].start, clips[1].duration, clips[1].source_in),
            (3 * S, 3 * S, S)
        );
    }

    #[test]
    fn split_outside_clip_fails() {
        let (mut tl, _, clip) = timeline_with_clip();
        assert_eq!(
            tl.split_clip(clip, 9 * S),
            Err(EditError::OutOfRange(9 * S))
        );
    }

    #[test]
    fn trim_start_moves_source_in() {
        let (mut tl, _, clip) = timeline_with_clip();
        tl.trim_clip(clip, Edge::Start, 3 * S).unwrap();
        let c = &tl.tracks[0].clips[0];
        assert_eq!((c.start, c.duration, c.source_in), (3 * S, 3 * S, S));
    }

    #[test]
    fn trim_start_cannot_go_before_source_start() {
        let (mut tl, _, clip) = timeline_with_clip();
        // source_in is 0, so the start edge cannot move left of 2s.
        tl.trim_clip(clip, Edge::Start, 0).unwrap();
        let c = &tl.tracks[0].clips[0];
        assert_eq!((c.start, c.duration, c.source_in), (2 * S, 4 * S, 0));
    }

    #[test]
    fn trim_end_is_bounded_by_source_length() {
        let (mut tl, _, clip) = timeline_with_clip();
        assert_eq!(
            tl.trim_clip(clip, Edge::End, 13 * S),
            Err(EditError::InvalidDuration)
        );
        tl.trim_clip(clip, Edge::End, 12 * S).unwrap();
        assert_eq!(tl.tracks[0].clips[0].duration, 10 * S);
    }

    #[test]
    fn move_checks_overlap_and_kind() {
        let (mut tl, track, clip) = timeline_with_clip();
        let other = tl.add_clip(track, "b", 8 * S, S, 0, S).unwrap();
        assert_eq!(tl.move_clip(other, 5 * S, None), Err(EditError::Overlap));
        tl.move_clip(other, 0, None).unwrap();
        assert_eq!(tl.tracks[0].clips[0].id, other, "clips stay sorted");

        let audio = tl.add_track(TrackKind::Audio);
        assert_eq!(
            tl.move_clip(clip, 0, Some(audio)),
            Err(EditError::KindMismatch(TrackKind::Video, TrackKind::Audio))
        );
    }

    #[test]
    fn resolve_returns_visible_layers_bottom_first() {
        let mut tl = Timeline::new();
        let bottom = tl.add_track(TrackKind::Video);
        let top = tl.add_track(TrackKind::Video);
        tl.add_clip(bottom, "bg", 0, 10 * S, 0, 10 * S).unwrap();
        tl.add_clip(top, "overlay", 4 * S, 2 * S, S, 5 * S).unwrap();

        let layers = tl.resolve(5 * S);
        assert_eq!(layers.len(), 2);
        assert_eq!(
            (layers[0].asset_id.as_str(), layers[0].source_time),
            ("bg", 5 * S)
        );
        assert_eq!(
            (layers[1].asset_id.as_str(), layers[1].source_time),
            ("overlay", 2 * S)
        );

        assert_eq!(tl.resolve(6 * S).len(), 1, "end is exclusive");
        assert!(tl.resolve(11 * S).is_empty());
    }

    #[test]
    fn audio_segments_include_all_tracks_and_skip_muted() {
        let mut tl = Timeline::new();
        let video = tl.add_track(TrackKind::Video);
        let music = tl.add_track(TrackKind::Audio);
        let v = tl.add_clip(video, "v", 0, 4 * S, S, 10 * S).unwrap();
        let m = tl.add_clip(music, "m", 2 * S, 6 * S, 0, 6 * S).unwrap();
        tl.set_clip_volume(m, 50).unwrap();

        let segments = tl.audio_segments(3 * S, 5 * S);
        assert_eq!(segments.len(), 2);
        assert_eq!(
            (segments[0].clip_id, segments[0].source_in, segments[0].gain),
            (v, S, 1.0)
        );
        assert_eq!((segments[1].clip_id, segments[1].gain), (m, 0.5));

        assert_eq!(
            tl.audio_segments(4 * S, 5 * S).len(),
            1,
            "window end is exclusive"
        );
        tl.set_clip_muted(m, true).unwrap();
        assert!(tl.audio_segments(4 * S, 5 * S).is_empty());
    }

    #[test]
    fn volume_is_bounded() {
        let (mut tl, _, clip) = timeline_with_clip();
        assert_eq!(
            tl.set_clip_volume(clip, 201),
            Err(EditError::InvalidVolume(201))
        );
        tl.set_clip_volume(clip, 0).unwrap();
        assert!(
            tl.audio_segments(0, 10 * S).is_empty(),
            "silent clips are skipped"
        );
    }

    #[test]
    fn split_keeps_volume_and_mute() {
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_clip_volume(clip, 150).unwrap();
        tl.set_clip_muted(clip, true).unwrap();
        tl.split_clip(clip, 3 * S).unwrap();
        assert!(tl.tracks[0]
            .clips
            .iter()
            .all(|c| c.volume_percent == 150 && c.muted));
    }

    #[test]
    fn projects_without_audio_fields_still_load() {
        let json = r#"{"tracks":[{"id":1,"kind":"video","clips":[{"id":2,"assetId":"a",
            "start":0,"duration":1000000,"sourceIn":0,"sourceDuration":1000000}]}],"nextId":2}"#;
        let tl = Timeline::from_json(json).unwrap();
        let clip = &tl.tracks[0].clips[0];
        assert_eq!((clip.volume_percent, clip.muted), (100, false));
    }

    #[test]
    fn prune_removes_empty_extra_tracks_only() {
        let mut tl = Timeline::new();
        let v1 = tl.add_track(TrackKind::Video);
        let a1 = tl.add_track(TrackKind::Audio);
        let v2 = tl.add_track(TrackKind::Video);
        let v3 = tl.add_track(TrackKind::Video);
        tl.add_clip(v3, "b-roll", 0, S, 0, S).unwrap();

        // v1 and v2 are empty, but v3 has content: both empty video tracks go.
        assert_eq!(tl.prune_empty_tracks(), vec![v1, v2]);
        let ids: Vec<_> = tl.tracks.iter().map(|t| t.id).collect();
        assert_eq!(
            ids,
            vec![a1, v3],
            "the empty audio track stays: it's the only one"
        );
    }

    #[test]
    fn prune_keeps_one_track_of_each_kind() {
        let mut tl = Timeline::new();
        let v1 = tl.add_track(TrackKind::Video);
        let a1 = tl.add_track(TrackKind::Audio);
        tl.add_track(TrackKind::Video);
        tl.add_track(TrackKind::Audio);
        tl.prune_empty_tracks();
        let ids: Vec<_> = tl.tracks.iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![v1, a1], "the first track of each kind is kept");
    }

    #[test]
    fn prune_is_a_no_op_when_nothing_is_empty() {
        let (mut tl, _, _) = timeline_with_clip();
        tl.add_track(TrackKind::Audio);
        assert!(tl.prune_empty_tracks().is_empty());
        assert_eq!(tl.tracks.len(), 2);
    }

    fn title(text: &str) -> TextContent {
        TextContent {
            text: text.into(),
            style: crate::text::TextStyle::default(),
            words: Vec::new(),
        }
    }

    #[test]
    fn text_clips_are_resolved_as_text_layers() {
        let mut tl = Timeline::new();
        let video = tl.add_track(TrackKind::Video);
        let titles = tl.add_track(TrackKind::Video);
        tl.add_clip(video, "a", 0, 10 * S, 0, 10 * S).unwrap();
        tl.add_text_clip(titles, 2 * S, 3 * S, title("Hello"))
            .unwrap();

        let layers = tl.resolve(3 * S);
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[0].text, None, "the video layer is underneath");
        let text = &layers[1];
        assert_eq!(text.text.as_ref().unwrap().text, "Hello");
        assert_eq!((text.clip_time, text.clip_duration), (S, 3 * S));
    }

    #[test]
    fn text_needs_a_video_track_and_valid_content() {
        let mut tl = Timeline::new();
        let audio = tl.add_track(TrackKind::Audio);
        let video = tl.add_track(TrackKind::Video);
        assert_eq!(
            tl.add_text_clip(audio, 0, S, title("Hi")),
            Err(EditError::TextNeedsVideoTrack)
        );
        assert_eq!(
            tl.add_text_clip(video, 0, S, title(" ")),
            Err(EditError::InvalidText(TextError::Empty))
        );
    }

    #[test]
    fn text_clips_split_trim_freely_and_are_silent() {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        let clip = tl.add_text_clip(track, 0, 4 * S, title("Hi")).unwrap();
        let right = tl.split_clip(clip, 2 * S).unwrap();
        assert!(tl.tracks[0]
            .clips
            .iter()
            .all(|c| c.text == Some(title("Hi"))));
        tl.trim_clip(right, Edge::End, 60 * S).unwrap(); // no media length to run out of
        assert_eq!(tl.duration(), 60 * S);
        assert!(tl.audio_segments(0, 60 * S).is_empty());
    }

    #[test]
    fn set_clip_text_validates_and_only_applies_to_text_clips() {
        let (mut tl, track, media) = timeline_with_clip();
        let text = tl.add_text_clip(track, 8 * S, S, title("Old")).unwrap();
        tl.set_clip_text(text, title("New")).unwrap();
        assert_eq!(tl.resolve(8 * S)[0].text.as_ref().unwrap().text, "New");
        assert_eq!(
            tl.set_clip_text(media, title("No")),
            Err(EditError::NotText(media))
        );
        assert_eq!(
            tl.set_clip_text(text, title("")),
            Err(EditError::InvalidText(TextError::Empty))
        );
    }

    #[test]
    fn text_survives_a_json_round_trip() {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        tl.add_text_clip(track, 0, S, title("Saved")).unwrap();
        assert_eq!(Timeline::from_json(&tl.to_json()).unwrap(), tl);
    }

    #[test]
    fn transforms_are_resolved_and_kept_on_split() {
        let (mut tl, _, clip) = timeline_with_clip();
        let pip = Transform {
            x: 785,
            y: 785,
            scale_percent: 35,
            rotation_deg: 0,
            opacity_percent: 100,
        };
        tl.set_clip_transform(clip, pip).unwrap();
        assert_eq!(tl.resolve(3 * S)[0].transform, pip.into());
        tl.split_clip(clip, 4 * S).unwrap();
        assert!(tl.tracks[0].clips.iter().all(|c| c.transform == pip));
    }

    #[test]
    fn transforms_are_validated_and_not_for_text() {
        let (mut tl, track, clip) = timeline_with_clip();
        let bad = Transform {
            scale_percent: 0,
            ..Transform::default()
        };
        assert_eq!(
            tl.set_clip_transform(clip, bad),
            Err(EditError::InvalidTransform(TransformError::Scale(0)))
        );
        let text = tl.add_text_clip(track, 8 * S, S, title("Hi")).unwrap();
        assert_eq!(
            tl.set_clip_transform(text, Transform::default()),
            Err(EditError::NotMedia)
        );
    }

    #[test]
    fn unchanged_transforms_are_not_saved() {
        let (mut tl, _, clip) = timeline_with_clip();
        assert!(!tl.to_json().contains("transform"), "identity is omitted");
        let moved = Transform {
            x: 100,
            ..Transform::default()
        };
        tl.set_clip_transform(clip, moved).unwrap();
        let json = tl.to_json();
        assert!(json.contains("transform"));
        assert_eq!(Timeline::from_json(&json).unwrap(), tl);
    }

    fn two_clips() -> (Timeline, TrackId, ClipId, ClipId) {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        // a: 0-6 s from source 0; b: 6-9 s from source 2 s.
        let a = tl.add_clip(track, "a", 0, 6 * S, 0, 10 * S).unwrap();
        let b = tl
            .add_clip(track, "b", 6 * S, 3 * S, 2 * S, 10 * S)
            .unwrap();
        (tl, track, a, b)
    }

    fn crossfade(ms: u16) -> Transition {
        Transition {
            kind: crate::transition::TransitionKind::Crossfade,
            duration_ms: ms,
        }
    }

    #[test]
    fn transitions_show_both_clips_around_the_cut() {
        let (mut tl, _, a, b) = two_clips();
        tl.set_clip_transition(b, Some(crossfade(1000))).unwrap();

        assert_eq!(tl.resolve(5_400_000).len(), 1, "before the window: only a");
        let at_cut = tl.resolve(6 * S);
        assert_eq!(at_cut.len(), 2);
        let (out, inc) = (&at_cut[0], &at_cut[1]);
        assert_eq!((out.clip_id, inc.clip_id), (a, b));
        assert!(out.transition.unwrap().outgoing);
        assert_eq!(
            inc.transition.unwrap().progress,
            500,
            "the cut is the midpoint"
        );
        // The outgoing clip plays on past its end; the incoming one started early.
        assert_eq!(out.source_time, 6 * S);
        let early = tl.resolve(5_600_000);
        assert_eq!(early[1].source_time, 2 * S - 400_000);
        assert_eq!(tl.resolve(6_600_000).len(), 1, "after the window: only b");
    }

    #[test]
    fn transitions_need_touching_media_clips_and_fit() {
        let (mut tl, track, a, b) = two_clips();
        assert_eq!(
            tl.set_clip_transition(a, Some(crossfade(500))),
            Err(EditError::InvalidTransition(
                TransitionError::NoPreviousClip
            ))
        );
        assert_eq!(
            tl.set_clip_transition(b, Some(crossfade(50))),
            Err(EditError::InvalidTransition(TransitionError::Duration(50)))
        );
        assert_eq!(
            tl.set_clip_transition(b, Some(crossfade(3000))),
            Ok(()),
            "3 s fits: b is 3 s long"
        );
        let title = tl.add_text_clip(track, 9 * S, S, title("Hi")).unwrap();
        assert_eq!(
            tl.set_clip_transition(title, Some(crossfade(500))),
            Err(EditError::InvalidTransition(TransitionError::NotVideo))
        );
    }

    #[test]
    fn transitions_go_inactive_when_clips_part_and_clamp_when_trimmed() {
        let (mut tl, track, _, b) = two_clips();
        tl.set_clip_transition(b, Some(crossfade(2000))).unwrap();
        assert!(tl.transition_active(track, b));
        tl.move_clip(b, 7 * S, None).unwrap();
        assert!(!tl.transition_active(track, b));
        assert_eq!(
            tl.resolve(6_500_000).len(),
            0,
            "the gap is empty, no transition"
        );
        tl.move_clip(b, 6 * S, None).unwrap();
        tl.trim_clip(b, Edge::End, 6_400_000).unwrap(); // b is now 0.4 s long
        assert_eq!(
            tl.resolve(5_850_000).len(),
            2,
            "clamped to 0.4 s around the cut"
        );
        assert_eq!(tl.resolve(5_700_000).len(), 1);
    }

    fn fade_of(segments: &[AudioSegment], clip: ClipId) -> (Option<AudioFade>, Option<AudioFade>) {
        let s = segments.iter().find(|s| s.clip_id == clip).unwrap();
        (s.fade_in, s.fade_out)
    }

    #[test]
    fn crossfades_extend_both_sounds_across_the_cut() {
        let (mut tl, _, a, b) = two_clips(); // a: 0-6 s (source 0-6 of 10), b: 6-9 s (source 2-5)
        tl.set_clip_transition(b, Some(crossfade(1000))).unwrap();
        let segments = tl.audio_segments(0, 10 * S);
        let sa = segments.iter().find(|s| s.clip_id == a).unwrap();
        let sb = segments.iter().find(|s| s.clip_id == b).unwrap();
        // a plays on to 6.5 s, fading out from 5.5 s; b starts at 5.5 s, fading in to 6.5 s.
        assert_eq!(sa.start + sa.duration, 6_500_000);
        assert_eq!(
            sa.fade_out,
            Some(fade(5_500_000, 6_500_000, FadeCurve::EqualPower))
        );
        assert_eq!((sb.start, sb.source_in), (5_500_000, 1_500_000));
        assert_eq!(
            sb.fade_in,
            Some(fade(5_500_000, 6_500_000, FadeCurve::EqualPower))
        );
        assert_eq!((sa.fade_in, sb.fade_out), (None, None));
    }

    #[test]
    fn crossfades_only_extend_as_far_as_the_media_goes() {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        // a uses its source to the very end; b starts at its source's very beginning.
        let a = tl.add_clip(track, "a", 0, 6 * S, 0, 6 * S).unwrap();
        let b = tl.add_clip(track, "b", 6 * S, 3 * S, 0, 3 * S).unwrap();
        tl.set_clip_transition(b, Some(crossfade(1000))).unwrap();
        let segments = tl.audio_segments(0, 10 * S);
        let (_, a_out) = fade_of(&segments, a);
        let (b_in, _) = fade_of(&segments, b);
        // No media past a's end or before b's start: the fades span what exists.
        assert_eq!(a_out, Some(fade(5_500_000, 6 * S, FadeCurve::EqualPower)));
        assert_eq!(b_in, Some(fade(6 * S, 6_500_000, FadeCurve::EqualPower)));
        assert!(segments.iter().all(|s| s.source_in >= 0));
    }

    #[test]
    fn dips_fade_out_to_the_cut_then_in() {
        let (mut tl, _, a, b) = two_clips();
        tl.set_clip_transition(
            b,
            Some(Transition {
                kind: crate::transition::TransitionKind::Dip,
                duration_ms: 1000,
            }),
        )
        .unwrap();
        let segments = tl.audio_segments(0, 10 * S);
        assert_eq!(
            fade_of(&segments, a).1,
            Some(fade(5_500_000, 6 * S, FadeCurve::Linear))
        );
        assert_eq!(
            fade_of(&segments, b).0,
            Some(fade(6 * S, 6_500_000, FadeCurve::Linear))
        );
        let sb = segments.iter().find(|s| s.clip_id == b).unwrap();
        assert_eq!(sb.start, 6 * S, "no early start for a dip");
    }

    #[test]
    fn no_fades_without_an_active_transition_and_muting_still_fades_the_other_side() {
        let (mut tl, _, a, b) = two_clips();
        tl.set_clip_transition(b, Some(crossfade(1000))).unwrap();
        tl.move_clip(b, 7 * S, None).unwrap(); // apart: inactive
        assert!(tl
            .audio_segments(0, 10 * S)
            .iter()
            .all(|s| s.fade_in.is_none() && s.fade_out.is_none()));
        tl.move_clip(b, 6 * S, None).unwrap();
        tl.set_clip_muted(a, true).unwrap();
        let segments = tl.audio_segments(0, 10 * S);
        assert_eq!(segments.len(), 1);
        assert!(
            segments[0].fade_in.is_some(),
            "b still fades in under the picture"
        );
    }

    #[test]
    fn the_query_window_includes_the_extended_sound() {
        let (mut tl, _, _, b) = two_clips();
        tl.set_clip_transition(b, Some(crossfade(1000))).unwrap();
        // 5.6 s is before b starts on the timeline, but b's sound has already begun.
        let ids: Vec<_> = tl
            .audio_segments(5_600_000, 5_700_000)
            .iter()
            .map(|s| s.clip_id)
            .collect();
        assert!(ids.contains(&b));
    }

    #[test]
    fn split_halves_cut_together() {
        let (mut tl, _, _, b) = two_clips();
        tl.set_clip_transition(b, Some(crossfade(1000))).unwrap();
        let right = tl.split_clip(b, 7 * S).unwrap();
        let clips = &tl.tracks[0].clips;
        assert!(
            clips[1].transition_in.is_some(),
            "b keeps its transition in"
        );
        assert_eq!(clips[2].id, right);
        assert!(clips[2].transition_in.is_none());
    }

    #[test]
    fn json_round_trip() {
        let (tl, _, _) = timeline_with_clip();
        let restored = Timeline::from_json(&tl.to_json()).unwrap();
        assert_eq!(restored, tl);
    }

    fn at_x(x: i16) -> Transform {
        Transform {
            x,
            ..Transform::default()
        }
    }

    /// The animated x position of the clip's layer at timeline time `at`.
    fn x_at(tl: &Timeline, at: Micros) -> f64 {
        tl.resolve(at)[0].transform.x
    }

    #[test]
    fn keyframes_animate_the_resolved_transform() {
        // The clip runs 2-6 s on the timeline, showing source 0-4 s.
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_keyframe(clip, 0, at_x(0)).unwrap();
        tl.set_keyframe(clip, 4 * S, at_x(1000)).unwrap();
        assert_eq!(x_at(&tl, 2 * S), 0.0);
        assert_eq!(x_at(&tl, 3 * S), 250.0);
        let fractional = x_at(&tl, 3 * S + S / 1000);
        assert!(
            (fractional - 250.25).abs() < 1e-9,
            "not stepped: {fractional}"
        );
        // The static transform is unused while keyframes exist.
        tl.set_clip_transform(clip, at_x(900)).unwrap();
        assert_eq!(x_at(&tl, 4 * S), 500.0);
        // Also available for any clip, whether or not it's on screen.
        assert_eq!(tl.clip_transform_at(clip, 0).unwrap().x, 0.0);
        assert_eq!(tl.clip_transform_at(clip, 4 * S).unwrap().x, 500.0);
        tl.clear_keyframes(clip).unwrap();
        assert_eq!(x_at(&tl, 4 * S), 900.0);
    }

    #[test]
    fn keyframes_stay_with_the_media_when_trimmed_or_split() {
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_keyframe(clip, 0, at_x(0)).unwrap();
        tl.set_keyframe(clip, 4 * S, at_x(1000)).unwrap();
        // Trim one second off the start: the same picture moment has the same transform.
        tl.trim_clip(clip, Edge::Start, 3 * S).unwrap();
        assert_eq!(x_at(&tl, 4 * S), 500.0);
        // Split: both halves carry the animation on seamlessly.
        tl.split_clip(clip, 4 * S).unwrap();
        assert_eq!(x_at(&tl, 4 * S - 1), 500.0 - 1000.0 / 4.0 / S as f64);
        assert_eq!(x_at(&tl, 5 * S), 750.0);
    }

    #[test]
    fn setting_a_keyframe_again_updates_it_and_keeps_its_easing() {
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_keyframe(clip, 2 * S, at_x(100)).unwrap();
        tl.set_keyframe(clip, S, at_x(50)).unwrap();
        tl.set_keyframe_easing(clip, 2 * S, Easing::EaseOut)
            .unwrap();
        tl.set_keyframe(clip, 2 * S, at_x(200)).unwrap();
        let keys = &tl.tracks[0].clips[0].keyframes;
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].source_time, S, "kept in time order");
        assert_eq!(
            (keys[1].transform.x, keys[1].easing),
            (200, Easing::EaseOut)
        );
    }

    #[test]
    fn keyframe_edits_are_validated() {
        let (mut tl, track, clip) = timeline_with_clip();
        assert_eq!(
            tl.set_keyframe(clip, 5 * S, at_x(0)),
            Err(EditError::OutOfRange(5 * S)),
            "outside the clip's media range"
        );
        assert!(matches!(
            tl.set_keyframe(clip, 0, at_x(3000)),
            Err(EditError::InvalidTransform(_))
        ));
        assert_eq!(
            tl.remove_keyframe(clip, S),
            Err(EditError::InvalidKeyframe(KeyframeError::NotFound))
        );
        assert_eq!(
            tl.set_keyframe_easing(clip, S, Easing::EaseIn),
            Err(EditError::InvalidKeyframe(KeyframeError::NotFound))
        );
        let text = tl.add_text_clip(track, 8 * S, S, title("Hi")).unwrap();
        assert_eq!(tl.set_keyframe(text, 0, at_x(0)), Err(EditError::NotMedia));
        for i in 0..keyframe::MAX_KEYFRAMES as i64 {
            tl.set_keyframe(clip, i * 1000, at_x(0)).unwrap();
        }
        assert_eq!(
            tl.set_keyframe(clip, 3 * S, at_x(0)),
            Err(EditError::InvalidKeyframe(KeyframeError::TooMany))
        );
        tl.set_keyframe(clip, 0, at_x(5)).unwrap(); // updating one is still fine
        tl.remove_keyframe(clip, 0).unwrap();
        assert_eq!(
            tl.tracks[0].clips[0].keyframes.len(),
            keyframe::MAX_KEYFRAMES - 1
        );
    }

    #[test]
    fn keyframes_are_saved_only_when_present_and_put_in_order_on_load() {
        let (mut tl, _, clip) = timeline_with_clip();
        assert!(!tl.to_json().contains("keyframes"));
        tl.set_keyframe(clip, S, at_x(10)).unwrap();
        tl.set_keyframe(clip, 2 * S, at_x(20)).unwrap();
        let json = tl.to_json();
        assert_eq!(Timeline::from_json(&json).unwrap(), tl);
        // A hand-edited file with keyframes out of order still loads in order.
        let swapped = json.replacen("\"sourceTime\":1000000", "\"sourceTime\":3000000", 1);
        let loaded = Timeline::from_json(&swapped).unwrap();
        let times: Vec<_> = loaded.tracks[0].clips[0]
            .keyframes
            .iter()
            .map(|k| k.source_time)
            .collect();
        assert_eq!(times, [2 * S, 3 * S]);
    }

    #[test]
    fn colour_adjustments_are_resolved_saved_and_kept_on_split() {
        let (mut tl, track, clip) = timeline_with_clip();
        assert!(tl.resolve(3 * S)[0].color.is_neutral());
        assert!(!tl.to_json().contains("color"), "neutral is omitted");
        let mono = ColorAdjust {
            saturation: -100,
            ..ColorAdjust::default()
        };
        tl.set_clip_color(clip, mono).unwrap();
        assert_eq!(tl.resolve(3 * S)[0].color, mono);
        tl.split_clip(clip, 4 * S).unwrap();
        assert!(tl.tracks[0].clips.iter().all(|c| c.color == mono));
        assert_eq!(Timeline::from_json(&tl.to_json()).unwrap(), tl);

        let bad = ColorAdjust {
            brightness: 101,
            ..ColorAdjust::default()
        };
        assert_eq!(
            tl.set_clip_color(clip, bad),
            Err(EditError::InvalidColor(ColorError::OutOfRange(
                "brightness",
                101
            )))
        );
        let text = tl.add_text_clip(track, 8 * S, S, title("Hi")).unwrap();
        assert_eq!(tl.set_clip_color(text, mono), Err(EditError::NotMedia));
    }

    #[test]
    fn speed_keeps_the_media_and_changes_the_length() {
        // 2-6 s on the timeline, source 0-4 s.
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_clip_speed(clip, 200).unwrap();
        let c = &tl.tracks[0].clips[0];
        assert_eq!((c.start, c.duration, c.source_end()), (2 * S, 2 * S, 4 * S));
        assert_eq!(tl.resolve(3 * S)[0].source_time, 2 * S);
        tl.set_clip_speed(clip, 50).unwrap();
        let c = &tl.tracks[0].clips[0];
        assert_eq!((c.duration, c.source_end()), (8 * S, 4 * S));
        assert_eq!(tl.resolve(4 * S)[0].source_time, S);
        tl.set_clip_speed(clip, 100).unwrap();
        assert_eq!(tl.tracks[0].clips[0].duration, 4 * S);
    }

    #[test]
    fn speed_changes_are_validated() {
        let (mut tl, track, clip) = timeline_with_clip();
        tl.add_clip(track, "b", 7 * S, S, 0, S).unwrap();
        assert_eq!(
            tl.set_clip_speed(clip, 50),
            Err(EditError::NoRoomToSlowDown),
            "8 s would run into the clip at 7 s"
        );
        assert_eq!(
            tl.set_clip_speed(clip, 24),
            Err(EditError::InvalidSpeed(24))
        );
        assert_eq!(
            tl.set_clip_speed(clip, 401),
            Err(EditError::InvalidSpeed(401))
        );
        let text = tl.add_text_clip(track, 9 * S, S, title("Hi")).unwrap();
        assert_eq!(tl.set_clip_speed(text, 200), Err(EditError::NotMedia));
        assert_eq!(tl.tracks[0].clips[0].duration, 4 * S, "unchanged");
    }

    #[test]
    fn trimming_and_splitting_follow_the_speed() {
        let (mut tl, _, clip) = timeline_with_clip(); // 10 s of media
        tl.set_clip_speed(clip, 200).unwrap(); // 2-4 s, source 0-4 s
                                               // At 2x, the remaining 10 s of media lasts 5 s: the end can go to 7 s, no further.
        tl.trim_clip(clip, Edge::End, 7 * S).unwrap();
        assert_eq!(tl.tracks[0].clips[0].source_end(), 10 * S);
        assert_eq!(
            tl.trim_clip(clip, Edge::End, 7 * S + 1),
            Err(EditError::InvalidDuration)
        );
        tl.trim_clip(clip, Edge::Start, 3 * S).unwrap();
        assert_eq!(tl.tracks[0].clips[0].source_in, 2 * S);
        let right = tl.split_clip(clip, 4 * S).unwrap();
        let right = tl.tracks[0].clips.iter().find(|c| c.id == right).unwrap();
        assert_eq!((right.source_in, right.speed_percent), (4 * S, 200));
    }

    #[test]
    fn speed_reaches_the_audio_and_keyframes() {
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_keyframe(clip, 0, at_x(0)).unwrap();
        tl.set_keyframe(clip, 4 * S, at_x(1000)).unwrap();
        tl.set_clip_speed(clip, 200).unwrap();
        // Keyframes follow the media: halfway through the (now 2 s) clip is source 2 s.
        assert_eq!(x_at(&tl, 3 * S), 500.0);
        let segment = &tl.audio_segments(0, 10 * S)[0];
        assert_eq!(
            (segment.start, segment.duration, segment.speed),
            (2 * S, 2 * S, 2.0)
        );
    }

    #[test]
    fn crossfade_extensions_are_measured_in_timeline_time() {
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        let a = tl.add_clip(track, "a", 0, 4 * S, 0, 20 * S).unwrap();
        let b = tl
            .add_clip(track, "b", 4 * S, 4 * S, 4 * S, 20 * S)
            .unwrap();
        tl.set_clip_speed(b, 200).unwrap(); // 4-6 s, source 4-8 s
        let fade = Transition {
            kind: crate::transition::TransitionKind::Crossfade,
            duration_ms: 1000,
        };
        tl.set_clip_transition(b, Some(fade)).unwrap();
        let segments = tl.audio_segments(0, 10 * S);
        let incoming = segments.iter().find(|s| s.clip_id == b).unwrap();
        // Starts 0.5 s early on the timeline, which is 1 s of its (2x) media.
        assert_eq!((incoming.start, incoming.source_in), (3_500_000, 3 * S));
        let outgoing = segments.iter().find(|s| s.clip_id == a).unwrap();
        assert_eq!(outgoing.duration, 4_500_000);
    }

    #[test]
    fn normal_speed_is_not_saved() {
        let (mut tl, _, clip) = timeline_with_clip();
        assert!(!tl.to_json().contains("speedPercent"));
        tl.set_clip_speed(clip, 150).unwrap();
        assert!(tl.to_json().contains("\"speedPercent\":150"));
        assert_eq!(Timeline::from_json(&tl.to_json()).unwrap(), tl);
    }

    #[test]
    fn the_longest_clip_never_runs_past_its_media() {
        for speed in [25, 33, 67, 100, 150, 299, 300, 333, 400] {
            for media in [10_001, 999_999, 1_234_567, 7 * S + 3] {
                for source_in in [0, 1, 333_333] {
                    let clip = Clip {
                        source_in,
                        source_duration: media + source_in,
                        speed_percent: speed,
                        ..timeline_with_clip().0.tracks[0].clips[0].clone()
                    };
                    let max = clip.max_duration(source_in, speed);
                    let fitted = Clip {
                        duration: max,
                        ..clip.clone()
                    };
                    assert!(
                        fitted.source_end() <= clip.source_duration,
                        "{speed}% {media}"
                    );
                    let over = Clip {
                        duration: max + 1,
                        ..clip
                    };
                    assert!(over.source_end() > over.source_duration - 2, "tight bound");
                }
            }
        }
    }

    /// Track with a (0-2 s, media from 1 s of 10 s), b (2-4 s) and c (6-7 s),
    /// plus another track with d (1-5 s).
    fn ripple_timeline() -> (Timeline, [ClipId; 4]) {
        let mut tl = Timeline::new();
        let v = tl.add_track(TrackKind::Video);
        let other = tl.add_track(TrackKind::Video);
        let a = tl.add_clip(v, "a", 0, 2 * S, S, 10 * S).unwrap();
        let b = tl.add_clip(v, "b", 2 * S, 2 * S, 0, 10 * S).unwrap();
        let c = tl.add_clip(v, "c", 6 * S, S, 0, 10 * S).unwrap();
        let d = tl.add_clip(other, "d", S, 4 * S, 0, 10 * S).unwrap();
        (tl, [a, b, c, d])
    }

    fn starts(tl: &Timeline) -> Vec<(ClipId, Micros, Micros)> {
        tl.tracks
            .iter()
            .flat_map(|t| &t.clips)
            .map(|c| (c.id, c.start, c.duration))
            .collect()
    }

    #[test]
    fn ripple_delete_closes_the_clip_s_space_on_its_track_only() {
        let (mut tl, [a, b, c, d]) = ripple_timeline();
        tl.ripple_delete(b).unwrap();
        // c moves back by b's length; the 2 s gap before it stays; d doesn't move.
        assert_eq!(starts(&tl), [(a, 0, 2 * S), (c, 4 * S, S), (d, S, 4 * S)]);
    }

    #[test]
    fn ripple_trimming_the_end_moves_later_clips_with_it() {
        let (mut tl, [a, b, c, d]) = ripple_timeline();
        tl.trim_clip_ripple(a, Edge::End, S).unwrap();
        assert_eq!(
            starts(&tl),
            [(a, 0, S), (b, S, 2 * S), (c, 5 * S, S), (d, S, 4 * S)]
        );
        // Lengthening pushes them out, where a plain trim would hit b.
        assert_eq!(tl.trim_clip(a, Edge::End, 2 * S), Err(EditError::Overlap));
        tl.trim_clip_ripple(a, Edge::End, 3 * S).unwrap();
        assert_eq!(
            starts(&tl),
            [
                (a, 0, 3 * S),
                (b, 3 * S, 2 * S),
                (c, 7 * S, S),
                (d, S, 4 * S)
            ]
        );
    }

    #[test]
    fn ripple_trimming_the_start_keeps_the_clip_in_place() {
        let (mut tl, [a, b, c, _]) = ripple_timeline();
        // Cut half a second off the beginning: a stays at 0 and is shorter.
        tl.trim_clip_ripple(a, Edge::Start, S / 2).unwrap();
        let clip = &tl.tracks[0].clips[0];
        assert_eq!(
            (clip.start, clip.duration, clip.source_in),
            (0, 3 * S / 2, 3 * S / 2)
        );
        assert_eq!(tl.tracks[0].clips[1].start, 3 * S / 2);
        // Restore past the original in-point: as far as the media goes (source 0).
        tl.trim_clip_ripple(a, Edge::Start, -5 * S).unwrap();
        let clip = &tl.tracks[0].clips[0];
        assert_eq!((clip.start, clip.duration, clip.source_in), (0, 3 * S, 0));
        assert_eq!(starts(&tl)[1..3], [(b, 3 * S, 2 * S), (c, 7 * S, S)]);
    }

    #[test]
    fn ripple_keeps_transitions_between_touching_clips() {
        let (mut tl, [a, b, _, _]) = ripple_timeline();
        let fade = Transition {
            kind: crate::transition::TransitionKind::Crossfade,
            duration_ms: 500,
        };
        tl.set_clip_transition(b, Some(fade)).unwrap();
        let track = tl.tracks[0].id;
        tl.trim_clip_ripple(a, Edge::End, 3 * S / 2).unwrap();
        assert!(tl.transition_active(track, b));
        tl.trim_clip_ripple(a, Edge::Start, S / 2).unwrap();
        assert!(tl.transition_active(track, b));
    }

    #[test]
    fn ripple_speed_changes_push_or_pull_later_clips() {
        let (mut tl, [a, b, c, d]) = ripple_timeline();
        assert_eq!(tl.set_clip_speed(a, 50), Err(EditError::NoRoomToSlowDown));
        tl.set_clip_speed_ripple(a, 50).unwrap();
        assert_eq!(
            starts(&tl),
            [
                (a, 0, 4 * S),
                (b, 4 * S, 2 * S),
                (c, 8 * S, S),
                (d, S, 4 * S)
            ]
        );
        tl.set_clip_speed_ripple(a, 200).unwrap();
        assert_eq!(starts(&tl)[1], (b, S, 2 * S));
    }

    #[test]
    fn failed_ripple_edits_change_nothing() {
        let (mut tl, [a, ..]) = ripple_timeline();
        let before = tl.clone();
        assert_eq!(
            tl.trim_clip_ripple(a, Edge::End, 1000),
            Err(EditError::InvalidDuration)
        );
        assert_eq!(
            tl.trim_clip_ripple(a, Edge::End, 20 * S),
            Err(EditError::InvalidDuration),
            "past the end of the media"
        );
        assert_eq!(
            tl.set_clip_speed_ripple(a, 10),
            Err(EditError::InvalidSpeed(10))
        );
        assert_eq!(tl.ripple_delete(999), Err(EditError::ClipNotFound(999)));
        assert_eq!(tl, before);
    }

    #[test]
    fn moving_several_clips_keeps_their_spacing_and_tracks() {
        let (mut tl, [a, b, c, d]) = ripple_timeline();
        tl.move_clips(&[b, d], S).unwrap();
        assert_eq!(
            starts(&tl),
            [
                (a, 0, 2 * S),
                (b, 3 * S, 2 * S),
                (c, 6 * S, S),
                (d, 2 * S, 4 * S)
            ]
        );
        // b would run into c; a would go before 0. Nothing moves either time.
        let before = tl.clone();
        assert_eq!(tl.move_clips(&[b, d], 2 * S), Err(EditError::Overlap));
        assert_eq!(tl.move_clips(&[a, b], -S), Err(EditError::OutOfRange(-S)));
        assert_eq!(tl, before);
        // Moving neighbours together is fine even though each alone would collide.
        tl.move_clips(&[a, b, c], 3 * S).unwrap();
        assert_eq!(tl.tracks[0].clips[0].start, 3 * S);
        assert_eq!(
            tl.move_clips(&[a, 999], S),
            Err(EditError::ClipNotFound(999))
        );
    }

    #[test]
    fn copies_are_relative_to_the_earliest_clip_and_keep_their_track() {
        let (tl, [_, b, _, d]) = ripple_timeline();
        let copied = tl.copy_clips(&[d, b]).unwrap();
        let summary: Vec<_> = copied
            .iter()
            .map(|c| (c.track_id, c.clip.id, c.clip.start))
            .collect();
        // In track order: b (track 1) then d (track 2); d starts first, at 1 s.
        assert_eq!(summary, [(tl.tracks[0].id, b, S), (tl.tracks[1].id, d, 0)]);
        assert_eq!(tl.copy_clips(&[b, 42]), Err(EditError::ClipNotFound(42)));
    }

    #[test]
    fn paste_goes_back_to_the_same_tracks_when_there_is_room() {
        let (mut tl, [a, b, ..]) = ripple_timeline();
        let copied = tl.copy_clips(&[a, b]).unwrap();
        let ids = tl.paste_clips(&copied, 10 * S).unwrap();
        assert_eq!(ids.len(), 2);
        assert_eq!(tl.tracks.len(), 2, "no new track needed");
        let pasted: Vec<_> = tl.tracks[0].clips[3..]
            .iter()
            .map(|c| (c.id, c.start, c.asset_id.as_str()))
            .collect();
        assert_eq!(pasted, [(ids[0], 10 * S, "a"), (ids[1], 12 * S, "b")]);
        assert!(!ids.contains(&a) && !ids.contains(&b), "fresh ids");
    }

    #[test]
    fn paste_never_overwrites_it_uses_a_new_track() {
        let (mut tl, [a, _, _, d]) = ripple_timeline();
        let copied = tl.copy_clips(&[a, d]).unwrap();
        // At 1 s, a would overlap b on its track and d would overlap itself.
        let ids = tl.paste_clips(&copied, S).unwrap();
        assert_eq!(tl.tracks.len(), 4, "a new track for each group");
        assert_eq!(tl.tracks[2].clips[0].id, ids[0]);
        assert_eq!(tl.tracks[3].clips[0].start, S + S);
        assert!(tl.tracks[2..].iter().all(|t| t.kind == TrackKind::Video));
    }

    #[test]
    fn pasted_clips_keep_everything_but_their_id_and_position() {
        let (mut tl, _, clip) = timeline_with_clip();
        tl.set_clip_speed(clip, 200).unwrap();
        tl.set_keyframe(clip, 0, at_x(0)).unwrap();
        tl.set_clip_color(
            clip,
            ColorAdjust {
                saturation: -100,
                ..ColorAdjust::default()
            },
        )
        .unwrap();
        let copied = tl.copy_clips(&[clip]).unwrap();
        let id = tl.paste_clips(&copied, 20 * S).unwrap()[0];
        let original = tl.tracks[0].clips[0].clone();
        let pasted = tl.tracks[0].clips.iter().find(|c| c.id == id).unwrap();
        assert_eq!(
            Clip {
                id: original.id,
                start: original.start,
                ..pasted.clone()
            },
            original
        );
    }

    #[test]
    fn luts_are_set_resolved_saved_and_copied() {
        let (mut tl, track, clip) = timeline_with_clip();
        let lut = LutRef {
            lut_id: "teal".to_owned(),
            intensity_percent: 60,
        };
        tl.set_clip_lut(clip, Some(lut.clone())).unwrap();
        assert_eq!(tl.resolve(3 * S)[0].lut, Some(lut.clone()));
        assert_eq!(Timeline::from_json(&tl.to_json()).unwrap(), tl);
        let right = tl.split_clip(clip, 4 * S).unwrap();
        assert_eq!(tl.tracks[0].clips[1].id, right);
        assert_eq!(tl.tracks[0].clips[1].lut, Some(lut));
        tl.set_clip_lut(clip, None).unwrap();
        assert_eq!(tl.tracks[0].clips[0].lut, None);

        let text = tl.add_text_clip(track, 9 * S, S, title("Hi")).unwrap();
        let any = LutRef {
            lut_id: "x".to_owned(),
            intensity_percent: 10,
        };
        assert_eq!(tl.set_clip_lut(text, Some(any)), Err(EditError::NotMedia));
        let bad = LutRef {
            lut_id: String::new(),
            intensity_percent: 10,
        };
        assert_eq!(
            tl.set_clip_lut(clip, Some(bad)),
            Err(EditError::InvalidColor(ColorError::LutId))
        );
    }

    #[test]
    fn inserting_space_moves_later_clips_on_the_given_tracks_only() {
        // Track 1: a 0-2, b 2-4, c 6-7. Track 2: d 1-5.
        let (mut tl, [a, b, c, d]) = ripple_timeline();
        let first = tl.tracks[0].id;
        tl.insert_space(&[first, first], 2 * S, 3 * S).unwrap();
        assert_eq!(
            starts(&tl),
            [
                (a, 0, 2 * S),
                (b, 5 * S, 2 * S),
                (c, 9 * S, S),
                (d, S, 4 * S)
            ]
        );
        // d (1-5 s) runs across 3 s, so nothing moves on either track.
        let before = tl.clone();
        let second = tl.tracks[1].id;
        assert_eq!(
            tl.insert_space(&[first, second], 3 * S, S),
            Err(EditError::SpaceCrossesClip(3 * S))
        );
        assert_eq!(tl, before);
        assert_eq!(
            tl.insert_space(&[first], 0, 0),
            Err(EditError::InvalidDuration)
        );
        assert_eq!(
            tl.insert_space(&[999], 0, S),
            Err(EditError::TrackNotFound(999))
        );
    }

    #[test]
    fn word_timings_follow_a_caption_through_splits_and_trims() {
        use crate::text::WordTiming;
        let mut tl = Timeline::new();
        let track = tl.add_track(TrackKind::Video);
        let words = vec![
            WordTiming { start: 0, end: S },
            WordTiming {
                start: S,
                end: 2 * S,
            },
            WordTiming {
                start: 2 * S,
                end: 3 * S,
            },
        ];
        let caption = TextContent {
            words: words.clone(),
            ..title("ask not what")
        };
        let clip = tl.add_text_clip(track, 10 * S, 3 * S, caption).unwrap();
        let right = tl.split_clip(clip, 12 * S).unwrap();
        // Both halves keep the same timings; each layer's source time says where
        // in them it is, so 12.5 s is still the third word (2-3 s).
        let layer = &tl.resolve(12 * S + S / 2)[0];
        assert_eq!(layer.clip_id, right);
        assert_eq!(layer.source_time, 2 * S + S / 2);
        assert_eq!(layer.text.as_ref().unwrap().words, words);
        tl.trim_clip(clip, Edge::Start, 11 * S).unwrap();
        assert_eq!(
            tl.resolve(11 * S)[0].source_time,
            S,
            "the second word starts here"
        );
    }
}
