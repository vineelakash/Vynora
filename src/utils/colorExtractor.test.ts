import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPaletteFromRgbaPixels,
  getCachedPalette,
  setCachedPalette,
  clearPaletteCache,
} from './colorExtractor.ts';
import { PaletteTransitionManager, lerpRgb } from './colorTransition.ts';
import { getReactiveGlowColor } from './audioMath.ts';
import {
  DEFAULT_NEUTRAL_PALETTE,
  MONOCHROME_PALETTE,
  type AlbumPalette,
  type RgbColor,
} from '../types/palette.ts';

// Helper to construct a synthetic RGBA pixel buffer of given dimensions and color fill
function createSolidRgbaBuffer(width: number, height: number, r: number, g: number, b: number, a: number = 255): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  }
  return buf;
}

// Helper to construct a two-tone RGBA buffer (e.g. 70% primary, 30% secondary)
function createTwoToneRgbaBuffer(
  width: number,
  height: number,
  c1: [number, number, number],
  c2: [number, number, number],
  c1Ratio: number = 0.7,
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  const totalPixels = width * height;
  const splitPoint = Math.floor(totalPixels * c1Ratio) * 4;

  for (let i = 0; i < splitPoint; i += 4) {
    buf[i] = c1[0];
    buf[i + 1] = c1[1];
    buf[i + 2] = c1[2];
    buf[i + 3] = 255;
  }
  for (let i = splitPoint; i < buf.length; i += 4) {
    buf[i] = c2[0];
    buf[i + 1] = c2[1];
    buf[i + 2] = c2[2];
    buf[i + 3] = 255;
  }
  return buf;
}

