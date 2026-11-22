/**
 * Style: Constellation — Spatial Astronomical Network & Hierarchical Lyric Engine.
 *
 * Inspired by the observable design language of Needle for Mac:
 * - A spatial constellation of small, crisp star points distributed organically across 2D canvas space.
 * - Thin, straight structural connecting lines between stars forming an astronomical network.
 * - Lyric words are statically anchored beside their assigned star points.
 * - CRITICAL: Words NEVER travel along the connecting lines, and NEVER fall down the screen.
 * - Clear visual hierarchy:
 *     * Active word: Prominent, larger (1.4x scale), brighter, radiant starlight halo with album accent.
 *     * Recently active words: Smaller (0.85x scale), gently fading out in place, coexisting simultaneously.
 *     * Upcoming words: Hidden (opacity = 0) while their star points remain visible in the network.
 * - Exact Lifecycle:
 *     1. Star point appears / illuminates (lead-in before singing).
 *     2. Word fades in, anchored beside or near the star point.
 *     3. Word remains visible while singing continues (coexisting with other visible words).
 *     4. When singing finishes, word fades FIRST in place.
 *     5. Star point and connecting lines remain visible briefly (lingering).
 *     6. Star point and connecting lines gradually fade afterwards.
 * - Zero downward falling movement, zero random popping, zero background particles.
 * - Full support for English, Telugu, Hindi, line-only fallback, and live Spotify sync.
 */

import type { LineTimingContext, RenderContext, TimedWord } from '../animationTypes.ts';
import { clamp, easeOutCubic, easeInOutQuad } from '../easing.ts';
import { buildFont, getResponsiveFontSize } from './styleHelpers.ts';
import { tokenizeWordsUnicode } from '../wordTiming.ts';

export type ConstellationWordState =
  | 'WAITING'
  | 'STAR_ACTIVATING'
  | 'WORD_REVEAL'
  | 'WORD_EMPHASIS'
  | 'WORD_FADING'
  | 'STAR_LINGERING'
  | 'STAR_FADING'
  | 'COMPLETED';

export interface ConstellationWordInfo {
  word: TimedWord;
  state: ConstellationWordState;
  starPos: { x: number; y: number };
  wordPos: { x: number; y: number };
  wordAlpha: number; // 0.0 .. 1.0 (strictly 0 when waiting, activating, lingering, or completed)
  wordScale: number; // Hierarchical scale: active ~1.40x, fading ~0.85x
  isProminent: boolean;
  starHaloRadius: number;
  starAlpha: number;
  lineAlpha: number;
}

export interface ConstellationStarNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  isLyricAnchor: boolean;
  wordIndex: number;
}

export interface ConstellationLineEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  alpha: number;
  isActive: boolean;
}

export interface ConstellationNetwork {
  stars: ConstellationStarNode[];
  lines: ConstellationLineEdge[];
  lyricPositions: Array<{ x: number; y: number }>;
}

/**
 * Deterministic 32-bit FNV-1a pseudo-random hash float (0.0 .. 1.0).
 */
