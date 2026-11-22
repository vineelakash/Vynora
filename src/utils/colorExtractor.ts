/**
 * Dynamic Album Artwork Colour Extractor.
 * Extracts dominant, secondary, accent, background, and foreground colours
 * from album artwork using perceptual colour clustering and quantization.
 */

import {
  type AlbumPalette,
  DEFAULT_NEUTRAL_PALETTE,
  MONOCHROME_PALETTE,
  type RgbColor,
  rgbToCss,
} from "../types/palette.ts";

export interface ColorCluster {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  count: number;
  score: number;
}

const PALETTE_CACHE = new Map<string, AlbumPalette>();
const MAX_CACHE_SIZE = 64;

export function getCachedPalette(key: string): AlbumPalette | undefined {
  if (!key) return undefined;
  return PALETTE_CACHE.get(key);
}

export function setCachedPalette(key: string, palette: AlbumPalette): void {
  if (!key) return;
  if (PALETTE_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = PALETTE_CACHE.keys().next().value;
    if (firstKey) PALETTE_CACHE.delete(firstKey);
  }
  PALETTE_CACHE.set(key, palette);
}

export function clearPaletteCache(): void {
  PALETTE_CACHE.clear();
}

/**
 * Converts RGB [0..255] to HSL (H: [0..360), S: [0..1], L: [0..1]).
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;

  let h = 0;
  const l = (max + min) / 2;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    switch (max) {
      case rf:
        h = ((gf - bf) / delta + (gf < bf ? 6 : 0)) * 60;
        break;
      case gf:
        h = ((bf - rf) / delta + 2) * 60;
        break;
      case bf:
        h = ((rf - gf) / delta + 4) * 60;
        break;
    }
  }

  return [h, s, l];
}

/**
 * Converts HSL (H: [0..360), S: [0..1], L: [0..1]) to RGB [0..255].
 */
export function hslToRgb(h: number, s: number, l: number): RgbColor {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;

  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp >= 1 && hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp >= 2 && hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp >= 3 && hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp >= 4 && hp < 5) {
    r1 = x;
    b1 = c;
  } else if (hp >= 5 && hp < 6) {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Computes perceptual color distance between two RGB colors.
 */
export function colorDistance(c1: RgbColor, c2: RgbColor): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  // Weighted Euclidean distance approximating human eye sensitivity
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
}

/**
 * Pure image pixel extraction function.
 * Evaluates RGBA pixel buffers directly without DOM canvas requirements.
 */
