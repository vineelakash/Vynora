import assert from 'node:assert/strict';
import test from 'node:test';
import { computeEffectivePositionMs } from '../../utils/lyricsSync.ts';
import { parseLrc } from '../../utils/parseLrc.ts';
import {
  clearWordTimingCache,
  getEstimatedWordsForLine,
  resolveLineTimingContext,
} from './wordTiming.ts';
import { DEFAULT_STUDIO_SETTINGS } from './animationTypes.ts';

/**
 * Mirrors the Task B.1 continuous clock + lookahead + stale-position guard from LyricsCanvasEngine.
 */
class SyncClockHarness {
  public currentPositionMs = 0;
  public positionMs = 0;
  public driftCorrectionMs = 0;
  public lastRenderTimestamp = 0;
  public lastAuthoritativePosMs: number | null = null;
  public isPlaying = false;
  public isSampleMode = false;
  public syncOffsetMs = DEFAULT_STUDIO_SETTINGS.syncOffsetMs ?? 120;

  public setPosition(authoritativePosMs: number, isPlaying: boolean): void {
    if (!this.isPlaying && isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.lastAuthoritativePosMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      this.isPlaying = true;
      return;
    }

    if (this.isPlaying && !isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.lastAuthoritativePosMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      this.isPlaying = false;
      return;
    }

    this.isPlaying = isPlaying;
    if (!isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.lastAuthoritativePosMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      return;
    }

    if (
      this.lastAuthoritativePosMs === null ||
      Math.abs(authoritativePosMs - this.lastAuthoritativePosMs) > 1
    ) {
      this.lastAuthoritativePosMs = authoritativePosMs;
      const disparity = authoritativePosMs - this.currentPositionMs;
      if (Math.abs(disparity) > 500) {
        this.currentPositionMs = authoritativePosMs;
        this.driftCorrectionMs = 0;
      } else if (Math.abs(disparity) > 15) {
        this.driftCorrectionMs = disparity;
      } else {
        this.driftCorrectionMs = 0;
      }
    }
  }

  public tick(timestamp: number, speed = 1): number {
    const rawDeltaMs = this.lastRenderTimestamp > 0 ? timestamp - this.lastRenderTimestamp : 16.67;
    const deltaMs = Math.min(100, Math.max(0, rawDeltaMs));
    this.lastRenderTimestamp = timestamp;

    if (this.isPlaying) {
      const progression = deltaMs * speed;
      if (Math.abs(this.driftCorrectionMs) > 0.05) {
        const nudge = this.driftCorrectionMs * 0.05;
        this.driftCorrectionMs -= nudge;
        this.currentPositionMs = Math.max(0, this.currentPositionMs + progression + nudge);
      } else {
        this.driftCorrectionMs = 0;
        this.currentPositionMs = Math.max(0, this.currentPositionMs + progression);
      }
    }

    const lookaheadMs = this.isSampleMode ? 0 : this.syncOffsetMs;
    this.positionMs = Math.max(0, this.currentPositionMs + lookaheadMs);
    return this.positionMs;
  }
}

test('sync smoothness: monotonic position extrapolation advances cleanly across 33ms ticks without freezing', () => {
  const status = {
    connectionState: 'connected' as const,
    playbackStatus: 'playing' as const,
    positionMs: 10000,
    durationMs: 240000,
    timeline: null,
  };

  // Snapshot timestamp is fixed at T=5000 when Rust emits the GSMTC snapshot
  const snapshotPerfMs = 5000;
  const samples: number[] = [];

  // Simulate 30 ticks at 33ms intervals (total ~990ms between 1-second GSMTC polls)
  for (let i = 0; i < 30; i++) {
    const nowPerf = snapshotPerfMs + i * 33;
    const eff = computeEffectivePositionMs(status, snapshotPerfMs, nowPerf);
    assert.notEqual(eff, null);
    samples.push(eff!);
  }

  // Strictly monotonic 33ms progression
  for (let i = 1; i < samples.length; i++) {
    assert.equal(
      samples[i]! - samples[i - 1]!,
      33,
      `Tick ${i} should advance monotonically by 33ms`,
    );
  }
  assert.equal(samples[samples.length - 1], 10000 + 29 * 33);
});

test('sync smoothness: stale duplicate authoritative position never causes negative drift drag', () => {
  const clock = new SyncClockHarness();
  clock.setPosition(10000, true);

  let ts = 1000;
  clock.tick(ts);

  // Advance 20 frames (~333ms) while React repeatedly passes the SAME authoritative position (10000)
  for (let i = 0; i < 20; i++) {
    ts += 16.666;
    clock.setPosition(10000, true);
    clock.tick(ts);
  }

  assert.equal(clock.driftCorrectionMs, 0, 'Duplicate authoritative position must not create negative drag');
  const expectedRaw = 10000 + 16.67 + 20 * 16.666;
  assert.ok(
    Math.abs(clock.currentPositionMs - expectedRaw) < 2,
    `Clock should advance freely without drag: expected ~${expectedRaw.toFixed(1)}, got ${clock.currentPositionMs.toFixed(1)}`,
  );
});

