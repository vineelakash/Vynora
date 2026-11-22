/**
 * Audio math, interpolation, and dynamic album artwork canvas visualizer rendering utilities for Beat Glow.
 */

import {
  type AlbumPalette,
  DEFAULT_NEUTRAL_PALETTE,
} from "../types/palette.ts";

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export interface ReactiveColor {
  r: number;
  g: number;
  b: number;
  a: number;
  cssRgba: string;
  cssBoxShadow: string;
}

/**
 * Derives a dynamic reactive glow color based on the current album artwork palette,
 * frequency band energy (Bass, Mid, Treble), beat triggers, and user intensity.
 */
export function getReactiveGlowColor(
  bass: number,
  mid: number,
  treble: number,
  intensity: number = 1.0,
  palette: AlbumPalette = DEFAULT_NEUTRAL_PALETTE,
  beat: boolean = false,
): ReactiveColor {
  const safeBass = clamp(bass, 0, 1);
  const safeMid = clamp(mid, 0, 1);
  const safeTreble = clamp(treble, 0, 1);
  const safeIntensity = clamp(intensity, 0.1, 2.5);

  const dom = palette.dominant;
  const sec = palette.secondary;
  const acc = palette.accent;

  // Weight dominant heavily by bass, secondary by mid, accent by treble
  const total = safeBass * 1.2 + safeMid * 0.8 + safeTreble * 0.7 + 0.001;
  const wB = (safeBass * 1.2) / total;
  const wM = (safeMid * 0.8) / total;
  const wT = (safeTreble * 0.7) / total;

  let r = Math.round(dom.r * wB + sec.r * wM + acc.r * wT);
  let g = Math.round(dom.g * wB + sec.g * wM + acc.g * wT);
  let b = Math.round(dom.b * wB + sec.b * wM + acc.b * wT);

  // On rhythm onsets/beats, briefly boost luminance
  if (beat) {
    r = Math.min(255, Math.round(r * 1.2 + 20));
    g = Math.min(255, Math.round(g * 1.2 + 20));
    b = Math.min(255, Math.round(b * 1.2 + 20));
  }

  // Overall energy drives alpha and glow halo
  const energy = clamp(
    (safeBass * 0.55 + safeMid * 0.3 + safeTreble * 0.15) * safeIntensity,
    0,
    1,
  );
  const alpha = Math.min(0.9, 0.18 + energy * 0.72 + (beat ? 0.12 : 0));

  const blurRadius = Math.round(8 + energy * 26 + (beat ? 8 : 0));
  const spreadRadius = Math.round(1 + energy * 6 + (beat ? 2 : 0));

  const cssRgba = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  const cssBoxShadow = `0 0 ${blurRadius}px ${spreadRadius}px rgba(${r}, ${g}, ${b}, ${(alpha * 0.55).toFixed(3)})`;

  return { r, g, b, a: alpha, cssRgba, cssBoxShadow };
}

/**
 * Draws vertical spectrum bars styled dynamically with album artwork gradient.
 */
export function drawSpectrumBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spectrum: number[],
  intensity: number = 1.0,
  palette: AlbumPalette = DEFAULT_NEUTRAL_PALETTE,
  beat: boolean = false,
): void {
  ctx.clearRect(0, 0, width, height);

  if (!spectrum || spectrum.length === 0) return;

  const barCount = Math.min(spectrum.length, 48);
  const totalPadding = 2 * (barCount - 1);
  const barWidth = Math.max(2, (width - totalPadding) / barCount);
  const bottomPadding = 4;
  const maxHeight = height - bottomPadding - 6;

  const dom = palette.dominant;
  const sec = palette.secondary;
  const acc = palette.accent;

  for (let i = 0; i < barCount; i++) {
    const rawVal = spectrum[i] || 0;
    const scaledVal = clamp(rawVal * intensity, 0, 1);
    const barHeight = Math.max(3, scaledVal * maxHeight);

    const x = i * (barWidth + 2);
    const y = height - bottomPadding - barHeight;

    // Linear gradient derived from album artwork: dominant base -> secondary mid -> accent tip
    const grad = ctx.createLinearGradient(x, height - bottomPadding, x, y);
    grad.addColorStop(0, `rgba(${dom.r}, ${dom.g}, ${dom.b}, 0.8)`);
    grad.addColorStop(0.55, `rgba(${sec.r}, ${sec.g}, ${sec.b}, 0.88)`);
    grad.addColorStop(1, `rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.96)`);

    ctx.fillStyle = grad;
    // Rounded top pill
    const radius = Math.min(barWidth / 2, 2.5);
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
    ctx.fill();

    // Floating cap on energy peaks
    if (scaledVal > 0.12) {
      const capY = Math.max(2, y - 3);
      ctx.fillStyle = beat
        ? 'rgba(255, 255, 255, 0.95)'
        : `rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.85)`;
      ctx.fillRect(x, capY, barWidth, 1.5);
    }
  }
}

