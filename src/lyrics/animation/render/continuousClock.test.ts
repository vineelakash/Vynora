import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Simulates the continuous clock and drift correction mathematics from LyricsCanvasEngine.
 */
class MockContinuousClock {
  public currentPositionMs = 0;
  public driftCorrectionMs = 0;
  public isPlaying = false;
  public lastRenderTimestamp = 0;

  public setPosition(authoritativePosMs: number, isPlaying: boolean): void {
    if (!this.isPlaying && isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      this.isPlaying = true;
      return;
    }

    if (this.isPlaying && !isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      this.isPlaying = false;
      return;
    }

    this.isPlaying = isPlaying;
    if (!isPlaying) {
      this.currentPositionMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
      return;
    }

    const disparity = authoritativePosMs - this.currentPositionMs;
    if (Math.abs(disparity) > 500) {
      this.currentPositionMs = authoritativePosMs;
      this.driftCorrectionMs = 0;
    } else {
      this.driftCorrectionMs = disparity;
    }
  }

  public renderTick(timestamp: number, speed = 1): number {
    const deltaMs = this.lastRenderTimestamp > 0 ? (timestamp - this.lastRenderTimestamp) : 16.67;
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

    return this.currentPositionMs;
  }
}

test('continuous clock: progresses smoothly frame by frame between authoritative updates', () => {
  const clock = new MockContinuousClock();
  clock.setPosition(10000, true);

  let time = 1000;
  clock.renderTick(time);

  // Advance 6 consecutive frames (~100ms) with NO authoritative updates
  const positions: number[] = [];
  for (let i = 0; i < 6; i++) {
    time += 16.666;
    positions.push(clock.renderTick(time));
  }

  // Ensure every single frame progressed forward without stepping or freezing
  for (let i = 1; i < positions.length; i++) {
    const step = positions[i]! - positions[i - 1]!;
    assert.ok(step >= 16 && step <= 17.5, `Each frame step should be ~16.6ms, got ${step}`);
  }
});

test('continuous clock: smoothly absorbs small drift without visual jumps', () => {
  const clock = new MockContinuousClock();
  clock.setPosition(10000, true);

  let time = 1000;
  clock.renderTick(time);

  // Run for 30 frames (~500ms)
  for (let i = 0; i < 30; i++) {
    time += 16.666;
    clock.renderTick(time);
  }

  // Authoritative update arrives with +60ms drift
  const preUpdatePos = clock.currentPositionMs;
  clock.setPosition(preUpdatePos + 60, true);

  // Check next frame: position must NOT jump by 60ms instantly!
  time += 16.666;
  const nextPos = clock.renderTick(time);
  const singleFrameDelta = nextPos - preUpdatePos;

  // Single frame delta should only nudge by ~16.6 + (60 * 0.05 = 3ms) = ~19.6ms, NEVER 60ms!
  assert.ok(singleFrameDelta < 22, `Delta should be gently dampened, got ${singleFrameDelta}`);
  assert.ok(singleFrameDelta > 17, `Delta should include positive nudge, got ${singleFrameDelta}`);
});

test('continuous clock: snaps immediately on large seek (>500ms)', () => {
  const clock = new MockContinuousClock();
  clock.setPosition(10000, true);

  let time = 1000;
  clock.renderTick(time);

  // User seeks forward to 25000ms (+15000ms)
  clock.setPosition(25000, true);
  assert.equal(clock.currentPositionMs, 25000, 'Large seek must snap immediately');
  assert.equal(clock.driftCorrectionMs, 0, 'Drift correction must reset on seek');
});
