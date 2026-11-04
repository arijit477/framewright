//! JavaScript bindings. A thin layer: all logic lives in [`crate::timeline`].
//!
//! Times cross the boundary as `f64` microseconds (a JS `number`). `i64` would
//! surface as `BigInt`, which is awkward in UI code; `f64` is exact up to 2^53 µs
//! (about 285 years), so nothing is lost.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::color::{ColorAdjust, LutRef};
use crate::keyframe::Easing;
use crate::text::{TextContent, TextStyle};
use crate::timeline::{CopiedClip, Edge, EditError, Micros, Timeline, TrackKind};
use crate::transform::Transform;
use crate::transition::Transition;

fn to_micros(value: f64) -> Micros {
    value.round() as Micros
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

fn parse_edge(edge: &str) -> Result<Edge, JsError> {
    match edge {
        "start" => Ok(Edge::Start),
        "end" => Ok(Edge::End),
        other => Err(JsError::new(&format!("unknown edge: {other}"))),
    }
}

fn err(e: EditError) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
pub struct Engine {
    timeline: Timeline,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine {
            timeline: Timeline::new(),
        }
    }

    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(json: &str) -> Result<Engine, JsError> {
        Ok(Engine {
            timeline: Timeline::from_json(json).map_err(err)?,
        })
    }

    #[wasm_bindgen(js_name = toJson)]
    pub fn to_json(&self) -> String {
        self.timeline.to_json()
    }

    /// The whole timeline as a plain JS object, for rendering the UI.
    pub fn snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&self.timeline)
    }

    pub fn duration(&self) -> f64 {
        self.timeline.duration() as f64
    }

    #[wasm_bindgen(js_name = addTrack)]
    pub fn add_track(&mut self, kind: &str) -> Result<u32, JsError> {
        let kind = match kind {
            "video" => TrackKind::Video,
            "audio" => TrackKind::Audio,
            other => return Err(JsError::new(&format!("unknown track kind: {other}"))),
        };
        Ok(self.timeline.add_track(kind))
    }

    #[wasm_bindgen(js_name = removeTrack)]
    pub fn remove_track(&mut self, track_id: u32) -> Result<(), JsError> {
        self.timeline.remove_track(track_id).map_err(err)
    }

    /// Remove empty tracks (keeping at least one of each kind); returns their ids.
    #[wasm_bindgen(js_name = pruneEmptyTracks)]
    pub fn prune_empty_tracks(&mut self) -> Vec<u32> {
        self.timeline.prune_empty_tracks()
    }

    #[wasm_bindgen(js_name = appendClip)]
    pub fn append_clip(
        &mut self,
        track_id: u32,
        asset_id: &str,
        source_duration: f64,
    ) -> Result<u32, JsError> {
        self.timeline
            .append_clip(track_id, asset_id, to_micros(source_duration))
            .map_err(err)
    }

    #[wasm_bindgen(js_name = removeClip)]
    pub fn remove_clip(&mut self, clip_id: u32) -> Result<(), JsError> {
        self.timeline.remove_clip(clip_id).map(|_| ()).map_err(err)
    }

    #[wasm_bindgen(js_name = moveClip)]
    pub fn move_clip(
        &mut self,
        clip_id: u32,
        new_start: f64,
        to_track: Option<u32>,
    ) -> Result<(), JsError> {
        self.timeline
            .move_clip(clip_id, to_micros(new_start), to_track)
            .map_err(err)
    }

    /// `edge` is `"start"` or `"end"`.
    #[wasm_bindgen(js_name = trimClip)]
    pub fn trim_clip(&mut self, clip_id: u32, edge: &str, at: f64) -> Result<(), JsError> {
        self.timeline
            .trim_clip(clip_id, parse_edge(edge)?, to_micros(at))
            .map_err(err)
    }

    #[wasm_bindgen(js_name = splitClip)]
    pub fn split_clip(&mut self, clip_id: u32, at: f64) -> Result<u32, JsError> {
        self.timeline
            .split_clip(clip_id, to_micros(at))
            .map_err(err)
    }

    #[wasm_bindgen(js_name = setClipVolume)]
    pub fn set_clip_volume(&mut self, clip_id: u32, percent: u16) -> Result<(), JsError> {
        self.timeline.set_clip_volume(clip_id, percent).map_err(err)
    }

    /// Playback speed in percent (25-400); the clip's length changes to match.
    #[wasm_bindgen(js_name = setClipSpeed)]
    pub fn set_clip_speed(&mut self, clip_id: u32, percent: u16) -> Result<(), JsError> {
        self.timeline.set_clip_speed(clip_id, percent).map_err(err)
    }

    #[wasm_bindgen(js_name = setClipSpeedRipple)]
    pub fn set_clip_speed_ripple(&mut self, clip_id: u32, percent: u16) -> Result<(), JsError> {
        self.timeline
            .set_clip_speed_ripple(clip_id, percent)
            .map_err(err)
    }

    /// Move several clips by `delta` µs, keeping their tracks (all or nothing).
    #[wasm_bindgen(js_name = moveClips)]
    pub fn move_clips(&mut self, clip_ids: Vec<u32>, delta: f64) -> Result<(), JsError> {
        self.timeline
            .move_clips(&clip_ids, to_micros(delta))
            .map_err(err)
    }

    /// Clips for the clipboard: `[{ trackId, trackKind, clip }]`, starts relative to the earliest.
    #[wasm_bindgen(js_name = copyClips)]
    pub fn copy_clips(&self, clip_ids: Vec<u32>) -> Result<JsValue, JsError> {
        to_js(&self.timeline.copy_clips(&clip_ids).map_err(err)?)
    }

    /// Paste clips from `copyClips` with the earliest at `at`. Returns the new ids.
    #[wasm_bindgen(js_name = pasteClips)]
    pub fn paste_clips(&mut self, copied: JsValue, at: f64) -> Result<Vec<u32>, JsError> {
        let copied: Vec<CopiedClip> = serde_wasm_bindgen::from_value(copied)?;
        self.timeline
            .paste_clips(&copied, to_micros(at))
            .map_err(err)
    }

    /// Open a gap of `length` µs at `at` on the given tracks (later clips move along).
    #[wasm_bindgen(js_name = insertSpace)]
    pub fn insert_space(
        &mut self,
        track_ids: Vec<u32>,
        at: f64,
        length: f64,
    ) -> Result<(), JsError> {
        self.timeline
            .insert_space(&track_ids, to_micros(at), to_micros(length))
            .map_err(err)
    }

    /// Remove a clip and close the space it leaves on its track.
    #[wasm_bindgen(js_name = rippleDelete)]
    pub fn ripple_delete(&mut self, clip_id: u32) -> Result<(), JsError> {
        self.timeline
            .ripple_delete(clip_id)
            .map(|_| ())
            .map_err(err)
    }

    /// Like `trimClip`, but the clip keeps its start and later clips follow its end.
    #[wasm_bindgen(js_name = trimClipRipple)]
    pub fn trim_clip_ripple(&mut self, clip_id: u32, edge: &str, at: f64) -> Result<(), JsError> {
        self.timeline
            .trim_clip_ripple(clip_id, parse_edge(edge)?, to_micros(at))
            .map_err(err)
    }

    #[wasm_bindgen(js_name = setClipMuted)]
    pub fn set_clip_muted(&mut self, clip_id: u32, muted: bool) -> Result<(), JsError> {
        self.timeline.set_clip_muted(clip_id, muted).map_err(err)
    }

    /// Add a text clip; `content` is `{ text, style }` (see `text.rs`).
    #[wasm_bindgen(js_name = addTextClip)]
    pub fn add_text_clip(
        &mut self,
        track_id: u32,
        start: f64,
        duration: f64,
        content: JsValue,
    ) -> Result<u32, JsError> {
        let content: TextContent = serde_wasm_bindgen::from_value(content)?;
        self.timeline
            .add_text_clip(track_id, to_micros(start), to_micros(duration), content)
            .map_err(err)
    }

    #[wasm_bindgen(js_name = setClipText)]
    pub fn set_clip_text(&mut self, clip_id: u32, content: JsValue) -> Result<(), JsError> {
        let content: TextContent = serde_wasm_bindgen::from_value(content)?;
        self.timeline.set_clip_text(clip_id, content).map_err(err)
    }

    /// Set where a media clip appears; `transform` is `{ x, y, scalePercent, rotationDeg, opacityPercent }`.
    #[wasm_bindgen(js_name = setClipTransform)]
    pub fn set_clip_transform(&mut self, clip_id: u32, transform: JsValue) -> Result<(), JsError> {
        let transform: Transform = serde_wasm_bindgen::from_value(transform)?;
        self.timeline
            .set_clip_transform(clip_id, transform)
            .map_err(err)
    }

    /// Set a media clip's `{ brightness, contrast, saturation }` (each -100 to 100).
    #[wasm_bindgen(js_name = setClipColor)]
    pub fn set_clip_color(&mut self, clip_id: u32, color: JsValue) -> Result<(), JsError> {
        let color: ColorAdjust = serde_wasm_bindgen::from_value(color)?;
        self.timeline.set_clip_color(clip_id, color).map_err(err)
    }

    /// Apply `{ lutId, intensityPercent }` to a media clip, or remove its LUT with `null`.
    #[wasm_bindgen(js_name = setClipLut)]
    pub fn set_clip_lut(&mut self, clip_id: u32, lut: JsValue) -> Result<(), JsError> {
        let lut: Option<LutRef> = serde_wasm_bindgen::from_value(lut)?;
        self.timeline.set_clip_lut(clip_id, lut).map_err(err)
    }

    /// Add or update the keyframe at `source_time` (µs in the clip's media).
    #[wasm_bindgen(js_name = setKeyframe)]
    pub fn set_keyframe(
        &mut self,
        clip_id: u32,
        source_time: f64,
        transform: JsValue,
    ) -> Result<(), JsError> {
        let transform: Transform = serde_wasm_bindgen::from_value(transform)?;
        self.timeline
            .set_keyframe(clip_id, to_micros(source_time), transform)
            .map_err(err)
    }

    /// `easing` is `"linear"`, `"easeIn"`, `"easeOut"` or `"easeInOut"`.
    #[wasm_bindgen(js_name = setKeyframeEasing)]
    pub fn set_keyframe_easing(
        &mut self,
        clip_id: u32,
        source_time: f64,
        easing: JsValue,
    ) -> Result<(), JsError> {
        let easing: Easing = serde_wasm_bindgen::from_value(easing)?;
        self.timeline
            .set_keyframe_easing(clip_id, to_micros(source_time), easing)
            .map_err(err)
    }

    #[wasm_bindgen(js_name = removeKeyframe)]
    pub fn remove_keyframe(&mut self, clip_id: u32, source_time: f64) -> Result<(), JsError> {
        self.timeline
            .remove_keyframe(clip_id, to_micros(source_time))
            .map_err(err)
    }

    /// A media clip's transform at timeline time `at`, as `resolve` would place it.
    #[wasm_bindgen(js_name = clipTransformAt)]
    pub fn clip_transform_at(&self, clip_id: u32, at: f64) -> Result<JsValue, JsError> {
        to_js(
            &self
                .timeline
                .clip_transform_at(clip_id, to_micros(at))
                .map_err(err)?,
        )
    }

    #[wasm_bindgen(js_name = clearKeyframes)]
    pub fn clear_keyframes(&mut self, clip_id: u32) -> Result<(), JsError> {
        self.timeline.clear_keyframes(clip_id).map_err(err)
    }

    /// Set (`{ kind, durationMs }`) or clear (`null`) the transition into a clip.
    #[wasm_bindgen(js_name = setClipTransition)]
    pub fn set_clip_transition(
        &mut self,
        clip_id: u32,
        transition: JsValue,
    ) -> Result<(), JsError> {
        let transition: Option<Transition> = serde_wasm_bindgen::from_value(transition)?;
        self.timeline
            .set_clip_transition(clip_id, transition)
            .map_err(err)
    }

    /// Whether a clip's transition is in effect (it touches the clip before it).
    #[wasm_bindgen(js_name = transitionActive)]
    pub fn transition_active(&self, track_id: u32, clip_id: u32) -> bool {
        self.timeline.transition_active(track_id, clip_id)
    }

    /// The default style for new titles, so the UI doesn't duplicate it.
    #[wasm_bindgen(js_name = defaultTextStyle)]
    pub fn default_text_style() -> Result<JsValue, JsError> {
        to_js(&TextStyle::default())
    }

    /// Audible segments overlapping `[from, to)`, for the audio mixer.
    #[wasm_bindgen(js_name = audioSegments)]
    pub fn audio_segments(&self, from: f64, to: f64) -> Result<JsValue, JsError> {
        to_js(&self.timeline.audio_segments(to_micros(from), to_micros(to)))
    }

    /// The layers to draw at timeline time `at`, bottom first.
    pub fn resolve(&self, at: f64) -> Result<JsValue, JsError> {
        to_js(&self.timeline.resolve(to_micros(at)))
    }
}
