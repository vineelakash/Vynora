/**
 * Chat Conversation Planner.
 *
 * Computes deterministic, randomized conversation groupings (1-2 consecutive messages)
 * for lyrics displayed in the Chat style.
 *
 * Guarantees:
 * - Natural 1-2 consecutive messages per participant without predictable repetition.
 * - Maximum 2 consecutive messages per participant; minimum 1.
 * - A-B-A-B alternating conversations are allowed and supported.
 * - Continuous rigid A-B-A-B alternation is strictly interrupted before reaching 25 seconds.
 * - Natural grouping variation (participant sending 2 consecutive messages) breaks continuous alternation.
 * - Alternation resumes naturally after variation.
 * - Deterministic repeatability for a given song across seeks, pauses, and window resizes.
 * - Visual grouping metadata (single, first, last) for tailored bubble corner treatments.
 */

import type { ParsedLyricLine } from '../../../types/lyrics.ts';

export type ChatParticipantSide = 'left' | 'right';
export type ChatGroupPosition = 'single' | 'first' | 'middle' | 'last';

export interface ChatPlannedMessage {
  lineIndex: number;
  side: ChatParticipantSide;
  groupPosition: ChatGroupPosition;
  groupId: number;
  burstLength: number;
  timeMs: number;
  text: string;
  emoji?: string;
  emojiPlacement?: 'inline' | 'reaction';
}

export interface ChatConversationPlan {
  trackKey: string;
  signature?: string;
  messages: ChatPlannedMessage[];
  messageByLineIndex: Map<number, ChatPlannedMessage>;
}

/**
 * Fast, seedable Mulberry32 pseudo-random number generator.
 * Produces uniform 32-bit floating-point numbers in [0, 1).
 */
export function createMulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a stable 32-bit integer seed from trackKey and lyric lines.
 */
export function computeStableSeed(trackKey: string, lines: ParsedLyricLine[]): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < trackKey.length; i++) {
    h = Math.imul(h ^ trackKey.charCodeAt(i), 16777619);
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    h = Math.imul(h ^ (l.text.length + Math.round(l.timeMs)), 16777619);
    for (let c = 0; c < Math.min(10, l.text.length); c++) {
      h = Math.imul(h ^ l.text.charCodeAt(c), 16777619);
    }
  }
  return h >>> 0;
}

/**
 * Estimates presentation duration for a lyric line based on reliable timestamps,
 * inline word timings, or conservative line presentation timing for line-only lyrics.
 */
export function getLinePresentationDuration(
  lines: ParsedLyricLine[],
  index: number,
): number {
  const line = lines[index];
  if (!line) return 3000;

  // 1. If next line exists with a forward timestamp
  const nextLine = index + 1 < lines.length ? lines[index + 1] : null;
  if (nextLine && nextLine.timeMs > line.timeMs) {
    const interval = nextLine.timeMs - line.timeMs;
    // Normal singing gap: presentation span is the interval up to 10s
    if (interval <= 10000) {
      return interval;
    }
    // If there is an instrumental gap (> 10s), conservative lyric line presentation duration
    return Math.max(2500, Math.min(8000, Math.round(line.text.length * 75)));
  }

  // 2. If line has inline word timings (word-timed lyrics)
  if (line.inlineWords && line.inlineWords.length > 0) {
    const lastWord = line.inlineWords[line.inlineWords.length - 1]!;
    if (lastWord.timeMs > line.timeMs) {
      return Math.max(2000, (lastWord.timeMs - line.timeMs) + 600);
    }
  }

  // 3. Line-only or last line fallback (conservative estimated line presentation timing)
  return Math.max(2500, Math.min(5000, Math.round(line.text.length * 75)));
}

/**
 * Generates the full conversational plan for a track's lyrics.
 *
 * Rules:
 * 1. Maximum 2 consecutive messages per participant (1 or 2 messages).
 * 2. Short A-B-A-B sequences are allowed and natural.
 * 3. Continuous A-B-A-B alternation is interrupted before reaching 25 seconds.
 * 4. Timing is computed along the lyric presentation timeline.
 * 5. Alternation resumes naturally after the variation.
 */
