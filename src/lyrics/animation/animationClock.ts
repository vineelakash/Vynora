/**
 * High-precision animation clock synchronized with audio timeline.
 */

export class AnimationClock {
  private lastPerfMs: number;
  private currentPositionMs: number;
  private isPlaying: boolean;
  private playbackSpeed: number;

  constructor(initialPositionMs = 0, isPlaying = false, speed = 1.0) {
    this.lastPerfMs = performance.now();
    this.currentPositionMs = initialPositionMs;
    this.isPlaying = isPlaying;
    this.playbackSpeed = speed;
  }

  public setSpeed(speed: number): void {
    this.playbackSpeed = Math.max(0.2, Math.min(3.0, speed));
  }

  public syncWithTimeline(positionMs: number, isPlaying: boolean): void {
    this.currentPositionMs = positionMs;
    this.isPlaying = isPlaying;
    this.lastPerfMs = performance.now();
  }

  public update(): { positionMs: number; deltaSec: number } {
    const now = performance.now();
    const elapsedMs = Math.max(0, now - this.lastPerfMs);
    this.lastPerfMs = now;

    if (this.isPlaying) {
      this.currentPositionMs += elapsedMs * this.playbackSpeed;
    }

    return {
      positionMs: this.currentPositionMs,
      deltaSec: elapsedMs / 1000,
    };
  }

  public seek(newPositionMs: number): void {
    this.currentPositionMs = Math.max(0, newPositionMs);
    this.lastPerfMs = performance.now();
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    this.lastPerfMs = performance.now();
  }

  public getPositionMs(): number {
    return this.currentPositionMs;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
