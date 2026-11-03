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
}

pub const MAX_VOLUME_PERCENT: u16 = 200;

fn default_volume() -> u16 {
    100
}

impl Clip {
    pub fn end(&self) -> Micros {
        self.start + self.duration
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

/// Which edge of a clip a trim moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Edge {
    Start,
    End,
}

/// One clip visible at a given moment, as the renderer needs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    /// Index of the track; higher indices are drawn on top.
    pub track_index: usize,
    pub clip_id: ClipId,
    pub asset_id: String,
    /// The time inside the source media to show.
    pub source_time: Micros,
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
    /// Linear gain (1.0 = unchanged).
    pub gain: f32,
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
    #[error("invalid project data: {0}")]
    InvalidProject(String),
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

    /// Move one edge of a clip to the timeline time `at`.
    pub fn trim_clip(&mut self, clip_id: ClipId, edge: Edge, at: Micros) -> Result<(), EditError> {
        let (t, c) = self.locate(clip_id)?;
        let clip = self.tracks[t].clips[c].clone();
        let (start, duration, source_in) = match edge {
            Edge::Start => {
                // The earliest the clip can start is where source time 0 would land.
                let at = at.max(clip.start - clip.source_in).max(0);
                let duration = clip.end() - at;
                (at, duration, clip.source_in + (at - clip.start))
            }
            Edge::End => (clip.start, at - clip.start, clip.source_in),
        };
        if duration < MIN_CLIP_DURATION || source_in + duration > clip.source_duration {
            return Err(EditError::InvalidDuration);
        }
        if !self.tracks[t].is_free(start, start + duration, Some(clip_id)) {
            return Err(EditError::Overlap);
        }
        let clip = &mut self.tracks[t].clips[c];
        clip.start = start;
        clip.duration = duration;
        clip.source_in = source_in;
        // Start never moves past another clip (overlap check), so order is preserved.
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
        right.start = at;
        right.duration = clip.duration - left_duration;
        right.source_in = clip.source_in + left_duration;
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
    ///
    /// This runs on every frame during playback, so it binary-searches each track.
    pub fn resolve(&self, at: Micros) -> Vec<Layer> {
        self.tracks
            .iter()
            .enumerate()
            .filter(|(_, t)| t.kind == TrackKind::Video)
            .filter_map(|(track_index, track)| {
                let i = track.clips.partition_point(|c| c.end() <= at);
                let clip = track.clips.get(i).filter(|c| c.start <= at)?;
                Some(Layer {
                    track_index,
                    clip_id: clip.id,
                    asset_id: clip.asset_id.clone(),
                    source_time: clip.source_in + (at - clip.start),
                })
            })
            .collect()
    }

    /// Every audible clip overlapping `[from, to)`, on any track, in timeline order.
    ///
    /// The audio mixer calls this for its look-ahead window. Video clips are
    /// included because their embedded audio plays too; muted and silent clips
    /// are left out so the mixer never decodes them.
    pub fn audio_segments(&self, from: Micros, to: Micros) -> Vec<AudioSegment> {
        let mut segments: Vec<AudioSegment> = self
            .tracks
            .iter()
            .flat_map(|t| &t.clips)
            .filter(|c| !c.muted && c.volume_percent > 0 && c.start < to && from < c.end())
            .map(|c| AudioSegment {
                clip_id: c.id,
                asset_id: c.asset_id.clone(),
                start: c.start,
                duration: c.duration,
                source_in: c.source_in,
                gain: f32::from(c.volume_percent) / 100.0,
            })
            .collect();
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

    pub fn set_clip_muted(&mut self, clip_id: ClipId, muted: bool) -> Result<(), EditError> {
        let (t, c) = self.locate(clip_id)?;
        self.tracks[t].clips[c].muted = muted;
        Ok(())
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("timeline is always serialisable")
    }

    pub fn from_json(json: &str) -> Result<Self, EditError> {
        serde_json::from_str(json).map_err(|e| EditError::InvalidProject(e.to_string()))
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
    fn json_round_trip() {
        let (tl, _, _) = timeline_with_clip();
        let restored = Timeline::from_json(&tl.to_json()).unwrap();
        assert_eq!(restored, tl);
    }
}
