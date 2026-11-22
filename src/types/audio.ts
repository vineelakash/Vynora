export type BeatGlowMode = 'spectrum' | 'waveform' | 'circular' | 'ambient';
export type BeatGlowTheme = 'artwork' | 'monochrome';

export interface BeatGlowFrame {
  rms: number;
  peak: number;
  bass: number;
  mid: number;
  treble: number;
  beat: boolean;
  spectrum: number[];
  waveform: number[];
  isCapturing: boolean;
  deviceAvailable: boolean;
  timestampUnixMs: number;
}

export interface BeatGlowPrefs {
  enabled: boolean;
  mode: BeatGlowMode;
  theme: BeatGlowTheme;
  sensitivity: number;
  intensity: number;
  showMainVisualizer: boolean;
  islandGlowEnabled: boolean;
  vinylGlowEnabled: boolean;
}

export interface BeatGlowPrefsPatch {
  enabled?: boolean;
  mode?: BeatGlowMode;
  theme?: BeatGlowTheme;
  sensitivity?: number;
  intensity?: number;
  showMainVisualizer?: boolean;
  islandGlowEnabled?: boolean;
  vinylGlowEnabled?: boolean;
}

export const DEFAULT_BEAT_GLOW_PREFS: BeatGlowPrefs = {
  enabled: true,
  mode: 'spectrum',
  theme: 'artwork',
  sensitivity: 1.0,
  intensity: 1.0,
  showMainVisualizer: true,
  islandGlowEnabled: true,
  vinylGlowEnabled: true,
};

export const DEFAULT_BEAT_GLOW_FRAME: BeatGlowFrame = {
  rms: 0,
  peak: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: false,
  spectrum: new Array(64).fill(0),
  waveform: new Array(64).fill(0),
  isCapturing: false,
  deviceAvailable: true,
  timestampUnixMs: 0,
};
