/**
 * Performance Profiler & Diagnostic Overlay for Kinetic Lyrics Engine.
 *
 * Measures:
 * - Current instantaneous FPS
 * - 60-frame rolling average FPS
 * - 1% Low FPS (99th percentile frame latency)
 * - Frame time duration (ms)
 * - Long frames count (> 20ms) and severe stalls (> 50ms)
 * - Timeline position smoothness and jitter
 *
 * Toggled via F3 or Ctrl+Shift+D. Hidden by default in production.
 */

export interface SyncTelemetry {
  currentPositionMs?: number;
  authoritativePosMs?: number;
  disparityMs?: number;
  syncOffsetMs?: number;
  isSampleMode?: boolean;
  activeLineIndex?: number;
  activeLineText?: string;
  timingMode?: string;
  timingConfidence?: string;
}

export interface PerformanceSnapshot {
  currentFps: number;
  avgFps: number;
  onePercentLowFps: number;
  frameTimeMs: number;
  maxFrameTimeMs: number;
  longFramesCount: number;
  severeStallsCount: number;
  totalFrames: number;
  sampleDurationSec: number;
}

export class PerformanceProfiler {
  private enabled = false;
  private lastFrameTime = 0;
  private frameTimes: number[] = []; // rolling delta times in ms (last 120 frames)
  private maxFrameTimes = 120;

  private totalFrames = 0;
  private longFramesCount = 0; // > 20ms
  private severeStallsCount = 0; // > 50ms
  private sessionStartTime = 0;

  // Cached calculated metrics
  private lastCalculationTime = 0;
  private cachedSnapshot: PerformanceSnapshot = {
    currentFps: 60,
    avgFps: 60,
    onePercentLowFps: 60,
    frameTimeMs: 16.6,
    maxFrameTimeMs: 16.6,
    longFramesCount: 0,
    severeStallsCount: 0,
    totalFrames: 0,
    sampleDurationSec: 0,
  };

  constructor() {
    this.reset();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(val: boolean): void {
    this.enabled = val;
    if (val) {
      this.reset();
    }
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public reset(): void {
    this.frameTimes = [];
    this.totalFrames = 0;
    this.longFramesCount = 0;
    this.severeStallsCount = 0;
    this.lastFrameTime = 0;
    this.sessionStartTime = 0;
    this.lastCalculationTime = 0;
  }

  /**
   * Called on every requestAnimationFrame tick.
   */
  public recordFrame(now: number): void {
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = now;
      this.sessionStartTime = now;
      return;
    }

    const deltaMs = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Filter out crazy jumps (e.g. background tab sleep > 1000ms)
    if (deltaMs > 1000) {
      return;
    }

    this.totalFrames += 1;
    this.frameTimes.push(deltaMs);
    if (this.frameTimes.length > this.maxFrameTimes) {
      this.frameTimes.shift();
    }

    if (deltaMs > 20) {
      this.longFramesCount += 1;
    }
    if (deltaMs > 50) {
      this.severeStallsCount += 1;
    }

    // Refresh cached snapshot at most every 100ms to avoid GC thrash
    if (now - this.lastCalculationTime >= 100) {
      this.updateSnapshot(now, deltaMs);
      this.lastCalculationTime = now;
    }
  }

  private updateSnapshot(now: number, latestDeltaMs: number): void {
    if (this.frameTimes.length === 0) return;

    const currentFps = latestDeltaMs > 0 ? Math.min(240, 1000 / latestDeltaMs) : 60;
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    const avgDelta = sum / this.frameTimes.length;
    const avgFps = avgDelta > 0 ? Math.min(240, 1000 / avgDelta) : 60;

    // Sort to compute 99th percentile frame time (1% low FPS)
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
    const p99Delta = sorted[p99Index] ?? avgDelta;
    const onePercentLowFps = p99Delta > 0 ? Math.min(240, 1000 / p99Delta) : 60;

    const maxFrameTimeMs = sorted[sorted.length - 1] ?? latestDeltaMs;
    const sampleDurationSec = (now - this.sessionStartTime) / 1000;

    this.cachedSnapshot = {
      currentFps,
      avgFps,
      onePercentLowFps,
      frameTimeMs: latestDeltaMs,
      maxFrameTimeMs,
      longFramesCount: this.longFramesCount,
      severeStallsCount: this.severeStallsCount,
      totalFrames: this.totalFrames,
      sampleDurationSec,
    };
  }

  public getSnapshot(): PerformanceSnapshot {
    const latestDelta = this.frameTimes.length > 0 ? this.frameTimes[this.frameTimes.length - 1]! : 16.666;
    this.updateSnapshot(this.lastFrameTime || 1, latestDelta);
    return this.cachedSnapshot;
  }

  /**
   * Renders a lightweight, high-contrast HUD on the 2D canvas context.
   */
  public drawOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    positionMs: number,
    isPlaying: boolean,
    telemetry?: SyncTelemetry,
  ): void {
    if (!this.enabled) return;

    const s = this.cachedSnapshot;
    const hudW = 320;
    const hudH = telemetry ? 165 : 130;
    const pad = 12;
    const x = width - hudW - pad;
    const y = pad;

    ctx.save();
    // Neutral dark background panel with border
    ctx.fillStyle = 'rgba(10, 12, 16, 0.90)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, hudW, hudH, 8);
    ctx.fill();
    ctx.stroke();

    // Text metrics
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.textBaseline = 'top';

    // Header
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(telemetry ? 'DIAGNOSTICS & SYNC (TASK B.1)' : 'DIAGNOSTICS', x + 10, y + 10);

    // Status indicator dot
    ctx.fillStyle = isPlaying ? '#10b981' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(x + hudW - 14, y + 16, 4, 0, Math.PI * 2);
    ctx.fill();

    // FPS Line
    const fpsColor = s.avgFps >= 55 ? '#34d399' : s.avgFps >= 40 ? '#fbbf24' : '#f87171';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('FPS: ', x + 10, y + 28);
    ctx.fillStyle = fpsColor;
    ctx.fillText(`${s.avgFps.toFixed(1)} (1% Low: ${s.onePercentLowFps.toFixed(1)})`, x + 44, y + 28);

    // Frame Time Line
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`Frame Time: ${s.frameTimeMs.toFixed(1)} ms (Max: ${s.maxFrameTimeMs.toFixed(1)} ms)`, x + 10, y + 46);

