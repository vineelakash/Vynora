import assert from "node:assert/strict";
import test from "node:test";
import { ConstellationStyle, hashToFloat } from "./styles/Constellation.ts";
import type { TimedWord } from "./animationTypes.ts";

test("constellation: spatial star distribution is deterministic and repeatable", () => {
  const style = new ConstellationStyle();
  const word: TimedWord = {
    id: "w-constellation",
    text: "Orion",
    startMs: 2000,
    endMs: 3000,
    durationMs: 1000,
    index: 1,
    lineIndex: 0,
  };

  const pos1 = style.evaluateStarPosition(word, 0, 5, 1920, 1080);
  const pos2 = style.evaluateStarPosition(word, 0, 5, 1920, 1080);

  assert.equal(pos1.x, pos2.x, "X coordinates must match across evaluations");
  assert.equal(pos1.y, pos2.y, "Y coordinates must match across evaluations");
  assert.ok(pos1.x > 0 && pos1.y > 0);
});

test("constellation: generates structural network lines connecting stars", () => {
  const style = new ConstellationStyle();
  const words: TimedWord[] = [
    { id: "w0", text: "Bright", startMs: 1000, endMs: 1500, durationMs: 500, index: 0, lineIndex: 0 },
    { id: "w1", text: "stars", startMs: 1500, endMs: 2000, durationMs: 500, index: 1, lineIndex: 0 },
    { id: "w2", text: "align", startMs: 2000, endMs: 2700, durationMs: 700, index: 2, lineIndex: 0 },
  ];

  const network = style.getConstellationNetwork(words, 0, 1920, 1080);
  assert.ok(network.stars.length >= words.length, "Must include all lyric stars plus background stars");
  assert.ok(network.lines.length >= words.length - 1, "Must include sequential connecting lines");

  // Verify connecting line endpoints connect adjacent star positions
  const line0 = network.lines[0]!;
  assert.equal(line0.from.x, network.lyricPositions[0]!.x);
  assert.equal(line0.from.y, network.lyricPositions[0]!.y);
  assert.equal(line0.to.x, network.lyricPositions[1]!.x);
  assert.equal(line0.to.y, network.lyricPositions[1]!.y);
});

test("constellation: visual hierarchy ensures active word is significantly larger (1.4x) than recent words (0.85x)", () => {
  const style = new ConstellationStyle();
  const words: TimedWord[] = [
    { id: "w0", text: "First", startMs: 1000, endMs: 1800, durationMs: 800, index: 0, lineIndex: 0 },
    { id: "w1", text: "Second", startMs: 1800, endMs: 2600, durationMs: 800, index: 1, lineIndex: 0 },
    { id: "w2", text: "Third", startMs: 2600, endMs: 3400, durationMs: 800, index: 2, lineIndex: 0 },
  ];

  // Evaluate at t = 2200 (Word 1 is active, Word 0 is recent/fading, Word 2 is upcoming)
  const s0 = style.getWordConstellationState(0, words, 2200, 1920, 1080, 0, 32);
  const s1 = style.getWordConstellationState(1, words, 2200, 1920, 1080, 0, 32);
  const s2 = style.getWordConstellationState(2, words, 2200, 1920, 1080, 0, 32);

  // Active word (Word 1)
  assert.equal(s1.state, "WORD_EMPHASIS");
  assert.equal(s1.wordScale, 1.40, "Active word must have prominent 1.4x scale");
  assert.equal(s1.wordAlpha, 1.0, "Active word must be 100% visible");
  assert.equal(s1.isProminent, true);

  // Recent word (Word 0)
  assert.equal(s0.state, "WORD_FADING");
  assert.ok(s0.wordScale < 1.40, "Recent word scale must decrease towards 0.85x");
  assert.equal(s0.isProminent, false);

  // Upcoming word (Word 2)
  assert.equal(s2.state, "WAITING");
  assert.equal(s2.wordAlpha, 0.0, "Upcoming word must be strictly invisible");
  assert.equal(s2.isProminent, false);
});

test("constellation: words are anchored near stars and NEVER travel along lines or fall", () => {
  const style = new ConstellationStyle();
  const words: TimedWord[] = [
    { id: "w0", text: "Stationary", startMs: 1000, endMs: 2000, durationMs: 1000, index: 0, lineIndex: 0 },
  ];

  // Sample word positions at different timestamps (activation, emphasis, fading, lingering)
  const st1 = style.getWordConstellationState(0, words, 1200, 1920, 1080, 0, 32);
  const st2 = style.getWordConstellationState(0, words, 1600, 1920, 1080, 0, 32);
  const st3 = style.getWordConstellationState(0, words, 2400, 1920, 1080, 0, 32);
  const st4 = style.getWordConstellationState(0, words, 3200, 1920, 1080, 0, 32);

  // Word coordinates must stay anchored to star position without drift or movement
  assert.equal(st1.wordPos.x, st2.wordPos.x, "Word X must stay stationary");
  assert.equal(st2.wordPos.x, st3.wordPos.x, "Word X must not move during fading");
  assert.equal(st3.wordPos.x, st4.wordPos.x, "Word X must remain stationary during lingering");
  assert.equal(st1.wordPos.y, st2.wordPos.y, "Word Y must stay stationary");
  assert.equal(st2.wordPos.y, st3.wordPos.y, "Word Y must not fall during fading");
  assert.equal(st3.wordPos.y, st4.wordPos.y, "Word Y must remain stationary");
});

