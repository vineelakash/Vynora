/**
 * Common typography and styling helpers for kinetic styles.
 * Ensures consistent Unicode rendering across English, Telugu, and Hindi,
 * with dynamic responsive font sizing for fullscreen displays.
 */

import type { FontFamilyChoice, FontWeightChoice } from '../animationTypes.ts';

export function getFontStack(family: FontFamilyChoice): string {
  switch (family) {
    case 'serif':
      return '"Georgia", "Cambria", "Times New Roman", "Nirmala UI", serif';
    case 'mono':
      return 'ui-monospace, "Cascadia Code", "Consolas", "Courier New", "Nirmala UI", monospace';
    case 'display':
      return '"Arial Black", "Trebuchet MS", -apple-system, BlinkMacSystemFont, "Segoe UI", "Nirmala UI", sans-serif';
    case 'sans':
    default:
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Nirmala UI", "Gautami", "Mangal", sans-serif';
  }
}

export function getFontWeight(weight: FontWeightChoice): number {
  switch (weight) {
    case 'normal':
      return 400;
    case 'medium':
      return 500;
    case 'semibold':
      return 600;
    case 'bold':
    default:
      return 700;
  }
}

export function buildFont(
  weight: FontWeightChoice | number,
  sizePx: number,
  family: FontFamilyChoice,
): string {
  const w = typeof weight === 'number' ? weight : getFontWeight(weight);
  const stack = getFontStack(family);
  return `${w} ${Math.round(sizePx)}px ${stack}`;
}

export function getBaseFontSize(size: 'small' | 'medium' | 'large' | 'xl', baseMultiplier = 1): number {
  switch (size) {
    case 'small':
      return Math.round(24 * baseMultiplier);
    case 'large':
      return Math.round(44 * baseMultiplier);
    case 'xl':
      return Math.round(56 * baseMultiplier);
    case 'medium':
    default:
      return Math.round(34 * baseMultiplier);
  }
}

export function getResponsiveFontSize(
  size: 'small' | 'medium' | 'large' | 'xl',
  viewportWidth: number,
  viewportHeight: number,
  baseMultiplier = 1,
): number {
  // If viewport is large (fullscreen desktop / TV / monitor, e.g. width >= 850 or height >= 550)
  // Scale dynamically based on viewport dimensions so lyrics are comfortably readable from distance
  const isLargeViewport = viewportWidth >= 850 || viewportHeight >= 550;
  if (isLargeViewport) {
    const scaleFactor = Math.min(viewportWidth / 1280, viewportHeight / 800);
    const clampedScale = Math.max(0.9, Math.min(2.2, scaleFactor));
    switch (size) {
      case 'small':
        return Math.round(32 * clampedScale * baseMultiplier);
      case 'large':
        return Math.round(58 * clampedScale * baseMultiplier);
      case 'xl':
        return Math.round(74 * clampedScale * baseMultiplier);
      case 'medium':
      default:
        return Math.round(44 * clampedScale * baseMultiplier);
    }
  }

  // Small embedded preview fallback
  return getBaseFontSize(size, baseMultiplier);
}
