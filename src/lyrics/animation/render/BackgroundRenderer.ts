/**
 * High-performance background renderer for Kinetic Lyrics Studio.
 *
 * Four distinct background modes:
 * - Aura: Blurred album-derived multi-point glow diffusion with dark vignette overlay.
 * - Black: Deep obsidian #060608 background for high-contrast minimalism.
 * - Cover: Album artwork filling background with heavy cinematic dark overlay.
 * - Ambient: Fluid moving gradient mesh with audio-reactive luminosity.
 */

import type { AlbumPalette } from '../../../types/palette.ts';
import type { BackgroundStyleId } from '../animationTypes.ts';

export class BackgroundRenderer {
  public draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    style: BackgroundStyleId,
    palette: AlbumPalette,
    timeMs: number,
    bass = 0,
    beat = false,
    artworkImg?: HTMLImageElement | null,
    reducedMotion = false,
  ): void {
    ctx.save();

    switch (style) {
      case 'black': {
        ctx.fillStyle = '#060608';
        ctx.fillRect(0, 0, width, height);
        break;
      }

      case 'cover': {
        // Base dark
        ctx.fillStyle = '#07070a';
        ctx.fillRect(0, 0, width, height);

        if (artworkImg && artworkImg.complete && artworkImg.naturalWidth > 0) {
          ctx.save();
          // Draw cover scaled to cover canvas with blur simulation
          const scale = Math.max(width / artworkImg.naturalWidth, height / artworkImg.naturalHeight);
          const dw = artworkImg.naturalWidth * scale;
          const dh = artworkImg.naturalHeight * scale;
          const dx = (width - dw) / 2;
          const dy = (height - dh) / 2;

          ctx.globalAlpha = 0.22;
          ctx.drawImage(artworkImg, dx, dy, dw, dh);
          ctx.restore();
        }

        // Heavy dark overlay vignette
        const grad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.2,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.7,
        );
        grad.addColorStop(0, 'rgba(6, 6, 9, 0.75)');
        grad.addColorStop(1, 'rgba(4, 4, 6, 0.96)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        break;
      }

      case 'ambient': {
        // Fluid moving gradient mesh driven by album palette
        const t = reducedMotion ? 0 : timeMs * 0.0006;
        ctx.fillStyle = '#060608';
        ctx.fillRect(0, 0, width, height);

        const x1 = width * (0.3 + Math.sin(t) * 0.2);
        const y1 = height * (0.3 + Math.cos(t * 0.8) * 0.2);
        const r1 = Math.max(width, height) * (0.45 + (reducedMotion ? 0 : bass * 0.15) + (!reducedMotion && beat ? 0.08 : 0));

        const g1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, r1);
        const dom = palette.dominant;
        const domAlpha = Math.min(0.4, 0.18 + (reducedMotion ? 0 : bass * 0.18));
        g1.addColorStop(0, `rgba(${dom.r}, ${dom.g}, ${dom.b}, ${domAlpha})`);
        g1.addColorStop(1, 'rgba(6, 6, 8, 0)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, width, height);

        const x2 = width * (0.7 + Math.cos(t * 0.9) * 0.2);
        const y2 = height * (0.65 + Math.sin(t * 0.7) * 0.2);
        const r2 = Math.max(width, height) * 0.4;

        const g2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, r2);
        const sec = palette.secondary;
        g2.addColorStop(0, `rgba(${sec.r}, ${sec.g}, ${sec.b}, 0.15)`);
        g2.addColorStop(1, 'rgba(6, 6, 8, 0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, width, height);
        break;
      }

      case 'aura':
      default: {
        // Album Aura: Blurred multi-point glow diffusion with dark vignette
        const t = reducedMotion ? 0 : timeMs * 0.0008;
        ctx.fillStyle = '#08080b';
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2;
        const cy = height / 2;
        const dom = palette.dominant;
        const sec = palette.secondary;
        const acc = palette.accent;

        // Dominant center bloom
        const rCenter = Math.max(width, height) * (0.48 + (reducedMotion ? 0 : bass * 0.12) + (!reducedMotion && beat ? 0.06 : 0));
        const gCenter = ctx.createRadialGradient(
          cx + (reducedMotion ? 0 : Math.sin(t) * 30),
          cy + (reducedMotion ? 0 : Math.cos(t * 0.7) * 20),
          0,
          cx,
          cy,
          rCenter,
        );
        const auraAlpha = Math.min(0.45, 0.22 + (reducedMotion ? 0 : bass * 0.18));
        gCenter.addColorStop(0, `rgba(${dom.r}, ${dom.g}, ${dom.b}, ${auraAlpha})`);
        gCenter.addColorStop(0.5, `rgba(${sec.r}, ${sec.g}, ${sec.b}, ${auraAlpha * 0.5})`);
        gCenter.addColorStop(1, 'rgba(8, 8, 11, 0)');
        ctx.fillStyle = gCenter;
        ctx.fillRect(0, 0, width, height);

        // Accent specular top highlight
        const gTop = ctx.createRadialGradient(
          cx + (reducedMotion ? 0 : Math.cos(t * 1.1) * (width * 0.25)),
          height * 0.15,
          0,
          cx,
          height * 0.15,
          width * 0.35,
        );
        gTop.addColorStop(0, `rgba(${acc.r}, ${acc.g}, ${acc.b}, 0.16)`);
        gTop.addColorStop(1, 'rgba(8, 8, 11, 0)');
        ctx.fillStyle = gTop;
        ctx.fillRect(0, 0, width, height);

        // Dark text contrast vignette overlay
        const vGrad = ctx.createRadialGradient(
          cx,
          cy,
          Math.min(width, height) * 0.25,
          cx,
          cy,
          Math.max(width, height) * 0.75,
        );
        vGrad.addColorStop(0, 'rgba(7, 7, 10, 0.45)');
        vGrad.addColorStop(1, 'rgba(5, 5, 8, 0.88)');
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, width, height);
        break;
      }
    }

    ctx.restore();
  }
}
