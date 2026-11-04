//! JavaScript bindings. A thin layer: all logic lives in [`crate::timeline`].
//!
//! Times cross the boundary as `f64` microseconds (a JS `number`). `i64` would
//! surface as `BigInt`, which is awkward in UI code; `f64` is exact up to 2^53 µs
//! (about 285 years), so nothing is lost.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::text::{TextContent, TextStyle};
use crate::timeline::{Edge, EditError, Micros, Timeline, TrackKind};

fn to_micros(value: f64) -> Micros {
    value.round() as Micros
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
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
        let edge = match edge {
            "start" => Edge::Start,
            "end" => Edge::End,
            other => return Err(JsError::new(&format!("unknown edge: {other}"))),
        };
        self.timeline
            .trim_clip(clip_id, edge, to_micros(at))
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
