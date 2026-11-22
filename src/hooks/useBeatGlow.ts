import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  type BeatGlowFrame,
  type BeatGlowPrefs,
  type BeatGlowPrefsPatch,
  DEFAULT_BEAT_GLOW_FRAME,
  DEFAULT_BEAT_GLOW_PREFS,
} from '../types/audio.ts';
import {
  type AlbumPalette,
  DEFAULT_NEUTRAL_PALETTE,
  MONOCHROME_PALETTE,
} from '../types/palette.ts';
import type { SpotifyStatus } from '../types/spotify.ts';
import { getReactiveGlowColor, type ReactiveColor } from '../utils/audioMath.ts';
import { extractPaletteFromDataUrl } from '../utils/colorExtractor.ts';
import { PaletteTransitionManager } from '../utils/colorTransition.ts';

export interface UseBeatGlowOptions {
  spotifyStatus?: SpotifyStatus | null;
  role?: 'coordinator' | 'consumer';
}

export interface UseBeatGlowReturn {
  frame: BeatGlowFrame;
  prefs: BeatGlowPrefs;
  updatePrefs: (patch: BeatGlowPrefsPatch) => Promise<void>;
  palette: AlbumPalette;
  reactiveColor: ReactiveColor;
  isAudioActive: boolean;
  isSpotifyPlaying: boolean;
}

