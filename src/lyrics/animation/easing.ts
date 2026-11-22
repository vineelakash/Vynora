/**
 * Reusable easing and spring physics functions for kinetic typography.
 */

export function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function easeOutQuad(t: number): number {
  const c = clamp(t);
  return c * (2 - c);
}

export function easeInQuad(t: number): number {
  const c = clamp(t);
  return c * c;
}

export function easeInOutQuad(t: number): number {
  const c = clamp(t);
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
}

export function easeOutCubic(t: number): number {
  const c = clamp(t);
  const inv = c - 1;
  return inv * inv * inv + 1;
}

export function easeInCubic(t: number): number {
  const c = clamp(t);
  return c * c * c;
}

export function easeInOutCubic(t: number): number {
  const c = clamp(t);
  return c < 0.5 ? 4 * c * c * c : (c - 1) * (2 * c - 2) * (2 * c - 2) + 1;
}

export function easeOutExpo(t: number): number {
  const c = clamp(t);
  return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
}

export function easeOutBack(t: number, s = 1.70158): number {
  const c = clamp(t);
  const inv = c - 1;
  return inv * inv * ((s + 1) * inv + s) + 1;
}

/**
 * Spring-like settling calculation.
 * Returns value oscillating around target (1.0) and settling smoothly.
 * @param t Progress 0..1
 * @param damping Damping factor (e.g. 8)
 * @param frequency Oscillation frequency (e.g. 15)
 */
export function springSettling(t: number, damping = 7, frequency = 12): number {
  const c = clamp(t);
  if (c >= 1) return 1;
  const decay = Math.exp(-damping * c);
  const osc = Math.cos(frequency * c);
  return 1 - decay * osc;
}

/**
 * Smoothly interpolates a value towards a target with critically damped spring behavior.
 */
export function smoothDamp(
  current: number,
  target: number,
  currentVelocity: { value: number },
  smoothTime: number,
  deltaTime: number,
  maxSpeed = Infinity,
): number {
  const safeSmoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / safeSmoothTime;
  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const originalTo = target;

  const maxChange = maxSpeed * safeSmoothTime;
  change = clamp(change, -maxChange, maxChange);
  const tempTarget = current - change;

  const temp = (currentVelocity.value + omega * change) * deltaTime;
  currentVelocity.value = (currentVelocity.value - omega * temp) * exp;
  let output = tempTarget + (change + temp) * exp;

  if (originalTo - current > 0.0 === output > originalTo) {
    output = originalTo;
    currentVelocity.value = (output - originalTo) / deltaTime;
  }
  return output;
}
