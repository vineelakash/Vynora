/**
 * Kinetic Lyrics Animation Engine Types & Interfaces.
 */

import type { AlbumPalette } from '../../types/palette.ts';
import type { BeatGlowFrame } from '../../types/audio.ts';
import type { ParsedLyricLine } from '../../types/lyrics.ts';

export type KineticStyleId =
  | 'big-words'
  | 'lines'
  | 'chat'
  | 'constellation'
  | 'terminal'
  | 'karaoke';

export type BackgroundStyleId =
  | 'aura'
  | 'black'
  | 'cover'
  | 'ambient';

export type TimingMode = 'actual' | 'estimated' | 'line-only';
export type TimingConfidence = 'high' | 'medium' | 'low';

export type TransitionPreset = 'cinematic' | 'smooth' | 'minimal' | 'expressive' | 'custom';

export type FontFamilyChoice = 'sans' | 'serif' | 'mono' | 'display';
export type FontSizeChoice = 'small' | 'medium' | 'large' | 'xl';
export type FontWeightChoice = 'normal' | 'medium' | 'semibold' | 'bold';
export type TextAlignChoice = 'left' | 'center' | 'right';

export interface TimedWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  index: number;
  lineIndex: number;
  trailingPunctuation?: string;
  leadingSpace?: boolean;
}

export interface LineTimingContext {
  lineIndex: number;
  lineText: string;
  lineStartMs: number;
  lineEndMs: number;
  words: TimedWord[];
  activeWordIndex: number;
  activeWordProgress: number; // 0.0 .. 1.0 within current word
  lineProgress: number;       // 0.0 .. 1.0 within current line
  mode: TimingMode;
  confidence: TimingConfidence;
  prevLineText?: string;
  nextLineText?: string;
}

export interface KineticStudioSettings {
  style: KineticStyleId;
  background: BackgroundStyleId;
  preset: TransitionPreset;
  fontFamily: FontFamilyChoice;
  fontSize: FontSizeChoice;
  fontWeight: FontWeightChoice;
  letterSpacing: number;     // -1 .. 4 px (default 0)
  lineSpacing: number;       // 1.2 .. 2.2 (default 1.5)
  textAlign: TextAlignChoice;
  speed: number;             // 0.5 .. 2.0 (default 1.0)
  intensity: number;         // 0.5 .. 2.0 (default 1.0)
  glowEnabled: boolean;      // default true
  glowIntensity: number;     // 0.0 .. 2.0 (default 1.0)
  blurIntensity: number;     // 0.0 .. 1.5 (default 1.0)
  particleIntensity: number; // 0.0 .. 2.0 (default 1.0)
  reducedMotion: boolean;    // default false
  audioReactive: boolean;    // default true
  showPerfDiagnostics?: boolean; // default false (F3 / Ctrl+Shift+D diagnostic HUD)
  syncOffsetMs?: number;     // Transport latency compensation in ms (default 120ms for real playback; 0ms for sample benchmark)
}

export const DEFAULT_STUDIO_SETTINGS: KineticStudioSettings = {
  style: 'chat',
  background: 'aura',
  preset: 'cinematic',
  fontFamily: 'sans',
  fontSize: 'medium',
  fontWeight: 'bold',
  letterSpacing: 0,
  lineSpacing: 1.5,
  textAlign: 'center',
  speed: 1.0,
  intensity: 1.0,
  glowEnabled: true,
  glowIntensity: 1.0,
  blurIntensity: 1.0,
  particleIntensity: 1.0,
  reducedMotion: false,
  audioReactive: true,
  showPerfDiagnostics: false,
  syncOffsetMs: 120,
};

export const PRESET_CONFIGS: Record<Exclude<TransitionPreset, 'custom'>, Partial<KineticStudioSettings>> = {
  cinematic: {
    preset: 'cinematic',
    style: 'big-words',
    background: 'aura',
    fontFamily: 'sans',
    fontWeight: 'bold',
    letterSpacing: 0.5,
    lineSpacing: 1.5,
    speed: 1.0,
    intensity: 1.2,
    glowEnabled: true,
    glowIntensity: 1.3,
    blurIntensity: 1.0,
    particleIntensity: 1.0,
    reducedMotion: false,
    audioReactive: true,
  },
  smooth: {
    preset: 'smooth',
    style: 'lines',
    background: 'ambient',
    fontFamily: 'sans',
    fontWeight: 'medium',
    letterSpacing: 0,
    lineSpacing: 1.6,
    speed: 0.9,
    intensity: 0.85,
    glowEnabled: true,
    glowIntensity: 0.7,
    blurIntensity: 0.5,
    particleIntensity: 0.6,
    reducedMotion: false,
    audioReactive: true,
  },
  minimal: {
    preset: 'minimal',
    style: 'lines',
    background: 'black',
    fontFamily: 'sans',
    fontWeight: 'normal',
    letterSpacing: 0,
    lineSpacing: 1.4,
    speed: 1.0,
    intensity: 0.5,
    glowEnabled: false,
    glowIntensity: 0.2,
    blurIntensity: 0.0,
    particleIntensity: 0.0,
    reducedMotion: false,
    audioReactive: false,
  },
  expressive: {
    preset: 'expressive',
    style: 'constellation',
    background: 'ambient',
    fontFamily: 'display',
    fontWeight: 'bold',
    letterSpacing: 0.5,
    lineSpacing: 1.6,
    speed: 1.0,
    intensity: 1.0,
    glowEnabled: true,
    glowIntensity: 0.8,
    blurIntensity: 0.0,
    particleIntensity: 0.0,
    reducedMotion: false,
    audioReactive: true,
  },
};

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  trackKey?: string;
  lookupState?: 'idle' | 'loading' | 'synced' | 'plain' | 'instrumental' | 'unavailable' | 'error';
  isConnected?: boolean;
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  nowMs: number;
  positionMs: number;
  isPlaying: boolean;
  palette: AlbumPalette;
  audioFrame?: BeatGlowFrame | null;
  settings: KineticStudioSettings;
  artworkImg?: HTMLImageElement | null;
  lines?: ParsedLyricLine[];
  metadata?: TrackMetadata;
}

export interface SampleTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  language: 'English' | 'Telugu' | 'Hindi';
  lrc: string;
  durationMs: number;
  palette: AlbumPalette;
  artworkDataUrl: string;
}