test('sync smoothness: real playback applies +120ms transport lookahead while sample mode uses 0ms', () => {
  const clock = new SyncClockHarness();
  assert.equal(DEFAULT_STUDIO_SETTINGS.syncOffsetMs, 120);

  // Real playback mode
  clock.isSampleMode = false;
  clock.setPosition(20000, true);
  const visualReal = clock.tick(1000);
  assert.ok(
    Math.abs(visualReal - (clock.currentPositionMs + 120)) < 0.01,
    'Real playback should add +120ms transport lookahead',
  );

  // Sample benchmark mode
  clock.isSampleMode = true;
  const visualSample = clock.tick(1016.67);
  assert.ok(
    Math.abs(visualSample - clock.currentPositionMs) < 0.01,
    'Sample mode must apply 0ms lookahead to preserve benchmark timing',
  );
});

test('sync smoothness: sub-15ms micro-jitter is ignored while large seeks (>500ms) snap immediately', () => {
  const clock = new SyncClockHarness();
  clock.setPosition(15000, true);
  clock.tick(1000);

  // Small 8ms jitter update -> ignored (driftCorrectionMs stays 0)
  clock.setPosition(clock.currentPositionMs + 8, true);
  assert.equal(clock.driftCorrectionMs, 0, 'Micro-jitter <= 15ms should not trigger drift correction');

  // Medium 80ms drift -> gradual correction
  clock.setPosition(clock.currentPositionMs + 80, true);
  assert.ok(Math.abs(clock.driftCorrectionMs - 80) < 0.5, 'Medium drift should engage gradual correction');

  // Large forward seek (45000ms) -> immediate snap
  clock.setPosition(45000, true);
  assert.equal(clock.currentPositionMs, 45000);
  assert.equal(clock.driftCorrectionMs, 0);

  // Large backward seek (5000ms) -> immediate snap
  clock.setPosition(5000, true);
  assert.equal(clock.currentPositionMs, 5000);
  assert.equal(clock.driftCorrectionMs, 0);
});

test('sync smoothness: clamps runaway deltaMs after background tab sleep', () => {
  const clock = new SyncClockHarness();
  clock.setPosition(10000, true);
  clock.tick(1000);
  const posBeforeSleep = clock.currentPositionMs;

  // Simulate 5 seconds of tab sleep before next rAF callback
  clock.tick(6000);
  const jump = clock.currentPositionMs - posBeforeSleep;
  assert.ok(jump <= 100.1, `Sleep delta should be clamped to <=100ms, got ${jump}`);
});

test('sync smoothness: parses inline <mm:ss.xx> word timestamps for English, Telugu, and Hindi', () => {
  clearWordTimingCache();
  const lrc = [
    '[offset:100]',
    '[00:10.00]<00:10.00>Lights <00:10.50>guide <00:11.00>you <00:11.40>home',
    '[00:14.00]<00:14.00>నీ <00:14.40>నవ్వు <00:15.00>చాలు',
    '[00:18.00]<00:18.00>दिल <00:18.50>की <00:19.00>बातें',
  ].join('\n');

  const doc = parseLrc(lrc);
  assert.equal(doc.lines.length, 3);

  // Line 0 (English) with [offset:100] subtracted
  const enLine = doc.lines[0]!;
  assert.equal(enLine.text, 'Lights guide you home');
  assert.equal(enLine.timeMs, 9900);
  assert.equal(enLine.inlineWords?.length, 4);
  assert.equal(enLine.inlineWords![0]!.text, 'Lights');
  assert.equal(enLine.inlineWords![0]!.timeMs, 9900);
  assert.equal(enLine.inlineWords![1]!.text, 'guide');
  assert.equal(enLine.inlineWords![1]!.timeMs, 10400);

  // Word timing engine should classify inline timestamps as 'actual' + 'high' confidence
  const timing = getEstimatedWordsForLine(enLine, 0, doc.lines[1]!, 'inline-test');
  assert.equal(timing.mode, 'actual');
  assert.equal(timing.confidence, 'high');
  assert.equal(timing.words.length, 4);
  assert.equal(timing.words[1]!.startMs, 10400);
  assert.equal(timing.words[1]!.endMs, 10900);

  // Resolve exact active word at 10650ms -> middle of 'guide' (progress 0.5)
  const ctx = resolveLineTimingContext(doc.lines, 0, 10650, 'inline-test');
  assert.equal(ctx.mode, 'actual');
  assert.equal(ctx.activeWordIndex, 1);
  assert.ok(Math.abs(ctx.activeWordProgress - 0.5) < 0.01);

  // Telugu inline words
  const teLine = doc.lines[1]!;
  assert.equal(teLine.text, 'నీ నవ్వు చాలు');
  assert.equal(teLine.inlineWords?.length, 3);
  const teTiming = getEstimatedWordsForLine(teLine, 1, doc.lines[2]!, 'inline-test');
  assert.equal(teTiming.mode, 'actual');
  assert.equal(teTiming.words[1]!.text, 'నవ్వు');

  // Hindi inline words
  const hiLine = doc.lines[2]!;
  assert.equal(hiLine.text, 'दिल की बातें');
  assert.equal(hiLine.inlineWords?.length, 3);
  const hiTiming = getEstimatedWordsForLine(hiLine, 2, null, 'inline-test');
  assert.equal(hiTiming.mode, 'actual');
  assert.equal(hiTiming.words[2]!.text, 'बातें');
});
