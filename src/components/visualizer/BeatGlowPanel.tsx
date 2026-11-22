import { useEffect, useRef } from 'react';
import type { BeatGlowFrame, BeatGlowMode, BeatGlowPrefs, BeatGlowPrefsPatch } from '../../types/audio.ts';
import type { AlbumPalette } from '../../types/palette.ts';
import type { SpotifyStatus } from '../../types/spotify.ts';
import {
  drawAmbientGlow,
  drawCircularPulse,
  drawSpectrumBars,
  drawWaveform,
  type ReactiveColor,
} from '../../utils/audioMath.ts';

interface BeatGlowPanelProps {
  spotifyStatus: SpotifyStatus;
  frame: BeatGlowFrame;
  prefs: BeatGlowPrefs;
  palette: AlbumPalette;
  reactiveColor: ReactiveColor;
  isAudioActive: boolean;
  onUpdatePrefs: (patch: BeatGlowPrefsPatch) => Promise<void>;
}

const MODES: { id: BeatGlowMode; label: string; icon: string }[] = [
  { id: 'spectrum', label: 'Spectrum', icon: '📊' },
  { id: 'waveform', label: 'Waveform', icon: '〰️' },
  { id: 'circular', label: 'Circular', icon: '🔘' },
  { id: 'ambient', label: 'Ambient', icon: '✨' },
];