export function useBeatGlow(options?: UseBeatGlowOptions): UseBeatGlowReturn {
  const [frame, setFrame] = useState<BeatGlowFrame>(DEFAULT_BEAT_GLOW_FRAME);
  const [prefs, setPrefs] = useState<BeatGlowPrefs>(DEFAULT_BEAT_GLOW_PREFS);
  const [palette, setPalette] = useState<AlbumPalette>(DEFAULT_NEUTRAL_PALETTE);

  const role = options?.role ?? 'consumer';
  const spotifyStatus = options?.spotifyStatus;
  const isSpotifyPlaying = Boolean(
    spotifyStatus?.connectionState === 'connected' &&
      spotifyStatus?.playbackStatus === 'playing',
  );

  const isMountedRef = useRef(true);
  const transitionRef = useRef(new PaletteTransitionManager(DEFAULT_NEUTRAL_PALETTE, 700));
  const currentTrackKeyRef = useRef<string>('');
  const extractSeqRef = useRef<number>(0);

  // Initial load of prefs, frame, and album palette
  useEffect(() => {
    isMountedRef.current = true;

    invoke<BeatGlowPrefs>('get_beat_glow_prefs')
      .then((loadedPrefs) => {
        if (isMountedRef.current && loadedPrefs) {
          setPrefs(loadedPrefs);
        }
      })
      .catch((err) => {
        console.warn('[BeatGlow] Failed to load initial prefs:', err);
      });

    invoke<BeatGlowFrame>('get_beat_glow_data')
      .then((initialFrame) => {
        if (isMountedRef.current && initialFrame) {
          setFrame(initialFrame);
        }
      })
      .catch((err) => {
        console.warn('[BeatGlow] Failed to get initial frame:', err);
      });

    invoke<AlbumPalette | null>('get_album_palette')
      .then((initialPalette) => {
        if (isMountedRef.current && initialPalette) {
          transitionRef.current.setTarget(initialPalette);
          setPalette(transitionRef.current.getPalette());
        }
      })
      .catch((err) => {
        console.warn('[BeatGlow] Failed to get initial palette:', err);
      });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Listen to Tauri events: beat-glow-data, beat-glow-prefs-changed, album-palette-changed
  useEffect(() => {
    let unlistenData: (() => void) | null = null;
    let unlistenPrefs: (() => void) | null = null;
    let unlistenPalette: (() => void) | null = null;

    listen<BeatGlowFrame>('beat-glow-data', (event) => {
      if (isMountedRef.current) {
        setFrame(event.payload);
        // Step smooth transition forward ONLY while transitioning to eliminate redundant state churn
        if (transitionRef.current.isTransitioning()) {
          const currentInterp = transitionRef.current.getPalette();
          setPalette(currentInterp);
        }
      }
    }).then((unlisten) => {
      unlistenData = unlisten;
    });

    listen<BeatGlowPrefs>('beat-glow-prefs-changed', (event) => {
      if (isMountedRef.current) {
        setPrefs(event.payload);
      }
    }).then((unlisten) => {
      unlistenPrefs = unlisten;
    });

    listen<AlbumPalette | null>('album-palette-changed', (event) => {
      if (isMountedRef.current) {
        const nextPalette = event.payload || DEFAULT_NEUTRAL_PALETTE;
        transitionRef.current.setTarget(nextPalette);
        setPalette(transitionRef.current.getPalette());
      }
    }).then((unlisten) => {
      unlistenPalette = unlisten;
    });

    return () => {
      if (unlistenData) unlistenData();
      if (unlistenPrefs) unlistenPrefs();
      if (unlistenPalette) unlistenPalette();
    };
  }, []);

  // Coordinator role: extracts palette from artwork once and publishes to Rust
  useEffect(() => {
    if (role !== 'coordinator') return;

    if (!spotifyStatus || spotifyStatus.connectionState !== 'connected') {
      if (currentTrackKeyRef.current !== 'idle::neutral') {
        currentTrackKeyRef.current = 'idle::neutral';
        transitionRef.current.setTarget(DEFAULT_NEUTRAL_PALETTE);
        setPalette(transitionRef.current.getPalette());
        invoke('set_album_palette', { palette: DEFAULT_NEUTRAL_PALETTE }).catch((err) => {
          console.warn('[BeatGlow::coordinator] Failed resetting palette:', err);
        });
      }
      return;
    }

    const artwork = spotifyStatus.artwork;
    const title = spotifyStatus.title ?? 'unknown';
    const artist = spotifyStatus.artist ?? 'unknown';
    const album = spotifyStatus.album ?? 'unknown';
    const byteLen = artwork?.byteLen ?? 0;

    const trackKey = `${title}::${artist}::${album}::${byteLen}`;
    if (trackKey === currentTrackKeyRef.current) {
      return;
    }

    currentTrackKeyRef.current = trackKey;
    const seq = ++extractSeqRef.current;

    if (!artwork || !artwork.dataUrl) {
      transitionRef.current.setTarget(DEFAULT_NEUTRAL_PALETTE);
      setPalette(transitionRef.current.getPalette());
      invoke('set_album_palette', { palette: DEFAULT_NEUTRAL_PALETTE }).catch((err) => {
        console.warn('[BeatGlow::coordinator] Failed setting neutral palette:', err);
      });
      return;
    }

    // Extract asynchronously
    void extractPaletteFromDataUrl(artwork.dataUrl, trackKey)
      .then((extracted) => {
        // Protect against stale asynchronous completion
        if (!isMountedRef.current || seq !== extractSeqRef.current) {
          return;
        }
        transitionRef.current.setTarget(extracted);
        setPalette(transitionRef.current.getPalette());
        return invoke('set_album_palette', { palette: extracted });
      })
      .catch((err) => {
        console.warn('[BeatGlow::coordinator] Palette extraction error:', err);
      });
  }, [role, spotifyStatus]);

  const updatePrefs = useCallback(async (patch: BeatGlowPrefsPatch) => {
    try {
      const updated = await invoke<BeatGlowPrefs>('set_beat_glow_prefs', { patch });
      if (isMountedRef.current) {
        setPrefs(updated);
      }
    } catch (err) {
      console.error('[BeatGlow] Failed to update prefs:', err);
    }
  }, []);

  // If Spotify is paused/stopped or disabled, dampen frame values to near zero
  const effectiveFrame = useMemo(() => {
    if (!prefs.enabled) {
      return DEFAULT_BEAT_GLOW_FRAME;
    }
    if (spotifyStatus !== undefined && !isSpotifyPlaying) {
      return {
        ...frame,
        rms: 0,
        peak: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        beat: false,
        spectrum: frame.spectrum.map((v) => v * 0.1),
        waveform: frame.waveform.map((v) => v * 0.1),
      };
    }
    return frame;
  }, [frame, prefs.enabled, spotifyStatus, isSpotifyPlaying]);

  // Active palette considering user theme setting ('artwork' vs 'monochrome')
  const activePalette = useMemo(() => {
    if (prefs.theme === 'monochrome') {
      return MONOCHROME_PALETTE;
    }
    return palette;
  }, [palette, prefs.theme]);

  const reactiveColor = useMemo(() => {
    return getReactiveGlowColor(
      effectiveFrame.bass,
      effectiveFrame.mid,
      effectiveFrame.treble,
      prefs.intensity,
      activePalette,
      effectiveFrame.beat,
    );
  }, [
    effectiveFrame.bass,
    effectiveFrame.mid,
    effectiveFrame.treble,
    effectiveFrame.beat,
    prefs.intensity,
    activePalette,
  ]);

  const isAudioActive = Boolean(
    prefs.enabled && effectiveFrame.isCapturing && effectiveFrame.rms > 0.005,
  );

  return {
    frame: effectiveFrame,
    prefs,
    updatePrefs,
    palette: activePalette,
    reactiveColor,
    isAudioActive,
    isSpotifyPlaying,
  };
}
