/**
 * Smooth Palette Transition & Interpolation Engine.
 * Transitions between previous and new album artwork palettes over 500–900 ms
 * using a cubic ease-out curve to prevent sudden visual flashes when tracks change.
 */

import {
  type AlbumPalette,
  DEFAULT_NEUTRAL_PALETTE,
  type RgbColor,
  rgbToCss,
} from "../types/palette.ts";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function lerpRgb(c1: RgbColor, c2: RgbColor, t: number): RgbColor {
  const safeT = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * safeT),
    g: Math.round(c1.g + (c2.g - c1.g) * safeT),
    b: Math.round(c1.b + (c2.b - c1.b) * safeT),
  };
}

/**
 * Quadratic ease-out curve: starts briskly and decelerates smoothly into the target color.
 */
export function easeOutQuad(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * (2 - c);
}

export interface TransitionState {
  current: AlbumPalette;
  from: AlbumPalette;
  to: AlbumPalette;
  startTime: number;
  durationMs: number;
}

export class PaletteTransitionManager {
  private from: AlbumPalette;
  private to: AlbumPalette;
  private startTime: number;
  private durationMs: number;

  constructor(initial: AlbumPalette = DEFAULT_NEUTRAL_PALETTE, durationMs = 700) {
    this.from = initial;
    this.to = initial;
    this.startTime = 0;
    this.durationMs = durationMs;
  }

  public setTarget(newPalette: AlbumPalette, now = performance.now()): void {
    if (this.to.trackKey === newPalette.trackKey) {
      return;
    }

    // Capture currently interpolated state as new starting point
    this.from = this.getPalette(now);
    this.to = newPalette;
    this.startTime = now;
  }

  public getPalette(now = performance.now()): AlbumPalette {
    if (this.startTime === 0 || now >= this.startTime + this.durationMs) {
      return this.to;
    }

    const elapsed = now - this.startTime;
    const progress = Math.max(0, Math.min(1, elapsed / this.durationMs));
    const eased = easeOutQuad(progress);

    const dominant = lerpRgb(this.from.dominant, this.to.dominant, eased);
    const secondary = lerpRgb(this.from.secondary, this.to.secondary, eased);
    const accent = lerpRgb(this.from.accent, this.to.accent, eased);
    const background = lerpRgb(this.from.background, this.to.background, eased);
    const foreground = lerpRgb(this.from.foreground, this.to.foreground, eased);

    return {
      trackKey: this.to.trackKey,
      dominant,
      secondary,
      accent,
      background,
      foreground,
      isMonochrome: this.to.isMonochrome,
      dominantCss: rgbToCss(dominant),
      secondaryCss: rgbToCss(secondary),
      accentCss: rgbToCss(accent),
      backgroundCss: rgbToCss(background),
      foregroundCss: rgbToCss(foreground),
    };
  }

  public getCurrentPalette(now = performance.now()): AlbumPalette {
    return this.getPalette(now);
  }

  public isTransitioning(now = performance.now()): boolean {
    return this.startTime !== 0 && now < this.startTime + this.durationMs;
  }

  public reset(neutral: AlbumPalette = DEFAULT_NEUTRAL_PALETTE): void {
    this.from = neutral;
    this.to = neutral;
    this.startTime = 0;
  }
}
