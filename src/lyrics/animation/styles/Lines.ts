/**
 * Style 2: Lines — Clean, Elegant Vertical 3-Line Progression.
 *
 * Displays a 3-line layout:
 * - Previous line above in muted opacity (0.3).
 * - Active line at center with word-by-word highlight and audio-reactive breathing.
 * - Next line below in muted opacity (0.3).
 */

import type { LineTimingContext, RenderContext } from '../animationTypes.ts';
import { buildFont, getResponsiveFontSize } from './styleHelpers.ts';

export class LinesStyle {
  public draw(
    ctx: CanvasRenderingContext2D,
    context: LineTimingContext,
    renderCtx: RenderContext,
  ): void {
    const { width, height, palette, audioFrame, settings } = renderCtx;
    const { words, activeWordIndex, lineText, prevLineText, nextLineText, mode } = context;

    const cx = width / 2;
    const cy = height / 2;

    const bass = (settings.audioReactive && audioFrame) ? audioFrame.bass : 0;
    const beat = (settings.audioReactive && audioFrame) ? audioFrame.beat : false;
    const audioScale = (bass * 0.03 + (beat ? 0.02 : 0)) * settings.intensity;

    const baseFontSize = getResponsiveFontSize(settings.fontSize, width, height, 0.88);
    const lineSpacing = baseFontSize * (settings.lineSpacing || 1.65);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Previous Line (Above)
    if (prevLineText) {
      ctx.save();
      const prevY = cy - lineSpacing;
      ctx.font = buildFont('medium', Math.round(baseFontSize * 0.76), settings.fontFamily);
      ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.3)`;
      ctx.fillText(prevLineText, cx, prevY);
      ctx.restore();
    }

    // 2. Active Line (Center with Word Progression or Line-Only Mode)
    if (mode === 'line-only' || !words.length || activeWordIndex < 0) {
      ctx.save();
      ctx.font = buildFont(settings.fontWeight, baseFontSize, settings.fontFamily);
      if (settings.glowEnabled && settings.glowIntensity > 0) {
        ctx.shadowColor = palette.accentCss;
        ctx.shadowBlur = Math.round(10 * settings.glowIntensity);
      }
      ctx.fillStyle = palette.accentCss;
      ctx.fillText(lineText || '♪ · ♪', cx, cy);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.92;
      ctx.fillText(lineText || '♪ · ♪', cx, cy);
      ctx.restore();
    } else {
      ctx.save();
      ctx.font = buildFont(settings.fontWeight, baseFontSize, settings.fontFamily);

      // Measure all words to center the line
      const wordMetrics: { word: typeof words[0]; width: number; spaceWidth: number }[] = [];
      const spaceWidth = ctx.measureText(' ').width + (settings.letterSpacing || 0);
      let totalLineWidth = 0;

      for (let i = 0; i < words.length; i++) {
        const w = words[i]!;
        const textWidth = ctx.measureText(w.text).width + (settings.letterSpacing || 0);
        const spacing = i > 0 ? spaceWidth : 0;
        wordMetrics.push({ word: w, width: textWidth, spaceWidth: spacing });
        totalLineWidth += textWidth + spacing;
      }

      // If line is wider than canvas width * 0.88, scale font down dynamically
      let scaleDown = 1.0;
      if (totalLineWidth > width * 0.88) {
        scaleDown = (width * 0.88) / totalLineWidth;
        ctx.font = buildFont(settings.fontWeight, Math.round(baseFontSize * scaleDown), settings.fontFamily);
      }

      let currentX = cx - (totalLineWidth * scaleDown) / 2;

      for (let i = 0; i < words.length; i++) {
        const item = wordMetrics[i]!;
        const isPast = i < activeWordIndex;
        const isActive = i === activeWordIndex;
        const itemWidth = item.width * scaleDown;
        const itemSpace = item.spaceWidth * scaleDown;

        currentX += itemSpace;
        const wordCenterX = currentX + itemWidth / 2;

        ctx.save();
        if (isActive) {
          // Active word: glowing, slightly scaled up
          const activeScale = settings.reducedMotion ? 1.0 : (1.06 + audioScale);
          ctx.translate(wordCenterX, cy);
          ctx.scale(activeScale, activeScale);

          if (settings.glowEnabled && settings.glowIntensity > 0) {
            ctx.shadowColor = palette.accentCss;
            ctx.shadowBlur = Math.round(12 * settings.glowIntensity);
          }
          ctx.fillStyle = palette.accentCss;
          ctx.fillText(item.word.text, 0, 0);

          // Top highlight
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.95;
          ctx.fillText(item.word.text, 0, 0);
        } else if (isPast) {
          // Past word in current line: high visibility
          ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.88)`;
          ctx.fillText(item.word.text, wordCenterX, cy);
        } else {
          // Future word in current line: lower opacity
          ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.38)`;
          ctx.fillText(item.word.text, wordCenterX, cy);
        }
        ctx.restore();

        currentX += itemWidth;
      }

      ctx.restore();
    }

    // 3. Next Line (Below)
    if (nextLineText) {
      ctx.save();
      const nextY = cy + lineSpacing;
      ctx.font = buildFont('medium', Math.round(baseFontSize * 0.76), settings.fontFamily);
      ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.3)`;
      ctx.fillText(nextLineText, cx, nextY);
      ctx.restore();
    }

    ctx.restore();
  }
}
