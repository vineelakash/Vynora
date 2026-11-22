import assert from 'node:assert/strict';
import test from 'node:test';
import { PerformanceProfiler } from './PerformanceProfiler.ts';

test('profiler: records frames and calculates correct average FPS', () => {
  const profiler = new PerformanceProfiler();
  profiler.setEnabled(true);

  // Simulate 60 frames spaced by 16.66ms (~60 FPS)
  let time = 1000;
  for (let i = 0; i < 60; i++) {
    time += 16.666;
    profiler.recordFrame(time);
  }

  const snap = profiler.getSnapshot();
  assert.ok(snap.avgFps >= 59 && snap.avgFps <= 61, `Average FPS should be ~60, got ${snap.avgFps}`);
  assert.ok(snap.frameTimeMs >= 16 && snap.frameTimeMs <= 17.5);
  assert.equal(snap.longFramesCount, 0, 'No frames over 20ms');
  assert.equal(snap.severeStallsCount, 0, 'No severe stalls');
});

test('profiler: correctly flags long frames and severe stalls', () => {
  const profiler = new PerformanceProfiler();
  profiler.setEnabled(true);

  let time = 1000;
  // 30 normal frames
  for (let i = 0; i < 30; i++) {
    time += 16.666;
    profiler.recordFrame(time);
  }

  // 1 long frame (35ms)
  time += 35;
  profiler.recordFrame(time);

  // 1 severe stall (60ms)
  time += 60;
  profiler.recordFrame(time);

  const snap = profiler.getSnapshot();
  assert.equal(snap.longFramesCount, 2, 'Should flag frames > 20ms');
  assert.equal(snap.severeStallsCount, 1, 'Should flag frames > 50ms');
  assert.ok(snap.maxFrameTimeMs >= 60, 'Max frame time should record peak');
});
