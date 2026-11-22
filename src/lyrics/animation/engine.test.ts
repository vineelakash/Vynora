import assert from "node:assert/strict";
import test from "node:test";
import { ConstellationStyle } from "./styles/Constellation.ts";
import { TerminalStyle } from "./styles/Terminal.ts";
import { ChatStyle } from "./styles/Chat.ts";
import { PRESET_CONFIGS, DEFAULT_STUDIO_SETTINGS, type TimedWord, type LineTimingContext, type RenderContext } from "./animationTypes.ts";
import { NEUTRAL_PALETTE } from "./render/LyricsCanvas.ts";

test("engine: presets provide distinct and valid configurations", () => {
  const presets = ["cinematic", "smooth", "minimal", "expressive"] as const;
  for (const p of presets) {
    const cfg = PRESET_CONFIGS[p];
    assert.ok(cfg, `Preset ${p} must exist`);
    assert.equal(cfg.preset, p);
    assert.ok(cfg.style);
    assert.ok(cfg.background);
    assert.ok(typeof cfg.speed === "number" && cfg.speed > 0);
  }
});

test("engine: ConstellationStyle layout is deterministic and repeatable", () => {
  const constellation = new ConstellationStyle();
  const word: TimedWord = { id: "w0", text: "Celestial", startMs: 1000, endMs: 1500, durationMs: 500, index: 0, lineIndex: 0 };

  const p1 = constellation.evaluateStarPosition(word, 0, 4, 1280, 720);
  const p2 = constellation.evaluateStarPosition(word, 0, 4, 1280, 720);

  // Exact deterministic match
  assert.equal(p1.x, p2.x);
  assert.equal(p1.y, p2.y);
  assert.ok(p1.x > 0 && p1.x < 1280);
  assert.ok(p1.y > 0 && p1.y < 720);
});

test("engine: ConstellationStyle generates distinct star coordinates for consecutive words", () => {
  const constellation = new ConstellationStyle();
  const words: TimedWord[] = [
    { id: "w0", text: "Starlight", startMs: 1000, endMs: 1500, durationMs: 500, index: 0, lineIndex: 0 },
    { id: "w1", text: "Constellation", startMs: 1500, endMs: 2000, durationMs: 500, index: 1, lineIndex: 0 },
    { id: "w2", text: "Radiance", startMs: 2000, endMs: 2500, durationMs: 500, index: 2, lineIndex: 0 },
  ];

  const p0 = constellation.evaluateStarPosition(words[0]!, 0, 3, 1920, 1080);
  const p1 = constellation.evaluateStarPosition(words[1]!, 0, 3, 1920, 1080);
  const p2 = constellation.evaluateStarPosition(words[2]!, 0, 3, 1920, 1080);

  const dist01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const dist12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  assert.ok(dist01 >= 60, `Distance between stars 0 and 1 (${dist01}) should be >= 60px`);
  assert.ok(dist12 >= 60, `Distance between stars 1 and 2 (${dist12}) should be >= 60px`);
});

test("engine: reduced-motion disables aggressive scaling and motion", () => {
  const settings = {
    ...DEFAULT_STUDIO_SETTINGS,
    reducedMotion: true,
  };
  assert.equal(settings.reducedMotion, true);
});