    // Long frames / Stalls
    const stallColor = s.longFramesCount > 0 ? '#fbbf24' : '#94a3b8';
    ctx.fillStyle = stallColor;
    ctx.fillText(`Long (>20ms): ${s.longFramesCount}  |  Stalls (>50ms): ${s.severeStallsCount}`, x + 10, y + 64);

    if (telemetry) {
      // Clock telemetry line
      const clockSec = ((telemetry.currentPositionMs ?? positionMs) / 1000).toFixed(2);
      const authSec = ((telemetry.authoritativePosMs ?? positionMs) / 1000).toFixed(2);
      const dispMs = (telemetry.disparityMs ?? 0).toFixed(0);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`Clock: ${clockSec}s | Auth: ${authSec}s | Δ: ${dispMs}ms`, x + 10, y + 82);

      // Sync offset & Mode
      const isSample = telemetry.isSampleMode ?? false;
      const offsetMs = telemetry.syncOffsetMs ?? 0;
      ctx.fillStyle = isSample ? '#38bdf8' : '#a78bfa';
      ctx.fillText(
        `Sync Lookahead: +${offsetMs}ms [${isSample ? 'SAMPLE BENCHMARK' : 'SPOTIFY GSMTC'}]`,
        x + 10,
        y + 100,
      );

      // Active line & timing mode
      const modeStr = telemetry.timingMode ? `${telemetry.timingMode} (${telemetry.timingConfidence ?? 'high'})` : 'active';
      const lineStr = typeof telemetry.activeLineIndex === 'number' && telemetry.activeLineIndex >= 0
        ? `L#${telemetry.activeLineIndex + 1}: ${telemetry.activeLineText?.slice(0, 18) ?? ''}...`
        : 'Line: [Waiting]';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`${lineStr} [${modeStr}]`, x + 10, y + 118);

      // Toggle hint
      ctx.fillStyle = '#64748b';
      ctx.fillText('Press F3 or Ctrl+Shift+D to hide', x + 10, y + 140);
    } else {
      // Position & Clock
      const posSec = (positionMs / 1000).toFixed(2);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`Timeline: ${posSec}s [${isPlaying ? 'PLAYING' : 'PAUSED'}]`, x + 10, y + 84);

      // Toggle hint
      ctx.fillStyle = '#64748b';
      ctx.fillText('Press F3 or Ctrl+Shift+D to hide', x + 10, y + 104);
    }

    ctx.restore();
  }
}
