/**
 * Style: Chat — Desktop-First Messaging Interface for Lyrics.
 *
 * Reimagines lyrics as a natural two-person online desktop messaging conversation
 * inspired by modern desktop messaging apps (WhatsApp Web, Instagram Desktop):
 *
 * 1. Left Panel (Album Information):
 *    - Prominent album artwork with original aspect ratio and rounded corners.
 *    - Song title, artist name, and album name with responsive typography.
 *    - Discrete live playing status indicator.
 *    - NO fake contact lists or fake user profiles.
 *    - Audio-reactive mini spectrum bars at the base.
 *
 * 2. Main Panel (Conversation):
 *    - Full horizontal messaging canvas.
 *    - Two distinct participants:
 *      * Participant 1 (Left): Understated dark slate neutral bubbles (#1A1C26).
 *      * Participant 2 (Right): Subtle luminous album accent tinted bubbles (#2A1E35 / #1E253A).
 *    - Natural 1-3 consecutive message bursts per side without predictable repetition.
 *    - Visual grouping with tighter intra-group spacing and tailored bubble corner radii.
 *    - Contextual emoji system matching lyric meaning (~1 per 2 exchanges).
 *    - Real timestamps and subtle delivery checkmarks (✓✓).
 *    - Smooth upward vertical scroll damping as new lyrics arrive.
 *    - Instant scroll snapping on seeks and window resizes (zero clipping or visual jumps).
 *    - 100% preservation of original lyric text.
 */

import type { LineTimingContext, RenderContext } from '../animationTypes.ts';
import { getResponsiveFontSize } from './styleHelpers.ts';
import {
  computeLyricContentSignature,
  getOrGenerateChatPlan,
  type ChatConversationPlan,
  type ChatPlannedMessage,
} from './chatConversationPlanner.ts';
import { assignContextualEmojis } from './chatEmojiEngine.ts';