export function BeatGlowPanel({
  spotifyStatus,
  frame,
  prefs,
  palette,
  reactiveColor,
  isAudioActive,
  onUpdatePrefs,
}: BeatGlowPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isOpen = prefs.showMainVisualizer;

  // Keep latest refs for 60fps canvas loop
  const frameRef = useRef(frame);
  const prefsRef = useRef(prefs);
  const paletteRef = useRef(palette);
  frameRef.current = frame;
  prefsRef.current = prefs;
  paletteRef.current = palette;

  // Toggle open (persisted via Rust beat-glow-prefs.json)
  const handleToggleOpen = () => {
    void onUpdatePrefs({ showMainVisualizer: !isOpen });
  };

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isOpen || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!prefs.enabled) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let animId: number;

    const render = () => {
      const f = frameRef.current;
      const p = prefsRef.current;
      const pal = paletteRef.current;
      const width = canvas.width;
      const height = canvas.height;

      switch (p.mode) {
        case 'spectrum':
          drawSpectrumBars(ctx, width, height, f.spectrum, p.intensity, pal, f.beat);
          break;
        case 'waveform':
          drawWaveform(ctx, width, height, f.waveform, p.intensity, pal, f.beat);
          break;
        case 'circular':
          drawCircularPulse(
            ctx,
            width,
            height,
            f.bass,
            f.mid,
            f.treble,
            f.beat,
            p.intensity,
            pal,
          );
          break;
        case 'ambient':
          drawAmbientGlow(ctx, width, height, f.bass, f.mid, p.intensity, pal, f.beat);
          break;
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isOpen, prefs.enabled, prefs.mode]);

  const isConnected = spotifyStatus.connectionState === 'connected';

  // Status badge meta
  const statusBadge = (() => {
    if (!prefs.enabled) {
      return {
        label: 'Disabled',
        pillClass: 'border-zinc-800 bg-zinc-900 text-zinc-500',
        dotClass: 'bg-zinc-600',
        style: {},
      };
    }
    if (!frame.deviceAvailable) {
      return {
        label: 'No Audio Device',
        pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        dotClass: 'bg-amber-400',
        style: {},
      };
    }
    if (isAudioActive) {
      return {
        label: 'Live Loopback',
        pillClass: 'border-white/10 bg-black/40',
        dotClass: 'animate-pulse',
        style: {
          color: palette.accentCss,
          borderColor: `${palette.dominantCss}`,
        },
      };
    }
    return {
      label: 'Idle • Listening',
      pillClass: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
      dotClass: 'bg-sky-400',
      style: {},
    };
  })();

  return (
    <section
      aria-labelledby="visualizer-heading"
      className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50 px-5 py-4 transition-all duration-300"
      style={{
        boxShadow:
          prefs.enabled && isAudioActive && isOpen
            ? reactiveColor.cssBoxShadow
            : undefined,
      }}
    >
      {/* Dynamic reactive ambient background aura derived from album artwork */}
      {prefs.enabled && isAudioActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-10 rounded-full opacity-20 blur-3xl transition-opacity duration-300"
          style={{ backgroundColor: reactiveColor.cssRgba }}
        />
      )}

      {/* Header */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="visualizer-heading" className="text-sm font-medium text-zinc-200">
              Beat Glow
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge.pillClass}`}
              style={statusBadge.style}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusBadge.dotClass}`}
                style={isAudioActive ? { backgroundColor: palette.accentCss } : undefined}
              />
              {statusBadge.label}
            </span>
            {frame.beat && prefs.enabled && (
              <span
                className="animate-ping inline-flex items-center rounded-full px-1.5 py-0.2 text-[10px] font-bold text-black"
                style={{ backgroundColor: palette.accentCss }}
              >
                BEAT
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {prefs.enabled
              ? `Real-time WASAPI audio reactive visualizer (${prefs.mode} · ${
                  prefs.theme === 'artwork' ? 'Album Palette' : 'Monochrome'
                })`
              : 'Visualizer paused — enable to activate audio glow'}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* Theme switcher */}
          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-950/80 p-0.5 border border-zinc-800/80 text-[11px]">
            <button
              type="button"
              onClick={() => onUpdatePrefs({ theme: 'artwork' })}
              className={`px-2 py-0.5 rounded font-medium transition ${
                prefs.theme === 'artwork'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Extract colors dynamically from Album Artwork"
            >
              🎨 Album
            </button>
            <button
              type="button"
              onClick={() => onUpdatePrefs({ theme: 'monochrome' })}
              className={`px-2 py-0.5 rounded font-medium transition ${
                prefs.theme === 'monochrome'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Neutral Monochrome Theme"
            >
              ⚪ Mono
            </button>
          </div>

          <button
            type="button"
            onClick={() => onUpdatePrefs({ enabled: !prefs.enabled })}
            style={
              prefs.enabled
                ? {
                    borderColor: `${palette.dominantCss}`,
                    backgroundColor: `rgba(${palette.dominant.r}, ${palette.dominant.g}, ${palette.dominant.b}, 0.15)`,
                    color: palette.accentCss,
                  }
                : undefined
            }
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              prefs.enabled
                ? 'hover:brightness-110'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-white'
            }`}
          >
            {prefs.enabled ? '⚡ Glow On' : '⚡ Glow Off'}
          </button>
          <button
            type="button"
            onClick={handleToggleOpen}
            className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-700 hover:text-white transition"
          >
            {isOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Expanded Body */}
      {isOpen && (
        <div className="relative mt-4 space-y-4">
          {/* Mode Switcher Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-1 rounded-xl bg-zinc-950/80 p-1 border border-zinc-800/60">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdatePrefs({ mode: m.id })}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    prefs.mode === m.id
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            {/* Quick Island & Vinyl sync toggles */}
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={prefs.islandGlowEnabled}
                  onChange={(e) =>
                    onUpdatePrefs({ islandGlowEnabled: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-800 focus:ring-white/20"
                  style={{ accentColor: palette.dominantCss }}
                />
                <span>Island</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={prefs.vinylGlowEnabled}
                  onChange={(e) =>
                    onUpdatePrefs({ vinylGlowEnabled: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-800 focus:ring-white/20"
                  style={{ accentColor: palette.dominantCss }}
                />
                <span>Vinyl</span>
              </label>
            </div>
          </div>

          {/* Interactive Canvas Container */}
          <div className="relative flex items-center justify-center rounded-xl border border-zinc-800/70 bg-zinc-950/90 p-3 overflow-hidden shadow-inner">
            <canvas
              ref={canvasRef}
              width={540}
              height={130}
              className="w-full h-32 block"
            />
            {!isAudioActive && prefs.enabled && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="text-xs text-zinc-600 font-mono tracking-wide">
                  {isConnected
                    ? 'Play audio in Spotify to visualize'
                    : 'Awaiting Spotify playback...'}
                </span>
              </div>
            )}
          </div>

          {/* Frequency Bands Live Meters styled with extracted album palette */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-2.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                <span>Bass (Dominant)</span>
                <span className="font-mono text-zinc-300">
                  {Math.round(frame.bass * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    backgroundColor: palette.dominantCss,
                    width: `${Math.min(100, Math.round(frame.bass * 100))}%`,
                  }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-2.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                <span>Mid (Secondary)</span>
                <span className="font-mono text-zinc-300">
                  {Math.round(frame.mid * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    backgroundColor: palette.secondaryCss,
                    width: `${Math.min(100, Math.round(frame.mid * 100))}%`,
                  }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-2.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                <span>Treble (Accent)</span>
                <span className="font-mono text-zinc-300">
                  {Math.round(frame.treble * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    backgroundColor: palette.accentCss,
                    width: `${Math.min(100, Math.round(frame.treble * 100))}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Sliders: Sensitivity and Intensity */}
          <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/60 pt-3">
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                <span>Sensitivity</span>
                <span className="font-mono text-zinc-300">
                  {prefs.sensitivity.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={prefs.sensitivity}
                onChange={(e) =>
                  onUpdatePrefs({ sensitivity: parseFloat(e.target.value) })
                }
                style={{ accentColor: palette.dominantCss }}
                className="w-full cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                <span>Visual Intensity</span>
                <span className="font-mono text-zinc-300">
                  {prefs.intensity.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.1"
                value={prefs.intensity}
                onChange={(e) =>
                  onUpdatePrefs({ intensity: parseFloat(e.target.value) })
                }
                style={{ accentColor: palette.dominantCss }}
                className="w-full cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
