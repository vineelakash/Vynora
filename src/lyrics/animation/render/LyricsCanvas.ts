/**
 * Unified Canvas Orchestrator for Kinetic Lyrics Animation.
 *
 * Coordinates:
 * - Single requestAnimationFrame loop with timestamp-based delta time.
 * - High-DPI canvas scaling (devicePixelRatio).
 * - Smooth album palette transitions (lerp between track palettes).
 * - BackgroundRenderer, ParticleRenderer, and Style Dispatcher (all 6 styles).
 * - Dynamic resize and clean resource destruction.
 */

import type { AlbumPalette, RgbColor } from '../../../types/palette.ts';
import type { BeatGlowFrame } from '../../../types/audio.ts';
import type { ParsedLyricLine } from '../../../types/lyrics.ts';
import type {
  KineticStudioSettings,
  KineticStyleId,
  RenderContext,
  TrackMetadata,
} from '../animationTypes.ts';
import { DEFAULT_STUDIO_SETTINGS } from '../animationTypes.ts';
import { resolveLineTimingContext } from '../wordTiming.ts';
import { BackgroundRenderer } from './BackgroundRenderer.ts';
import { ParticleRenderer } from './ParticleRenderer.ts';
import { PerformanceProfiler, type PerformanceSnapshot } from './PerformanceProfiler.ts';
import { BigWordsStyle } from '../styles/BigWords.ts';
import { LinesStyle } from '../styles/Lines.ts';
import { ChatStyle } from '../styles/Chat.ts';
import { ConstellationStyle } from '../styles/Constellation.ts';
import { TerminalStyle } from '../styles/Terminal.ts';
import { KaraokeStyle } from '../styles/Karaoke.ts';

// Neutral fallback palette when artwork/palette is unavailable
export const NEUTRAL_PALETTE: AlbumPalette = {
  trackKey: 'idle::neutral',
  dominant: { r: 38, g: 38, b: 48 },
  secondary: { r: 24, g: 24, b: 32 },
  accent: { r: 139, g: 92, b: 246 }, // Elegant violet
  background: { r: 8, g: 8, b: 12 },
  foreground: { r: 240, g: 240, b: 245 },
  dominantCss: 'rgb(38, 38, 48)',
  secondaryCss: 'rgb(24, 24, 32)',
  accentCss: 'rgb(139, 92, 246)',
  backgroundCss: 'rgb(8, 8, 12)',
  foregroundCss: 'rgb(240, 240, 245)',
  isMonochrome: false,
};

function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  const step = (from: number, to: number) => {
    if (from === to) return to;
    const delta = (to - from) * t;
    const rounded = Math.round(delta);
    if (rounded === 0) {
      return from + (to > from ? 1 : -1);
    }
    return from + rounded;
  };
  return {
    r: step(a.r, b.r),
    g: step(a.g, b.g),
    b: step(a.b, b.b),
  };
}

