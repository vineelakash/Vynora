/**
 * Style 6: Karaoke — Progressive Sub-Word Sweep Fill with Rhythmic Bounce.
 *
 * Classic singing companion visualization:
 * - Unsung lyrics rendered in muted contrast.
 * - Sung lyrics dynamically filled with luminous accent color.
 * - Sub-word progressive sweep fill matching active word progress.
 * - Rhythmic vertical bounce and subtle beat reactivity.
 * - Graceful fallback to line-level sweep when word timing is low-confidence or line-only.
 */

import type { LineTimingContext, RenderContext } from '../animationTypes.ts';
import { clamp } from '../easing.ts';
import { buildFont, getResponsiveFontSize } from './styleHelpers.ts';

export class KaraokeStyle {
  public draw(
    ctx: CanvasRenderingContext2D,
    context: LineTimingContext,
    renderCtx: RenderContext,
  ): void {
    const { width, height, palette, audioFrame, settings } = renderCtx;
    const { words, activeWordIndex, activeWordProgress, lineProgress, lineText, mode } = context;

    const cx = width / 2;
    const cy = height / 2;

    const bass = (settings.audioReactive && audioFrame) ? audioFrame.bass : 0;
    const beat = (settings.audioReactive && audioFrame) ? audioFrame.beat : false;
    const bounceOffset = settings.reducedMotion ? 0 : (beat ? -4 : 0);

    const baseFontSize = getResponsiveFontSize(settings.fontSize, width, height, 0.95);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Line-Only Fallback (Uniform horizontal line sweep)
    if (mode === 'line-only' || !words.length || activeWordIndex < 0) {
      const textToDraw = lineText || '♪ · ♪';
      ctx.font = buildFont(settings.fontWeight, baseFontSize, settings.fontFamily);

      // Measure total text width
      const textMetrics = ctx.measureText(textToDraw);
      const textWidth = textMetrics.width;
      const startX = cx - textWidth / 2;

      // Base un-sung text
      ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.35)`;
      ctx.fillText(textToDraw, cx, cy);

      // Sung portion with clipping rectangle
      const sweepWidth = textWidth * clamp(lineProgress);
      if (sweepWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX, cy - baseFontSize, sweepWidth, baseFontSize * 2);
        ctx.clip();

        if (settings.glowEnabled && settings.glowIntensity > 0) {
          ctx.shadowColor = palette.accentCss;
          ctx.shadowBlur = Math.round(14 * settings.glowIntensity);
        }
        ctx.fillStyle = palette.accentCss;
        ctx.fillText(textToDraw, cx, cy);

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.95;
        ctx.fillText(textToDraw, cx, cy);
        ctx.restore();
      }

      ctx.restore();
      return;
    }

    // 2. High/Medium Confidence Word-Level Sweep
    ctx.font = buildFont(settings.fontWeight, baseFontSize, settings.fontFamily);
    const spaceWidth = ctx.measureText(' ').width + (settings.letterSpacing || 0);

    // Measure words
    const metrics: { text: string; width: number; space: number }[] = [];
    let totalLineWidth = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const tw = ctx.measureText(w.text).width + (settings.letterSpacing || 0);
      const sw = i > 0 ? spaceWidth : 0;
      metrics.push({ text: w.text, width: tw, space: sw });
      totalLineWidth += tw + sw;
    }

    // Scale down if line exceeds canvas width
    let scaleDown = 1.0;
    if (totalLineWidth > width * 0.88) {
      scaleDown = (width * 0.88) / totalLineWidth;
      ctx.font = buildFont(settings.fontWeight, Math.round(baseFontSize * scaleDown), settings.fontFamily);
    }

    let currentX = cx - (totalLineWidth * scaleDown) / 2;

    for (let i = 0; i < words.length; i++) {
      const item = metrics[i]!;
      const itemWidth = item.width * scaleDown;
      const itemSpace = item.space * scaleDown;
      currentX += itemSpace;

      const isPast = i < activeWordIndex;
      const isActive = i === activeWordIndex;
      const wordCenterX = currentX + itemWidth / 2;

      ctx.save();

      if (isActive) {
        // Active word: vertical bounce and sub-word sweep
        const yOffset = settings.reducedMotion ? 0 : bounceOffset - Math.sin(activeWordProgress * Math.PI) * 4;
        const activeY = cy + yOffset;
        const activeScale = settings.reducedMotion ? 1.0 : (1.05 + bass * 0.03);

        ctx.translate(wordCenterX, activeY);
        ctx.scale(activeScale, activeScale);

        // 1. Unsung base
        ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.35)`;
        ctx.fillText(item.text, 0, 0);

        // 2. Sub-word progressive sweep fill
        const wordSweepWidth = itemWidth * clamp(activeWordProgress);
        if (wordSweepWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(-itemWidth / 2, -baseFontSize, wordSweepWidth, baseFontSize * 2);
          ctx.clip();

          if (settings.glowEnabled && settings.glowIntensity > 0) {
            ctx.shadowColor = palette.accentCss;
            ctx.shadowBlur = Math.round(14 * settings.glowIntensity);
          }
          ctx.fillStyle = palette.accentCss;
          ctx.fillText(item.text, 0, 0);

          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.95;
          ctx.fillText(item.text, 0, 0);
          ctx.restore();
        }
      } else if (isPast) {
        // Fully sung word
        ctx.fillStyle = palette.accentCss;
        ctx.fillText(item.text, wordCenterX, cy);

        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.9;
        ctx.fillText(item.text, wordCenterX, cy);
      } else {
        // Upcoming unsung word
        ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.35)`;
        ctx.fillText(item.text, wordCenterX, cy);
      }

      ctx.restore();
      currentX += itemWidth;
    }

    ctx.restore();
  }
}