test("constellation: exact lifecycle - word fades first while star and lines remain visible, then gradually fade", () => {
  const style = new ConstellationStyle();
  const words: TimedWord[] = [
    { id: "w0", text: "Luminous", startMs: 1000, endMs: 2000, durationMs: 1000, index: 0, lineIndex: 0 },
  ];

  // 1. Star activates before singing starts (t = 800)
  const sAct = style.getWordConstellationState(0, words, 800, 1920, 1080, 0, 32);
  assert.equal(sAct.state, "STAR_ACTIVATING");
  assert.equal(sAct.wordAlpha, 0.0, "Word must be invisible before singing");
  assert.ok(sAct.starAlpha > 0.25, "Star must illuminate during lead-in");

  // 2. Active singing (t = 1500)
  const sActive = style.getWordConstellationState(0, words, 1500, 1920, 1080, 0, 32);
  assert.equal(sActive.state, "WORD_EMPHASIS");
  assert.equal(sActive.wordAlpha, 1.0);
  assert.equal(sActive.wordScale, 1.40);
  assert.equal(sActive.starAlpha, 1.0);

  // 3. Word fading in place (t = 2500) — Word fades, but star point stays bright
  const sMidFade = style.getWordConstellationState(0, words, 2500, 1920, 1080, 0, 32);
  assert.equal(sMidFade.state, "WORD_FADING");
  assert.ok(sMidFade.wordAlpha < 1.0 && sMidFade.wordAlpha > 0, "Word alpha is fading down");
  assert.ok(sMidFade.starAlpha >= 0.75, "Star point remains bright while word fades");

  // 4. Word completely faded, star point and lines linger visibly (t = 3300)
  const sLinger = style.getWordConstellationState(0, words, 3300, 1920, 1080, 0, 32);
  assert.equal(sLinger.state, "STAR_LINGERING");
  assert.equal(sLinger.wordAlpha, 0.0, "Word must fade FIRST (alpha = 0)");
  assert.ok(sLinger.starAlpha >= 0.70, "Star point lingers visibly after word is gone");
  assert.ok(sLinger.lineAlpha >= 0.30, "Connecting lines linger visibly after word is gone");

  // 5. Star and lines gradually fade afterwards (t = 3900)
  const sStarFade = style.getWordConstellationState(0, words, 3900, 1920, 1080, 0, 32);
  assert.equal(sStarFade.state, "STAR_FADING");
  assert.equal(sStarFade.wordAlpha, 0.0);
  assert.ok(sStarFade.starAlpha < sLinger.starAlpha, "Star alpha must gradually decrease");

  // 6. Completed lifecycle (t = 4800)
  const sCompleted = style.getWordConstellationState(0, words, 4800, 1920, 1080, 0, 32);
  assert.equal(sCompleted.state, "COMPLETED");
  assert.equal(sCompleted.wordAlpha, 0.0);
  assert.ok(sCompleted.starAlpha > 0, "Star retains subtle ambient presence");
});

test("constellation: multiple words coexist simultaneously across the network", () => {
  const style = new ConstellationStyle();
  const words: TimedWord[] = [
    { id: "w0", text: "Every", startMs: 1000, endMs: 1600, durationMs: 600, index: 0, lineIndex: 0 },
    { id: "w1", text: "breath", startMs: 1600, endMs: 2200, durationMs: 600, index: 1, lineIndex: 0 },
    { id: "w2", text: "you", startMs: 2200, endMs: 2800, durationMs: 600, index: 2, lineIndex: 0 },
  ];

  // At t = 2300: Word 2 is active, Word 1 is recently completed, Word 0 is fading
  const s0 = style.getWordConstellationState(0, words, 2300, 1920, 1080, 0, 32);
  const s1 = style.getWordConstellationState(1, words, 2300, 1920, 1080, 0, 32);
  const s2 = style.getWordConstellationState(2, words, 2300, 1920, 1080, 0, 32);

  // Both Word 1 and Word 2 are simultaneously visible
  assert.ok(s2.wordAlpha > 0.9, "Word 2 must be fully visible (active)");
  assert.ok(s1.wordAlpha > 0.4, "Word 1 must be visibly coexisting");
  assert.equal(s2.isProminent, true, "Word 2 is prominent (1.4x)");
  assert.equal(s1.isProminent, false, "Word 1 is secondary (0.85x)");
});