describe('colorExtractor — Album Artwork Palette Extraction', () => {
  it('extracts red-dominant palette from crimson/ruby artwork', () => {
    // 48x48 crimson red image
    const pixels = createSolidRgbaBuffer(48, 48, 220, 20, 60);
    const palette = extractPaletteFromRgbaPixels(pixels, 48, 48, 'track-red');

    assert.equal(palette.trackKey, 'track-red');
    assert.equal(palette.isMonochrome, false);
    // Dominant color should be predominantly red
    assert.ok(palette.dominant.r > 160, `Expected dominant R > 160, got ${palette.dominant.r}`);
    assert.ok(palette.dominant.r > palette.dominant.g * 1.5, 'Expected R > G * 1.5');
    assert.ok(palette.dominant.r > palette.dominant.b * 1.5, 'Expected R > B * 1.5');
    assert.ok(palette.dominantCss.startsWith('rgb(') || palette.dominantCss.startsWith('#'));
  });

  it('extracts blue-dominant palette from cobalt/sapphire artwork', () => {
    const pixels = createSolidRgbaBuffer(48, 48, 20, 80, 230);
    const palette = extractPaletteFromRgbaPixels(pixels, 48, 48, 'track-blue');

    assert.equal(palette.trackKey, 'track-blue');
    assert.equal(palette.isMonochrome, false);
    assert.ok(palette.dominant.b > 160, `Expected dominant B > 160, got ${palette.dominant.b}`);
    assert.ok(palette.dominant.b > palette.dominant.r * 1.5, 'Expected B > R * 1.5');
    assert.ok(palette.dominant.b > palette.dominant.g * 1.2, 'Expected B > G * 1.2');
  });

  it('extracts pink/magenta dominant palette from vibrant magenta artwork', () => {
    const pixels = createSolidRgbaBuffer(48, 48, 230, 30, 180);
    const palette = extractPaletteFromRgbaPixels(pixels, 48, 48, 'track-pink');

    assert.equal(palette.trackKey, 'track-pink');
    assert.equal(palette.isMonochrome, false);
    assert.ok(palette.dominant.r > 150 && palette.dominant.b > 120);
    assert.ok(palette.dominant.g < 80);
  });

  it('extracts amber/gold dominant palette from warm orange artwork', () => {
    const pixels = createSolidRgbaBuffer(48, 48, 240, 140, 10);
    const palette = extractPaletteFromRgbaPixels(pixels, 48, 48, 'track-amber');

    assert.equal(palette.trackKey, 'track-amber');
    assert.equal(palette.isMonochrome, false);
    assert.ok(palette.dominant.r > 180);
    assert.ok(palette.dominant.g > 100);
    assert.ok(palette.dominant.b < 50);
  });

  it('detects monochrome grayscale artwork and applies silver/graphite palette', () => {
    // Pure neutral gray artwork: R=120, G=120, B=120
    const pixels = createSolidRgbaBuffer(48, 48, 120, 120, 120);
    const palette = extractPaletteFromRgbaPixels(pixels, 48, 48, 'track-mono');

    assert.equal(palette.trackKey, 'track-mono');
    assert.equal(palette.isMonochrome, true);
    // Dominant should be balanced silver/graphite
    assert.ok(Math.abs(palette.dominant.r - palette.dominant.g) <= 10);
    assert.ok(Math.abs(palette.dominant.g - palette.dominant.b) <= 10);
  });

  it('extracts distinct secondary and energetic accent from two-tone artwork', () => {
    // 70% deep navy blue [20, 40, 160], 30% bright electric yellow [250, 220, 30]
    const pixels = createTwoToneRgbaBuffer(48, 48, [20, 40, 160], [250, 220, 30], 0.7);
    const palette = extractPaletteFromRgbaPixels(pixels, 48, 48, 'track-two-tone');

    assert.equal(palette.trackKey, 'track-two-tone');
    assert.equal(palette.isMonochrome, false);

    // One should be the dark navy and the other the bright yellow
    const hasNavy = [palette.dominant, palette.secondary, palette.accent].some(
      (c) => c.b > 100 && c.r < 100,
    );
    const hasYellow = [palette.dominant, palette.secondary, palette.accent].some(
      (c) => c.r > 150 && c.g > 150 && c.b < 80,
    );

    assert.ok(hasNavy, 'Expected palette to include navy tone');
    assert.ok(hasYellow, 'Expected palette to include yellow tone');

    // Background should be deep obsidian (low luminance)
    assert.ok(palette.background.r < 30);
    assert.ok(palette.background.g < 30);
    assert.ok(palette.background.b < 40);

    // Foreground should be crisp and high-contrast
    assert.ok(palette.foreground.r > 200 && palette.foreground.g > 200 && palette.foreground.b > 200);
  });

  it('handles empty or transparent buffer by falling back to DEFAULT_NEUTRAL_PALETTE', () => {
    const emptyPixels = new Uint8ClampedArray(48 * 48 * 4); // all 0 (transparent black)
    const palette = extractPaletteFromRgbaPixels(emptyPixels, 48, 48, 'track-empty');

    assert.equal(palette.trackKey, 'track-empty');
    assert.equal(palette.dominant.r, DEFAULT_NEUTRAL_PALETTE.dominant.r);
    assert.equal(palette.dominant.g, DEFAULT_NEUTRAL_PALETTE.dominant.g);
    assert.equal(palette.dominant.b, DEFAULT_NEUTRAL_PALETTE.dominant.b);
  });

  it('caches extracted palettes by track key and supports clearPaletteCache', () => {
    clearPaletteCache();
    assert.equal(getCachedPalette('test-key'), undefined);

    const testPalette: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'test-key',
      dominant: { r: 11, g: 22, b: 33 },
    };
    setCachedPalette('test-key', testPalette);

    const cached = getCachedPalette('test-key');
    assert.ok(cached);
    assert.equal(cached.dominant.r, 11);
    assert.equal(cached.dominant.g, 22);
    assert.equal(cached.dominant.b, 33);

    clearPaletteCache();
    assert.equal(getCachedPalette('test-key'), undefined);
  });
});