function formatTimestamp(timeMs: number): string {
  const totalSec = Math.max(0, Math.floor(timeMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface WrappedLine {
  text: string;
  width: number;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): WrappedLine[] {
  if (!text) return [];

  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [{ text, width: ctx.measureText(text).width }];

  const lines: WrappedLine[] = [];
  let currentLine = words[0]!;

  for (let i = 1; i < words.length; i++) {
    const candidate = `${currentLine} ${words[i]}`;
    const w = ctx.measureText(candidate).width;
    if (w <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push({ text: currentLine, width: ctx.measureText(currentLine).width });
      currentLine = words[i]!;
    }
  }

  lines.push({ text: currentLine, width: ctx.measureText(currentLine).width });
  return lines;
}

export class ChatStyle {
  private lastTrackKey = '';
  private lastLyricSignature = '';
  private currentPlan: ChatConversationPlan | null = null;
  private scrollY = 0;
  private targetScrollY = 0;
  private lastPositionMs = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private snapScroll = false;

  public draw(
    ctx: CanvasRenderingContext2D,
    _context: LineTimingContext,
    renderCtx: RenderContext,
  ): void {
    const {
      width,
      height,
      palette,
      audioFrame,
      settings,
      nowMs,
      positionMs,
      isPlaying,
      lines,
      artworkImg,
      metadata,
    } = renderCtx;

    if (width <= 0 || height <= 0) return;

    ctx.save();

    // 1. Maintain or Generate Deterministic Conversation Plan for Track
    const trackKey = metadata?.trackKey || (lines && lines.length ? `track_${lines.length}_${lines[0]?.timeMs}` : 'default');
    const lyricSignature = computeLyricContentSignature(lines);

    if (
      trackKey !== this.lastTrackKey ||
      !this.currentPlan ||
      lyricSignature !== this.lastLyricSignature ||
      (this.currentPlan.messages.length === 0 && lines && lines.length > 0)
    ) {
      this.lastTrackKey = trackKey;
      this.lastLyricSignature = lyricSignature;
      this.currentPlan = getOrGenerateChatPlan(trackKey, lines || [], (msgs) => {
        assignContextualEmojis(msgs);
      }, lyricSignature);
      this.scrollY = 0;
      this.targetScrollY = 0;
      this.snapScroll = true;
    }

    // Handle large seek jump (> 600ms) by snapping scroll immediately
    const deltaSeek = Math.abs(positionMs - this.lastPositionMs);
    if (deltaSeek > 600) {
      this.snapScroll = true;
    }
    this.lastPositionMs = positionMs;

    // Detect significant resize (e.g. entering/exiting fullscreen or maximize)
    if (Math.abs(width - this.lastWidth) > 8 || Math.abs(height - this.lastHeight) > 8) {
      this.lastWidth = width;
      this.lastHeight = height;
      this.snapScroll = true;
    }

    // 2. Responsive Desktop Layout Partitioning
    // Left panel: 20% to 26% of width, min 200px, max 380px
    let leftPanelW: number;
    if (width >= 1440) {
      leftPanelW = Math.max(300, Math.min(380, Math.round(width * 0.22)));
    } else if (width >= 1024) {
      leftPanelW = Math.max(250, Math.min(320, Math.round(width * 0.24)));
    } else {
      leftPanelW = Math.max(200, Math.min(270, Math.round(width * 0.26)));
    }

    const convX = leftPanelW;
    const convW = width - leftPanelW;
    const convH = height;

    // 3. Draw Left Panel (Album Information)
    this.drawLeftPanel(
      ctx,
      leftPanelW,
      height,
      artworkImg ?? null,
      metadata,
      palette,
      isPlaying,
      audioFrame,
      settings,
      nowMs,
    );

    // 4. Draw Main Panel (Conversation Viewport)
    this.drawConversationPanel(
      ctx,
      convX,
      convW,
      convH,
      positionMs,
      palette,
      settings,
      metadata,
    );

    ctx.restore();
  }

  /**
   * Draws the Left Panel featuring the album cover, song title, artist, and status.
   */
  private drawLeftPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    artworkImg: HTMLImageElement | null,
    metadata: RenderContext['metadata'],
    palette: RenderContext['palette'],
    isPlaying: boolean,
    audioFrame: RenderContext['audioFrame'],
    settings: RenderContext['settings'],
    nowMs: number,
  ): void {
    ctx.save();

    // Background surface: deep charcoal obsidian
    ctx.fillStyle = 'rgba(11, 11, 19, 0.96)';
    ctx.fillRect(0, 0, w, h);

    // Right vertical hairline divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
    ctx.stroke();

    const isLargeScreen = w >= 280 && h >= 650;
    const paddingX = Math.max(16, Math.min(28, Math.round(w * 0.08)));

    // Top status pill
    const topPad = Math.max(14, Math.min(28, Math.round(h * 0.035)));
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Status dot
    const dotX = paddingX;
    const dotY = topPad + 6;
    ctx.fillStyle = isPlaying ? '#22c55e' : '#71717a';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Status text
    ctx.fillStyle = '#A6A2B3';
    ctx.fillText(isPlaying ? 'NOW PLAYING' : 'PAUSED', dotX + 12, dotY);

    // Album Artwork: Center-aligned, square, proportionally scaled
    const artMaxW = w - paddingX * 2;
    const artMaxH = Math.round(h * 0.40);
    const artSize = Math.max(110, Math.min(artMaxW, artMaxH, 320));
    const artX = Math.round((w - artSize) / 2);
    const artY = dotY + Math.max(16, Math.round(h * 0.025));
    const artRadius = Math.max(10, Math.min(18, Math.round(artSize * 0.055)));

    // Artwork shadow & border
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;

    if (artworkImg && artworkImg.complete && artworkImg.naturalWidth > 0) {
      // Draw actual album artwork with rounded corners
      ctx.beginPath();
      ctx.roundRect(artX, artY, artSize, artSize, artRadius);
      ctx.clip();
      ctx.drawImage(artworkImg, artX, artY, artSize, artSize);
    } else {
      // Fallback: Gradient album placeholder with vinyl aesthetic
      const grad = ctx.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
      grad.addColorStop(0, `rgb(${palette.dominant.r}, ${palette.dominant.g}, ${palette.dominant.b})`);
      grad.addColorStop(1, `rgb(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(artX, artY, artSize, artSize, artRadius);
      ctx.fill();

      // Inner disc ring
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(artX + artSize / 2, artY + artSize / 2, artSize * 0.28, 0, Math.PI * 2);
      ctx.stroke();

      // Musical note symbol
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `600 ${Math.round(artSize * 0.22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', artX + artSize / 2, artY + artSize / 2);
    }
    ctx.restore();

    // Subtle artwork outline border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(artX, artY, artSize, artSize, artRadius);
    ctx.stroke();

    // Track Metadata with responsive typography
    const metaY = artY + artSize + Math.max(14, Math.round(h * 0.024));
    const maxTextW = w - paddingX * 2;

    const titleFontSize = isLargeScreen ? 18 : 15;
    const artistFontSize = isLargeScreen ? 13 : 12;
    const albumFontSize = isLargeScreen ? 11 : 10;

    // Song Title
    const titleText = metadata?.title || 'VYNORA Playback';
    ctx.font = `700 ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#F5F3FA';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    this.drawTruncatedText(ctx, titleText, paddingX, metaY, maxTextW);

    // Artist Name
    const artistText = metadata?.artist || 'Unknown Artist';
    ctx.font = `500 ${artistFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#A6A2B3';
    this.drawTruncatedText(ctx, artistText, paddingX, metaY + titleFontSize + 8, maxTextW);

    // Album Name (Optional)
    if (metadata?.album) {
      ctx.font = `400 ${albumFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(166, 162, 179, 0.65)';
      this.drawTruncatedText(ctx, metadata.album, paddingX, metaY + titleFontSize + artistFontSize + 14, maxTextW);
    }

    // Audio-reactive mini equalizer bars at bottom of left panel
    if (settings.audioReactive && audioFrame && isPlaying) {
      const eqY = h - Math.max(18, Math.round(h * 0.035));
      const barCount = 8;
      const barW = Math.max(3, Math.min(5, Math.round(w * 0.012)));
      const barGap = Math.max(3, Math.min(5, Math.round(w * 0.010)));
      const startEqX = paddingX;

      ctx.fillStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, 0.8)`;
      for (let b = 0; b < barCount; b++) {
        const factor = (audioFrame.spectrum[b * 4] ?? 0.3) * (0.5 + 0.5 * Math.sin(nowMs * 0.005 + b));
        const barH = Math.max(3, Math.min(20, Math.round(factor * 20)));
        ctx.fillRect(startEqX + b * (barW + barGap), eqY - barH, barW, barH);
      }
    }

    ctx.restore();
  }

  /**
   * Draws the Main Conversation Panel with responsive desktop messaging layout.
   */
  private drawConversationPanel(
    ctx: CanvasRenderingContext2D,
    x: number,
    w: number,
    h: number,
    positionMs: number,
    palette: RenderContext['palette'],
    settings: RenderContext['settings'],
    metadata?: RenderContext['metadata'],
  ): void {
    if (!this.currentPlan) return;

    ctx.save();

    // Conversation background: obsidian
    ctx.fillStyle = '#08080E';
    ctx.fillRect(x, 0, w, h);

    // Header bar across conversation top
    const headerH = Math.max(40, Math.min(50, Math.round(h * 0.055)));
    ctx.fillStyle = 'rgba(14, 15, 23, 0.9)';
    ctx.fillRect(x, 0, w, headerH);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, headerH - 0.5);
    ctx.lineTo(x + w, headerH - 0.5);
    ctx.stroke();

    // Header title and participant badge
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#F5F3FA';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Lyrics Chat', x + 24, headerH / 2 - 6);

    ctx.font = '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#A6A2B3';
    ctx.fillText('2 participants · Synced with playback', x + 24, headerH / 2 + 8);

    // Viewport area for messages
    const viewY = headerH;
    const viewH = h - headerH;
    const viewPaddingBottom = Math.max(18, Math.round(h * 0.035));

    // Filter visible messages based on timeline position
    const allMsgs = this.currentPlan.messages;
    const visibleMsgs: ChatPlannedMessage[] = [];
    for (let i = 0; i < allMsgs.length; i++) {
      if (allMsgs[i]!.timeMs <= positionMs) {
        visibleMsgs.push(allMsgs[i]!);
      } else {
        break;
      }
    }

    // If no lyrics reached yet
    if (!visibleMsgs.length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const centerX = x + w / 2;
      const centerY = viewY + viewH / 2;

      if (allMsgs.length > 0) {
        // A. Lyrics are loaded, currently in instrumental intro
        ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = palette.accentCss || '#A6A2B3';
        ctx.fillText('♪ Instrumental Intro ♪', centerX, centerY - 14);

        const firstMsg = allMsgs[0];
        if (firstMsg?.text) {
          ctx.font = '400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillStyle = 'rgba(166, 162, 179, 0.55)';
          const preview = firstMsg.text.length > 40 ? `${firstMsg.text.slice(0, 38)}...` : firstMsg.text;
          ctx.fillText(`First lyric: "${preview}"`, centerX, centerY + 14);
        }
      } else {
        // B. No lyrics in plan: determine honest status from metadata
        const state = metadata?.lookupState;
        let statusMsg = 'Searching for lyrics…';

        if (state === 'instrumental') {
          statusMsg = '♪ Instrumental Track ♪';
        } else if (state === 'unavailable') {
          statusMsg = 'Lyrics unavailable for this track';
        } else if (state === 'error') {
          statusMsg = 'Unable to retrieve lyrics';
        } else if (metadata?.isConnected === false || !metadata?.title) {
          statusMsg = 'Waiting for Spotify playback…';
        } else if (state === 'loading') {
          statusMsg = 'Searching for lyrics…';
        } else if (state === 'plain') {
          statusMsg = 'Plain lyrics available (Unsynchronized)';
        }

        ctx.font = '400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(166, 162, 179, 0.6)';
        ctx.fillText(statusMsg, centerX, centerY);
      }

      ctx.restore();
      ctx.restore();
      return;
    }

    // Responsive Typography & Bubble Proportions
    const baseFontSize = getResponsiveFontSize(settings.fontSize, w, h, 0.36);
    const fontSize = Math.max(13, Math.min(18, Math.round(baseFontSize)));
    const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Nirmala UI", sans-serif';
    ctx.font = `400 ${fontSize}px ${fontStack}`;

    // Responsive horizontal margins & comfortable bubble sizing (avoids canyon on wide screens)
    const horizontalMargin = Math.max(20, Math.min(120, Math.round(w * 0.075)));
    const usableW = w - horizontalMargin * 2;
    const maxBubbleW = Math.max(260, Math.min(Math.round(usableW * 0.64), 720));

    const bubblePadX = Math.max(12, Math.min(18, Math.round(fontSize * 0.95)));
    const bubblePadY = Math.max(8, Math.min(13, Math.round(fontSize * 0.68)));
    const lineHeight = Math.round(fontSize * 1.45);
    const timeHeight = 14;

    // First pass: Pre-compute layouts and heights of all visible messages
    interface RenderedBubble {
      msg: ChatPlannedMessage;
      lines: WrappedLine[];
      bubbleW: number;
      bubbleH: number;
      y: number;
      isRight: boolean;
      timeStr: string;
      reactionEmoji?: string;
    }

    const rendered: RenderedBubble[] = [];
    let currentLayoutY = 16;
    let lastGroupId = -1;

    for (let i = 0; i < visibleMsgs.length; i++) {
      const msg = visibleMsgs[i]!;
      const isRight = msg.side === 'right';

      // Spacing between messages:
      // Tighter (6px) within same participant group; wider (22px) when speaker alternates
      if (lastGroupId !== -1) {
        const isSameGroup = msg.groupId === lastGroupId;
        currentLayoutY += isSameGroup ? 6 : 22;
      }
      lastGroupId = msg.groupId;

      // Prepare text content (append inline emoji if assigned)
      let displayText = msg.text;
      let reactionEmoji: string | undefined;
      if (msg.emoji) {
        if (msg.emojiPlacement === 'reaction') {
          reactionEmoji = msg.emoji;
        } else {
          displayText = `${msg.text} ${msg.emoji}`;
        }
      }

      ctx.font = `400 ${fontSize}px ${fontStack}`;
      const wrapped = wrapText(ctx, displayText, maxBubbleW - bubblePadX * 2);

      // Compute bubble width based on longest line and timestamp
      const longestTextW = wrapped.reduce((max, l) => Math.max(max, l.width), 0);
      const timeStr = formatTimestamp(msg.timeMs);
      ctx.font = '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const timeW = ctx.measureText(timeStr).width + (isRight ? 18 : 0);

      const bubbleW = Math.max(78, Math.max(longestTextW, timeW) + bubblePadX * 2);
      const bubbleH = bubblePadY * 2 + wrapped.length * lineHeight + timeHeight;

      rendered.push({
        msg,
        lines: wrapped,
        bubbleW,
        bubbleH,
        y: currentLayoutY,
        isRight,
        timeStr,
        reactionEmoji,
      });

      currentLayoutY += bubbleH;
    }

    // Total content height determines scroll offset
    const totalContentH = currentLayoutY + viewPaddingBottom;
    if (totalContentH > viewH) {
      this.targetScrollY = totalContentH - viewH;
    } else {
      this.targetScrollY = 0;
    }

    // Scroll Damping / Snapping
    if (this.snapScroll) {
      this.scrollY = this.targetScrollY;
      this.snapScroll = false;
    } else {
      const scrollDelta = (this.targetScrollY - this.scrollY) * 0.15;
      this.scrollY += scrollDelta;
    }

    // Clip rendering strictly to conversation viewport
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, viewY, w, viewH);
    ctx.clip();

    // Render each visible bubble
    for (let i = 0; i < rendered.length; i++) {
      const b = rendered[i]!;
      const drawY = viewY + b.y - this.scrollY;

      // Cull bubbles outside visible viewport
      if (drawY + b.bubbleH < viewY - 40 || drawY > viewY + viewH + 40) {
        continue;
      }

      const drawX = b.isRight
        ? x + w - horizontalMargin - b.bubbleW
        : x + horizontalMargin;

      // Smooth entrance animation for freshly revealed line (fade and slide up over 220ms)
      const ageMs = positionMs - b.msg.timeMs;
      const enterProgress = Math.min(1, Math.max(0, ageMs / 220));
      const slideOffsetY = (1 - enterProgress) * 8;
      const bubbleAlpha = Math.min(1, Math.max(0.2, enterProgress));

      ctx.save();
      ctx.globalAlpha = bubbleAlpha;
      ctx.translate(0, slideOffsetY);

      // Tailored corner radii for natural message grouping (WhatsApp / Instagram style)
      const r = Math.max(12, Math.min(18, Math.round(fontSize * 1.05)));
      const s = 4;
      let radii: [number, number, number, number];

      if (!b.isRight) {
        // Left participant (Understated dark slate surface)
        switch (b.msg.groupPosition) {
          case 'first':
            radii = [r, r, r, s];
            break;
          case 'middle':
            radii = [s, r, r, s];
            break;
          case 'last':
            radii = [s, r, r, r];
            break;
          case 'single':
          default:
            radii = [r, r, r, s];
            break;
        }
      } else {
        // Right participant (Subtle violet/blue tinted surface)
        switch (b.msg.groupPosition) {
          case 'first':
            radii = [r, r, s, r];
            break;
          case 'middle':
            radii = [r, s, s, r];
            break;
          case 'last':
            radii = [r, s, r, r];
            break;
          case 'single':
          default:
            radii = [r, r, s, r];
            break;
        }
      }

      // Draw bubble background & border
      ctx.beginPath();
      ctx.roundRect(drawX, drawY, b.bubbleW, b.bubbleH, radii);

      if (b.isRight) {
        // Right: Subtle violet/blue tinted surface
        ctx.fillStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, 0.22)`;
        ctx.strokeStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, 0.38)`;
      } else {
        // Left: Understated dark neutral surface
        ctx.fillStyle = 'rgba(26, 28, 38, 0.94)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      }

      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw lyric text lines
      ctx.font = `400 ${fontSize}px ${fontStack}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = b.isRight ? '#FFFFFF' : '#F5F3FA';

      for (let l = 0; l < b.lines.length; l++) {
        ctx.fillText(
          b.lines[l]!.text,
          drawX + bubblePadX,
          drawY + bubblePadY + l * lineHeight,
        );
      }

      // Draw timestamp and checkmarks at bottom-right of bubble
      const timeY = drawY + b.bubbleH - bubblePadY - 2;
      ctx.font = '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = b.isRight ? 'rgba(255, 255, 255, 0.65)' : 'rgba(166, 162, 179, 0.7)';

      if (b.isRight) {
        // Right participant: timestamp + subtle double checkmark (✓✓)
        ctx.fillText(`${b.timeStr}  ✓✓`, drawX + b.bubbleW - bubblePadX, timeY);
      } else {
        // Left participant: timestamp only
        ctx.fillText(b.timeStr, drawX + b.bubbleW - bubblePadX, timeY);
      }

      // Draw reaction badge if assigned as reaction pill
      if (b.reactionEmoji) {
        const pillW = 28;
        const pillH = 20;
        const pillX = b.isRight ? drawX - 10 : drawX + b.bubbleW - 18;
        const pillY = drawY + b.bubbleH - 10;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 10);
        ctx.fillStyle = 'rgba(18, 19, 28, 0.96)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = `12px ${fontStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.reactionEmoji, pillX + pillW / 2, pillY + pillH / 2);
        ctx.restore();
      }

      ctx.restore();
    }

    ctx.restore();
    ctx.restore();
  }

  /**
   * Helper to draw single line text truncated with ellipsis if exceeding maxWidth.
   */
  private drawTruncatedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
  ): void {
    if (ctx.measureText(text).width <= maxWidth) {
      ctx.fillText(text, x, y);
      return;
    }

    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    ctx.fillText(`${truncated}…`, x, y);
  }
}
