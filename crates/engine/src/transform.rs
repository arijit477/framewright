//! Clip transforms: where a media clip appears in the frame.
//!
//! Integers relative to the frame, like text styles, so projects compare
//! exactly and a transform looks the same at every output resolution:
//! position in thousandths of the frame (the clip's centre), scale in
//! percent, rotation in degrees, opacity in percent.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Positions may go past the frame edges (to slide a clip partly off screen).
pub const MIN_POSITION: i16 = -1000;
pub const MAX_POSITION: i16 = 2000;
pub const MIN_SCALE_PERCENT: u16 = 1;
pub const MAX_SCALE_PERCENT: u16 = 1000;
pub const MAX_ROTATION_DEG: i16 = 360;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Transform {
    /// Centre of the clip, in thousandths of the frame width/height (500 = centre).
    pub x: i16,
    pub y: i16,
    /// Size relative to fitting the frame (100 = fills it, letterboxed).
    pub scale_percent: u16,
    /// Clockwise, in degrees.
    pub rotation_deg: i16,
    pub opacity_percent: u8,
}

impl Default for Transform {
    /// No change: centred, full size, upright, opaque.
    fn default() -> Self {
        Self {
            x: 500,
            y: 500,
            scale_percent: 100,
            rotation_deg: 0,
            opacity_percent: 100,
        }
    }
}

impl Transform {
    pub fn is_identity(&self) -> bool {
        *self == Self::default()
    }

    pub fn validate(&self) -> Result<(), TransformError> {
        if !(MIN_POSITION..=MAX_POSITION).contains(&self.x)
            || !(MIN_POSITION..=MAX_POSITION).contains(&self.y)
        {
            return Err(TransformError::Position);
        }
        if !(MIN_SCALE_PERCENT..=MAX_SCALE_PERCENT).contains(&self.scale_percent) {
            return Err(TransformError::Scale(self.scale_percent));
        }
        if self.rotation_deg.abs() > MAX_ROTATION_DEG {
            return Err(TransformError::Rotation(self.rotation_deg));
        }
        if self.opacity_percent > 100 {
            return Err(TransformError::Opacity(self.opacity_percent));
        }
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransformError {
    #[error("the position is too far outside the frame")]
    Position,
    #[error("scale {0}% is out of range ({MIN_SCALE_PERCENT}-{MAX_SCALE_PERCENT}%)")]
    Scale(u16),
    #[error("rotation {0}° is out of range (±{MAX_ROTATION_DEG}°)")]
    Rotation(i16),
    #[error("opacity {0}% is out of range (0-100%)")]
    Opacity(u8),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_identity_and_valid() {
        let t = Transform::default();
        assert!(t.is_identity());
        assert_eq!(t.validate(), Ok(()));
    }

    #[test]
    fn validates_ranges() {
        let ok = Transform {
            x: -200,
            y: 1500,
            scale_percent: 35,
            rotation_deg: -90,
            opacity_percent: 50,
        };
        assert_eq!(ok.validate(), Ok(()));
        let t = |patch: fn(&mut Transform)| {
            let mut t = Transform::default();
            patch(&mut t);
            t.validate()
        };
        assert_eq!(t(|t| t.x = 2001), Err(TransformError::Position));
        assert_eq!(t(|t| t.scale_percent = 0), Err(TransformError::Scale(0)));
        assert_eq!(
            t(|t| t.rotation_deg = 361),
            Err(TransformError::Rotation(361))
        );
        assert_eq!(
            t(|t| t.opacity_percent = 101),
            Err(TransformError::Opacity(101))
        );
    }

    #[test]
    fn missing_fields_default_to_no_change() {
        let parsed: Transform = serde_json::from_str(r#"{"scalePercent":50}"#).unwrap();
        assert_eq!(parsed.scale_percent, 50);
        assert_eq!(
            (parsed.x, parsed.y, parsed.opacity_percent),
            (500, 500, 100)
        );
    }
}
