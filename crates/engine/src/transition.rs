//! Transitions between adjacent clips on the same track.
//!
//! A transition belongs to the *incoming* clip (`transition_in`) and is centred
//! on the cut: for a duration `D`, the outgoing clip keeps playing for `D/2`
//! past the cut and the incoming clip starts `D/2` early, both from their own
//! media. Where a file has no extra media there, the edge frame is held.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::timeline::Micros;

pub const MIN_TRANSITION_MS: u16 = 100;
pub const MAX_TRANSITION_MS: u16 = 3000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionKind {
    /// The incoming clip fades in over the outgoing one.
    Crossfade,
    /// Fade out, then fade in (through black, or whatever is underneath).
    Dip,
    /// The incoming clip pushes the outgoing one off to the left.
    Slide,
    /// The incoming clip is revealed from left to right.
    Wipe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub kind: TransitionKind,
    pub duration_ms: u16,
}

impl Transition {
    pub fn validate(&self) -> Result<(), TransitionError> {
        if !(MIN_TRANSITION_MS..=MAX_TRANSITION_MS).contains(&self.duration_ms) {
            return Err(TransitionError::Duration(self.duration_ms));
        }
        Ok(())
    }

    pub fn duration(&self) -> Micros {
        Micros::from(self.duration_ms) * 1000
    }
}

/// How a layer takes part in a transition, as the renderer needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerTransition {
    pub kind: TransitionKind,
    /// True for the clip being left, false for the one coming in.
    pub outgoing: bool,
    /// How far through the transition, in thousandths (0 = start, 1000 = end).
    pub progress: u16,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransitionError {
    #[error(
        "transition length {0} ms is out of range ({MIN_TRANSITION_MS}-{MAX_TRANSITION_MS} ms)"
    )]
    Duration(u16),
    #[error("a transition needs a clip directly before this one on the same track")]
    NoPreviousClip,
    #[error("transitions work between video clips, not titles")]
    NotVideo,
    #[error("the transition is longer than the clips on either side of the cut")]
    TooLong,
}