export class LyricsCanvasEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private settings: KineticStudioSettings;
  private currentPalette: AlbumPalette;
  private targetPalette: AlbumPalette;
  private artworkImg: HTMLImageElement | null = null;
  private trackMetadata: TrackMetadata = {};

  private lines: ParsedLyricLine[] = [];
  private trackKey = 'default';
  private positionMs = 0;
  private isPlaying = false;
  private audioFrame: BeatGlowFrame | null = null;

  // High-Precision Continuous Clock (Task A.6.1 & Task B.1)
  private currentPositionMs = 0;
  private driftCorrectionMs = 0;
  private lastRenderTimestamp = 0;
  private lastAuthoritativePosMs: number | null = null;
  private isSampleMode = false;

  // Diagnostic Profiler
  private profiler = new PerformanceProfiler();

  // Stable Tauri IPC Subscriptions (Bypasses React state churn)
  private unlistenData: (() => void) | null = null;
  private unlistenPalette: (() => void) | null = null;

  // Renderers & Styles
  private bgRenderer = new BackgroundRenderer();
  private particleRenderer = new ParticleRenderer(42);
  private styles: Record<KineticStyleId, { draw: (ctx: CanvasRenderingContext2D, c: any, r: RenderContext) => void }> = {
    'big-words': new BigWordsStyle(),
    'lines': new LinesStyle(),
    'chat': new ChatStyle(),
    'constellation': new ConstellationStyle(),
    'terminal': new TerminalStyle(),
    'karaoke': new KaraokeStyle(),
  };

  private width = 0;
  private height = 0;
  private dpr = 1;
  private boundWindowResize = () => this.handleResize();

  constructor(
    canvas: HTMLCanvasElement,
    initialSettings: Partial<KineticStudioSettings> = {},
    initialPalette?: AlbumPalette,
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Canvas 2D context not available');
    }
    this.ctx = context;

    this.settings = { ...DEFAULT_STUDIO_SETTINGS, ...initialSettings };
    this.targetPalette = initialPalette ? { ...initialPalette } : { ...NEUTRAL_PALETTE };
    this.currentPalette = { ...this.targetPalette };

    this.handleResize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.canvas);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundWindowResize);
    }

    this.attachAudioBridge();

    // Auto-enable diagnostics if query param or localStorage requested (supports both VYNORA and legacy Needle keys)
    if (
      typeof window !== 'undefined' &&
      (window.location.search.includes('perf=true') ||
        window.location.search.includes('debug=1') ||
        localStorage.getItem('vynora_perf_overlay') === '1' ||
        localStorage.getItem('needle_perf_overlay') === '1')
    ) {
      this.profiler.setEnabled(true);
    }

    this.startLoop();
  }

  /**
   * Attaches stable direct event subscriptions to Tauri IPC for audio & palette.
   * Completely avoids React component re-rendering during high-frequency audio frames.
   */
  public attachAudioBridge(): void {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return;
    }

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        listen<BeatGlowFrame>('beat-glow-data', (event) => {
          if (event.payload) {
            this.audioFrame = event.payload;
          }
        })
          .then((unlisten) => {
            this.unlistenData = unlisten;
          })
          .catch((err) => {
            console.warn('[LyricsCanvasEngine] Failed to listen beat-glow-data:', err);
          });

        listen<AlbumPalette | null>('album-palette-changed', (event) => {
          if (event.payload) {
            this.setPalette(event.payload);
          }
        })
          .then((unlisten) => {
            this.unlistenPalette = unlisten;
          })
          .catch((err) => {
            console.warn('[LyricsCanvasEngine] Failed to listen album-palette-changed:', err);
          });
      })
      .catch((err) => {
        console.warn('[LyricsCanvasEngine] Failed to load Tauri event module:', err);
      });
  }

  public handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.width = w;
    this.height = h;

    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  public setSettings(settings: Partial<KineticStudioSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (typeof settings.showPerfDiagnostics === 'boolean') {
      this.profiler.setEnabled(settings.showPerfDiagnostics);
    }
  }

  public setPalette(palette?: AlbumPalette | null): void {
    if (!palette) {
      this.targetPalette = { ...NEUTRAL_PALETTE };
    } else {
      this.targetPalette = { ...palette };
    }
  }

  public setArtwork(img: HTMLImageElement | null): void {
    this.artworkImg = img;
  }

  public setTrackMetadata(metadata: TrackMetadata): void {
    this.trackMetadata = { ...metadata };
  }

  public setLyrics(lines: ParsedLyricLine[], trackKey = 'default'): void {
    if (trackKey !== this.trackKey) {
      this.lastAuthoritativePosMs = null;
      this.driftCorrectionMs = 0;
    }
    this.lines = lines;
    this.trackKey = trackKey;
  }

  public setSampleMode(isSample: boolean): void {
    this.isSampleMode = isSample;
  }

  public setPosition(authoritativePosMs: number, isPlaying: boolean): void {
    if (!this.isPlaying && isPlaying) {
      // Transition from paused to playing: snap cleanly
      this.currentPositionMs = authoritativePosMs;
      this.lastAuthoritativePosMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      this.isPlaying = true;
      return;
    }

    if (this.isPlaying && !isPlaying) {
      // Transition from playing to paused: freeze at authoritative position
      this.currentPositionMs = authoritativePosMs;
      this.lastAuthoritativePosMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      this.isPlaying = false;
      return;
    }

    this.isPlaying = isPlaying;

    if (!isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.lastAuthoritativePosMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      return;
    }

    // Only re-evaluate disparity when a new authoritative timestamp arrives
    if (this.lastAuthoritativePosMs === null || Math.abs(authoritativePosMs - this.lastAuthoritativePosMs) > 1) {
      this.lastAuthoritativePosMs = authoritativePosMs;
      const disparity = authoritativePosMs - this.currentPositionMs;

      if (Math.abs(disparity) > 500) {
        // Large seek / track skip: snap immediately
        this.currentPositionMs = authoritativePosMs;
        this.driftCorrectionMs = 0;
      } else if (Math.abs(disparity) > 15) {
        // Small timing difference: gradual correction without resetting anchor
        this.driftCorrectionMs = disparity;
      } else {
        // Within 15ms tolerance: keep continuous clock perfectly steady without drag
        this.driftCorrectionMs = 0;
      }
    }
  }

  public setAudioFrame(audioFrame: BeatGlowFrame | null): void {
    this.audioFrame = audioFrame;
  }

  private startLoop(): void {
    const loop = (timestamp: number) => {
      this.renderFrame(timestamp);
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private smoothPaletteTransition(): void {
    // Lerp RGB colors towards target palette (factor 0.08 per frame)
    const factor = 0.08;
    this.currentPalette.dominant = lerpRgb(this.currentPalette.dominant, this.targetPalette.dominant, factor);
    this.currentPalette.secondary = lerpRgb(this.currentPalette.secondary, this.targetPalette.secondary, factor);
    this.currentPalette.accent = lerpRgb(this.currentPalette.accent, this.targetPalette.accent, factor);
    this.currentPalette.background = lerpRgb(this.currentPalette.background, this.targetPalette.background, factor);
    this.currentPalette.foreground = lerpRgb(this.currentPalette.foreground, this.targetPalette.foreground, factor);

    const d = this.currentPalette.dominant;
    const s = this.currentPalette.secondary;
    const a = this.currentPalette.accent;
    const b = this.currentPalette.background;
    const f = this.currentPalette.foreground;

    this.currentPalette.dominantCss = `rgb(${d.r}, ${d.g}, ${d.b})`;
    this.currentPalette.secondaryCss = `rgb(${s.r}, ${s.g}, ${s.b})`;
    this.currentPalette.accentCss = `rgb(${a.r}, ${a.g}, ${a.b})`;
    this.currentPalette.backgroundCss = `rgb(${b.r}, ${b.g}, ${b.b})`;
    this.currentPalette.foregroundCss = `rgb(${f.r}, ${f.g}, ${f.b})`;
  }

  private renderFrame(timestamp: number): void {
    const { ctx, width, height, dpr } = this;
    if (width <= 0 || height <= 0) return;

    // Advance continuous timeline clock (clamp deltaMs to avoid sleep/minimize jump)
    const rawDeltaMs = this.lastRenderTimestamp > 0 ? (timestamp - this.lastRenderTimestamp) : 16.67;
    const deltaMs = Math.min(100, Math.max(0, rawDeltaMs));
    this.lastRenderTimestamp = timestamp;

    if (this.isPlaying) {
      const speed = this.settings.speed || 1;
      const progression = deltaMs * speed;

      // Apply gradual drift correction (half-life ~220ms, ~5% per frame)
      if (Math.abs(this.driftCorrectionMs) > 0.05) {
        const nudge = this.driftCorrectionMs * 0.05;
        this.driftCorrectionMs -= nudge;
        this.currentPositionMs = Math.max(0, this.currentPositionMs + progression + nudge);
      } else {
        this.driftCorrectionMs = 0;
        this.currentPositionMs = Math.max(0, this.currentPositionMs + progression);
      }
    }

    // High-precision sub-frame continuous position with transport latency compensation.
    // Sample mode keeps 0ms lookahead (exact benchmark behavior); real playback applies syncOffsetMs (+120ms default)
    // to compensate for Windows WASAPI mixer/DAC buffer + GSMTC IPC latency.
    const lookaheadMs = this.isSampleMode ? 0 : (this.settings.syncOffsetMs ?? 120);
    this.positionMs = Math.max(0, this.currentPositionMs + lookaheadMs);

    this.smoothPaletteTransition();

    ctx.save();
    // High-DPI scaling
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bass = this.settings.audioReactive ? (this.audioFrame?.bass ?? 0) : 0;
    const beat = this.settings.audioReactive ? (this.audioFrame?.beat ?? false) : false;
    const treble = this.settings.audioReactive ? (this.audioFrame?.treble ?? 0) : 0;

    // 1. Draw Background Environment
    this.bgRenderer.draw(
      ctx,
      width,
      height,
      this.settings.background,
      this.currentPalette,
      timestamp,
      bass,
      beat,
      this.artworkImg,
      this.settings.reducedMotion,
    );

    // 2. Draw Particles (if enabled; strictly suppressed for minimal Constellation style)
    if (this.settings.particleIntensity > 0 && this.settings.style !== 'constellation') {
      this.particleRenderer.updateAndDraw(
        ctx,
        width,
        height,
        this.currentPalette,
        timestamp,
        treble,
        beat,
        this.settings.particleIntensity,
        this.settings.reducedMotion,
      );
    }

    // 3. Resolve Active Line
    let activeLineIndex = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i]!.timeMs <= this.positionMs) {
        activeLineIndex = i;
      } else {
        break;
      }
    }

    // 4. Resolve LineTimingContext
    const lineContext = resolveLineTimingContext(this.lines, activeLineIndex, this.positionMs, this.trackKey);

    // 5. Render Active Kinetic Style
    const styleRenderer = this.styles[this.settings.style] ?? this.styles['big-words']!;
    const renderCtx: RenderContext = {
      ctx,
      width,
      height,
      dpr,
      nowMs: timestamp,
      positionMs: this.positionMs,
      isPlaying: this.isPlaying,
      palette: this.currentPalette,
      audioFrame: this.settings.audioReactive ? this.audioFrame : null,
      settings: this.settings,
      artworkImg: this.artworkImg,
      lines: this.lines,
      metadata: this.trackMetadata,
    };

    styleRenderer.draw(ctx, lineContext, renderCtx);

    // 6. Performance Profiler & Diagnostic Overlay
    this.profiler.recordFrame(timestamp);
    if (this.profiler.isEnabled()) {
      this.profiler.drawOverlay(ctx, width, height, this.positionMs, this.isPlaying, {
        currentPositionMs: this.currentPositionMs,
        authoritativePosMs: this.lastAuthoritativePosMs ?? this.currentPositionMs,
        disparityMs: this.driftCorrectionMs,
        syncOffsetMs: lookaheadMs,
        isSampleMode: this.isSampleMode,
        activeLineIndex,
        activeLineText: lineContext.lineText,
        timingMode: lineContext.mode,
        timingConfidence: lineContext.confidence,
      });
    }

    ctx.restore();
  }

  public destroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundWindowResize);
    }
    if (this.unlistenData) {
      this.unlistenData();
      this.unlistenData = null;
    }
    if (this.unlistenPalette) {
      this.unlistenPalette();
      this.unlistenPalette = null;
    }
  }

  public togglePerformanceOverlay(enabled?: boolean): boolean {
    if (typeof enabled === 'boolean') {
      this.profiler.setEnabled(enabled);
      return enabled;
    }
    return this.profiler.toggle();
  }

  public getPerformanceSnapshot(): PerformanceSnapshot {
    return this.profiler.getSnapshot();
  }

  public getCurrentPositionMs(): number {
    return this.currentPositionMs;
  }

  public getVisualPositionMs(): number {
    return this.positionMs;
  }
}
