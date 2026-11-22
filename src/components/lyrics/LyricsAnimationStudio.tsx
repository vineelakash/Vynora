/**
 * Dedicated Lyrics Animation Studio Component.
 *
 * Provides:
 * - High-DPI HTML5 Canvas driven by LyricsCanvasEngine.
 * - Live Spotify synchronization & Offline Sample Studio testing (English, Telugu, Hindi).
 * - 6 distinct Kinetic Animation Styles & 4 Background Environments.
 * - 4 Presets (Cinematic, Smooth, Minimal, Expressive).
 * - Advanced Customization Drawer (Font family, size, weight, letter/line spacing, speed, glow, blur, particles, reduced-motion, audio-reactive).
 * - Timing confidence indicator (ensures estimated timing is never misrepresented as actual).
 * - Full settings persistence via localStorage.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DisplayInfo } from '../../types/island.ts';
import type { SpotifyStatus } from '../../types/spotify.ts';
import type { ParsedLyricLine } from '../../types/lyrics.ts';
import type { BeatGlowFrame } from '../../types/audio.ts';
import type { AlbumPalette } from '../../types/palette.ts';
import type {
  BackgroundStyleId,
  FontFamilyChoice,
  FontSizeChoice,
  FontWeightChoice,
  KineticStudioSettings,
  KineticStyleId,
  TextAlignChoice,
  TransitionPreset,
} from '../../lyrics/animation/animationTypes.ts';
import {
  DEFAULT_STUDIO_SETTINGS,
  PRESET_CONFIGS,
} from '../../lyrics/animation/animationTypes.ts';
import { LyricsCanvasEngine, NEUTRAL_PALETTE } from '../../lyrics/animation/render/LyricsCanvas.ts';
import { SAMPLE_TRACKS } from '../../lyrics/animation/sampleTracks.ts';
import {
  isStudioSettingsStorageKey,
  loadPerfOverlayPreference,
  loadStudioSettings,
  savePerfOverlayPreference,
  saveStudioSettings,
} from '../../lyrics/animation/studioSettingsStorage.ts';
import { parseLrc } from '../../utils/parseLrc.ts';
import { evaluateTimingFeasibility } from '../../lyrics/animation/wordTiming.ts';

interface LyricsAnimationStudioProps {
  spotifyStatus: SpotifyStatus;
  parsedLines: ParsedLyricLine[];
  timelinePositionMs: number | null;
  audioFrame: BeatGlowFrame | null;
  palette: AlbumPalette;
}

export const LyricsAnimationStudio: React.FC<LyricsAnimationStudioProps> = ({
  spotifyStatus,
  parsedLines,
  timelinePositionMs,
  audioFrame,
  palette,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LyricsCanvasEngine | null>(null);
  const artworkImgRef = useRef<HTMLImageElement | null>(null);

  // Studio Settings
  const [settings, setSettings] = useState<KineticStudioSettings>(() => loadStudioSettings());
  const [showDrawer, setShowDrawer] = useState(false);

  // Mode: 'live' or 'sample'
  const [mode, setMode] = useState<'live' | 'sample'>('live');
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);

  // Sample playback state
  const [samplePlaying, setSamplePlaying] = useState(true);
  const [samplePositionMs, setSamplePositionMs] = useState(0);
  const sampleParsedLinesRef = useRef<ParsedLyricLine[]>([]);

  // Displays & Fullscreen Player State
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<string>('default');
  const [launchingFullscreen, setLaunchingFullscreen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
      invoke<DisplayInfo[]>('get_lyrics_player_displays')
        .then((list) => {
          if (Array.isArray(list)) setDisplays(list);
        })
        .catch((err) => {
          console.warn('[LyricsAnimationStudio] failed to get displays:', err);
        });
    }
  }, []);

  const handleLaunchFullscreen = useCallback(async () => {
    try {
      setLaunchingFullscreen(true);
      if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        await invoke('show_lyrics_player', {
          monitorId: selectedMonitor === 'default' ? null : selectedMonitor,
          fullscreen: true,
        });
      } else {
        console.info('[LyricsAnimationStudio] Tauri internals unavailable');
      }
    } catch (err) {
      console.error('[LyricsAnimationStudio] Failed to show fullscreen player:', err);
    } finally {
      setLaunchingFullscreen(false);
    }
  }, [selectedMonitor]);

  // Update stored settings whenever settings change
  const updateSettings = useCallback((newPartial: Partial<KineticStudioSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newPartial, preset: (newPartial.preset ?? 'custom') as TransitionPreset };
      saveStudioSettings(updated);
      return updated;
    });
  }, []);

  const applyPreset = useCallback((preset: Exclude<TransitionPreset, 'custom'>) => {
    const presetConfig = PRESET_CONFIGS[preset];
    if (presetConfig) {
      setSettings((prev) => {
        const updated = { ...prev, ...presetConfig, preset };
        saveStudioSettings(updated);
        return updated;
      });
    }
  }, []);

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_STUDIO_SETTINGS);
    saveStudioSettings(DEFAULT_STUDIO_SETTINGS);
  }, []);

  // Keep settings synchronized across Main (Lyrics Studio) <-> Fullscreen Player windows
  useEffect(() => {
    const reloadFromStorage = () => {
      setSettings(loadStudioSettings());
    };
    const onStorage = (e: StorageEvent) => {
      if (isStudioSettingsStorageKey(e.key)) {
        reloadFromStorage();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', reloadFromStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', reloadFromStorage);
    };
  }, []);

  // Parse sample track lyrics on sample track change
  const currentSample = SAMPLE_TRACKS[selectedSampleIndex] ?? SAMPLE_TRACKS[0]!;
  useEffect(() => {
    sampleParsedLinesRef.current = parseLrc(currentSample.lrc).lines;
    setSamplePositionMs(0);
  }, [currentSample]);

  // Load sample artwork into HTMLImageElement
  useEffect(() => {
    if (mode === 'sample') {
      const img = new Image();
      img.src = currentSample.artworkDataUrl;
      img.onload = () => {
        artworkImgRef.current = img;
        engineRef.current?.setArtwork(img);
      };
    } else if (spotifyStatus.artwork?.dataUrl) {
      const img = new Image();
      img.src = spotifyStatus.artwork.dataUrl;
      img.onload = () => {
        artworkImgRef.current = img;
        engineRef.current?.setArtwork(img);
      };
      img.onerror = () => {
        artworkImgRef.current = null;
        engineRef.current?.setArtwork(null);
      };
    } else {
      artworkImgRef.current = null;
      engineRef.current?.setArtwork(null);
    }
  }, [mode, currentSample, spotifyStatus.artwork?.dataUrl]);

  // Initialize Canvas Engine
  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new LyricsCanvasEngine(
      canvasRef.current,
      settings,
      mode === 'sample' ? currentSample.palette : palette,
    );
    if (loadPerfOverlayPreference()) {
      engine.togglePerformanceOverlay(true);
    }
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []); // Run once on mount

  // Sync settings with canvas engine
  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  // Performance Profiler HUD toggle (F3 or Ctrl+Shift+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3' || (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd'))) {
        e.preventDefault();
        const next = engineRef.current?.togglePerformanceOverlay() ?? false;
        savePerfOverlayPreference(next);
        updateSettings({ showPerfDiagnostics: next });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [updateSettings]);

  // Sample playback ticker
  useEffect(() => {
    if (mode !== 'sample' || !samplePlaying) return;

    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const delta = (now - lastTime) * settings.speed;
      lastTime = now;

      setSamplePositionMs((prev) => {
        const next = prev + delta;
        if (next >= currentSample.durationMs) {
          return 0; // Loop back
        }
        return next;
      });
    }, 16);

    return () => clearInterval(interval);
  }, [mode, samplePlaying, settings.speed, currentSample.durationMs]);

  // Sync data to Engine on every tick/change
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (mode === 'sample') {
      engine.setSampleMode(true);
      engine.setPalette(currentSample.palette);
      engine.setTrackMetadata({
        title: currentSample.title,
        artist: currentSample.artist,
        album: currentSample.album,
        trackKey: currentSample.id,
      });
      engine.setLyrics(sampleParsedLinesRef.current, currentSample.id);
      engine.setPosition(samplePositionMs, samplePlaying);
      // Generate synthetic gentle beat for sample mode preview
      const syntheticBeat = samplePlaying && Math.sin(samplePositionMs * 0.007) > 0.85;
      const syntheticBass = samplePlaying ? (Math.sin(samplePositionMs * 0.005) * 0.5 + 0.5) : 0;
      engine.setAudioFrame({
        rms: 0.3,
        peak: 0.5,
        bass: syntheticBass,
        mid: 0.2,
        treble: 0.2,
        beat: syntheticBeat,
        spectrum: [0.3, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1],
        waveform: [0.1, -0.1, 0.2, -0.2],
        isCapturing: true,
        deviceAvailable: true,
        timestampUnixMs: Date.now(),
      });
    } else {
      const isPlaying = spotifyStatus.playbackStatus === 'playing';
      engine.setSampleMode(false);
      engine.setPalette(palette || NEUTRAL_PALETTE);
      engine.setTrackMetadata({
        title: spotifyStatus.title || undefined,
        artist: spotifyStatus.artist || undefined,
        album: spotifyStatus.album || undefined,
        trackKey: `${spotifyStatus.title}::${spotifyStatus.artist}`,
        lookupState: parsedLines.length > 0 ? 'synced' : 'loading',
        isConnected: spotifyStatus.connectionState === 'connected',
      });
      engine.setLyrics(parsedLines, `${spotifyStatus.title}::${spotifyStatus.artist}`);
      engine.setPosition(timelinePositionMs ?? 0, isPlaying);
      engine.setAudioFrame(audioFrame);
    }
  }, [
    mode,
    selectedSampleIndex,
    samplePositionMs,
    samplePlaying,
    currentSample,
    timelinePositionMs,
    spotifyStatus.playbackStatus,
    spotifyStatus.title,
    spotifyStatus.artist,
    parsedLines,
    palette,
    audioFrame,
  ]);

  // Calculate timing confidence badge for display
  const activePositionMs = mode === 'sample' ? samplePositionMs : (timelinePositionMs ?? 0);
  const activeLines = mode === 'sample' ? sampleParsedLinesRef.current : parsedLines;

  let timingConfidenceStr = 'Estimated (Fallback)';
  let timingConfidenceBadgeColor = 'bg-zinc-800 text-zinc-400';

  if (activeLines.length > 0) {
    let curLineIdx = -1;
    for (let i = 0; i < activeLines.length; i++) {
      if (activeLines[i]!.timeMs <= activePositionMs) {
        curLineIdx = i;
      } else {
        break;
      }
    }

    if (curLineIdx >= 0) {
      const curLine = activeLines[curLineIdx]!;
      const nextLine = curLineIdx + 1 < activeLines.length ? activeLines[curLineIdx + 1]! : null;
      const interval = nextLine ? nextLine.timeMs - curLine.timeMs : 4000;
      const chars = Array.from(curLine.text).length;
      const { confidence } = evaluateTimingFeasibility(chars, curLine.text.split(/\s+/).length, interval);

      if (confidence === 'high') {
        timingConfidenceStr = 'Timing: Estimated (High Confidence)';
        timingConfidenceBadgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';
      } else if (confidence === 'medium') {
        timingConfidenceStr = 'Timing: Estimated (Medium Confidence)';
        timingConfidenceBadgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800/60';
      } else {
        timingConfidenceStr = 'Timing: Line-Only Fallback (Conservative)';
        timingConfidenceBadgeColor = 'bg-zinc-900 text-zinc-400 border-zinc-700/60';
      }
    }
  }

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <section
      aria-labelledby="lyrics-studio-heading"
      className="flex flex-col gap-3 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 shadow-xl shadow-black/40 backdrop-blur-md"
    >
      {/* Top Header / Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-700/60 bg-zinc-800 text-zinc-100 shadow-inner">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div>
            <h2 id="lyrics-studio-heading" className="text-sm font-semibold tracking-tight text-zinc-100">
              Lyrics Studio
            </h2>
            <p className="text-[11px] text-zinc-400">Kinetic Typography & Visual Style Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live vs Sample Toggle */}
          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode('live')}
              className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                mode === 'live'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Live Spotify
            </button>
            <button
              type="button"
              onClick={() => setMode('sample')}
              className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                mode === 'sample'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sample Studio
            </button>
          </div>

          {/* Fullscreen Player Launcher */}
          <div className="flex items-center gap-1.5">
            {displays.length > 1 && (
              <select
                value={selectedMonitor}
                onChange={(e) => setSelectedMonitor(e.target.value)}
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                title="Select target monitor for fullscreen lyrics player"
              >
                <option value="default">Default Monitor</option>
                {displays.map((d) => (
                  <option key={d.index} value={`${d.index}`}>
                    {d.name || `Display ${d.index + 1}`} {d.isPrimary ? '★' : ''} ({d.widthPx}×{d.heightPx})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleLaunchFullscreen}
              disabled={launchingFullscreen}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              title="Launch dedicated edge-to-edge fullscreen lyrics player"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
              <span>Fullscreen</span>
            </button>
          </div>
        </div>
      </div>

      {/* Offline Sample Selector & Transport (Visible when Sample mode is active) */}
      {mode === 'sample' && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-zinc-400">Sample:</span>
              <div className="flex gap-1">
                {SAMPLE_TRACKS.map((track, idx) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      setSelectedSampleIndex(idx);
                      setSamplePositionMs(0);
                    }}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      selectedSampleIndex === idx
                        ? 'border border-zinc-700 bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
                    }`}
                  >
                    {track.language} ({track.title})
                  </button>
                ))}
              </div>
            </div>

            {/* Transport Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSamplePlaying(!samplePlaying)}
                className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700"
              >
                {samplePlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => setSamplePositionMs(0)}
                className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              >
                Reset
              </button>
              <span className="font-mono text-[11px] text-zinc-400">
                {formatTime(samplePositionMs)} / {formatTime(currentSample.durationMs)}
              </span>
            </div>
          </div>

          {/* Scrub Slider */}
          <input
            type="range"
            min={0}
            max={currentSample.durationMs}
            value={samplePositionMs}
            onChange={(e) => setSamplePositionMs(Number(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
          />
        </div>
      )}

      {/* Preset Quick Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
        <span className="text-[11px] font-medium text-zinc-400">Presets:</span>
        <div className="flex flex-wrap gap-1">
          {(['cinematic', 'smooth', 'minimal', 'expressive'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                settings.preset === p
                  ? 'border border-zinc-600 bg-zinc-100 text-zinc-900'
                  : 'border border-zinc-800/80 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950 shadow-inner group">
        <canvas
          ref={canvasRef}
          className="h-full w-full block"
          style={{ imageRendering: 'auto' }}
        />

        {/* Quick Fullscreen Button Overlay */}
        <button
          type="button"
          onClick={handleLaunchFullscreen}
          className="absolute top-2 right-2 flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-zinc-300 backdrop-blur-md opacity-80 hover:opacity-100 hover:bg-zinc-800 hover:text-white transition-all shadow-md active:scale-95"
          title="Open Dedicated Fullscreen Lyrics Player"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
          <span>Expand</span>
        </button>

        {/* Confidence & Mode Overlay Badge */}
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium backdrop-blur-md ${timingConfidenceBadgeColor}`}>
            {timingConfidenceStr}
          </span>
        </div>
      </div>

      {/* Style Selector Tabs (6 Distinct Styles) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Animation Style
        </label>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              { id: 'big-words', label: 'Big Words' },
              { id: 'lines', label: 'Lines' },
              { id: 'chat', label: 'Chat' },
              { id: 'constellation', label: 'Constellation' },
              { id: 'terminal', label: 'Terminal' },
              { id: 'karaoke', label: 'Karaoke' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => updateSettings({ style: item.id as KineticStyleId })}
              className={`rounded-xl border px-2 py-1.5 text-center text-xs font-medium transition-all ${
                settings.style === item.id
                  ? 'border-zinc-500 bg-zinc-100 text-zinc-950 shadow-sm'
                  : 'border-zinc-800/80 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Background Selector Tabs (4 Environments) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Background Environment
        </label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(
            [
              { id: 'aura', label: 'Album Aura' },
              { id: 'black', label: 'Pure Black' },
              { id: 'cover', label: 'Album Cover' },
              { id: 'ambient', label: 'Ambient Motion' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => updateSettings({ background: item.id as BackgroundStyleId })}
              className={`rounded-xl border px-2.5 py-1.5 text-center text-xs font-medium transition-all ${
                settings.background === item.id
                  ? 'border-zinc-500 bg-zinc-100 text-zinc-950 shadow-sm'
                  : 'border-zinc-800/80 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Customization Collapsible Toggle */}
      <div className="border-t border-zinc-800/80 pt-2">
        <button
          type="button"
          onClick={() => setShowDrawer(!showDrawer)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200"
        >
          <span className="flex items-center gap-1.5">
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 transition-transform ${showDrawer ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Advanced Customization & Fine-Tuning
          </span>
          <span className="text-[11px] text-zinc-500">{showDrawer ? 'Collapse' : 'Expand'}</span>
        </button>

        {showDrawer && (
          <div className="mt-2.5 flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 text-xs">
            {/* Typography Section */}
            <div className="flex flex-col gap-2 border-b border-zinc-800/80 pb-3">
              <span className="font-semibold text-zinc-300">Typography</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-zinc-400">Font Family</label>
                  <select
                    value={settings.fontFamily}
                    onChange={(e) => updateSettings({ fontFamily: e.target.value as FontFamilyChoice })}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="sans">Sans-Serif (Native Clean)</option>
                    <option value="serif">Serif (Editorial / Classic)</option>
                    <option value="mono">Monospace (Code / Terminal)</option>
                    <option value="display">Display (Bold Poster)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400">Font Size</label>
                  <select
                    value={settings.fontSize}
                    onChange={(e) => updateSettings({ fontSize: e.target.value as FontSizeChoice })}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                    <option value="xl">Extra Large</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400">Font Weight</label>
                  <select
                    value={settings.fontWeight}
                    onChange={(e) => updateSettings({ fontWeight: e.target.value as FontWeightChoice })}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="normal">Normal (400)</option>
                    <option value="medium">Medium (500)</option>
                    <option value="semibold">Semibold (600)</option>
                    <option value="bold">Bold (700)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400">Alignment</label>
                  <select
                    value={settings.textAlign}
                    onChange={(e) => updateSettings({ textAlign: e.target.value as TextAlignChoice })}
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="center">Center</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              {/* Letter Spacing & Line Spacing */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Letter Spacing</span>
                    <span>{settings.letterSpacing}px</span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={4}
                    step={0.5}
                    value={settings.letterSpacing}
                    onChange={(e) => updateSettings({ letterSpacing: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Line Spacing</span>
                    <span>{settings.lineSpacing.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={1.2}
                    max={2.2}
                    step={0.1}
                    value={settings.lineSpacing}
                    onChange={(e) => updateSettings({ lineSpacing: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
              </div>
            </div>

            {/* Motion & Intensity Sliders */}
            <div className="flex flex-col gap-2.5 border-b border-zinc-800/80 pb-3">
              <span className="font-semibold text-zinc-300">Animation & Effects</span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Speed</span>
                    <span>{settings.speed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={settings.speed}
                    onChange={(e) => updateSettings({ speed: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Intensity</span>
                    <span>{settings.intensity.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={settings.intensity}
                    onChange={(e) => updateSettings({ intensity: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Glow Intensity</span>
                    <span>{settings.glowIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={2.0}
                    step={0.1}
                    value={settings.glowIntensity}
                    onChange={(e) => updateSettings({ glowIntensity: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Blur Intensity</span>
                    <span>{settings.blurIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={1.5}
                    step={0.1}
                    value={settings.blurIntensity}
                    onChange={(e) => updateSettings({ blurIntensity: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Particle Intensity</span>
                    <span>{settings.particleIntensity.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={2.0}
                    step={0.1}
                    value={settings.particleIntensity}
                    onChange={(e) => updateSettings({ particleIntensity: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Sync Offset</span>
                    <span>{(settings.syncOffsetMs ?? 120) >= 0 ? `+${settings.syncOffsetMs ?? 120}` : settings.syncOffsetMs}ms</span>
                  </div>
                  <input
                    type="range"
                    min={-200}
                    max={400}
                    step={10}
                    value={settings.syncOffsetMs ?? 120}
                    onChange={(e) => updateSettings({ syncOffsetMs: Number(e.target.value) })}
                    className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-zinc-200"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="mt-1 flex flex-wrap gap-4 pt-1">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={settings.reducedMotion}
                    onChange={(e) => updateSettings({ reducedMotion: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-900 text-zinc-100"
                  />
                  Reduced-Motion Mode
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={settings.audioReactive}
                    onChange={(e) => updateSettings({ audioReactive: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-900 text-zinc-100"
                  />
                  Audio-Reactive Effects (Beat Glow)
                </label>
              </div>
            </div>

            {/* Reset to defaults button */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={resetToDefaults}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
