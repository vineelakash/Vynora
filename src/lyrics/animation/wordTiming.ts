/**
 * Word Timing Engine with Unicode Segmentation, Conservative Weighting & Confidence Scoring.
 *
 * Implements:
 * - Deterministic word timing based on word length, character weights, and punctuation.
 * - Non-uniform singing duration bounds (no fixed 18% breath gap; avoids assuming the whole interval is sung).
 * - Multi-mode support: 'actual' | 'estimated' | 'line-only'.
 * - Timing confidence classification: 'high' | 'medium' | 'low'.
 * - Automatic fallback to 'line-only' when confidence is low or intervals/rates are implausible.
 * - Robust Unicode support for Telugu (తెలుగు), Hindi (हिन्दी), and English scripts.
 */

import type { ParsedLyricLine } from '../../types/lyrics.ts';
import type { LineTimingContext, TimedWord, TimingConfidence, TimingMode } from './animationTypes.ts';

// Cache for tokenized lines to avoid re-parsing on every animation frame
const wordCache = new Map<string, { words: TimedWord[]; confidence: TimingConfidence; mode: TimingMode }>();

/**
 * Unicode-aware tokenization using Intl.Segmenter with regex fallback.
 * Preserves Indic grapheme clusters (Telugu, Hindi matras, viramas) and punctuation.
 */
