import assert from "node:assert/strict";
import test from "node:test";
import {
  computeEffectivePositionMs,
  findActiveLyricIndex,
  findNextNonBlankLyricIndex,
} from "./lyricsSync.ts";
import { parseLrc } from "./parseLrc.ts";

const SAMPLE_LINES = parseLrc(`
[00:10.00]Line one
[00:20.00]Line two
[00:30.00]
[00:35.00]Line four
`).lines;

test("extrapolates playing timeline and freezes cleanly when paused or disconnected", () => {
  const playingPos = computeEffectivePositionMs(
    {
      connectionState: "connected",
      playbackStatus: "playing",
      positionMs: 19_500,
      durationMs: 60_000,
      timeline: null,
    },
    1000,
    1700,
  );
  assert.equal(playingPos, 20_200);

  const pausedPos = computeEffectivePositionMs(
    {
      connectionState: "connected",
      playbackStatus: "paused",
      positionMs: 19_500,
      durationMs: 60_000,
      timeline: null,
    },
    1000,
    5000,
  );
  assert.equal(pausedPos, 19_500);

  const closedPos = computeEffectivePositionMs(
    {
      connectionState: "notDetected",
      playbackStatus: "closed",
      positionMs: 19_500,
      durationMs: 60_000,
      timeline: null,
    },
    1000,
    5000,
  );
  assert.equal(closedPos, null);
});

test("finds active index accurately across forward seeks, backward seeks, and blank intervals", () => {
  assert.equal(findActiveLyricIndex(SAMPLE_LINES, 5_000, 0), -1);
  assert.equal(findActiveLyricIndex(SAMPLE_LINES, 10_500, 0), 0);

  // Seek forward to Line four
  assert.equal(findActiveLyricIndex(SAMPLE_LINES, 36_000, 0), 3);

  // Seek backward to Line two
  assert.equal(findActiveLyricIndex(SAMPLE_LINES, 21_000, 0), 1);

  // Next non-blank skips blank instrumental marker at index 2
  assert.equal(findNextNonBlankLyricIndex(SAMPLE_LINES, 1), 3);
});