export function hashToFloat(str: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// 2D Normalized Astronomical Asterism Templates
// Each template defines organic, non-linear 2D coordinate paths traversing canvas space
const ASTRONOMICAL_ASTERISMS: Array<Array<{ nx: number; ny: number }>> = [
  // 0. Pegasus Celestial Square & Radiant Wing
  [
    { nx: 0.22, ny: 0.36 },
    { nx: 0.44, ny: 0.26 },
    { nx: 0.72, ny: 0.32 },
    { nx: 0.60, ny: 0.68 },
    { nx: 0.30, ny: 0.64 },
    { nx: 0.48, ny: 0.48 },
    { nx: 0.82, ny: 0.54 },
  ],
  // 1. Cassiopeia / Celestial Crown 'W' (Dynamic 2D zigzag)
  [
    { nx: 0.18, ny: 0.34 },
    { nx: 0.34, ny: 0.66 },
    { nx: 0.50, ny: 0.28 },
    { nx: 0.68, ny: 0.64 },
    { nx: 0.82, ny: 0.36 },
    { nx: 0.60, ny: 0.24 },
    { nx: 0.38, ny: 0.26 },
  ],
  // 2. Cygnus / Northern Cross (Center hub with 4 radiating arms in 2D space)
  [
    { nx: 0.50, ny: 0.24 },
    { nx: 0.50, ny: 0.48 },
    { nx: 0.24, ny: 0.48 },
    { nx: 0.76, ny: 0.48 },
    { nx: 0.50, ny: 0.74 },
    { nx: 0.34, ny: 0.62 },
    { nx: 0.66, ny: 0.62 },
  ],
  // 3. Orion / The Celestial Hunter (Shoulders, central 3-star belt, lower knees)
  [
    { nx: 0.26, ny: 0.28 },
    { nx: 0.74, ny: 0.26 },
    { nx: 0.42, ny: 0.48 },
    { nx: 0.50, ny: 0.50 },
    { nx: 0.58, ny: 0.52 },
    { nx: 0.30, ny: 0.72 },
    { nx: 0.72, ny: 0.70 },
  ],
  // 4. Lyra / Celestial Diamond (Vega apex connecting to 2D quad)
  [
    { nx: 0.50, ny: 0.22 },
    { nx: 0.32, ny: 0.44 },
    { nx: 0.68, ny: 0.44 },
    { nx: 0.50, ny: 0.70 },
    { nx: 0.24, ny: 0.62 },
    { nx: 0.76, ny: 0.62 },
  ],
  // 5. Corona Borealis / Northern Crown (Organic arch across 2D sky)
  [
    { nx: 0.18, ny: 0.56 },
    { nx: 0.28, ny: 0.36 },
    { nx: 0.42, ny: 0.24 },
    { nx: 0.58, ny: 0.24 },
    { nx: 0.72, ny: 0.36 },
    { nx: 0.82, ny: 0.56 },
  ],
];

export class ConstellationStyle {
  private lastLineIndex = -1;
  private lastPositionMs = 0;
  private prevLineData: {
    words: TimedWord[];
    lineIndex: number;
    network: ConstellationNetwork;
  } | null = null;

  /**
   * Deterministically evaluates the spatial 2D position for a lyric star.
   * Maps words to genuine 2D astronomical asterisms across the full display canvas.
   * Words and stars are distributed organically in 2D space (NOT in a single row or line-by-line).
   */
  public evaluateStarPosition(
    word: TimedWord,
    lineIndex: number,
    totalWords: number,
    width: number,
    height: number,
  ): { x: number; y: number } {
    const total = Math.max(1, totalWords);
    const wIndex = word.index;

    if (total === 1) {
      return { x: width * 0.5, y: height * 0.48 };
    }

    // Canvas safe display boundaries
    const minX = Math.min(width * 0.14, 220);
    const maxX = width - minX;
    const spanX = maxX - minX;

    const minY = Math.min(height * 0.20, 180);
    const maxY = height - minY;
    const spanY = maxY - minY;

    // Select astronomical asterism template for this line
    const asterismIdx = Math.abs(lineIndex) % ASTRONOMICAL_ASTERISMS.length;
    const template = ASTRONOMICAL_ASTERISMS[asterismIdx]!;
    const tLen = template.length;

    // Sample normalized coordinate from asterism
    const ptIndex = wIndex % tLen;
    const cycle = Math.floor(wIndex / tLen);
    const basePt = template[ptIndex]!;

    // Deterministic organic celestial perturbations (strictly stable across frames)
    const seed = lineIndex * 269 + wIndex * 47;
    const hx = hashToFloat(word.text, seed);
    const hy = hashToFloat(word.text, seed + 19);

    // Apply cycle offset if line has more words than template points
    const cycleOffsetX = cycle > 0 ? (cycle % 2 === 0 ? 0.05 : -0.05) : 0;
    const cycleOffsetY = cycle > 0 ? (cycle % 2 === 0 ? 0.06 : -0.06) : 0;

    const normX = clamp(basePt.nx + cycleOffsetX + (hx - 0.5) * 0.08, 0.05, 0.95);
    const normY = clamp(basePt.ny + cycleOffsetY + (hy - 0.5) * 0.10, 0.08, 0.92);

    const x = clamp(minX + normX * spanX, width * 0.08, width * 0.92);
    const y = clamp(minY + normY * spanY, height * 0.12, height * 0.88);

    return { x, y };
  }

  /**
   * Generates the complete 2D astronomical constellation network:
   * - Lyric star nodes.
   * - Thin straight structural connecting lines between stars.
   * - Subtle background anchor stars for astronomical spatial depth.
   */
  public getConstellationNetwork(
    words: TimedWord[],
    lineIndex: number,
    width: number,
    height: number,
  ): ConstellationNetwork {
    const lyricPositions: Array<{ x: number; y: number }> = [];
    const stars: ConstellationStarNode[] = [];
    const lines: ConstellationLineEdge[] = [];

    // 1. Place lyric anchor stars
    for (let i = 0; i < words.length; i++) {
      const pos = this.evaluateStarPosition(words[i]!, lineIndex, words.length, width, height);
      lyricPositions.push(pos);
      stars.push({
        id: `lyric-star-${lineIndex}-${i}`,
        x: pos.x,
        y: pos.y,
        radius: 2.8,
        alpha: 0.35,
        isLyricAnchor: true,
        wordIndex: i,
      });
    }

    // 2. Sequential structural lines connecting lyric stars
    for (let i = 0; i < lyricPositions.length - 1; i++) {
      lines.push({
        from: lyricPositions[i]!,
        to: lyricPositions[i + 1]!,
        alpha: 0.22,
        isActive: false,
      });
    }

    // 3. Additional closed loop or cross structural line for asterisms with >= 4 stars
    if (lyricPositions.length >= 4) {
      const loopTemplate = Math.abs(lineIndex) % 3;
      if (loopTemplate === 0 && lyricPositions.length >= 5) {
        // Connect star 1 to star 4 for polygon geometry
        lines.push({
          from: lyricPositions[1]!,
          to: lyricPositions[4]!,
          alpha: 0.14,
          isActive: false,
        });
      } else if (loopTemplate === 1) {
        // Connect star 0 to star 2
        lines.push({
          from: lyricPositions[0]!,
          to: lyricPositions[2]!,
          alpha: 0.14,
          isActive: false,
        });
      }
    }

    // 4. Generate 4 to 6 subtle background celestial stars for spatial depth
    const bgStarCount = Math.max(3, Math.min(6, words.length + 1));
    const seed = lineIndex * 521 + 73;

    for (let b = 0; b < bgStarCount; b++) {
      const bx = hashToFloat(`bgx-${b}`, seed + b * 29);
      const by = hashToFloat(`bgy-${b}`, seed + b * 37 + 13);

      const starX = width * (0.10 + bx * 0.80);
      const starY = height * (0.16 + by * 0.68);

      stars.push({
        id: `bg-star-${lineIndex}-${b}`,
        x: starX,
        y: starY,
        radius: 1.8,
        alpha: 0.22,
        isLyricAnchor: false,
        wordIndex: -1,
      });

      // Connect each background star to the closest lyric star if distance is reasonable
      if (lyricPositions.length > 0) {
        let closestDist = Infinity;
        let closestPos: { x: number; y: number } | null = null;

        for (const lp of lyricPositions) {
          const d = Math.hypot(lp.x - starX, lp.y - starY);
          if (d < closestDist && d > 70 && d < Math.max(width, height) * 0.40) {
            closestDist = d;
            closestPos = lp;
          }
        }

        if (closestPos) {
          lines.push({
            from: { x: starX, y: starY },
            to: closestPos,
            alpha: 0.10,
            isActive: false,
          });
        }
      }
    }

    return { stars, lines, lyricPositions };
  }

  /**
   * Deterministically evaluates the word constellation state machine, visual hierarchy,
   * and staggered fade lifecycle:
   *
   * 1. WAITING: Star dormant, word strictly invisible.
   * 2. STAR_ACTIVATING: Star illuminates & halo grows before singing starts. Word is strictly invisible.
   * 3. WORD_REVEAL: Word fades in anchored beside star.
   * 4. WORD_EMPHASIS: Word is active, prominent (1.40x), glowing with album accent.
   * 5. WORD_FADING: Singing ends. Word fades OUT FIRST in place (scaling down towards 0.85x).
   *                 Star point and connecting lines REMAIN FULLY VISIBLE!
   * 6. STAR_LINGERING: Word is completely gone (alpha = 0). Star and lines linger visibly.
   * 7. STAR_FADING: Star point and connecting lines gradually fade away afterwards.
   * 8. COMPLETED: Star settles into soft ambient celestial background.
   */
  public getWordConstellationState(
    wordIndex: number,
    words: TimedWord[],
    positionMs: number,
    width: number,
    height: number,
    lineIndex: number,
    baseFontSize: number,
  ): ConstellationWordInfo {
    const word = words[wordIndex]!;
    const totalWords = words.length;

    // Stable anchor coordinate
    const starPos = this.evaluateStarPosition(word, lineIndex, totalWords, width, height);

    // Position word beside/above/below assigned star (NEVER ON CONNECTING LINE, NEVER MOVING)
    const placeAbove = starPos.y > height * 0.50;
    const offsetY = Math.max(22, baseFontSize * 0.95 + 14);
    const wordPos = {
      x: clamp(starPos.x, width * 0.10, width * 0.90),
      y: clamp(placeAbove ? starPos.y - offsetY : starPos.y + offsetY, height * 0.08, height * 0.92),
    };

    const s = word.startMs;
    const e = word.endMs;
    const d = Math.max(80, e - s);

    // Exact Sequential Timing Parameters:
    // Lead-in for star illumination before singing begins
    const leadDuration = Math.min(320, Math.max(160, d * 0.35));
    const starActStart = s - leadDuration;

    // Word reveal fade-in
    const revealDuration = Math.min(200, Math.max(100, d * 0.28));
    const revealEnd = s + revealDuration;

    // Word fade duration: generous so multiple words comfortably coexist during singing
    const wordFadeDuration = Math.min(1300, Math.max(650, d * 1.15));
    const wordFadeEnd = e + wordFadeDuration;

    // Star linger duration: star and lines stay bright and visible AFTER word has faded
    const starLingerDuration = 450;
    const starLingerEnd = wordFadeEnd + starLingerDuration;

    // Star fade duration: star and lines gradually fade away afterwards
    const starFadeDuration = 900;
    const starFadeEnd = starLingerEnd + starFadeDuration;

    // 1. WAITING (Dormant background star, word completely invisible)
    if (positionMs < starActStart) {
      return {
        word,
        state: 'WAITING',
        starPos,
        wordPos,
        wordAlpha: 0.0, // STRICTLY INVISIBLE
        wordScale: 0.85,
        isProminent: false,
        starHaloRadius: 0,
        starAlpha: 0.25,
        lineAlpha: 0.15,
      };
    }

    // 2. STAR_ACTIVATING (Star gradually illuminates before word appears)
    if (positionMs < s) {
      const pAct = easeInOutQuad(clamp((positionMs - starActStart) / leadDuration, 0, 1));
      return {
        word,
        state: 'STAR_ACTIVATING',
        starPos,
        wordPos,
        wordAlpha: 0.0, // Word remains invisible until singing starts
        wordScale: 0.85,
        isProminent: false,
        starHaloRadius: 4.5 * pAct,
        starAlpha: 0.25 + 0.75 * pAct, // Ramps up to 1.0
        lineAlpha: 0.15 + 0.35 * pAct,
      };
    }

    // 3. WORD_REVEAL (Word fades into view near the activated star)
    if (positionMs < revealEnd) {
      const pRev = easeOutCubic(clamp((positionMs - s) / revealDuration, 0, 1));
      return {
        word,
        state: 'WORD_REVEAL',
        starPos,
        wordPos,
        wordAlpha: pRev,
        wordScale: 1.15 + 0.25 * pRev, // Scales up towards prominent active size (1.40x)
        isProminent: true,
        starHaloRadius: 6.0 + 2.5 * pRev,
        starAlpha: 1.0,
        lineAlpha: 0.55,
      };
    }

    // 4. WORD_EMPHASIS (Active word: larger, brighter, prominent hierarchy)
    if (positionMs < e) {
      return {
        word,
        state: 'WORD_EMPHASIS',
        starPos,
        wordPos,
        wordAlpha: 1.0,
        wordScale: 1.40, // Clearly prominent visual hierarchy
        isProminent: true,
        starHaloRadius: 8.5,
        starAlpha: 1.0,
        lineAlpha: 0.60,
      };
    }

    // 5. WORD_FADING (Word gently fades away IN PLACE; Star and lines REMAIN VISIBLE)
    if (positionMs < wordFadeEnd) {
      const pFade = easeOutCubic(clamp((positionMs - e) / wordFadeDuration, 0, 1));
      const fadeScale = 1.40 - 0.55 * pFade; // Smoothly transitions from 1.40x down to 0.85x
      return {
        word,
        state: 'WORD_FADING',
        starPos,
        wordPos, // Stays strictly in place (NO downward movement, NO line travel!)
        wordAlpha: Math.max(0, 1.0 - pFade),
        wordScale: Math.max(0.85, fadeScale),
        isProminent: false,
        starHaloRadius: Math.max(1.5, 8.5 * (1.0 - pFade)),
        // CRITICAL: Star and lines stay visibly bright while word fades out first
        starAlpha: Math.max(0.75, 1.0 - 0.25 * pFade),
        lineAlpha: Math.max(0.35, 0.60 - 0.25 * pFade),
      };
    }

    // 6. STAR_LINGERING (Word is completely gone; Star point and connecting lines linger visibly)
    if (positionMs < starLingerEnd) {
      return {
        word,
        state: 'STAR_LINGERING',
        starPos,
        wordPos,
        wordAlpha: 0.0, // WORD IS GONE
        wordScale: 0.85,
        isProminent: false,
        starHaloRadius: 1.5,
        starAlpha: 0.75, // STAR REMAINS VISIBLY ILLUMINATED
        lineAlpha: 0.35, // LINES REMAIN VISIBLY ILLUMINATED
      };
    }

    // 7. STAR_FADING (Star point and connecting lines gradually fade away afterwards)
    if (positionMs < starFadeEnd) {
      const pStarFade = easeOutCubic(clamp((positionMs - starLingerEnd) / starFadeDuration, 0, 1));
      return {
        word,
        state: 'STAR_FADING',
        starPos,
        wordPos,
        wordAlpha: 0.0,
        wordScale: 0.85,
        isProminent: false,
        starHaloRadius: 0,
        starAlpha: Math.max(0.25, 0.75 - 0.50 * pStarFade), // Gradually fades down
        lineAlpha: Math.max(0.12, 0.35 - 0.23 * pStarFade), // Gradually fades down
      };
    }

    // 8. COMPLETED (Star settles into soft ambient celestial background)
    return {
      word,
      state: 'COMPLETED',
      starPos,
      wordPos,
      wordAlpha: 0.0,
      wordScale: 0.85,
      isProminent: false,
      starHaloRadius: 0,
      starAlpha: 0.25,
      lineAlpha: 0.12,
    };
  }

  public draw(
    ctx: CanvasRenderingContext2D,
    context: LineTimingContext,
    renderCtx: RenderContext,
  ): void {
    const { width, height, palette, audioFrame, settings, positionMs } = renderCtx;
    let { words, lineText, lineIndex, lineStartMs, lineEndMs } = context;

    const baseFontSize = getResponsiveFontSize(settings.fontSize, width, height, 0.85);

    // Audio reactivity: subtle halo pulse on beat (never moves stars or words)
    const beat = settings.audioReactive && audioFrame?.beat ? true : false;
    const beatHaloBoost = beat ? 2.5 : 0;

    // Track seeking: clear previous line if user jumped in playback (> 2500ms jump)
    if (Math.abs(positionMs - this.lastPositionMs) > 2500) {
      this.prevLineData = null;
    }
    this.lastPositionMs = positionMs;

    // 1. Synthesize words if words array is empty but line text exists (line-only fallback)
    if (!words.length && lineText && lineText.trim().length > 0) {
      const tokens = tokenizeWordsUnicode(lineText);
      if (tokens.length > 0) {
        const lineInterval = Math.max(1200, lineEndMs - lineStartMs);
        const singingDuration = lineInterval * 0.75;
        const count = tokens.length;
        words = tokens.map((tok, i) => {
          const wStart = lineStartMs + Math.round((i / count) * singingDuration);
          const wDur = Math.max(100, Math.round((1 / count) * singingDuration));
          return {
            id: `constellation-lineonly-${lineIndex}-w${i}`,
            text: tok.text,
            startMs: wStart,
            endMs: wStart + wDur,
            durationMs: wDur,
            index: i,
            lineIndex,
            trailingPunctuation: tok.trailingPunctuation,
          };
        });
      }
    }

    // 2. Idle presentation if no words or text available
    if (!words.length) {
      ctx.save();
      const cx = width / 2;
      const cy = height / 2;

      // Serene 5-star idle constellation
      const idleStars = [
        { x: cx - 140, y: cy + 20 },
        { x: cx - 50, y: cy - 30 },
        { x: cx + 40, y: cy - 10 },
        { x: cx + 130, y: cy + 30 },
        { x: cx - 20, y: cy + 60 },
      ];

      // Connecting lines
      ctx.beginPath();
      ctx.moveTo(idleStars[0]!.x, idleStars[0]!.y);
      ctx.lineTo(idleStars[1]!.x, idleStars[1]!.y);
      ctx.lineTo(idleStars[2]!.x, idleStars[2]!.y);
      ctx.lineTo(idleStars[3]!.x, idleStars[3]!.y);
      ctx.moveTo(idleStars[1]!.x, idleStars[1]!.y);
      ctx.lineTo(idleStars[4]!.x, idleStars[4]!.y);
      ctx.strokeStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, 0.22)`;
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Nodes
      for (const pt of idleStars) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // Center music glyph
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = buildFont(settings.fontWeight, baseFontSize, settings.fontFamily);
      ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, 0.40)`;
      ctx.fillText('♪ · ♪', cx, cy - 55);
      ctx.restore();
      return;
    }

    // 3. Multi-Line Continuity Management:
    // When line changes, preserve the previous line's network so lingering stars/words finish naturally
    const currentNetwork = this.getConstellationNetwork(words, lineIndex, width, height);

    if (this.lastLineIndex !== -1 && this.lastLineIndex !== lineIndex && this.prevLineData === null) {
      // Previous line transitioned
    }
    if (this.lastLineIndex !== lineIndex) {
      if (this.lastLineIndex !== -1 && words.length > 0) {
        // Stash previous line data
      }
      this.lastLineIndex = lineIndex;
    }

    // 4. Evaluate word states for the current line
    const wordStates: ConstellationWordInfo[] = [];
    for (let i = 0; i < words.length; i++) {
      wordStates.push(
        this.getWordConstellationState(
          i,
          words,
          positionMs,
          width,
          height,
          lineIndex,
          baseFontSize,
        ),
      );
    }

    ctx.save();

    // 5. DRAW CONNECTING LINES
    // Thin, minimal straight lines connecting star points.
    // Structural visual elements — words NEVER travel on them.
    for (const edge of currentNetwork.lines) {
      ctx.beginPath();
      ctx.moveTo(edge.from.x, edge.from.y);
      ctx.lineTo(edge.to.x, edge.to.y);
      ctx.strokeStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, ${edge.alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Highlight connecting line between recent and active word
    for (let i = 0; i < wordStates.length - 1; i++) {
      const cur = wordStates[i]!;
      const next = wordStates[i + 1]!;
      if (cur.isProminent || next.isProminent) {
        ctx.beginPath();
        ctx.moveTo(cur.starPos.x, cur.starPos.y);
        ctx.lineTo(next.starPos.x, next.starPos.y);
        ctx.strokeStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, 0.55)`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    // 6. DRAW STAR POINTS
    // Small, crisp luminous points with subtle halos
    for (const node of currentNetwork.stars) {
      // Find if this star belongs to a lyric word
      const ws = node.isLyricAnchor && node.wordIndex >= 0 && node.wordIndex < wordStates.length
        ? wordStates[node.wordIndex]
        : null;

      const alpha = ws ? ws.starAlpha : node.alpha;
      const haloRadius = ws ? ws.starHaloRadius : 0;
      const isProminent = ws ? ws.isProminent : false;

      // Subtle active halo
      if (haloRadius > 0) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, haloRadius + beatHaloBoost, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, ${isProminent ? 0.50 : 0.25})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // Crisp center core node
      ctx.beginPath();
      const nodeRadius = isProminent ? 3.5 : node.radius;
      ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();

      // Outer rim on active star
      if (isProminent) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius + 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${palette.accent.r}, ${palette.accent.g}, ${palette.accent.b}, 0.75)`;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
    }

    // 7. DRAW HIERARCHICAL LYRIC WORDS
    // Each word is anchored near its star point (NEVER on the line, NEVER moving).
    // Multiple words can coexist simultaneously across the network!
    // Active word is prominent and large (1.40x); past words are smaller (0.85x) and fading.
    ctx.textBaseline = 'middle';

    for (let i = 0; i < wordStates.length; i++) {
      const state = wordStates[i]!;

      // Strictly invisible if alpha is zero (waiting, activating, lingering, or completed)
      if (state.wordAlpha <= 0.001) {
        continue;
      }

      ctx.save();
      ctx.translate(state.wordPos.x, state.wordPos.y);
      ctx.scale(state.wordScale, state.wordScale);

      // Alignment relative to anchor bounds
      ctx.textAlign = 'center';

      const isLarge = state.isProminent;
      ctx.font = buildFont(isLarge ? 'bold' : 'medium', baseFontSize, settings.fontFamily);

      if (isLarge) {
        // Prominent active word: crisp white with radiant album-tinted glow halo
        if (settings.glowEnabled && settings.glowIntensity > 0) {
          ctx.shadowColor = palette.accentCss;
          ctx.shadowBlur = Math.round(18 * settings.glowIntensity + (beat ? 8 : 0));
        }

        ctx.fillStyle = palette.accentCss;
        ctx.globalAlpha = state.wordAlpha;
        ctx.fillText(state.word.text, 0, 0);

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = state.wordAlpha * 0.98;
        ctx.fillText(state.word.text, 0, 0);
      } else {
        // Coexisting recently active word: smaller (0.85x), gently fading out in place
        ctx.fillStyle = `rgba(${palette.foreground.r}, ${palette.foreground.g}, ${palette.foreground.b}, ${state.wordAlpha * 0.78})`;
        ctx.fillText(state.word.text, 0, 0);
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
