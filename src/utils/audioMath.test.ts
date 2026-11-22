import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  lerp,
  getReactiveGlowColor,
  drawSpectrumBars,
  drawWaveform,
  drawCircularPulse,
  drawAmbientGlow,
} from './audioMath.ts';

describe('audioMath utils', () => {
  it('clamps values correctly within bounds', () => {
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
    assert.equal(clamp(5, 0, 10), 5);
  });

  it('lerps correctly between endpoints', () => {
    assert.equal(lerp(10, 20, 0), 10);
    assert.equal(lerp(10, 20, 0.5), 15);
    assert.equal(lerp(10, 20, 1), 20);
  });

  it('generates rich reactive glow colors matching Spotify aesthetic', () => {
    const color = getReactiveGlowColor(0.8, 0.2, 0.1, 1.0);
    assert.ok(color.r >= 0 && color.r <= 255);
    assert.ok(color.g >= 0 && color.g <= 255);
    assert.ok(color.b >= 0 && color.b <= 255);
    assert.ok(color.a > 0);
    assert.ok(color.cssRgba.includes('rgba('));
    assert.ok(color.cssBoxShadow.includes('px rgba('));
    // High bass should favor emerald/greenish tones
    assert.ok(color.g > color.r);
  });

  it('handles zero energy safely without NaN or division by zero', () => {
    const color = getReactiveGlowColor(0, 0, 0, 1.0);
    assert.equal(Number.isNaN(color.r), false);
    assert.equal(Number.isNaN(color.g), false);
    assert.equal(Number.isNaN(color.b), false);
    assert.equal(Number.isNaN(color.a), false);
  });

  it('draws to canvas context without throwing', () => {
    const dummyCtx = {
      clearRect: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      beginPath: () => {},
      roundRect: () => {},
      fill: () => {},
      fillRect: () => {},
      stroke: () => {},
      moveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
    } as unknown as CanvasRenderingContext2D;

    assert.doesNotThrow(() => {
      drawSpectrumBars(dummyCtx, 300, 100, [0.1, 0.5, 0.8, 0.3]);
    });

    assert.doesNotThrow(() => {
      drawWaveform(dummyCtx, 300, 100, [0, 0.5, -0.5, 0]);
    });

    assert.doesNotThrow(() => {
      drawCircularPulse(dummyCtx, 200, 200, 0.8, 0.3, 0.2, true, 1.0);
    });

    assert.doesNotThrow(() => {
      drawAmbientGlow(dummyCtx, 200, 200, 0.7, 0.4, 1.0);
    });
  });
});