describe('colorTransition — Palette Interpolation Engine', () => {
  it('lerpRgb correctly calculates midpoints and clamps to 0..255', () => {
    const c1: RgbColor = { r: 100, g: 0, b: 200 };
    const c2: RgbColor = { r: 200, g: 100, b: 0 };

    const mid = lerpRgb(c1, c2, 0.5);
    assert.equal(mid.r, 150);
    assert.equal(mid.g, 50);
    assert.equal(mid.b, 100);

    // Bounds checking
    const clampedLower = lerpRgb(c1, c2, -0.5);
    assert.equal(clampedLower.r, 100);
    const clampedUpper = lerpRgb(c1, c2, 1.5);
    assert.equal(clampedUpper.r, 200);
  });

  it('transitions smoothly from palette A to palette B over duration without flashes', () => {
    const palA: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'song-A',
      dominant: { r: 255, g: 0, b: 0 },
      dominantCss: 'rgb(255, 0, 0)',
    };
    const palB: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'song-B',
      dominant: { r: 0, g: 0, b: 255 },
      dominantCss: 'rgb(0, 0, 255)',
    };

    const manager = new PaletteTransitionManager(palA, 600);

    // Initial state is palA
    const initial = manager.getCurrentPalette();
    assert.equal(initial.dominant.r, 255);
    assert.equal(initial.dominant.b, 0);

    // Trigger transition to palB
    const startTime = 1000;
    manager.setTarget(palB, startTime);

    // Midway at 300ms (50% progress)
    const mid = manager.getPalette(startTime + 300);
    // Ease-out curve at 0.5 has advanced more than 50%
    assert.ok(mid.dominant.r < 150, `Expected R < 150, got ${mid.dominant.r}`);
    assert.ok(mid.dominant.b > 100, `Expected B > 100, got ${mid.dominant.b}`);
    assert.equal(manager.isTransitioning(startTime + 300), true);

    // Finish transition at 700ms (100% progress)
    const final = manager.getPalette(startTime + 700);
    assert.equal(final.dominant.r, 0);
    assert.equal(final.dominant.b, 255);
    assert.equal(manager.isTransitioning(startTime + 700), false);
  });

  it('seamlessly chains rapid track skips by anchoring from current in-flight color', () => {
    const palA: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'song-A',
      dominant: { r: 200, g: 0, b: 0 },
    };
    const palB: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'song-B',
      dominant: { r: 0, g: 200, b: 0 },
    };
    const palC: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'song-C',
      dominant: { r: 0, g: 0, b: 200 },
    };

    const manager = new PaletteTransitionManager(palA, 600);
    manager.setTarget(palB, 1000);

    // Advance 200ms into A -> B transition
    const midStep = manager.getPalette(1200);
    const midR = midStep.dominant.r;
    const midG = midStep.dominant.g;

    // Immediately skip to C at 1200ms
    manager.setTarget(palC, 1200);

    // First frame of new transition starts smoothly from midStep without sudden jump
    const nextStep = manager.getPalette(1205);
    assert.ok(Math.abs(nextStep.dominant.r - midR) < 15, 'Transition should start near in-flight color');
    assert.ok(Math.abs(nextStep.dominant.g - midG) < 15, 'Transition should start near in-flight color');
  });
});

describe('audioMath with Dynamic Album Artwork Palette', () => {
  it('weights reactive color toward dominant red under heavy bass for red album', () => {
    const redPalette: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'crimson',
      dominant: { r: 240, g: 20, b: 30 },
      secondary: { r: 180, g: 30, b: 50 },
      accent: { r: 255, g: 100, b: 120 },
    };

    const color = getReactiveGlowColor(0.9, 0.1, 0.1, 1.0, redPalette, false);
    assert.ok(color.r > 200, `Expected R > 200, got ${color.r}`);
    assert.ok(color.r > color.g * 3, 'Red should dominate over green');
    assert.ok(color.r > color.b * 3, 'Red should dominate over blue');
  });

  it('weights reactive color toward dominant blue under heavy bass for blue album', () => {
    const bluePalette: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      trackKey: 'sapphire',
      dominant: { r: 20, g: 50, b: 240 },
      secondary: { r: 40, g: 80, b: 200 },
      accent: { r: 80, g: 180, b: 255 },
    };

    const color = getReactiveGlowColor(0.9, 0.1, 0.1, 1.0, bluePalette, false);
    assert.ok(color.b > 180, `Expected B > 180, got ${color.b}`);
    assert.ok(color.b > color.r * 2.5, 'Blue should dominate over red');
  });

  it('boosts luminance when beat is detected', () => {
    const palette: AlbumPalette = {
      ...DEFAULT_NEUTRAL_PALETTE,
      dominant: { r: 150, g: 100, b: 50 },
      secondary: { r: 120, g: 80, b: 40 },
      accent: { r: 200, g: 150, b: 80 },
    };

    const calmColor = getReactiveGlowColor(0.5, 0.5, 0.5, 1.0, palette, false);
    const beatColor = getReactiveGlowColor(0.5, 0.5, 0.5, 1.0, palette, true);

    assert.ok(beatColor.r > calmColor.r, 'Beat should increase R');
    assert.ok(beatColor.g > calmColor.g, 'Beat should increase G');
    assert.ok(beatColor.b > calmColor.b, 'Beat should increase B');
  });

  it('renders neutral monochrome palette cleanly when monochrome theme is active', () => {
    const color = getReactiveGlowColor(0.6, 0.6, 0.6, 1.0, MONOCHROME_PALETTE, false);
    // In monochrome, R, G, B should remain very close
    assert.ok(Math.abs(color.r - color.g) <= 12, 'Monochrome R and G should be near equal');
    assert.ok(Math.abs(color.g - color.b) <= 12, 'Monochrome G and B should be near equal');
  });
});
