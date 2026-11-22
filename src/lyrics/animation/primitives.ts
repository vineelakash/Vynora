/**
 * Reusable kinetic typography animation primitives.
 */

import { clamp, easeOutCubic, easeOutQuad, lerp } from './easing.ts';

export interface TransformState {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationRad: number;
  opacity: number;
  blurPx: number;
}

export function defaultTransformState(): TransformState {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotationRad: 0,
    opacity: 1,
    blurPx: 0,
  };
}

/**
 * Applies directional slide translation.
 */
export function applySlide(
  state: TransformState,
  progress: number,
  distanceX: number,
  distanceY: number,
): void {
  const eased = easeOutCubic(progress);
  state.x += distanceX * (1 - eased);
  state.y += distanceY * (1 - eased);
}

/**
 * Applies zoom/scale transition.
 */
export function applyScale(
  state: TransformState,
  progress: number,
  fromScale: number,
  toScale: number,
): void {
  const eased = easeOutQuad(progress);
  const s = lerp(fromScale, toScale, eased);
  state.scaleX *= s;
  state.scaleY *= s;
}

/**
 * Applies opacity fade.
 */
export function applyFade(
  state: TransformState,
  progress: number,
  fromOpacity: number,
  toOpacity: number,
): void {
  const eased = easeOutQuad(progress);
  state.opacity *= lerp(fromOpacity, toOpacity, eased);
}

/**
 * Applies subtle organic harmonic floating.
 */
export function applyFloat(
  state: TransformState,
  timeSec: number,
  freqX: number,
  ampX: number,
  freqY: number,
  ampY: number,
  seed = 0,
): void {
  state.x += Math.sin(timeSec * freqX + seed) * ampX;
  state.y += Math.cos(timeSec * freqY + seed * 1.5) * ampY;
}

/**
 * Applies controlled rotation in radians.
 */
export function applyRotate(state: TransformState, degrees: number): void {
  state.rotationRad += (degrees * Math.PI) / 180;
}

/**
 * Slices typewriter text with optional blinking block cursor.
 */
export function getTypewriterText(
  fullText: string,
  charProgress: number,
  showCursor = true,
  cursorChar = '█',
): string {
  const safeProgress = clamp(charProgress);
  const totalChars = fullText.length;
  const charsToShow = Math.round(safeProgress * totalChars);
  const visible = fullText.slice(0, charsToShow);
  if (showCursor && safeProgress < 1.0) {
    return visible + cursorChar;
  }
  return visible;
}

/**
 * Adds audio-reactive beat pulse expansion to transform state.
 */
export function applyBeatPulse(
  state: TransformState,
  bass: number,
  beat: boolean,
  intensity = 1.0,
): void {
  const pulse = (bass * 0.08 + (beat ? 0.05 : 0)) * intensity;
  state.scaleX *= 1 + pulse;
  state.scaleY *= 1 + pulse;
}
