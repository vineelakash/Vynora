/**
 * Dedicated Immersive Fullscreen Lyrics Player Component for Needle Windows.
 *
 * Provides:
 * - Edge-to-edge fullscreen viewport powered by LyricsCanvasEngine.
 * - Auto-hiding minimalist playback control overlay (fades out after 3s of inactivity).
 * - Full multi-monitor and DPI scaling support.
 * - Responsive typography scaling for all 6 styles (Big Words, Lines, Chat, Constellation, Terminal, Karaoke).
 * - Live Spotify GSMTC synchronization & offline fallback.
 * - Keyboard shortcuts (Escape to exit/close, Space to toggle play/pause, F/F11 for fullscreen).
 * - Double-click on canvas to toggle fullscreen mode.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLyrics } from '../hooks/useLyrics.ts';
import type { AlbumPalette } from '../types/palette.ts';
import { INITIAL_SPOTIFY_STATUS, type SpotifyStatus } from '../types/spotify.ts';
import type { ParsedLyricLine } from '../types/lyrics.ts';
import {
  type BackgroundStyleId,
  type KineticStudioSettings,
  type KineticStyleId,
} from '../lyrics/animation/animationTypes.ts';
import {
  isStudioSettingsStorageKey,
  loadPerfOverlayPreference,
  loadStudioSettings,
  mapPlayerTransportAction,
  savePerfOverlayPreference,
  saveStudioSettings,
} from '../lyrics/animation/studioSettingsStorage.ts';
import { LyricsCanvasEngine, NEUTRAL_PALETTE } from '../lyrics/animation/render/LyricsCanvas.ts';
import { SAMPLE_TRACKS } from '../lyrics/animation/sampleTracks.ts';
import { parseLrc } from '../utils/parseLrc.ts';
import { evaluateTimingFeasibility } from '../lyrics/animation/wordTiming.ts';
import { formatTimeMs } from '../utils/formatTime.ts';

export default function LyricsPlayerApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LyricsCanvasEngine | null>(null);
  const artworkImgRef = useRef<HTMLImageElement | null>(null);
  const controlBusyRef = useRef(false);

  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus>(INITIAL_SPOTIFY_STATUS);
  const [settings, setSettings] = useState<KineticStudioSettings>(() => loadStudioSettings());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const inactivityTimerRef = useRef<number | null>(null);

  // Offline Sample Studio Fallback
  const [sampleTrackIndex, setSampleTrackIndex] = useState<number | null>(null);
  const [samplePositionMs, setSamplePositionMs] = useState(0);
  const [samplePlaying, setSamplePlaying] = useState(true);
  const sampleParsedLinesRef = useRef<ParsedLyricLine[]>([]);

  const lyrics = useLyrics({
    spotifyStatus,
    role: 'consumer',
  });

  const [albumPalette, setAlbumPalette] = useState<AlbumPalette>(NEUTRAL_PALETTE);

  // Subscribe to album-palette-changed (emits only on track change or initial load, zero 38.5Hz churn)
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let unlisten: (() => void) | null = null;
    listen<AlbumPalette | null>('album-palette-changed', (event) => {
      if (event.payload) {
        setAlbumPalette(event.payload);
      }
    }).then((un) => {
      unlisten = un;
    });

    invoke<AlbumPalette | null>('get_album_palette')
      .then((initial) => {
        if (initial) setAlbumPalette(initial);
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Determine if sample mode is active (manual selection or Spotify has no lyrics/track)
  const isSampleMode = sampleTrackIndex !== null || (!spotifyStatus.title && lyrics.parsedLines.length === 0);
  const effectiveSampleIndex = sampleTrackIndex ?? 0;
  const currentSample = SAMPLE_TRACKS[effectiveSampleIndex] ?? SAMPLE_TRACKS[0]!;

  // Parse sample track lyrics on change
  useEffect(() => {
    if (isSampleMode) {
      sampleParsedLinesRef.current = parseLrc(currentSample.lrc).lines;
      setSamplePositionMs(0);
    }
  }, [isSampleMode, currentSample]);

  // Sample playback ticker
  useEffect(() => {
    if (!isSampleMode || !samplePlaying) return;

    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const delta = (now - lastTime) * (settings.speed || 1);
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
  }, [isSampleMode, samplePlaying, settings.speed, currentSample.durationMs]);

  // Update stored settings
  const updateSettings = useCallback((patch: Partial<KineticStudioSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...patch };
      saveStudioSettings(updated);
      return updated;
    });
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

  // Listen to Spotify status
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    let cancelled = false;
    const setup = async () => {
      try {
        const initial = await invoke<SpotifyStatus>('get_spotify_status');
        if (!cancelled && initial) {
          setSpotifyStatus(initial);
        }
      } catch {}

      try {
        const unlisten = await listen<SpotifyStatus>('spotify-status-changed', (e) => {
          if (!cancelled && e.payload) {
            setSpotifyStatus(e.payload);
          }
        });
        return unlisten;
      } catch {}
      return undefined;
    };

    let cleanupFn: (() => void) | undefined;
    void setup().then((unlisten) => {
      cleanupFn = unlisten;
    });

    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
    };
  }, []);

  // Rehydrate state on focus, visibilitychange, and explicit lyrics-player-opened event
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    let cancelled = false;
    const rehydrate = async () => {
      try {
        const [spotify, palette] = await Promise.all([
          invoke<SpotifyStatus>('get_spotify_status').catch(() => null),
          invoke<AlbumPalette | null>('get_album_palette').catch(() => null),
        ]);
        if (!cancelled) {
          if (spotify && spotify.connectionState === 'connected') {
            setSpotifyStatus(spotify);
          }
          if (palette) {
            setAlbumPalette(palette);
          }
        }
      } catch {}
    };

    window.addEventListener('focus', rehydrate);
    const syncFullscreen = () => {
      try {
        const win = getCurrentWindow();
        win.isFullscreen().then(setIsFullscreen).catch(() => {});
      } catch {}
    };
    syncFullscreen();
    window.addEventListener('focus', syncFullscreen);
    window.addEventListener('resize', syncFullscreen);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void rehydrate();
        syncFullscreen();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    let unlistenOpened: (() => void) | undefined;
    listen('lyrics-player-opened', () => {
      if (!cancelled) {
        void rehydrate();
      }
    }).then((un) => {
      unlistenOpened = un;
    });

    return () => {
      cancelled = true;
      window.removeEventListener('focus', rehydrate);
      document.removeEventListener('visibilitychange', onVisibility);
      if (unlistenOpened) unlistenOpened();
    };
  }, []);

  // Inactivity auto-hide timer for controls (3 seconds)
  const resetInactivityTimer = useCallback(() => {
    setControlsVisible(true);
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const onMouseMove = () => resetInactivityTimer();
    window.addEventListener('mousemove', onMouseMove);
    resetInactivityTimer();

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      if (inactivityTimerRef.current !== null) {
        window.clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [resetInactivityTimer]);

  // Handle Fullscreen & Exit actions
  const handleToggleFullscreen = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) return;
    try {
      const nextFs = await invoke<boolean>('toggle_lyrics_player_fullscreen');
      setIsFullscreen(nextFs);
    } catch {
      try {
        const win = getCurrentWindow();
        const curr = await win.isFullscreen();
        await win.setFullscreen(!curr);
        setIsFullscreen(!curr);
      } catch {}
    }
  }, []);

  const handleExit = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) return;
    try {
      await invoke('hide_lyrics_player');
    } catch {
      try {
        await getCurrentWindow().hide();
      } catch {}
    }
  }, []);

  // Media playback controls
  const handleControl = useCallback(async (action: 'PlayPause' | 'NextTrack' | 'PreviousTrack') => {
    if (isSampleMode) {
      if (action === 'PlayPause') {
        setSamplePlaying((p) => !p);
      } else if (action === 'NextTrack') {
        setSampleTrackIndex((prev) => ((prev ?? 0) + 1) % SAMPLE_TRACKS.length);
        setSamplePositionMs(0);
      } else if (action === 'PreviousTrack') {
        setSampleTrackIndex((prev) => {
          const curr = prev ?? 0;
          return (curr - 1 + SAMPLE_TRACKS.length) % SAMPLE_TRACKS.length;
        });
        setSamplePositionMs(0);
      }
      return;
    }

    if (!window.__TAURI_INTERNALS__ || controlBusyRef.current) return;
    controlBusyRef.current = true;
    try {
      const mappedAction = mapPlayerTransportAction(action);
      const nextStatus = await invoke<SpotifyStatus>('control_spotify_playback', {
        action: mappedAction,
      });
      if (nextStatus) {
        setSpotifyStatus(nextStatus);
      }
    } catch (err) {
      console.error('Failed media control:', err);
    } finally {
      controlBusyRef.current = false;
    }
  }, [isSampleMode]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetInactivityTimer();

      if (e.key === 'Escape') {
        e.preventDefault();
        void handleExit();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
        e.preventDefault();
        void handleToggleFullscreen();
      } else if (e.key === 'F3' || (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd'))) {
        e.preventDefault();
        const next = engineRef.current?.togglePerformanceOverlay() ?? false;
        updateSettings({ showPerfDiagnostics: next });
        savePerfOverlayPreference(next);
      } else if (e.code === 'Space') {
        e.preventDefault();
        void handleControl('PlayPause');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        void handleControl('NextTrack');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void handleControl('PreviousTrack');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExit, handleToggleFullscreen, handleControl, resetInactivityTimer, updateSettings]);

  // Load Album Artwork
  useEffect(() => {
    if (isSampleMode) {
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
  }, [isSampleMode, currentSample, spotifyStatus.artwork?.dataUrl]);

  // Initialize Canvas Engine
  useEffect(() => {
    if (!canvasRef.current) return;

    const initialPalette = isSampleMode ? currentSample.palette : (albumPalette || NEUTRAL_PALETTE);
    const engine = new LyricsCanvasEngine(
      canvasRef.current,
      settings,
      initialPalette,
    );
    if (loadPerfOverlayPreference()) {
      engine.togglePerformanceOverlay(true);
    }
    engineRef.current = engine;
    (window as any).__needleLyricsEngine = engine;

    return () => {
      delete (window as any).__needleLyricsEngine;
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Sync settings with canvas engine
  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  // Sync lyrics, audio frame, position, palette to engine on each render
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isSampleMode) {
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

      // Synthetic gentle audio reaction for sample mode preview
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
      engine.setPalette(albumPalette || NEUTRAL_PALETTE);
      const canonicalKey = lyrics.trackKey || `${spotifyStatus.title}::${spotifyStatus.artist}`;
      engine.setTrackMetadata({
        title: spotifyStatus.title || undefined,
        artist: spotifyStatus.artist || undefined,
        album: spotifyStatus.album || undefined,
        trackKey: canonicalKey,
        lookupState: lyrics.snapshot.state,
        isConnected: spotifyStatus.connectionState === 'connected',
      });
      engine.setLyrics(lyrics.parsedLines, canonicalKey);
      engine.setPosition(lyrics.effectivePositionMs ?? 0, isPlaying);
    }
  }, [
    isSampleMode,
    currentSample,
    samplePositionMs,
    samplePlaying,
    lyrics.parsedLines,
    lyrics.effectivePositionMs,
    lyrics.snapshot.state,
    spotifyStatus.title,
    spotifyStatus.artist,
    spotifyStatus.playbackStatus,
    spotifyStatus.connectionState,
    albumPalette,
  ]);

  // Timing confidence calculation
  let timingConfidenceStr = 'Timing: Conservative Sync';
  let timingConfidenceColor = 'text-zinc-400 bg-zinc-900/80 border-zinc-800';
  const effectiveLines = isSampleMode ? sampleParsedLinesRef.current : lyrics.parsedLines;
  if (effectiveLines.length > 0) {
    const curLine = effectiveLines[0]!;
    const chars = Array.from(curLine.text).length;
    const wordsCount = curLine.text.trim().split(/\s+/).length;
    const { confidence } = evaluateTimingFeasibility(chars, wordsCount, 4000);
    if (confidence === 'high') {
      timingConfidenceStr = 'Estimated (High Confidence)';
      timingConfidenceColor = 'text-emerald-300 bg-emerald-950/70 border-emerald-800/60';
    } else {
      timingConfidenceStr = 'Estimated (Medium Confidence)';
      timingConfidenceColor = 'text-amber-300 bg-amber-950/70 border-amber-800/60';
    }
  } else if (!isSampleMode && lyrics.snapshot.state === 'plain') {
    timingConfidenceStr = 'Plain Lyrics (Unsynchronized)';
    timingConfidenceColor = 'text-blue-300 bg-blue-950/70 border-blue-800/60';
  } else if (!isSampleMode && lyrics.snapshot.state === 'loading') {
    timingConfidenceStr = 'Searching Lyrics...';
    timingConfidenceColor = 'text-cyan-300 bg-cyan-950/70 border-cyan-800/60';
  } else if (!isSampleMode && lyrics.snapshot.state === 'instrumental') {
    timingConfidenceStr = 'Instrumental Track';
    timingConfidenceColor = 'text-purple-300 bg-purple-950/70 border-purple-800/60';
  } else if (!isSampleMode && lyrics.snapshot.state === 'unavailable') {
    timingConfidenceStr = 'Lyrics Unavailable';
    timingConfidenceColor = 'text-zinc-400 bg-zinc-900/80 border-zinc-800';
  }

  const isPlaying = isSampleMode ? samplePlaying : (spotifyStatus.playbackStatus === 'playing');
  const durationMs = isSampleMode ? currentSample.durationMs : (spotifyStatus.durationMs ?? spotifyStatus.timeline?.durationMs ?? 1);
  const currentPosMs = isSampleMode ? samplePositionMs : (lyrics.effectivePositionMs ?? spotifyStatus.positionMs ?? 0);
  const progressRatio = Math.max(0, Math.min(1, currentPosMs / durationMs));

  const displayTitle = isSampleMode ? currentSample.title : (spotifyStatus.title || 'No Track Playing');
  const displayArtist = isSampleMode ? currentSample.artist : (spotifyStatus.artist || 'Spotify Desktop');
  const displayArtwork = isSampleMode ? currentSample.artworkDataUrl : spotifyStatus.artwork?.dataUrl;
  const activePalette = isSampleMode ? currentSample.palette : (albumPalette || NEUTRAL_PALETTE);

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden bg-black select-none ${
        controlsVisible ? 'cursor-default' : 'cursor-none'
      }`}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement | null)?.closest('button, input, select, a')) {
          return;
        }
        void handleToggleFullscreen();
      }}
    >
      {/* Edge-to-edge HTML5 Canvas Viewport */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full block"
        style={{ imageRendering: 'auto' }}
      />

      {/* Non-synchronized / State Overlays (Active when live Spotify has no synced lines) */}
      {!isSampleMode && lyrics.parsedLines.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none select-text">
          {lyrics.snapshot.state === 'loading' ? (
            <div className="flex items-center gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-5 py-2.5 text-xs font-medium text-zinc-300 shadow-2xl backdrop-blur-md animate-pulse">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <span>Searching synchronized lyrics...</span>
            </div>
          ) : lyrics.snapshot.state === 'plain' && lyrics.plainLines.length > 0 ? (
            <div className="pointer-events-auto flex flex-col items-center max-h-[70vh] max-w-2xl overflow-y-auto px-6 py-8 space-y-4 text-center rounded-2xl border border-white/5 bg-black/40 backdrop-blur-sm scrollbar-thin scrollbar-thumb-zinc-800">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-950/50 px-3 py-1 text-[11px] font-medium text-sky-300 backdrop-blur-md">
                Unsynchronized Plain Lyrics
              </div>
              {lyrics.plainLines.map((line, idx) => (
                <p
                  key={idx}
                  className="text-lg md:text-xl font-medium tracking-tight text-zinc-200/90 leading-relaxed"
                >
                  {line}
                </p>
              ))}
            </div>
          ) : lyrics.snapshot.state === 'instrumental' ? (
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-4 py-2 text-xs font-medium text-purple-300 shadow-2xl backdrop-blur-md">
              <span>♫</span>
              <span>Instrumental Track</span>
            </div>
          ) : lyrics.snapshot.state === 'unavailable' ? (
            <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-5 py-3 text-xs text-zinc-400 shadow-2xl backdrop-blur-md">
              <span className="font-semibold text-zinc-300">No synchronized lyrics found</span>
              <span className="text-[11px] text-zinc-500">for {displayTitle} — {displayArtist}</span>
            </div>
          ) : lyrics.snapshot.state === 'error' ? (
            <div className="pointer-events-auto flex flex-col items-center gap-2.5 rounded-2xl border border-rose-900/40 bg-zinc-950/90 p-4 text-xs shadow-2xl backdrop-blur-md">
              <span className="text-zinc-200 font-medium">Unable to load lyrics</span>
              <button
                type="button"
                onClick={lyrics.retryLookup}
                className="rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-1 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 active:scale-95 transition-transform"
              >
                Retry Lookup
              </button>
            </div>
          ) : !spotifyStatus.title ? (
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-4 py-2 text-xs font-medium text-zinc-400 shadow-2xl backdrop-blur-md">
              <span>Waiting for Spotify playback...</span>
            </div>
          ) : null}
        </div>
      )}

      {/* Top Header Controls Overlay */}
      <header
        className={`pointer-events-auto absolute top-0 inset-x-0 z-50 flex items-center justify-between p-6 transition-opacity duration-500 bg-gradient-to-b from-black/80 via-black/40 to-transparent ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-zinc-800/80 bg-black text-zinc-100 shadow-md backdrop-blur-md">
            <img
              src="/vynora-logo.png"
              alt="VYNORA Logo"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100 drop-shadow-md">
              VYNORA Immersive Player
            </h1>
            <span className="text-[11px] text-zinc-400">
              {isFullscreen ? 'Borderless Fullscreen' : 'Windowed Presentation'}
            </span>
          </div>
        </div>

        {/* Center: Language / Source Switcher */}
        <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950/80 p-1 text-xs backdrop-blur-md">
          <button
            type="button"
            onClick={() => setSampleTrackIndex(null)}
            className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
              !isSampleMode
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Live Spotify
          </button>
          {SAMPLE_TRACKS.map((track, idx) => (
            <button
              key={track.id}
              type="button"
              onClick={() => {
                setSampleTrackIndex(idx);
                setSamplePositionMs(0);
              }}
              className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                (isSampleMode && effectiveSampleIndex === idx)
                  ? 'border border-zinc-700 bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {track.language}
            </button>
          ))}
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = engineRef.current?.togglePerformanceOverlay() ?? false;
              updateSettings({ showPerfDiagnostics: next });
              savePerfOverlayPreference(next);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700/60 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-mono font-medium text-emerald-400 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-emerald-300"
            title="Toggle Performance HUD (F3 or Ctrl+Shift+D)"
          >
            FPS
          </button>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700/60 bg-zinc-900/80 px-3.5 py-1.5 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-white"
            title="Toggle Fullscreen (F)"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              {isFullscreen ? (
                <>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              ) : (
                <>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              )}
            </svg>
            <span>{isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span>
          </button>

          <button
            type="button"
            onClick={handleExit}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-700/60 bg-zinc-900/80 text-zinc-400 shadow-lg backdrop-blur-md transition-colors hover:bg-rose-950/80 hover:text-rose-200"
            title="Close Fullscreen Player (Esc)"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Bottom Controls Overlay */}
      <footer
        className={`pointer-events-auto absolute bottom-0 inset-x-0 z-50 flex flex-col gap-3 p-6 transition-opacity duration-500 bg-gradient-to-t from-black/95 via-black/60 to-transparent ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubber Bar */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-400 min-w-[42px]">
            {formatTimeMs(currentPosMs)}
          </span>
          <div className="relative flex-1 h-1.5 rounded-full bg-zinc-800/80 overflow-hidden backdrop-blur-sm">
            <div
              className="h-full rounded-full transition-all duration-100"
              style={{
                width: `${progressRatio * 100}%`,
                backgroundColor: activePalette.accentCss || '#ffffff',
                boxShadow: `0 0 8px ${activePalette.accentCss || '#ffffff'}`,
              }}
            />
          </div>
          <span className="font-mono text-xs text-zinc-400 min-w-[42px] text-right">
            {formatTimeMs(durationMs)}
          </span>
        </div>

        {/* Main Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Track Metadata */}
          <div className="flex items-center gap-3.5 min-w-[200px] max-w-[320px]">
            {displayArtwork ? (
              <img
                src={displayArtwork}
                alt=""
                className="h-12 w-12 rounded-xl object-cover shadow-lg border border-white/10"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 border border-white/10">
                ♪
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-zinc-100 drop-shadow-sm">
                {displayTitle}
              </h2>
              <p className="truncate text-xs text-zinc-400">
                {displayArtist}
              </p>
            </div>
          </div>

          {/* Center: Playback Transport Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleControl('PreviousTrack')}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80 text-zinc-300 backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-white"
              title="Previous Track (Left Arrow)"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <polygon points="19 20 9 12 19 4 19 20" />
                <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => handleControl('PlayPause')}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-950 shadow-xl shadow-white/10 transition-transform hover:scale-105 active:scale-95"
              title="Play/Pause (Space)"
            >
              {isPlaying ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current ml-0.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleControl('NextTrack')}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80 text-zinc-300 backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-white"
              title="Next Track (Right Arrow)"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>

          {/* Right: Style Selector Pills & Timing Badge */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Style Pills */}
            <div className="flex rounded-xl border border-zinc-800 bg-zinc-950/80 p-1 text-xs backdrop-blur-md">
              {(
                [
                  { id: 'big-words', label: 'Big Words' },
                  { id: 'lines', label: 'Lines' },
                  { id: 'chat', label: 'Chat' },
                  { id: 'constellation', label: 'Constellation' },
                  { id: 'terminal', label: 'Terminal' },
                  { id: 'karaoke', label: 'Karaoke' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => updateSettings({ style: s.id as KineticStyleId })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    settings.style === s.id
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Background Pills */}
            <div className="flex rounded-xl border border-zinc-800 bg-zinc-950/80 p-1 text-xs backdrop-blur-md">
              {(
                [
                  { id: 'aura', label: 'Aura' },
                  { id: 'black', label: 'Black' },
                  { id: 'cover', label: 'Cover' },
                  { id: 'ambient', label: 'Motion' },
                ] as const
              ).map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => updateSettings({ background: b.id as BackgroundStyleId })}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                    settings.background === b.id
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* Confidence Badge */}
            <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md ${timingConfidenceColor}`}>
              {timingConfidenceStr}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
