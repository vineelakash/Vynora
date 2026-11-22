/**
 * Particle and starfield renderer for kinetic animations.
 */

import type { AlbumPalette } from '../../../types/palette.ts';

interface Particle {
  x: number;
  y: number;
  size: number;
  baseAlpha: number;
  speedX: number;
  speedY: number;
  phase: number;
}

export class ParticleRenderer {
  private particles: Particle[] = [];
  private width = 0;
  private height = 0;

  constructor(count = 36) {
    this.initParticles(count);
  }

  private initParticles(count: number): void {
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random(),
        y: Math.random(),
        size: 1.0 + Math.random() * 2.2,
        baseAlpha: 0.15 + Math.random() * 0.45,
        speedX: (Math.random() - 0.5) * 0.04,
        speedY: (Math.random() - 0.5) * 0.04,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  public updateAndDraw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: AlbumPalette,
    timeMs: number,
    treble = 0,
    beat = false,
    particleIntensity = 1.0,
    reducedMotion = false,
  ): void {
    if (particleIntensity <= 0.01) return;

    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
    }

    ctx.save();
    const acc = palette.accent;
    const t = reducedMotion ? 0 : timeMs * 0.0015;
    const countToDraw = Math.min(
      this.particles.length,
      Math.round(this.particles.length * Math.min(1.5, particleIntensity)),
    );

    for (let i = 0; i < countToDraw; i++) {
      const p = this.particles[i]!;
      if (!reducedMotion) {
        p.x += p.speedX * (1 + treble * 1.5);
        p.y += p.speedY * (1 + treble * 1.5);

        if (p.x < 0) p.x += 1;
        if (p.x > 1) p.x -= 1;
        if (p.y < 0) p.y += 1;
        if (p.y > 1) p.y -= 1;
      }

      const px = p.x * width;
      const py = p.y * height;
      const pulse = reducedMotion ? 0.5 : Math.sin(t + p.phase) * 0.5 + 0.5;
      const alpha = Math.min(
        1.0,
        ((p.baseAlpha * 0.6 + pulse * 0.4) + (reducedMotion ? 0 : treble * 0.35) + (!reducedMotion && beat ? 0.25 : 0)) *
          particleIntensity,
      );
      const size = p.size * (1 + (!reducedMotion && beat ? 0.3 : 0));

      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${acc.r}, ${acc.g}, ${acc.b}, ${alpha})`;
      ctx.fill();
    }

    ctx.restore();
  }
}
