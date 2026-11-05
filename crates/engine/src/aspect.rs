//! The shape of the frame: widescreen (the default), vertical for phone video,
//! square, or the 4:5 portrait of social feeds. Positions and sizes in the
//! project are relative to the frame (thousandths, fits), so a project can
//! switch shape and keep its layout; the renderer and export derive pixel
//! sizes from this.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum AspectRatio {
    /// 16:9 (YouTube, TV).
    #[default]
    #[serde(rename = "16:9")]
    Widescreen,
    /// 9:16 (Shorts, Reels, TikTok).
    #[serde(rename = "9:16")]
    Vertical,
    /// 1:1.
    #[serde(rename = "1:1")]
    Square,
    /// 4:5 (feed posts).
    #[serde(rename = "4:5")]
    Portrait,
}

impl AspectRatio {
    /// Width and height in lowest terms.
    pub fn ratio(self) -> (u32, u32) {
        match self {
            AspectRatio::Widescreen => (16, 9),
            AspectRatio::Vertical => (9, 16),
            AspectRatio::Square => (1, 1),
            AspectRatio::Portrait => (4, 5),
        }
    }

    pub fn is_default(&self) -> bool {
        *self == AspectRatio::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_as_the_ratio_people_know() {
        assert_eq!(
            serde_json::to_string(&AspectRatio::Vertical).unwrap(),
            r#""9:16""#
        );
        let parsed: AspectRatio = serde_json::from_str(r#""4:5""#).unwrap();
        assert_eq!(parsed, AspectRatio::Portrait);
        assert!(serde_json::from_str::<AspectRatio>(r#""3:2""#).is_err());
        assert_eq!(AspectRatio::Square.ratio(), (1, 1));
    }
}
