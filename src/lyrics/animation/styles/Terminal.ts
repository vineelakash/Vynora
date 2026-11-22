/**
 * Style 5: Terminal — Cinematic Code-Editor Lyric Writing.
 *
 * Implements a premium, developer-editor-inspired lyric experience:
 * - Deep charcoal editor canvas with subtle window chrome and tab status bar.
 * - Subtle line numbering (01, 02, ...) in an editor gutter.
 * - Natural 2-space and 4-space code indentation.
 * - Syntax-inspired decorative brackets and punctuation ([], {}, "", (), <>, //, =>, ;, ...).
 * - Exactly the latest two lines remain visible (Slot 0: Preceding, Slot 1: Active).
 * - Smooth 350ms vertical scroll transition when advancing to the next line.
 * - Responsive character-by-character typing synchronized with the lyric clock.
 * - Sleek 2.5px vertical insertion cursor following the write head.
 * - Unicode-safe grapheme clustering preserving Telugu, Hindi, and English.
 * - ZERO executable code or programming keywords (100% original lyrics).
 */

import type { LineTimingContext, RenderContext } from '../animationTypes.ts';
import { buildFont, getResponsiveFontSize } from './styleHelpers.ts';
import {
  formatTerminalLine,
  computeTerminalTokens,
  type TerminalLineFormat,
  type TerminalSyntaxTokens,
} from './terminalFormatter.ts';

export class TerminalStyle {
  public draw(
    ctx: CanvasRenderingContext2D,
    context: LineTimingContext,
    renderCtx: RenderContext,
  ): void {
    const { width, height, palette, audioFrame, settings, nowMs, positionMs, isPlaying, lines } = renderCtx;
    const { lineIndex, lineText, lineStartMs, prevLineText, words, activeWordIndex, activeWordProgress, lineProgress } = context;

    if (width <= 0 || height <= 0) return;

    ctx.save();

    // 1. Editor Window Geometry
    const padX = Math.max(16, Math.round(width * 0.05));
    const padY = Math.max(14, Math.round(height * 0.06));
    const editorW = width - padX * 2;
    const editorH = height - padY * 2;
    const headerH = Math.max(30, Math.round(height * 0.055));

    // Audio reactive ambient energy
    const bass = (settings.audioReactive && audioFrame) ? audioFrame.bass : 0;
    const beat = (settings.audioReactive && audioFrame) ? audioFrame.beat : false;
    const audioGlow = (bass * 6 + (beat ? 8 : 0)) * settings.intensity;

    // Responsive Monospace Typography
    const baseFontSize = getResponsiveFontSize(settings.fontSize, width, height, 0.70);
    const lineHeight = Math.round(baseFontSize * 2.0);

    // 2. Draw Code Editor Window Canvas
    ctx.save();
    // Deep charcoal background panel
    ctx.fillStyle = 'rgba(10, 12, 16, 0.94)';
    ctx.strokeStyle = `rgba(${palette.dominant.r}, ${palette.dominant.g}, ${palette.dominant.b}, 0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(padX, padY, editorW, editorH, 12);
    ctx.fill();
    ctx.stroke();

    // Window Header Bar
    ctx.fillStyle = 'rgba(17, 21, 28, 0.9)';
    ctx.beginPath();
    ctx.roundRect(padX, padY, editorW, headerH, [12, 12, 0, 0]);
    ctx.fill();

    // Header divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(padX, padY + headerH);
    ctx.lineTo(padX + editorW, padY + headerH);
    ctx.stroke();

    // Window Controls (macOS style window dots)
    const dotY = padY + headerH / 2;
    const dotRadius = 4.5;
    const dotSpacing = 16;
    const dotsStartX = padX + 18;

    // Red dot (close)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.75)';
    ctx.beginPath();
    ctx.arc(dotsStartX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Amber dot (minimize)
    ctx.fillStyle = 'rgba(245, 158, 11, 0.75)';
    ctx.beginPath();
    ctx.arc(dotsStartX + dotSpacing, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Green dot (expand)
    ctx.fillStyle = 'rgba(16, 185, 129, 0.75)';
    ctx.beginPath();
    ctx.arc(dotsStartX + dotSpacing * 2, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Editor Tab / Breadcrumb Title
    ctx.font = buildFont('medium', Math.max(11, Math.round(baseFontSize * 0.42)), 'mono');
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const totalLinesCount = lines ? lines.length : (lineIndex >= 0 ? lineIndex + 1 : 1);
    const lineDisplayNum = lineIndex >= 0 ? lineIndex + 1 : 0;
    const tabTitle = `lyrics.live // UTF-8 // [Line ${lineDisplayNum}/${totalLinesCount}]`;
    ctx.fillText(tabTitle, dotsStartX + dotSpacing * 2 + 24, dotY);

    // Subtle status indicator on right side of header
    ctx.textAlign = 'right';
    const statusText = isPlaying ? 'LIVE SYNC' : 'PAUSED';
    ctx.fillStyle = isPlaying ? '#10b981' : '#f59e0b';
    ctx.fillText(statusText, padX + editorW - 18, dotY);
    ctx.restore();

    // 3. Resolve Lines & Smooth Vertical Transition
    const bufferY = padY + headerH;
    const bufferH = editorH - headerH;
    const centerY = bufferY + bufferH / 2;

    const slot0Y = centerY - lineHeight * 0.65;
    const slot1Y = centerY + lineHeight * 0.65;

    // Gutter configuration
    const gutterW = Math.max(48, Math.round(baseFontSize * 1.8));
    const gutterDividerX = padX + gutterW;
    const textStartX = gutterDividerX + 16;
    const maxTextWidth = editorW - gutterW - 36;

    // Vertical Gutter separator line
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gutterDividerX, bufferY);
    ctx.lineTo(gutterDividerX, padY + editorH);
    ctx.stroke();
    ctx.restore();