export function tokenizeWordsUnicode(text: string): Array<{ text: string; trailingPunctuation?: string; leadingSpace?: boolean }> {
  if (!text || !text.trim()) {
    return [];
  }

  const results: Array<{ text: string; trailingPunctuation?: string; leadingSpace?: boolean }> = [];

  // Use Intl.Segmenter if supported by browser/runtime
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      const segments = Array.from(segmenter.segment(text));

      let pendingWord: string | null = null;
      let pendingSpace = false;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        if (seg.isWordLike) {
          if (pendingWord !== null) {
            results.push({ text: pendingWord, leadingSpace: pendingSpace });
            pendingSpace = false;
          }
          pendingWord = seg.segment;
        } else if (pendingWord !== null) {
          // Check for punctuation immediately following the word
          const trimmed = seg.segment.trim();
          if (trimmed.length > 0 && /^[.,!?:;'"—–\-|।॥]+$/.test(trimmed)) {
            results.push({
              text: pendingWord,
              trailingPunctuation: trimmed,
              leadingSpace: pendingSpace,
            });
            pendingWord = null;
            pendingSpace = false;
          } else if (seg.segment.includes(' ') || seg.segment.includes('\t')) {
            results.push({ text: pendingWord, leadingSpace: pendingSpace });
            pendingWord = null;
            pendingSpace = true;
          }
        } else if (seg.segment.includes(' ') || seg.segment.includes('\t')) {
          pendingSpace = true;
        }
      }

      if (pendingWord !== null) {
        results.push({ text: pendingWord, leadingSpace: pendingSpace });
      }

      if (results.length > 0) {
        return results;
      }
    } catch {
      // Fall through to regex if segmenter fails
    }
  }

  // Safe Unicode fallback: splits on whitespace without tearing Indic diacritics
  const tokens = text.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    // Match word content and optional trailing punctuation including Danda (|)
    const match = raw.match(/^([^\s.,!?:;'"—–\-|।॥]+)([.,!?:;'"—–\-|।॥]*)$/u);
    if (match) {
      results.push({
        text: match[1] ?? raw,
        trailingPunctuation: match[2] || undefined,
        leadingSpace: i > 0,
      });
    } else {
      results.push({ text: raw, leadingSpace: i > 0 });
    }
  }

  return results;
}

/**
 * Calculates punctuation weight bonus.
 */
function getPunctuationBonus(punct?: string): number {
  if (!punct) return 0;
  if (/^[.,!?;:|।॥]$/.test(punct)) {
    if (punct === ',' || punct === ';') return 2.0;
    if (punct === '.' || punct === '!' || punct === '?' || punct === '।') return 4.0;
    return 1.5;
  }
  return 1.0;
}

/**
 * Evaluates timing confidence and plausible singing duration without assuming fixed 18% breath gap.
 */
export function evaluateTimingFeasibility(
  charCount: number,
  wordCount: number,
  intervalMs: number,
): { confidence: TimingConfidence; plausible: boolean } {
  if (charCount <= 0 || wordCount <= 0) {
    return { confidence: 'low', plausible: false };
  }

  // Implausible interval extremes: < 400ms or > 20000ms
  if (intervalMs < 400 || intervalMs > 20000) {
    return { confidence: 'low', plausible: false };
  }

  const seconds = intervalMs / 1000;
  const charsPerSec = charCount / seconds;

  // Extreme rate bounds: vocal music is rarely < 1.0 chars/sec (without long instrumental pause) or > 16.0 chars/sec
  if (charsPerSec < 0.9 || charsPerSec > 16.0) {
    return { confidence: 'low', plausible: false };
  }

  // High confidence conditions
  if (intervalMs >= 1000 && intervalMs <= 9000 && charsPerSec >= 2.2 && charsPerSec <= 9.5 && wordCount >= 2) {
    return { confidence: 'high', plausible: true };
  }

  // Medium confidence conditions
  if (intervalMs >= 600 && intervalMs <= 15000 && charsPerSec >= 1.2 && charsPerSec <= 13.0) {
    return { confidence: 'medium', plausible: true };
  }

  return { confidence: 'low', plausible: false };
}

/**
 * Estimates singing duration conservatively based on syllable/character length and punctuation pauses.
 * Avoids assuming the entire line interval represents continuous singing.
 */
function computeConservativeSingingDuration(
  totalWeight: number,
  intervalMs: number,
  punctBonusTotal: number,
): number {
  // Base phoneme duration estimation: average 190ms per character unit + 250ms per punctuation unit
  const estimatedPhonemeDurationMs = Math.round(totalWeight * 190 + punctBonusTotal * 250);

  // If interval is tight, singing may fill up to interval minus a short 200ms transition
  const minIntervalTransition = intervalMs > 2500 ? 500 : 200;
  const maxPossibleSingingMs = Math.max(400, intervalMs - minIntervalTransition);

  // Take the minimum of estimated vocalization duration and maximum possible interval duration
  // Bound from below at 500ms (or intervalMs if shorter)
  return Math.min(maxPossibleSingingMs, Math.max(Math.min(500, intervalMs), estimatedPhonemeDurationMs));
}

/**
 * Builds or retrieves estimated TimedWord array for a lyric line.
 */
export function getEstimatedWordsForLine(
  line: ParsedLyricLine,
  lineIndex: number,
  nextLine: ParsedLyricLine | null,
  trackKey = 'default',
): { words: TimedWord[]; confidence: TimingConfidence; mode: TimingMode } {
  const cacheKey = `${trackKey}::${line.id}::${line.timeMs}::${line.text}`;
  const cached = wordCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Exact inline word timestamps from LRC (actual karaoke timing)
  if (line.inlineWords && line.inlineWords.length > 0) {
    const lineStartMs = line.timeMs;
    let lineEndMs = lineStartMs + 3800;
    if (nextLine && nextLine.timeMs > lineStartMs) {
      lineEndMs = nextLine.timeMs;
    }

    const words: TimedWord[] = [];
    for (let i = 0; i < line.inlineWords.length; i++) {
      const current = line.inlineWords[i]!;
      const startMs = current.timeMs;
      let nextStart = i + 1 < line.inlineWords.length ? line.inlineWords[i + 1]!.timeMs : lineEndMs;
      if (nextStart <= startMs) {
        nextStart = startMs + 300;
      }
      const dur = Math.max(60, nextStart - startMs);
      const endMs = startMs + dur;

      words.push({
        id: `${line.id}-actual-w${i}`,
        text: current.text,
        startMs,
        endMs,
        durationMs: dur,
        index: i,
        lineIndex,
        leadingSpace: i > 0,
      });
    }

    const actualResult = {
      words,
      confidence: 'high' as TimingConfidence,
      mode: 'actual' as TimingMode,
    };
    wordCache.set(cacheKey, actualResult);
    return actualResult;
  }

  const rawTokens = tokenizeWordsUnicode(line.text);
  if (rawTokens.length === 0) {
    const emptyResult = { words: [], confidence: 'low' as TimingConfidence, mode: 'line-only' as TimingMode };
    wordCache.set(cacheKey, emptyResult);
    return emptyResult;
  }

  // Calculate line interval
  const lineStartMs = line.timeMs;
  let intervalMs = 3800; // Realistic default if last line
  if (nextLine && nextLine.timeMs > lineStartMs) {
    intervalMs = nextLine.timeMs - lineStartMs;
  }

  // Unicode-safe total character count
  let totalChars = 0;
  for (const t of rawTokens) {
    totalChars += Array.from(t.text).length;
  }

  // Feasibility & confidence check
  const { confidence, plausible } = evaluateTimingFeasibility(totalChars, rawTokens.length, intervalMs);

  // If timing is implausible or confidence is low, fall back directly to line-only
  if (!plausible || confidence === 'low') {
    const fallbackResult = {
      words: [],
      confidence: 'low' as TimingConfidence,
      mode: 'line-only' as TimingMode,
    };
    wordCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  // Calculate weights
  const weights: number[] = [];
  let totalWeight = 0;
  let totalPunctBonus = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i]!;
    const charLen = Array.from(tok.text).length;
    const punctBonus = getPunctuationBonus(tok.trailingPunctuation);
    totalPunctBonus += punctBonus;
    const weight = Math.max(1.0, charLen + punctBonus);
    weights.push(weight);
    totalWeight += weight;
  }

  const singingDurationMs = computeConservativeSingingDuration(totalWeight, intervalMs, totalPunctBonus);

  const words: TimedWord[] = [];
  let currentOffsetMs = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i]!;
    const w = weights[i] ?? 1;
    const wordDur = Math.max(80, Math.round((w / totalWeight) * singingDurationMs));
    const startMs = lineStartMs + currentOffsetMs;
    const endMs = startMs + wordDur;

    words.push({
      id: `${line.id}-w${i}`,
      text: tok.text,
      startMs,
      endMs,
      durationMs: wordDur,
      index: i,
      lineIndex,
      trailingPunctuation: tok.trailingPunctuation,
      leadingSpace: tok.leadingSpace,
    });

    currentOffsetMs += wordDur;
  }

  const result = {
    words,
    confidence,
    mode: 'estimated' as TimingMode,
  };

  wordCache.set(cacheKey, result);
  return result;
}