export function extractPaletteFromRgbaPixels(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number,
  trackKey: string,
): AlbumPalette {
  if (!pixels || pixels.length < 4 || width <= 0 || height <= 0) {
    return { ...DEFAULT_NEUTRAL_PALETTE, trackKey };
  }

  const totalPixels = Math.floor(pixels.length / 4);
  let transparentCount = 0;
  let monochromePixels = 0;

  // 12-bit quantization buckets (16 levels per channel: 0..15)
  // Maps 4096 bins
  const binMap = new Map<
    number,
    { rSum: number; gSum: number; bSum: number; count: number }
  >();

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] ?? 255;
    if (a < 128) {
      transparentCount++;
      continue;
    }

    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;

    const [, s] = rgbToHsl(r, g, b);

    // Saturation threshold for grayscale
    if (s < 0.12) {
      monochromePixels++;
    }

    // Quantize 8-bit to 4-bit (0..15)
    const qr = Math.floor(r / 16);
    const qg = Math.floor(g / 16);
    const qb = Math.floor(b / 16);
    const binKey = (qr << 8) | (qg << 4) | qb;

    let bin = binMap.get(binKey);
    if (!bin) {
      bin = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
      binMap.set(binKey, bin);
    }
    bin.rSum += r;
    bin.gSum += g;
    bin.bSum += b;
    bin.count++;
  }

  const validPixels = totalPixels - transparentCount;
  if (validPixels <= 0) {
    return { ...DEFAULT_NEUTRAL_PALETTE, trackKey };
  }

  // Detect pure monochrome / grayscale artwork (> 90% desaturated)
  const isMonochrome = monochromePixels / validPixels > 0.9;
  if (isMonochrome) {
    const mono: AlbumPalette = {
      ...MONOCHROME_PALETTE,
      trackKey,
    };
    setCachedPalette(trackKey, mono);
    return mono;
  }

  // Build and score candidate color clusters
  const clusters: ColorCluster[] = [];

  for (const bin of binMap.values()) {
    if (bin.count < 2) continue;

    const r = Math.round(bin.rSum / bin.count);
    const g = Math.round(bin.gSum / bin.count);
    const b = Math.round(bin.bSum / bin.count);
    const [h, s, l] = rgbToHsl(r, g, b);

    // Boost score for saturated, visible hues; penalize extreme black or extreme white
    const saturationWeight = 1.0 + s * 2.2;
    const lightnessWeight = 1.0 - Math.abs(l - 0.5) * 1.4;
    const score = bin.count * Math.max(0.1, saturationWeight * lightnessWeight);

    clusters.push({ r, g, b, h, s, l, count: bin.count, score });
  }

  if (clusters.length === 0) {
    return { ...DEFAULT_NEUTRAL_PALETTE, trackKey };
  }

  // Sort clusters descending by prominence score
  clusters.sort((a, b) => b.score - a.score);

  // 1. Dominant colour: highest prominence score
  const dominantCluster = clusters[0]!;
  const dominant: RgbColor = {
    r: dominantCluster.r,
    g: dominantCluster.g,
    b: dominantCluster.b,
  };

  // 2. Secondary colour: distinct cluster with Euclidean color distance >= 48
  let secondaryCluster: ColorCluster | null = null;
  for (let i = 1; i < clusters.length; i++) {
    const c = clusters[i]!;
    const dist = colorDistance(dominant, c);
    if (dist >= 48) {
      secondaryCluster = c;
      break;
    }
  }

  let secondary: RgbColor;
  if (secondaryCluster) {
    secondary = {
      r: secondaryCluster.r,
      g: secondaryCluster.g,
      b: secondaryCluster.b,
    };
  } else {
    // If artwork is monochromatic (e.g. single red tone), derive harmonic secondary (shift lightness & tone)
    const [dh, ds, dl] = rgbToHsl(dominant.r, dominant.g, dominant.b);
    secondary = hslToRgb((dh + 20) % 360, Math.max(0.4, ds * 0.8), Math.max(0.25, dl * 0.7));
  }

  // 3. Accent colour: brightest / most energetic highlight with distance >= 40 from dominant
  let accentCluster: ColorCluster | null = null;
  let maxAccentScore = -1;

  for (let i = 1; i < clusters.length; i++) {
    const c = clusters[i]!;
    const distD = colorDistance(dominant, c);
    const distS = colorDistance(secondary, c);
    if (distD >= 36 || distS >= 36) {
      // Prioritize high saturation & vivid brightness
      const accentScore = c.s * 1.5 + (1.0 - Math.abs(c.l - 0.65)) * 1.2;
      if (accentScore > maxAccentScore) {
        maxAccentScore = accentScore;
        accentCluster = c;
      }
    }
  }

  let accent: RgbColor;
  if (accentCluster) {
    accent = {
      r: accentCluster.r,
      g: accentCluster.g,
      b: accentCluster.b,
    };
  } else {
    // Derive high-energy accent harmonic
    const [dh, ds] = rgbToHsl(dominant.r, dominant.g, dominant.b);
    accent = hslToRgb((dh + 45) % 360, Math.min(1.0, ds + 0.2), 0.72);
  }

  // 4. Background: Deep obsidian base retaining ~12% tint of dominant hue
  const [dh, ds] = rgbToHsl(dominant.r, dominant.g, dominant.b);
  const background = hslToRgb(dh, Math.min(0.35, ds * 0.5), 0.07);

  // 5. Foreground: High-contrast text / icon colour (WCAG >= 4.5:1 against dark background)
  const foreground: RgbColor = { r: 248, g: 248, b: 252 };

  const palette: AlbumPalette = {
    trackKey,
    dominant,
    secondary,
    accent,
    background,
    foreground,
    isMonochrome: false,
    dominantCss: rgbToCss(dominant),
    secondaryCss: rgbToCss(secondary),
    accentCss: rgbToCss(accent),
    backgroundCss: rgbToCss(background),
    foregroundCss: rgbToCss(foreground),
  };

  setCachedPalette(trackKey, palette);
  return palette;
}

/**
 * Extracts palette from a base64 / data URI image using an offscreen canvas.
 * Falls back gracefully to neutral palette on error or in headless environments.
 */
export async function extractPaletteFromDataUrl(
  dataUrl: string,
  trackKey: string,
): Promise<AlbumPalette> {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return { ...DEFAULT_NEUTRAL_PALETTE, trackKey };
  }

  // Check cache first
  const cached = getCachedPalette(trackKey);
  if (cached) {
    return cached;
  }

  // If in a non-browser environment without Image/canvas, return neutral
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return { ...DEFAULT_NEUTRAL_PALETTE, trackKey };
  }

  return new Promise<AlbumPalette>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    const timeoutId = setTimeout(() => {
      resolve({ ...DEFAULT_NEUTRAL_PALETTE, trackKey });
    }, 2000);

    img.onload = () => {
      clearTimeout(timeoutId);
      try {
        const canvas = document.createElement("canvas");
        const sampleSize = 48; // 48x48 downsample = 2304 pixels (executes in < 1ms)
        canvas.width = sampleSize;
        canvas.height = sampleSize;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ ...DEFAULT_NEUTRAL_PALETTE, trackKey });
          return;
        }

        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const imgData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const palette = extractPaletteFromRgbaPixels(
          imgData.data,
          sampleSize,
          sampleSize,
          trackKey,
        );
        resolve(palette);
      } catch {
        resolve({ ...DEFAULT_NEUTRAL_PALETTE, trackKey });
      }
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      resolve({ ...DEFAULT_NEUTRAL_PALETTE, trackKey });
    };

    img.src = dataUrl;
  });
}
