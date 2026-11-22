import assert from "node:assert/strict";
import test from "node:test";
import { parseLrc, splitPlainLyrics } from "./parseLrc.ts";

test("parses standard [mm:ss.xx], [mm:ss.xxx], [hh:mm:ss.xx], and [mm:ss] timestamps", () => {
  const input = `
[00:12.50]First line
[00:17.255]Second line with millis
[01:05]Third line without fraction
[01:02:03.40]Hour format line
`;
  const doc = parseLrc(input);
  assert.equal(doc.hasSyncedLines, true);
  assert.equal(doc.lines.length, 4);
  assert.deepEqual(
    doc.lines.map((l) => ({ timeMs: l.timeMs, text: l.text })),
    [
      { timeMs: 12_500, text: "First line" },
      { timeMs: 17_255, text: "Second line with millis" },
      { timeMs: 65_000, text: "Third line without fraction" },
      { timeMs: 3_723_400, text: "Hour format line" },
    ],
  );
});

test("expands multi-timestamp chorus lines and sorts lines chronologically", () => {
  const input = `
[01:45.20][00:32.10]Chorus line repeated
[00:15.00]Opening verse
[not-a-timestamp]Malformed junk ignored
Random plain text inside lrc ignored safely
`;
  const doc = parseLrc(input);
  assert.equal(doc.lines.length, 3);
  assert.deepEqual(
    doc.lines.map((l) => [l.timeMs, l.text]),
    [
      [15_000, "Opening verse"],
      [32_100, "Chorus line repeated"],
      [105_200, "Chorus line repeated"],
    ],
  );
});

test("preserves Telugu, Hindi, and multilingual Unicode characters without corruption", () => {
  const teluguChorus = "నాటు నాటు నాటు నాటు నాటు నాటు వీర నాటు";
  const hindiLine = "तुम ही हो अब तुम ही हो";
  const input = `\uFEFF[ti:Naatu Naatu]
[ar:Rahul Sipligunj]
[00:08.50]${teluguChorus}
[00:14.00]${hindiLine}
[00:20.00]
`;
  const doc = parseLrc(input);
  assert.equal(doc.metadata.title, "Naatu Naatu");
  assert.equal(doc.metadata.artist, "Rahul Sipligunj");
  assert.equal(doc.lines.length, 3);
  assert.equal(doc.lines[0].text, teluguChorus);
  assert.equal(doc.lines[1].text, hindiLine);
  assert.equal(doc.lines[2].isBlank, true);
  assert.equal(doc.lines[2].text, "");
});

test("applies valid [offset] tag and rejects out-of-range seconds safely", () => {
  const input = `
[offset:500]
[00:10.00]Shifted earlier
[00:00.20]Clamped at zero
[00:75.00]Invalid seconds ignored
`;
  const doc = parseLrc(input);
  assert.equal(doc.metadata.offsetMs, 500);
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].timeMs, 0);
  assert.equal(doc.lines[0].text, "Clamped at zero");
  assert.equal(doc.lines[1].timeMs, 9500);
  assert.equal(doc.lines[1].text, "Shifted earlier");
});

test("handles empty inputs and splits plain lyrics cleanly", () => {
  assert.deepEqual(parseLrc("").lines, []);
  assert.equal(parseLrc(null).hasSyncedLines, false);
  assert.deepEqual(splitPlainLyrics("Line 1\r\n\r\nనాటు నాటు"), ["Line 1", "", "నాటు నాటు"]);
});