/**
 * Resolves the complete LineTimingContext for the current playback position.
 */
export function resolveLineTimingContext(
  lines: ParsedLyricLine[],
  lineIndex: number,
  positionMs: number | null,
  trackKey = 'default',
): LineTimingContext {
  if (lineIndex < 0 || lineIndex >= lines.length || positionMs === null || !lines[lineIndex]) {
    return {
      lineIndex: -1,
      lineText: '',
      lineStartMs: 0,
      lineEndMs: 0,
      words: [],
      activeWordIndex: -1,
      activeWordProgress: 0,
      lineProgress: 0,
      mode: 'line-only',
      confidence: 'low',
    };
  }

  const currentLine = lines[lineIndex]!;
  const prevLine = lineIndex > 0 ? lines[lineIndex - 1] : null;
  const nextLine = lineIndex + 1 < lines.length ? lines[lineIndex + 1] : null;

  const lineStartMs = currentLine.timeMs;
  const lineEndMs = nextLine ? nextLine.timeMs : lineStartMs + 4000;
  const lineDuration = Math.max(1, lineEndMs - lineStartMs);
  const lineProgress = Math.max(0, Math.min(1, (positionMs - lineStartMs) / lineDuration));

  // Retrieve word timing
  const { words, confidence, mode } = getEstimatedWordsForLine(currentLine, lineIndex, nextLine, trackKey);

  let activeWordIndex = -1;
  let activeWordProgress = 0;

  if (words.length > 0 && mode !== 'line-only') {
    if (positionMs < words[0]!.startMs) {
      activeWordIndex = 0;
      activeWordProgress = 0;
    } else if (positionMs >= words[words.length - 1]!.endMs) {
      activeWordIndex = words.length - 1;
      activeWordProgress = 1.0;
    } else {
      for (let i = 0; i < words.length; i++) {
        const w = words[i]!;
        if (positionMs >= w.startMs && positionMs < w.endMs) {
          activeWordIndex = i;
          activeWordProgress = Math.max(0, Math.min(1, (positionMs - w.startMs) / Math.max(1, w.durationMs)));
          break;
        }
      }
    }
  }

  return {
    lineIndex,
    lineText: currentLine.text,
    lineStartMs,
    lineEndMs,
    words,
    activeWordIndex,
    activeWordProgress,
    lineProgress,
    mode,
    confidence,
    prevLineText: prevLine ? prevLine.text : undefined,
    nextLineText: nextLine ? nextLine.text : undefined,
  };
}

export function clearWordTimingCache(): void {
  wordCache.clear();
}
