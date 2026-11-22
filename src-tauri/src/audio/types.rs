use serde::{Deserialize, Serialize};

pub const DEFAULT_SPECTRUM_SIZE: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BeatGlowMode {
    Spectrum,
    Waveform,
    Circular,
    Ambient,
}

impl Default for BeatGlowMode {
    fn default() -> Self {
        Self::Spectrum
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BeatGlowTheme {
    Artwork,
    Monochrome,
}

impl Default for BeatGlowTheme {
    fn default() -> Self {
        Self::Artwork
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[allow(dead_code)]
impl RgbColor {
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    pub fn to_css(&self) -> String {
        format!("rgb({}, {}, {})", self.r, self.g, self.b)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPalette {
    pub track_key: String,
    pub dominant: RgbColor,
    pub secondary: RgbColor,
    pub accent: RgbColor,
    pub background: RgbColor,
    pub foreground: RgbColor,
    pub is_monochrome: bool,
    pub dominant_css: String,
    pub secondary_css: String,
    pub accent_css: String,
    pub background_css: String,
    pub foreground_css: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BeatGlowFrame {
    pub rms: f32,
    pub peak: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub beat: bool,
    pub spectrum: Vec<f32>,
    pub waveform: Vec<f32>,
    pub is_capturing: bool,
    pub device_available: bool,
    pub timestamp_unix_ms: u64,
}

impl Default for BeatGlowFrame {
    fn default() -> Self {
        Self::idle(false, false)
    }
}

impl BeatGlowFrame {
    pub fn idle(is_capturing: bool, device_available: bool) -> Self {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Self {
            rms: 0.0,
            peak: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            beat: false,
            spectrum: vec![0.0; DEFAULT_SPECTRUM_SIZE],
            waveform: vec![0.0; DEFAULT_SPECTRUM_SIZE],
            is_capturing,
            device_available,
            timestamp_unix_ms: now_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BeatGlowPrefs {
    pub enabled: bool,
    pub mode: BeatGlowMode,
    pub theme: BeatGlowTheme,
    pub sensitivity: f32,
    pub intensity: f32,
    pub show_main_visualizer: bool,
    pub island_glow_enabled: bool,
    pub vinyl_glow_enabled: bool,
}

impl Default for BeatGlowPrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: BeatGlowMode::Spectrum,
            theme: BeatGlowTheme::Artwork,
            sensitivity: 1.0,
            intensity: 1.0,
            show_main_visualizer: true,
            island_glow_enabled: true,
            vinyl_glow_enabled: true,
        }
    }
}

impl BeatGlowPrefs {
    pub fn apply_patch(&mut self, patch: BeatGlowPrefsPatch) {
        if let Some(enabled) = patch.enabled {
            self.enabled = enabled;
        }
        if let Some(mode) = patch.mode {
            self.mode = mode;
        }
        if let Some(theme) = patch.theme {
            self.theme = theme;
        }
        if let Some(sensitivity) = patch.sensitivity {
            self.sensitivity = sensitivity.clamp(0.2, 3.0);
        }
        if let Some(intensity) = patch.intensity {
            self.intensity = intensity.clamp(0.2, 2.5);
        }
        if let Some(show_main_visualizer) = patch.show_main_visualizer {
            self.show_main_visualizer = show_main_visualizer;
        }
        if let Some(island_glow_enabled) = patch.island_glow_enabled {
            self.island_glow_enabled = island_glow_enabled;
        }
        if let Some(vinyl_glow_enabled) = patch.vinyl_glow_enabled {
            self.vinyl_glow_enabled = vinyl_glow_enabled;
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatGlowPrefsPatch {
    pub enabled: Option<bool>,
    pub mode: Option<BeatGlowMode>,
    pub theme: Option<BeatGlowTheme>,
    pub sensitivity: Option<f32>,
    pub intensity: Option<f32>,
    pub show_main_visualizer: Option<bool>,
    pub island_glow_enabled: Option<bool>,
    pub vinyl_glow_enabled: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beat_glow_prefs_patch_updates_and_clamps() {
        let mut prefs = BeatGlowPrefs::default();
        assert_eq!(prefs.mode, BeatGlowMode::Spectrum);
        assert_eq!(prefs.theme, BeatGlowTheme::Artwork);
        assert_eq!(prefs.sensitivity, 1.0);

        prefs.apply_patch(BeatGlowPrefsPatch {
            enabled: Some(false),
            mode: Some(BeatGlowMode::Waveform),
            theme: Some(BeatGlowTheme::Monochrome),
            sensitivity: Some(99.0),
            intensity: Some(-5.0),
            show_main_visualizer: Some(false),
            island_glow_enabled: Some(false),
            vinyl_glow_enabled: Some(false),
        });

        assert!(!prefs.enabled);
        assert_eq!(prefs.mode, BeatGlowMode::Waveform);
        assert_eq!(prefs.theme, BeatGlowTheme::Monochrome);
        assert_eq!(prefs.sensitivity, 3.0);
        assert_eq!(prefs.intensity, 0.2);
        assert!(!prefs.show_main_visualizer);
        assert!(!prefs.island_glow_enabled);
        assert!(!prefs.vinyl_glow_enabled);
    }

    #[test]
    fn album_palette_serializes_and_deserializes() {
        let palette = AlbumPalette {
            track_key: "after_hours::the_weeknd".into(),
            dominant: RgbColor::new(220, 20, 60),
            secondary: RgbColor::new(139, 0, 0),
            accent: RgbColor::new(255, 69, 0),
            background: RgbColor::new(15, 10, 12),
            foreground: RgbColor::new(255, 240, 240),
            is_monochrome: false,
            dominant_css: "rgb(220, 20, 60)".into(),
            secondary_css: "rgb(139, 0, 0)".into(),
            accent_css: "rgb(255, 69, 0)".into(),
            background_css: "rgb(15, 10, 12)".into(),
            foreground_css: "rgb(255, 240, 240)".into(),
        };

        let json = serde_json::to_string(&palette).expect("palette serialization failed");
        let parsed: AlbumPalette = serde_json::from_str(&json).expect("palette parsing failed");
        assert_eq!(palette, parsed);
        assert_eq!(parsed.dominant.r, 220);
        assert_eq!(parsed.dominant.to_css(), "rgb(220, 20, 60)");
    }
}
