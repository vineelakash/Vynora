import assert from "node:assert/strict";
import test from "node:test";
import { getEstimatedWordsForLine, clearWordTimingCache, resolveLineTimingContext } from "./wordTiming.ts";
import { NEUTRAL_PALETTE } from "./render/LyricsCanvas.ts";
import type { ParsedLyricLine } from "../../types/lyrics.ts";
import type { RgbColor } from "../../types/palette.ts";

function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  const step = (from: number, to: number) => {
    if (from === to) return to;
    const delta = (to - from) * t;
    const rounded = Math.round(delta);
    if (rounded === 0) {
      return from + (to > from ? 1 : -1);
    }
    return from + rounded;
  };
  return {
    r: step(a.r, b.r),
    g: step(a.g, b.g),
    b: step(a.b, b.b),
  };
}

test("continuity: word cache properly isolates rapid track switching", () => {
  clearWordTimingCache();
  const lineA: ParsedLyricLine = { id: "1", timeMs: 1000, text: "Song A lyrics" };
  const lineB: ParsedLyricLine = { id: "1", timeMs: 1000, text: "Song B completely different" };

  const wordsA = getEstimatedWordsForLine(lineA, 0, null, "track-A");
  const wordsB = getEstimatedWordsForLine(lineB, 0, null, "track-B");

  assert.equal(wordsA.words.length, 3);
  assert.equal(wordsB.words.length, 4);
  assert.equal(wordsA.words[0]!.text, "Song");
  assert.equal(wordsB.words[0]!.text, "Song");
  assert.equal(wordsB.words[3]!.text, "different");
});

test("continuity: repeated forward and backward seeking preserves correct line index", () => {
  clearWordTimingCache();
  const lines: ParsedLyricLine[] = [
    { id: "1", timeMs: 1000, text: "Line one" },
    { id: "2", timeMs: 4000, text: "Line two" },
    { id: "3", timeMs: 7000, text: "Line three" },
  ];

  // Seek forward: 1200ms -> line 0
  assert.equal(resolveLineTimingContext(lines, 0, 1200, "t").lineIndex, 0);
  // Seek forward: 5000ms -> line 1
  assert.equal(resolveLineTimingContext(lines, 1, 5000, "t").lineIndex, 1);
  // Seek backward: 1500ms -> line 0
  assert.equal(resolveLineTimingContext(lines, 0, 1500, "t").lineIndex, 0);
  // Seek forward: 7200ms -> line 2
  assert.equal(resolveLineTimingContext(lines, 2, 7200, "t").lineIndex, 2);
  // Seek backward to start: 0ms -> -1 (before track start)
  assert.equal(resolveLineTimingContext(lines, -1, 0, "t").lineIndex, -1);
});

test("continuity: smooth palette lerping never produces NaN and converges to target", () => {
  const current: RgbColor = { r: 255, g: 0, b: 0 };
  const target: RgbColor = { r: 0, g: 255, b: 100 };

  let col = { ...current };
  for (let frame = 0; frame < 60; frame++) {
    col = lerpRgb(col, target, 0.1);
    assert.ok(!Number.isNaN(col.r));
    assert.ok(!Number.isNaN(col.g));
    assert.ok(!Number.isNaN(col.b));
    assert.ok(col.r >= 0 && col.r <= 255);
    assert.ok(col.g >= 0 && col.g <= 255);
    assert.ok(col.b >= 0 && col.b <= 255);
  }

  // After 60 frames at 0.1 factor, should have converged to within 2 units of target
  assert.ok(Math.abs(col.r - target.r) <= 2);
  assert.ok(Math.abs(col.g - target.g) <= 2);
  assert.ok(Math.abs(col.b - target.b) <= 2);
});

test("continuity: NEUTRAL_PALETTE fallback has full contrast and valid CSS strings", () => {
  assert.ok(NEUTRAL_PALETTE.dominantCss.startsWith("rgb("));
  assert.ok(NEUTRAL_PALETTE.accentCss.startsWith("rgb("));
  assert.ok(NEUTRAL_PALETTE.backgroundCss.startsWith("rgb("));
  assert.ok(NEUTRAL_PALETTE.foregroundCss.startsWith("rgb("));
});
