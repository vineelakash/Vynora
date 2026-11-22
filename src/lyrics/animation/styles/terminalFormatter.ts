/**
 * Terminal Style Formatting & Syntax Tokenizer Engine.
 *
 * Implements code-editor inspired formatting around original lyric text:
 * - Natural programming punctuation ([], {}, (), <>, "", //, =>, ;, ...)
 * - Subtle line numbering (01, 02, ...)
 * - Natural 2-space and 4-space visual indentation
 * - Unicode-safe grapheme clustering for Telugu, Hindi, and English
 * - ZERO executable code or programming keywords (no const, let, function, etc.)
 * - 100% preservation of original lyric content and word order
 */

import type { TimedWord } from '../animationTypes.ts';

export interface TerminalLineFormat {
  lineNum: string;       // "01", "02", ...
  indent: string;        // "  " (2 spaces) or "    " (4 spaces)
  prefix: string;        // Opening decorative symbols (e.g. "[ ", "{ ", "\"", "< ")
  body: string;          // Original raw lyric line text (completely untouched)
  suffix: string;        // Closing decorative symbols (e.g. "... ]", "; }", "\"")
  patternIndex: number;
}

export interface TerminalSyntaxTokens {
  lineNum: string;
  indent: string;
  prefix: string;
  revealedBody: string;
  unrevealedBody: string;
  suffix: string;
  isCompleted: boolean;
  totalGraphemes: number;
  revealedGraphemes: number;
}

export interface TerminalPattern {
  indent: string;
  prefix: string;
  suffix: string;
}

/**
 * 8 balanced, deterministic code-editor syntax patterns.
 * strictly decorative symbols only — NO programming keywords or logic.
 */
export const TERMINAL_PATTERNS: readonly TerminalPattern[] = [
  { indent: '  ', prefix: '[ ', suffix: '... ]' },
  { indent: '    ', prefix: '{ ', suffix: '; }' },
  { indent: '  ', prefix: '"', suffix: '"' },
  { indent: '    ', prefix: '( ', suffix: ' );' },
  { indent: '  ', prefix: '< ', suffix: '... >' },
  { indent: '    ', prefix: '[ ', suffix: ' ];' },
  { indent: '  ', prefix: '// ', suffix: '' },
  { indent: '    ', prefix: '=> { ', suffix: ' }' },
] as const;

/**
 * Unicode-safe grapheme cluster segmentation.
 * Preserves Telugu matras/viramas and Hindi Devanagari conjuncts as atomic units.
 */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    try {
      const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), (s: any) => s.segment as string);
    } catch {
      // Fallback if Segmenter throws
    }
  }
  return Array.from(text);
}

/**
 * Formats a raw lyric line into a structured Terminal line with line number and syntax brackets.
 * The original text is preserved without alteration.
 */
export function formatTerminalLine(rawText: string, lineIndex: number): TerminalLineFormat {
  const safeIndex = Math.max(0, lineIndex);
  const lineNum = String(safeIndex + 1).padStart(2, '0');
  const patternIndex = safeIndex % TERMINAL_PATTERNS.length;
  const pattern = TERMINAL_PATTERNS[patternIndex]!;

  return {
    lineNum,
    indent: pattern.indent,
    prefix: pattern.prefix,
    body: rawText,
    suffix: pattern.suffix,
    patternIndex,
  };
}

/**
 * Evaluates progressive character-by-character typing for a line.
 *
 * @param format Formatted terminal line structure
 * @param lineProgress Overall line progress (0.0 .. 1.0)
 * @param words Optional array of timed words for word-synchronized typing
 * @param activeWordIndex Currently active singing word index
 * @param activeWordProgress Progress within active word (0.0 .. 1.0)
 * @param isPrecedingCompleted If true, line is fully typed (for preceding line in slot 0)
 */
export function computeTerminalTokens(
  format: TerminalLineFormat,
  lineProgress: number,
  words?: TimedWord[],
  activeWordIndex = -1,
  activeWordProgress = 0,
  isPrecedingCompleted = false,
): TerminalSyntaxTokens {
  const bodyGraphemes = splitGraphemes(format.body);
  const totalGraphemes = bodyGraphemes.length;

  if (isPrecedingCompleted || lineProgress >= 0.99) {
    return {
      lineNum: format.lineNum,
      indent: format.indent,
      prefix: format.prefix,
      revealedBody: format.body,
      unrevealedBody: '',
      suffix: format.suffix,
      isCompleted: true,
      totalGraphemes,
      revealedGraphemes: totalGraphemes,
    };
  }

  let revealedCount = 0;

  if (words && words.length > 0 && activeWordIndex >= 0) {
    // Word-synchronized mode: typing advances with singer's vocal delivery
    let count = 0;
    for (let i = 0; i <= activeWordIndex && i < words.length; i++) {
      const w = words[i]!;
      const wGraphemes = splitGraphemes(w.text);
      if (i < activeWordIndex) {
        count += wGraphemes.length;
        if (i < words.length - 1) {
          count += 1; // Inter-word space
        }
      } else {
        // Current active word
        const activeWordChars = Math.min(
          wGraphemes.length,
          Math.max(0, Math.floor(activeWordProgress * (wGraphemes.length + 0.2))),
        );
        count += activeWordChars;
      }
    }
    revealedCount = Math.min(totalGraphemes, count);
  } else {
    // Line-only mode: typing progresses across active singing duration (~85% of interval)
    const activeSingingProgress = Math.min(1.0, Math.max(0.0, lineProgress / 0.85));
    revealedCount = Math.min(totalGraphemes, Math.floor(activeSingingProgress * totalGraphemes));
  }

  const revealedBody = bodyGraphemes.slice(0, revealedCount).join('');
  const unrevealedBody = bodyGraphemes.slice(revealedCount).join('');
  const isCompleted = revealedCount >= totalGraphemes;
  const suffix = isCompleted ? format.suffix : '';

  return {
    lineNum: format.lineNum,
    indent: format.indent,
    prefix: format.prefix,
    revealedBody,
    unrevealedBody,
    suffix,
    isCompleted,
    totalGraphemes,
    revealedGraphemes: revealedCount,
  };
}
