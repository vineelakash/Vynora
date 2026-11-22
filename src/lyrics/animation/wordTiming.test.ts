import assert from "node:assert/strict";
import test from "node:test";
import {
  tokenizeWordsUnicode,
  evaluateTimingFeasibility,
  getEstimatedWordsForLine,
  resolveLineTimingContext,
  clearWordTimingCache,
} from "./wordTiming.ts";
import type { ParsedLyricLine } from "../../types/lyrics.ts";

test("word timing: Unicode tokenization preserves Telugu graphemes without splitting viramas/matras", () => {
  const teluguLine = "వెళ్ళకే వెళ్ళకే నన్ను వదిలి";
  const tokens = tokenizeWordsUnicode(teluguLine);
  assert.equal(tokens.length, 4);
  assert.equal(tokens[0]!.text, "వెళ్ళకే");
  assert.equal(tokens[1]!.text, "వెళ్ళకే");
  assert.equal(tokens[2]!.text, "నన్ను");
  assert.equal(tokens[3]!.text, "వదిలి");
});

test("word timing: Unicode tokenization preserves Hindi Devanagari conjuncts and matras", () => {
  const hindiLine = "केसरिया तेरा इश्क है पिया।";
  const tokens = tokenizeWordsUnicode(hindiLine);
  assert.equal(tokens.length, 5);
  assert.equal(tokens[0]!.text, "केसरिया");
  assert.equal(tokens[1]!.text, "तेरा");
  assert.equal(tokens[2]!.text, "इश्क");
  assert.equal(tokens[3]!.text, "है");
  assert.equal(tokens[4]!.text, "पिया");
  assert.equal(tokens[4]!.trailingPunctuation, "।");
});

test("word timing: handles mixed-language lyrics with English, Telugu and Hindi", () => {
  const mixedLine = "Yeah, నువ్వు and मैं forever!";
  const tokens = tokenizeWordsUnicode(mixedLine);
  assert.equal(tokens.length, 5);
  assert.equal(tokens[0]!.text, "Yeah");
  assert.equal(tokens[0]!.trailingPunctuation, ",");
  assert.equal(tokens[1]!.text, "నువ్వు");
  assert.equal(tokens[2]!.text, "and");
  assert.equal(tokens[3]!.text, "मैं");
  assert.equal(tokens[4]!.text, "forever");
  assert.equal(tokens[4]!.trailingPunctuation, "!");
});

test("word timing: handles very short and very long lyric lines safely", () => {
  const shortTokens = tokenizeWordsUnicode("Oh");
  assert.equal(shortTokens.length, 1);
  assert.equal(shortTokens[0]!.text, "Oh");

  const longLine = "This is an extremely long lyric line containing numerous rapid poetic verses that spans well across multiple sentences without stopping for any breath.";
  const longTokens = tokenizeWordsUnicode(longLine);
  assert.ok(longTokens.length >= 20);
});

test("word timing: evaluates timing feasibility and confidence classification", () => {
  // Normal singing line: 4 words, 20 chars, 3500ms interval -> high confidence
  const norm = evaluateTimingFeasibility(20, 4, 3500);
  assert.equal(norm.confidence, "high");
  assert.equal(norm.plausible, true);

  // Extremely fast / implausible line: 80 chars in 1000ms (80 chars/s) -> low confidence
  const fast = evaluateTimingFeasibility(80, 15, 1000);
  assert.equal(fast.confidence, "low");
  assert.equal(fast.plausible, false);

  // Extremely long interval (e.g. 30s instrumental pause) -> low confidence
  const longPause = evaluateTimingFeasibility(10, 2, 30000);
  assert.equal(longPause.confidence, "low");
  assert.equal(longPause.plausible, false);

  // Extremely tight interval (< 400ms) -> low confidence
  const tight = evaluateTimingFeasibility(10, 2, 250);
  assert.equal(tight.confidence, "low");
  assert.equal(tight.plausible, false);
});

test("word timing: falls back to line-only when confidence is low or interval is extreme", () => {
  clearWordTimingCache();
  const line: ParsedLyricLine = { id: "l1", timeMs: 1000, text: "Wait" };
  const nextLine: ParsedLyricLine = { id: "l2", timeMs: 40000, text: "Next after solo" };

  const result = getEstimatedWordsForLine(line, 0, nextLine, "test-track");
  assert.equal(result.confidence, "low");
  assert.equal(result.mode, "line-only");
  assert.equal(result.words.length, 0);
});

test("word timing: never claims estimated timing is actual", () => {
  clearWordTimingCache();
  const line: ParsedLyricLine = { id: "l1", timeMs: 2000, text: "I said ooh I am blinded by the lights" };
  const nextLine: ParsedLyricLine = { id: "l2", timeMs: 6500, text: "No I cannot sleep" };

  const result = getEstimatedWordsForLine(line, 0, nextLine, "sample");
  assert.notEqual(result.mode, "actual");
  assert.equal(result.mode, "estimated");
  assert.ok(result.words.length > 0);
  assert.equal(result.confidence, "high");
});

test("word timing: resolveLineTimingContext accurately reconstructs active word on seek", () => {
  clearWordTimingCache();
  const lines: ParsedLyricLine[] = [
    { id: "1", timeMs: 1000, text: "First line of the song" },
    { id: "2", timeMs: 5000, text: "Second line of the song" },
    { id: "3", timeMs: 9000, text: "Third line of the song" },
  ];

  // At 1000ms: active line index 0, first word active
  const ctxAtStart = resolveLineTimingContext(lines, 0, 1050, "test");
  assert.equal(ctxAtStart.lineIndex, 0);
  assert.equal(ctxAtStart.activeWordIndex, 0);
  assert.ok(ctxAtStart.activeWordProgress >= 0 && ctxAtStart.activeWordProgress <= 1);

  // Seek forward to 3000ms (still within line 0, but later word)
  const ctxMid = resolveLineTimingContext(lines, 0, 3000, "test");
  assert.equal(ctxMid.lineIndex, 0);
  assert.ok(ctxMid.activeWordIndex >= 2);

  // Seek backwards to line 0 start
  const ctxBack = resolveLineTimingContext(lines, 0, 1020, "test");
  assert.equal(ctxBack.activeWordIndex, 0);
});