export function generateChatConversationPlan(
  trackKey: string,
  lines: ParsedLyricLine[],
  options?: {
    seed?: number;
    assignEmojis?: (messages: ChatPlannedMessage[]) => void;
  },
): ChatConversationPlan {
  const seed = options?.seed ?? computeStableSeed(trackKey, lines);
  const prng = createMulberry32(seed);

  const messages: ChatPlannedMessage[] = [];
  const messageByLineIndex = new Map<number, ChatPlannedMessage>();

  if (!lines.length) {
    return { trackKey, messages, messageByLineIndex };
  }

  const isTimeSynced = lines.some((l, idx) => idx > 0 && l.timeMs > lines[0]!.timeMs);

  // Choose starting participant side randomly (0 = Left, 1 = Right)
  let currentSide: ChatParticipantSide = prng() < 0.5 ? 'left' : 'right';
  let lineIdx = 0;
  let groupId = 0;

  // Alternation duration tracking along the lyric presentation timeline
  let consecutiveSingleBursts = 0;
  let alternatingStartTimeMs = -1;
  let lastLinePresentationEndMs = -1;
  let simulatedTimelineMs = 0;

  while (lineIdx < lines.length) {
    const currentLine = lines[lineIdx]!;
    const currentLineDuration = getLinePresentationDuration(lines, lineIdx);
    const lineStartMs = isTimeSynced ? currentLine.timeMs : simulatedTimelineMs;
    const lineEndMs = lineStartMs + currentLineDuration;

    // If an instrumental gap (> 10s) occurred since the previous line,
    // the conversation naturally paused, resetting the active alternation sequence.
    if (lastLinePresentationEndMs >= 0 && lineStartMs - lastLinePresentationEndMs > 10000) {
      consecutiveSingleBursts = 0;
      alternatingStartTimeMs = -1;
    }

    // Determine projected duration of continuous A-B-A-B alternation if this burst were single
    const projectedAlternatingStart = consecutiveSingleBursts > 0 ? alternatingStartTimeMs : lineStartMs;
    const projectedAlternatingEnd = lineEndMs;
    const projectedAlternatingDuration = projectedAlternatingEnd - projectedAlternatingStart;

    const remaining = lines.length - lineIdx;

    // Continuous rigid A-B-A-B alternation must NOT persist for 25 seconds or longer.
    // Interrupt before reaching 25.0s (25000ms).
    const MUST_INTERRUPT_ALTERNATION =
      consecutiveSingleBursts >= 1 &&
      remaining >= 2 &&
      projectedAlternatingDuration >= 24500;

    let burstLength: number;
    if (MUST_INTERRUPT_ALTERNATION) {
      // Force variation: current participant sends 2 consecutive messages
      burstLength = 2;
    } else if (remaining === 1) {
      burstLength = 1;
    } else {
      // Natural pseudo-random choice: 1 or 2 messages
      burstLength = prng() < 0.5 ? 1 : 2;
    }

    // Update alternation tracking state
    if (burstLength === 1) {
      if (consecutiveSingleBursts === 0) {
        alternatingStartTimeMs = lineStartMs;
      }
      consecutiveSingleBursts++;
      lastLinePresentationEndMs = lineEndMs;
      simulatedTimelineMs += currentLineDuration;
    } else {
      // Burst length is 2: variation occurred! One participant sends two consecutive messages.
      // Continuous A-B-A-B alternation is interrupted.
      consecutiveSingleBursts = 0;
      alternatingStartTimeMs = -1;
      const dur2 = getLinePresentationDuration(lines, lineIdx + 1);
      const line2Start = isTimeSynced ? lines[lineIdx + 1]!.timeMs : (simulatedTimelineMs + currentLineDuration);
      lastLinePresentationEndMs = line2Start + dur2;
      simulatedTimelineMs += currentLineDuration + dur2;
    }

    // Group the messages in this burst
    for (let b = 0; b < burstLength; b++) {
      const line = lines[lineIdx]!;
      let groupPosition: ChatGroupPosition = 'single';
      if (burstLength === 1) {
        groupPosition = 'single';
      } else if (b === 0) {
        groupPosition = 'first';
      } else {
        groupPosition = 'last';
      }

      const msg: ChatPlannedMessage = {
        lineIndex: lineIdx,
        side: currentSide,
        groupPosition,
        groupId,
        burstLength,
        timeMs: line.timeMs,
        text: line.text,
      };

      messages.push(msg);
      messageByLineIndex.set(lineIdx, msg);
      lineIdx++;
    }

    // Switch participant side for next burst
    currentSide = currentSide === 'left' ? 'right' : 'left';
    groupId++;
  }

  // Assign contextual emojis if callback provided
  if (options?.assignEmojis) {
    options.assignEmojis(messages);
  }

  return { trackKey, messages, messageByLineIndex };
}

/**
 * Inexpensive content signature that detects when lyric data changes:
 * captures line count, character sample sum, first line time/text, middle line time/text, and last line time/text.
 * Cost is O(1) (< 0.001 ms) and allocates only a tiny string.
 */
export function computeLyricContentSignature(lines: ParsedLyricLine[] | undefined | null): string {
  if (!lines || lines.length === 0) {
    return '0:empty';
  }
  const len = lines.length;
  const first = lines[0]!;
  const mid = lines[Math.floor(len / 2)]!;
  const last = lines[len - 1]!;
  let charSum = 0;
  const sampleCount = Math.min(len, 8);
  for (let i = 0; i < sampleCount; i++) {
    charSum += lines[i]!.text.length;
  }
  return `${len}:${charSum}:${first.timeMs}:${first.text.slice(0, 16)}:${mid.timeMs}:${mid.text.slice(0, 16)}:${last.timeMs}:${last.text.slice(0, 16)}`;
}

// In-memory plan cache per trackKey
const planCache = new Map<string, ChatConversationPlan>();

export function getOrGenerateChatPlan(
  trackKey: string,
  lines: ParsedLyricLine[],
  assignEmojis?: (messages: ChatPlannedMessage[]) => void,
  signature?: string,
): ChatConversationPlan {
  const sig = signature ?? computeLyricContentSignature(lines);
  const cached = planCache.get(trackKey);
  if (
    cached &&
    cached.messages.length === lines.length &&
    cached.signature === sig &&
    (lines.length === 0 || cached.messages.length > 0)
  ) {
    return cached;
  }

  const plan = generateChatConversationPlan(trackKey, lines, { assignEmojis });
  plan.signature = sig;
  planCache.set(trackKey, plan);
  return plan;
}

export function clearChatPlanCache(): void {
  planCache.clear();
}
