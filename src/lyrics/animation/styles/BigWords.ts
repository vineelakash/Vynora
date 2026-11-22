/**
 * Style 1: Big Words — Cinematic Focal Typography.
 *
 * One important word occupies the visual center with large scale.
 * Preceding and succeeding words appear smaller around it for context.
 * Smooth scale (0.65 -> 1.0) and opacity transitions with blur-to-sharp settling.
 * Dynamic font sizing to prevent long word clipping.
 * Supports reduced-motion and line-only fallback.
 */

import type { LineTimingContext, RenderContext } from '../animationTypes.ts';
import { easeOutCubic, easeOutQuad, clamp } from '../easing.ts';
import { buildFont, getResponsiveFontSize } from './styleHelpers.ts';

export class BigWordsStyle {
  public draw(
    ctx: CanvasRenderingContext2D,
    context: LineTimingContext,
    renderCtx: RenderContext,
  ): void {
    const { width, height, palette, audioFrame, settings } = renderCtx;
    const { words, activeWordIndex, activeWordProgress, mode, lineText } = context;

    const cx = width / 2;
    const cy = height / 2;

    // If in line-only mode or no words resolved
    if (mode === 'line-only' || !words.length || activeWordIndex < 0) {
      ctx.save();
      ctx.textAlign = settings.textAlign;
      ctx.textBaseline = 'middle';
      const textX = settings.textAlign === 'center' ? cx : settings.textAlign === 'left' ? width * 0.15 : width * 0.85;

      const fontSize = getResponsiveFontSize(settings.fontSize, width, height, 0.9);
      ctx.font = buildFont(settings.fontWeight, fontSize, settings.fontFamily);

      if (settings.glowEnabled && settings.glowIntensity > 0) {
        ctx.shadowColor = palette.accentCss;
        ctx.shadowBlur = Math.round(10 * settings.glowIntensity);
      }
      ctx.fillStyle = palette.accentCss;
      ctx.fillText(lineText || '♪ · ♪', textX, cy);

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.95;
      ctx.fillText(lineText || '♪ · ♪', textX, cy);
      ctx.restore();
      return;
    }

    const activeWord = words[activeWordIndex]!;
    const prevWord = activeWordIndex > 0 ? words[activeWordIndex - 1] : null;
    const nextWord = activeWordIndex + 1 < words.length ? words[activeWordIndex + 1] : null;

    // Font size scaling based on studio settings, responsive viewport dimensions, and word length
    let baseFontSize = getResponsiveFontSize(settings.fontSize, width, height, 1.15);
    const wordCharLength = Array.from(activeWord.text).length;
    if (wordCharLength > 9) {
      baseFontSize = Math.round(baseFontSize * Math.max(0.6, 1 - (wordCharLength - 9) * 0.04));
    }

    const bass = (settings.audioReactive && audioFrame) ? audioFrame.bass : 0;
    const beat = (settings.audioReactive && audioFrame) ? audioFrame.beat : false;
    const audioScale = (bass * 0.05 + (beat ? 0.04 : 0)) * settings.intensity;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Draw Previous Word (Floating above, shrinking, fading out)
    if (prevWord) {
      ctx.save();
      const prevScale = settings.reducedMotion ? 0.55 : (1.0 - activeWordProgress * 0.18) * 0.55;
      const prevAlpha = settings.reducedMotion ? 0.25 : (1.0 - activeWordProgress * 0.75) * 0.35;
      const prevY = cy - baseFontSize * 1.15 - (settings.reducedMotion ? 0 : activeWordProgress * 12);

      ctx.font = buildFont('medium', Math.round(baseFontSize * prevScale), settings.fontFamily);
      ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, ${clamp(prevAlpha)})`;
      ctx.fillText(prevWord.text, cx, prevY);
      ctx.restore();
    }

    // 2. Draw Active Word (Cinematic Focal Center)
    ctx.save();
    const enterProgress = settings.reducedMotion ? 1 : easeOutCubic(activeWordProgress);
    const enterScale = settings.reducedMotion
      ? 1.0 + (settings.audioReactive ? audioScale * 0.5 : 0)
      : (0.7 + enterProgress * 0.3) * (1 + audioScale);
    const enterAlpha = easeOutQuad(Math.min(1, activeWordProgress * 3.0));

    // Dynamic tilt (disabled in reduced-motion)
    const tiltDeg = settings.reducedMotion ? 0 : ((activeWordIndex % 5) - 2) * 1.0 * (1 - activeWordProgress);

    ctx.translate(cx, cy);
    if (tiltDeg !== 0) {
      ctx.rotate((tiltDeg * Math.PI) / 180);
    }
    ctx.scale(enterScale, enterScale);

    ctx.font = buildFont(settings.fontWeight, baseFontSize, settings.fontFamily);

    // Glow halo if enabled
    if (settings.glowEnabled && settings.glowIntensity > 0) {
      ctx.shadowColor = palette.accentCss;
      ctx.shadowBlur = Math.round((14 * settings.glowIntensity) + (beat ? 8 : 0));
    }

    // Active word text in dominant / accent tone
    ctx.fillStyle = palette.accentCss;
    ctx.globalAlpha = enterAlpha;
    ctx.fillText(activeWord.text, 0, 0);

    // Overlay crisp white core for readability
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = enterAlpha * 0.92;
    ctx.fillText(activeWord.text, 0, 0);

    ctx.restore();

    // 3. Draw Upcoming Word (Floating below, soft preview)
    if (nextWord) {
      ctx.save();
      const nextScale = 0.5;
      const nextAlpha = settings.reducedMotion ? 0.3 : 0.25 + activeWordProgress * 0.2;
      const nextY = cy + baseFontSize * 1.15 + (settings.reducedMotion ? 0 : (1 - activeWordProgress) * 8);

      ctx.font = buildFont('medium', Math.round(baseFontSize * nextScale), settings.fontFamily);
      ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, ${clamp(nextAlpha)})`;
      ctx.fillText(nextWord.text, cx, nextY);
      ctx.restore();
    }

    ctx.restore();
  }
}
