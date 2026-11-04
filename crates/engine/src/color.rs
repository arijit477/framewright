//! Colour adjustments for media clips: brightness, contrast and saturation.
//!
//! Stored as integers from -100 to 100 (0 = unchanged), like other clip
//! settings, so projects compare exactly. How each value maps to pixels is
//! the renderer's job (`apps/web/src/render/color.ts`), shared by every
//! rendering path so preview and export match.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_ADJUSTMENT: i8 = 100;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColorAdjust {
    /// Darker (-100) to brighter (100).
    pub brightness: i8,
    /// Flat grey (-100) to strong contrast (100).
    pub contrast: i8,
    /// Black and white (-100) to vivid (100).
    pub saturation: i8,
}

impl ColorAdjust {
    pub fn is_neutral(&self) -> bool {
        *self == Self::default()
    }

    pub fn validate(&self) -> Result<(), ColorError> {
        for (name, value) in [
            ("brightness", self.brightness),
            ("contrast", self.contrast),
            ("saturation", self.saturation),
        ] {
            if !(-MAX_ADJUSTMENT..=MAX_ADJUSTMENT).contains(&value) {
                return Err(ColorError::OutOfRange(name, value));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ColorError {
    #[error("{0} {1} is out of range (-{MAX_ADJUSTMENT} to {MAX_ADJUSTMENT})")]
    OutOfRange(&'static str, i8),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_neutral_and_valid() {
        assert!(ColorAdjust::default().is_neutral());
        assert_eq!(ColorAdjust::default().validate(), Ok(()));
    }

    #[test]
    fn validates_each_value() {
        let ok = ColorAdjust {
            brightness: -100,
            contrast: 100,
            saturation: 0,
        };
        assert_eq!(ok.validate(), Ok(()));
        let bad = ColorAdjust {
            saturation: -101,
            ..ColorAdjust::default()
        };
        assert_eq!(
            bad.validate(),
            Err(ColorError::OutOfRange("saturation", -101))
        );
    }

    #[test]
    fn missing_values_are_unchanged() {
        let parsed: ColorAdjust = serde_json::from_str(r#"{"saturation":-100}"#).unwrap();
        assert_eq!((parsed.brightness, parsed.contrast), (0, 0));
        assert_eq!(parsed.saturation, -100);
    }
}
