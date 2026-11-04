//! Keyframes: a media clip's transform animated over time.
//!
//! A keyframe stores a whole [`Transform`] at a time in the clip's *source
//! media*, so it stays with the picture when the clip is trimmed, and both
//! halves of a split clip keep animating exactly as before. Between two
//! keyframes the transform is interpolated with the first one's easing;
//! before the first and after the last it holds.
//!
//! Stored transforms are integers (like everything saved), but interpolated
//! values are fractional: a slow zoom from 100% to 110% must not move in 1%
//! steps.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::timeline::Micros;
use crate::transform::Transform;

/// Plenty for hand-made animation, and bounds the cost of a lookup.
pub const MAX_KEYFRAMES: usize = 100;

/// How the transform moves from a keyframe towards the next one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Easing {
    #[default]
    Linear,
    /// Starts slowly, then speeds up.
    EaseIn,
    /// Starts quickly, then slows down.
    EaseOut,
    /// Slow at both ends.
    EaseInOut,
}

impl Easing {
    /// Maps progress `t` (0..=1) to eased progress (0..=1).
    pub fn apply(self, t: f64) -> f64 {
        match self {
            Easing::Linear => t,
            Easing::EaseIn => t * t * t,
            Easing::EaseOut => 1.0 - (1.0 - t).powi(3),
            Easing::EaseInOut => {
                if t < 0.5 {
                    4.0 * t * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    /// Time in the clip's source media.
    pub source_time: Micros,
    pub transform: Transform,
    /// Easing towards the next keyframe.
    #[serde(default)]
    pub easing: Easing,
}

/// A transform at one moment, as the renderer needs it: the same fields as
/// [`Transform`], but fractional while animating.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTransform {
    pub x: f64,
    pub y: f64,
    pub scale_percent: f64,
    pub rotation_deg: f64,
    pub opacity_percent: f64,
}

impl From<Transform> for ResolvedTransform {
    fn from(t: Transform) -> Self {
        Self {
            x: f64::from(t.x),
            y: f64::from(t.y),
            scale_percent: f64::from(t.scale_percent),
            rotation_deg: f64::from(t.rotation_deg),
            opacity_percent: f64::from(t.opacity_percent),
        }
    }
}

impl ResolvedTransform {
    fn lerp(a: Self, b: Self, t: f64) -> Self {
        let mix = |a: f64, b: f64| a + (b - a) * t;
        Self {
            x: mix(a.x, b.x),
            y: mix(a.y, b.y),
            scale_percent: mix(a.scale_percent, b.scale_percent),
            // Linear in degrees (not the shortest way round), so 0° -> 360° is a full spin.
            rotation_deg: mix(a.rotation_deg, b.rotation_deg),
            opacity_percent: mix(a.opacity_percent, b.opacity_percent),
        }
    }
}

/// The transform at `source_time`, or `None` without keyframes.
/// `keyframes` must be sorted by time (as [`validate`] requires).
pub fn evaluate(keyframes: &[Keyframe], source_time: Micros) -> Option<ResolvedTransform> {
    let first = keyframes.first()?;
    let next = keyframes.partition_point(|k| k.source_time <= source_time);
    if next == 0 {
        return Some(first.transform.into());
    }
    let from = &keyframes[next - 1];
    let Some(to) = keyframes.get(next) else {
        return Some(from.transform.into());
    };
    let span = (to.source_time - from.source_time) as f64;
    let t = (source_time - from.source_time) as f64 / span;
    Some(ResolvedTransform::lerp(
        from.transform.into(),
        to.transform.into(),
        from.easing.apply(t),
    ))
}

/// Keyframes must be in time order, at distinct times, with valid transforms.
pub fn validate(keyframes: &[Keyframe]) -> Result<(), KeyframeError> {
    if keyframes.len() > MAX_KEYFRAMES {
        return Err(KeyframeError::TooMany);
    }
    if keyframes
        .windows(2)
        .any(|w| w[0].source_time >= w[1].source_time)
    {
        return Err(KeyframeError::Order);
    }
    for k in keyframes {
        k.transform.validate()?;
    }
    Ok(())
}

/// Put keyframes loaded from a file into a valid order (sorted, one per time).
pub fn normalize(keyframes: &mut Vec<Keyframe>) {
    keyframes.sort_by_key(|k| k.source_time);
    keyframes.dedup_by_key(|k| k.source_time);
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum KeyframeError {
    #[error("a clip can have at most {MAX_KEYFRAMES} keyframes")]
    TooMany,
    #[error("keyframes must be in time order, one per moment")]
    Order,
    #[error("no keyframe at that time")]
    NotFound,
    #[error(transparent)]
    Transform(#[from] crate::transform::TransformError),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(source_time: Micros, x: i16, easing: Easing) -> Keyframe {
        Keyframe {
            source_time,
            transform: Transform {
                x,
                ..Transform::default()
            },
            easing,
        }
    }

    #[test]
    fn no_keyframes_means_no_animation() {
        assert_eq!(evaluate(&[], 0), None);
    }

    #[test]
    fn holds_before_the_first_and_after_the_last() {
        let keys = [
            key(1000, 100, Easing::Linear),
            key(2000, 300, Easing::Linear),
        ];
        assert_eq!(evaluate(&keys, 0).unwrap().x, 100.0);
        assert_eq!(evaluate(&keys, 1000).unwrap().x, 100.0);
        assert_eq!(evaluate(&keys, 2000).unwrap().x, 300.0);
        assert_eq!(evaluate(&keys, 9000).unwrap().x, 300.0);
    }

    #[test]
    fn interpolates_fractionally_between_keyframes() {
        let keys = [key(0, 0, Easing::Linear), key(1000, 1, Easing::Linear)];
        // A one-unit move over the span is still smooth, not a jump.
        assert_eq!(evaluate(&keys, 250).unwrap().x, 0.25);
        let other = evaluate(&keys, 500).unwrap();
        assert_eq!((other.y, other.scale_percent), (500.0, 100.0));
    }

    #[test]
    fn uses_the_easing_of_the_keyframe_it_leaves() {
        let keys = [
            key(0, 0, Easing::EaseIn),
            key(1000, 1000, Easing::Linear),
            key(2000, 0, Easing::Linear),
        ];
        assert_eq!(evaluate(&keys, 500).unwrap().x, 125.0); // 0.5³
        assert_eq!(evaluate(&keys, 1500).unwrap().x, 500.0); // linear on the way back
    }

    #[test]
    fn easings_start_at_0_end_at_1_and_are_symmetric_where_expected() {
        for e in [
            Easing::Linear,
            Easing::EaseIn,
            Easing::EaseOut,
            Easing::EaseInOut,
        ] {
            assert_eq!(e.apply(0.0), 0.0, "{e:?}");
            assert_eq!(e.apply(1.0), 1.0, "{e:?}");
        }
        assert_eq!(Easing::EaseInOut.apply(0.5), 0.5);
        assert!((Easing::EaseIn.apply(0.3) + Easing::EaseOut.apply(0.7) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn validates_order_count_and_transforms() {
        let ok = [key(0, 0, Easing::Linear), key(1, 0, Easing::Linear)];
        assert_eq!(validate(&ok), Ok(()));
        let same_time = [key(5, 0, Easing::Linear), key(5, 1, Easing::Linear)];
        assert_eq!(validate(&same_time), Err(KeyframeError::Order));
        let backwards = [key(5, 0, Easing::Linear), key(1, 0, Easing::Linear)];
        assert_eq!(validate(&backwards), Err(KeyframeError::Order));
        let bad = [key(0, 3000, Easing::Linear)];
        assert!(matches!(validate(&bad), Err(KeyframeError::Transform(_))));
        let many: Vec<_> = (0..=MAX_KEYFRAMES as i64)
            .map(|i| key(i, 0, Easing::Linear))
            .collect();
        assert_eq!(validate(&many), Err(KeyframeError::TooMany));
    }

    #[test]
    fn normalize_sorts_and_drops_duplicates() {
        let mut keys = vec![
            key(20, 2, Easing::Linear),
            key(10, 1, Easing::Linear),
            key(20, 3, Easing::Linear),
        ];
        normalize(&mut keys);
        assert_eq!(
            keys.iter().map(|k| k.source_time).collect::<Vec<_>>(),
            [10, 20]
        );
    }

    #[test]
    fn easing_defaults_to_linear_when_missing() {
        let k: Keyframe =
            serde_json::from_str(r#"{"sourceTime":5,"transform":{"x":100}}"#).unwrap();
        assert_eq!(k.easing, Easing::Linear);
        assert_eq!(k.transform.x, 100);
    }
}
