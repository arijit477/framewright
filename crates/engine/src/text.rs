//! Text overlays: content, style and validation.
//!
//! Sizes and positions are integers relative to a 1080-pixel-tall frame
//! (size in px at 1080p, position in thousandths of the frame), so a title
//! looks the same at every export resolution and projects compare exactly.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::timeline::Micros;

pub const MAX_TEXT_CHARS: usize = 500;
pub const MIN_FONT_SIZE: u16 = 12;
pub const MAX_FONT_SIZE: u16 = 300;
/// Positions are in thousandths of the frame width/height.
pub const POSITION_SCALE: u16 = 1000;
pub const MAX_ANIMATION_MS: u16 = 3000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontFamily {
    Sans,
    Serif,
    Mono,
    Handwriting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAnimation {
    None,
    Fade,
    /// Slides in from below (in) / out upwards (out), while fading.
    Slide,
    /// Scales from small to full size (in) / back down (out), while fading.
    Pop,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TextStyle {
    pub font: FontFamily,
    /// Font size in pixels on a 1080p frame (scaled for other resolutions).
    pub size: u16,
    /// `#rrggbb`.
    pub color: String,
    /// Optional box behind the text, `#rrggbbaa`.
    pub background: Option<String>,
    pub bold: bool,
    pub italic: bool,
    pub align: TextAlign,
    /// Anchor point in thousandths of the frame: `x` is the left, centre or right
    /// edge of the text (per `align`), `y` the vertical centre of the block.
    pub x: u16,
    pub y: u16,
    pub animation_in: TextAnimation,
    pub animation_out: TextAnimation,
    /// Length of each animation.
    pub animation_ms: u16,
    /// `#rrggbb` for the word being spoken (needs word timings); none by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
}

impl Default for TextStyle {
    /// A clean lower-third title: bold white sans, centred, fading in and out.
    fn default() -> Self {
        Self {
            font: FontFamily::Sans,
            size: 72,
            color: "#ffffff".into(),
            background: None,
            bold: true,
            italic: false,
            align: TextAlign::Center,
            x: 500,
            y: 820,
            animation_in: TextAnimation::Fade,
            animation_out: TextAnimation::Fade,
            animation_ms: 400,
            highlight: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextContent {
    pub text: String,
    #[serde(default)]
    pub style: TextStyle,
    /// When each word is spoken (captions): one entry per whitespace-separated
    /// word of `text`, in order, in the clip's source time, so trims and splits
    /// keep them in place. Empty for ordinary titles.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<WordTiming>,
}

/// When a word is spoken, in the text clip's source time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordTiming {
    pub start: Micros,
    pub end: Micros,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TextError {
    #[error("the text is empty")]
    Empty,
    #[error("the text is too long ({0} characters; the maximum is {MAX_TEXT_CHARS})")]
    TooLong(usize),
    #[error("font size {0} is out of range ({MIN_FONT_SIZE}-{MAX_FONT_SIZE})")]
    FontSize(u16),
    #[error("{0:?} is not a valid colour")]
    Color(String),
    #[error("the text position is outside the frame")]
    Position,
    #[error("animation length {0} ms is out of range (0-{MAX_ANIMATION_MS} ms)")]
    AnimationMs(u16),
    #[error("the word timings don't match the text ({0} timings for {1} words)")]
    WordCount(usize, usize),
    #[error("word timings must be in order, each ending after it starts")]
    WordOrder,
}

impl TextContent {
    pub fn validate(&self) -> Result<(), TextError> {
        if self.text.trim().is_empty() {
            return Err(TextError::Empty);
        }
        let chars = self.text.chars().count();
        if chars > MAX_TEXT_CHARS {
            return Err(TextError::TooLong(chars));
        }
        let style = &self.style;
        if !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&style.size) {
            return Err(TextError::FontSize(style.size));
        }
        if !is_hex_color(&style.color, false) {
            return Err(TextError::Color(style.color.clone()));
        }
        if let Some(background) = &style.background {
            if !is_hex_color(background, true) {
                return Err(TextError::Color(background.clone()));
            }
        }
        if style.x > POSITION_SCALE || style.y > POSITION_SCALE {
            return Err(TextError::Position);
        }
        if style.animation_ms > MAX_ANIMATION_MS {
            return Err(TextError::AnimationMs(style.animation_ms));
        }
        if let Some(highlight) = &style.highlight {
            if !is_hex_color(highlight, false) {
                return Err(TextError::Color(highlight.clone()));
            }
        }
        if !self.words.is_empty() {
            let count = self.text.split_whitespace().count();
            if self.words.len() != count {
                return Err(TextError::WordCount(self.words.len(), count));
            }
            let ordered = self.words.iter().all(|w| w.start >= 0 && w.start <= w.end)
                && self.words.windows(2).all(|w| w[0].start <= w[1].start);
            if !ordered {
                return Err(TextError::WordOrder);
            }
        }
        Ok(())
    }
}

/// `#rrggbb`, or `#rrggbbaa` when `with_alpha`.
fn is_hex_color(value: &str, with_alpha: bool) -> bool {
    let digits = if with_alpha { 8 } else { 6 };
    value.len() == digits + 1
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(text: &str) -> TextContent {
        TextContent {
            text: text.into(),
            style: TextStyle::default(),
            words: Vec::new(),
        }
    }

    #[test]
    fn default_title_is_valid() {
        assert_eq!(content("Hello").validate(), Ok(()));
    }

    #[test]
    fn rejects_empty_or_overlong_text() {
        assert_eq!(content("   \n").validate(), Err(TextError::Empty));
        let long = "é".repeat(MAX_TEXT_CHARS + 1); // counted in characters, not bytes
        assert_eq!(
            content(&long).validate(),
            Err(TextError::TooLong(MAX_TEXT_CHARS + 1))
        );
        assert_eq!(content(&"é".repeat(MAX_TEXT_CHARS)).validate(), Ok(()));
    }

    #[test]
    fn validates_style_ranges_and_colours() {
        let mut c = content("Hi");
        c.style.size = 8;
        assert_eq!(c.validate(), Err(TextError::FontSize(8)));
        c.style.size = 72;
        c.style.color = "red".into();
        assert_eq!(c.validate(), Err(TextError::Color("red".into())));
        c.style.color = "#FF0000".into();
        c.style.background = Some("#00000080".into());
        assert_eq!(c.validate(), Ok(()));
        c.style.background = Some("#000000".into()); // needs alpha
        assert!(matches!(c.validate(), Err(TextError::Color(_))));
        c.style.background = None;
        c.style.y = 1001;
        assert_eq!(c.validate(), Err(TextError::Position));
        c.style.y = 500;
        c.style.animation_ms = 5000;
        assert_eq!(c.validate(), Err(TextError::AnimationMs(5000)));
    }

    #[test]
    fn missing_style_fields_get_defaults() {
        let parsed: TextContent =
            serde_json::from_str(r#"{"text":"Hi","style":{"size":40}}"#).unwrap();
        assert_eq!(parsed.style.size, 40);
        assert_eq!(parsed.style.color, "#ffffff");
        let bare: TextContent = serde_json::from_str(r#"{"text":"Hi"}"#).unwrap();
        assert_eq!(bare.style, TextStyle::default());
    }

    #[test]
    fn word_timings_must_match_the_text() {
        let words = |pairs: &[(Micros, Micros)]| {
            pairs
                .iter()
                .map(|&(start, end)| WordTiming { start, end })
                .collect::<Vec<_>>()
        };
        let content = |text: &str, timings: Vec<WordTiming>| TextContent {
            text: text.to_owned(),
            style: TextStyle {
                highlight: Some("#facc15".into()),
                ..TextStyle::default()
            },
            words: timings,
        };
        assert_eq!(
            content("ask not\nwhat", words(&[(0, 10), (10, 20), (25, 40)])).validate(),
            Ok(()),
            "a line break separates words too"
        );
        assert_eq!(
            content("ask not", words(&[(0, 10)])).validate(),
            Err(TextError::WordCount(1, 2))
        );
        assert_eq!(
            content("ask not", words(&[(20, 30), (0, 10)])).validate(),
            Err(TextError::WordOrder)
        );
        assert_eq!(
            content("ask", words(&[(10, 5)])).validate(),
            Err(TextError::WordOrder)
        );
        let bad_colour = TextContent {
            style: TextStyle {
                highlight: Some("yellow".into()),
                ..TextStyle::default()
            },
            ..content("ask", vec![])
        };
        assert_eq!(
            bad_colour.validate(),
            Err(TextError::Color("yellow".into()))
        );
    }

    #[test]
    fn titles_without_word_timings_save_as_before() {
        let content = TextContent {
            text: "Hi".into(),
            style: TextStyle::default(),
            words: vec![],
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(!json.contains("words") && !json.contains("highlight"));
        let back: TextContent = serde_json::from_str(r#"{"text":"Hi"}"#).unwrap();
        assert_eq!(back, content);
    }
}