/**
 * Draws an oscillogram smooth waveform on an HTML canvas styled with album artwork palette.
 */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  waveform: number[],
  intensity: number = 1.0,
  palette: AlbumPalette = DEFAULT_NEUTRAL_PALETTE,
  beat: boolean = false,
): void {
  ctx.clearRect(0, 0, width, height);

  if (!waveform || waveform.length === 0) return;

  const centerY = height / 2;
  const maxAmp = (height / 2) * 0.85;

  const dom = palette.dominant;
  const sec = palette.secondary;
  const acc = palette.accent;

  ctx.lineWidth = beat ? 2.5 : 2.0;
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, `rgba(${dom.r}, ${dom.g}, ${dom.b}, 0.7)`);
  grad.addColorStop(0.5, `rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.98)`);
  grad.addColorStop(1, `rgba(${sec.r}, ${sec.g}, ${sec.b}, 0.7)`);
  ctx.strokeStyle = grad;

  ctx.beginPath();
  const step = width / (waveform.length - 1);

  for (let i = 0; i < waveform.length; i++) {
    const rawVal = waveform[i] || 0;
    const scaledVal = clamp(rawVal * intensity, -1, 1);
    const x = i * step;
    const y = centerY - scaledVal * maxAmp;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prevX = (i - 1) * step;
      const prevY = centerY - clamp(waveform[i - 1] * intensity, -1, 1) * maxAmp;
      const cpX = (prevX + x) / 2;
      const cpY = (prevY + y) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
    }
  }

  ctx.stroke();

  // Subtle dynamic glow blur pass
  ctx.shadowColor = `rgba(${acc.r}, ${acc.g}, ${acc.b}, ${beat ? 0.8 : 0.5})`;
  ctx.shadowBlur = beat ? 12 : 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/**
 * Draws a circular pulse with radial energy nodes styled with album artwork palette.
 */
export function drawCircularPulse(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bass: number,
  mid: number,
  treble: number,
  beat: boolean,
  intensity: number = 1.0,
  palette: AlbumPalette = DEFAULT_NEUTRAL_PALETTE,
): void {
  ctx.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(centerX, centerY) * 0.45;

  const bassBoost = clamp(bass * intensity, 0, 1) * 20;
  const radius = baseRadius + bassBoost;

  const color = getReactiveGlowColor(bass, mid, treble, intensity, palette, beat);

  // Background radial pulse
  const radialGrad = ctx.createRadialGradient(
    centerX,
    centerY,
    radius * 0.3,
    centerX,
    centerY,
    radius * 1.5,
  );
  radialGrad.addColorStop(
    0,
    `rgba(${color.r}, ${color.g}, ${color.b}, ${beat ? 0.38 : 0.16})`,
  );
  radialGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = radialGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Core ring
  ctx.lineWidth = beat ? 3.0 : 1.8;
  ctx.strokeStyle = color.cssRgba;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Orbiting energy nodes
  const acc = palette.accent;
  const nodeCount = 12;
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2 + Date.now() * 0.001;
    const nodeDist = radius + Math.sin(angle * 3 + bass * 5) * 6;
    const nx = centerX + Math.cos(angle) * nodeDist;
    const ny = centerY + Math.sin(angle) * nodeDist;
    const nodeR = 1.5 + treble * intensity * 3;

    ctx.fillStyle = beat
      ? 'rgba(255, 255, 255, 0.95)'
      : `rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.9)`;
    ctx.beginPath();
    ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draws soft ambient glow breathing with album artwork dominant tones.
 */
export function drawAmbientGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bass: number,
  mid: number,
  intensity: number = 1.0,
  palette: AlbumPalette = DEFAULT_NEUTRAL_PALETTE,
  beat: boolean = false,
): void {
  ctx.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const maxR = Math.max(width, height) * 0.65;

  const energy = clamp((bass * 0.7 + mid * 0.3) * intensity, 0, 1);
  const color = getReactiveGlowColor(bass, mid, 0.2, intensity, palette, beat);

  const grad = ctx.createRadialGradient(
    centerX,
    centerY,
    maxR * 0.05,
    centerX,
    centerY,
    maxR * (0.5 + energy * 0.5),
  );
  grad.addColorStop(
    0,
    `rgba(${color.r}, ${color.g}, ${color.b}, ${(0.22 + energy * 0.45).toFixed(3)})`,
  );
  grad.addColorStop(
    0.5,
    `rgba(${color.r}, ${color.g}, ${color.b}, ${(0.08 + energy * 0.2).toFixed(3)})`,
  );
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}