    // Intro state (before lyrics begin)
    if (lineIndex < 0 || !lineText) {
      this.drawIntroState(
        ctx,
        textStartX,
        padX + gutterW - 12,
        centerY,
        baseFontSize,
        palette.accentCss,
        nowMs,
        isPlaying,
      );
      ctx.restore();
      return;
    }

    // Scroll Transition Progress (over the first 350ms of line arrival)
    const lineElapsedMs = positionMs - lineStartMs;
    const transitionMs = 350;
    let scrollEase = 1.0;
    let scrollOffsetY = 0;

    if (!settings.reducedMotion && lineElapsedMs >= 0 && lineElapsedMs < transitionMs && lineIndex > 0) {
      const t = Math.min(1.0, Math.max(0.0, lineElapsedMs / transitionMs));
      scrollEase = 1 - Math.pow(1 - t, 3); // easeOutCubic
      scrollOffsetY = (1 - scrollEase) * lineHeight;
    }

    // Line 1: Preceding completed line (Slot 0)
    // If we have prevLineText or can get lines[lineIndex - 1]
    const effectivePrevText = prevLineText ?? (lines && lineIndex > 0 ? lines[lineIndex - 1]?.text : undefined);

    if (effectivePrevText && lineIndex > 0) {
      const prevFormat = formatTerminalLine(effectivePrevText, lineIndex - 1);
      const prevTokens = computeTerminalTokens(prevFormat, 1.0, undefined, -1, 0, true);

      const prevLineY = slot0Y + scrollOffsetY;
      const prevAlpha = 0.62;

      this.drawLineContent(
        ctx,
        prevFormat,
        prevTokens,
        padX + gutterW - 12,
        textStartX,
        prevLineY,
        baseFontSize,
        maxTextWidth,
        palette,
        prevAlpha,
        false, // not active
        settings.fontWeight,
      );

      // During the upward scroll transition, also render line (i - 2) sliding above Slot 0 and fading out
      if (scrollOffsetY > 0 && lineIndex >= 2 && lines && lines[lineIndex - 2]) {
        const oldText = lines[lineIndex - 2]!.text;
        const oldFormat = formatTerminalLine(oldText, lineIndex - 2);
        const oldTokens = computeTerminalTokens(oldFormat, 1.0, undefined, -1, 0, true);
        const oldLineY = slot0Y - lineHeight + scrollOffsetY;
        const oldAlpha = 0.5 * (1 - scrollEase);

        this.drawLineContent(
          ctx,
          oldFormat,
          oldTokens,
          padX + gutterW - 12,
          textStartX,
          oldLineY,
          baseFontSize,
          maxTextWidth,
          palette,
          oldAlpha,
          false,
          settings.fontWeight,
        );
      }
    }

