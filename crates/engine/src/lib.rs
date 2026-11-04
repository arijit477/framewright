//! Framewright engine.
//!
//! The engine owns the project model and answers "what should be on screen at
//! time t?". It does no decoding or drawing itself: the web app's media and
//! render workers do that, using the [`timeline::Layer`]s this crate returns.
//!
//! The same crate compiles to WebAssembly for the browser and natively for a
//! future desktop build (Tauri), so it must not depend on browser APIs outside
//! [`wasm`].

pub mod text;
pub mod timeline;
pub mod transform;
pub mod wasm;

pub use timeline::{
    AudioSegment, Clip, Edge, EditError, Layer, Micros, Timeline, Track, TrackKind,
};