    // Line 2: Currently active writing line (Slot 1)
    const activeFormat = formatTerminalLine(lineText, lineIndex);
    const activeTokens = computeTerminalTokens(
      activeFormat,
      lineProgress,
      words,
      activeWordIndex,
      activeWordProgress,
      false,
    );

    const activeLineY = lineIndex === 0 ? centerY : (slot1Y + scrollOffsetY);
    const activeAlpha = scrollOffsetY > 0 ? Math.min(1.0, scrollEase + 0.2) : 1.0;

    // Evaluate cursor state:
    // Is actively writing if not paused and body is not fully revealed yet
    const isActivelyWriting = isPlaying && !activeTokens.isCompleted;
    // Cursor blinks during pauses; remains solid during active character writing
    const cursorBlink = Math.floor(nowMs / 530) % 2 === 0;
    const cursorVisible = isActivelyWriting ? true : cursorBlink;

    this.drawLineContent(
      ctx,
      activeFormat,
      activeTokens,
      padX + gutterW - 12,
      textStartX,
      activeLineY,
      baseFontSize,
      maxTextWidth,
      palette,
      activeAlpha,
      true, // active
      settings.fontWeight,
      cursorVisible,
      audioGlow,
      settings.glowEnabled,
    );

    ctx.restore();
  }

  /**
   * Renders a single terminal line with line numbers, indentation, syntax brackets, and insertion cursor.
   */
  private drawLineContent(
    ctx: CanvasRenderingContext2D,
    format: TerminalLineFormat,
    tokens: TerminalSyntaxTokens,
    gutterRightX: number,
    textStartX: number,
    lineY: number,
    baseFontSize: number,
    maxTextWidth: number,
    palette: RenderContext['palette'],
    alpha: number,
    isActive: boolean,
    fontWeight: RenderContext['settings']['fontWeight'],
    cursorVisible = false,
    audioGlow = 0,
    glowEnabled = true,
  ): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    // Dynamic responsive line scaling for long lines
    ctx.font = buildFont(fontWeight, baseFontSize, 'mono');
    const fullPreviewStr = `${format.indent}${format.prefix}${tokens.revealedBody}${tokens.suffix}`;
    const measuredW = ctx.measureText(fullPreviewStr).width;
    const fitScale = measuredW > maxTextWidth ? Math.max(0.72, maxTextWidth / measuredW) : 1.0;
    const effectiveFontSize = baseFontSize * fitScale;

    // 1. Line Number in Gutter
    ctx.font = buildFont('medium', effectiveFontSize * 0.85, 'mono');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isActive ? 'rgba(148, 163, 184, 0.65)' : 'rgba(148, 163, 184, 0.28)';
    ctx.fillText(format.lineNum, gutterRightX, lineY);

    // 2. Syntax-Colored Line Segments
    ctx.font = buildFont(fontWeight, effectiveFontSize, 'mono');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let curX = textStartX;

    // Indentation spaces
    if (format.indent) {
      curX += ctx.measureText(format.indent).width;
    }

    // Opening Prefix Punctuation
    if (format.prefix) {
      const prefixColor = this.resolveSyntaxColor(format.prefix, palette, isActive);
      ctx.fillStyle = prefixColor;
      ctx.fillText(format.prefix, curX, lineY);
      curX += ctx.measureText(format.prefix).width;
    }

    // Revealed Lyric Body Text
    if (tokens.revealedBody) {
      if (isActive) {
        // High contrast bright white for active lyrics
        ctx.fillStyle = '#f8fafc';
        if (glowEnabled && audioGlow > 0) {
          ctx.shadowColor = palette.accentCss;
          ctx.shadowBlur = Math.round(audioGlow);
        }
      } else {
        // Soft secondary neutral for completed previous line
        ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
      }

      ctx.fillText(tokens.revealedBody, curX, lineY);
      ctx.shadowBlur = 0;
      curX += ctx.measureText(tokens.revealedBody).width;
    }

    // 3. Insertion Cursor (drawn right at the writing head of active line)
    if (isActive && cursorVisible) {
      const cursorW = Math.max(2, Math.round(2.5 * fitScale));
      const cursorH = Math.round(effectiveFontSize * 1.15);
      const cursorX = curX + 2;
      const cursorY = Math.round(lineY - cursorH / 2);

      ctx.save();
      ctx.fillStyle = palette.accentCss;
      if (glowEnabled) {
        ctx.shadowColor = palette.accentCss;
        ctx.shadowBlur = Math.max(4, Math.round(audioGlow + 4));
      }
      ctx.fillRect(cursorX, cursorY, cursorW, cursorH);
      ctx.restore();
    }

    // Closing Suffix Punctuation (appears when body typing is complete)
    if (tokens.suffix) {
      const suffixColor = this.resolveSyntaxColor(tokens.suffix, palette, isActive);
      ctx.fillStyle = suffixColor;
      // Slight space before suffix if cursor was present
      const suffixX = isActive ? curX + 6 : curX;
      ctx.fillText(tokens.suffix, suffixX, lineY);
    }

    ctx.restore();
  }

  /**
   * Decorative syntax highlighting color resolver without programming semantics.
   */
  private resolveSyntaxColor(
    symbol: string,
    palette: RenderContext['palette'],
    isActive: boolean,
  ): string {
    const dimAlpha = isActive ? '0.78' : '0.45';

    if (symbol.includes('//')) {
      // Comment syntax: muted slate
      return `rgba(100, 116, 139, ${dimAlpha})`;
    }
    if (symbol.includes('=>')) {
      // Arrow / operator: soft violet
      return `rgba(167, 139, 250, ${dimAlpha})`;
    }
    if (symbol.includes('"') || symbol.includes("'")) {
      // Quoted string syntax: sky / cyan
      return `rgba(56, 189, 248, ${dimAlpha})`;
    }
    if (symbol.includes('[') || symbol.includes(']') || symbol.includes('{') || symbol.includes('}')) {
      // Structural brackets: cool silver / slate
      return `rgba(203, 213, 225, ${dimAlpha})`;
    }
    if (symbol.includes('<') || symbol.includes('>')) {
      // Angle brackets: emerald / mint
      return `rgba(52, 211, 153, ${dimAlpha})`;
    }
    if (symbol.includes(';') || symbol.includes(':')) {
      // Delimiters: secondary accent
      return `rgba(${palette.secondary.r}, ${palette.secondary.g}, ${palette.secondary.b}, ${dimAlpha})`;
    }

    // Default decorative punctuation
    return `rgba(148, 163, 184, ${dimAlpha})`;
  }

  /**
   * Initial idle / waiting display before playback begins.
   */
  private drawIntroState(
    ctx: CanvasRenderingContext2D,
    textStartX: number,
    gutterRightX: number,
    centerY: number,
    baseFontSize: number,
    accentCss: string,
    nowMs: number,
    _isPlaying: boolean,
  ): void {
    ctx.font = buildFont('medium', baseFontSize * 0.85, 'mono');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.fillText('01', gutterRightX, centerY);

    ctx.font = buildFont('normal', baseFontSize, 'mono');
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
    const prompt = '// waiting for playback...';
    ctx.fillText(prompt, textStartX, centerY);

    // Blinking cursor
    if (Math.floor(nowMs / 530) % 2 === 0) {
      const promptW = ctx.measureText(prompt).width;
      const cursorX = textStartX + promptW + 6;
      const cursorH = Math.round(baseFontSize * 1.15);
      const cursorY = Math.round(centerY - cursorH / 2);

      ctx.fillStyle = accentCss;
      ctx.fillRect(cursorX, cursorY, 2.5, cursorH);
    }
  }
}
