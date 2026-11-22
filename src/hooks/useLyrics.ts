import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetchTrackLyrics } from "../services/lyricsService.ts";
import {
  INITIAL_LYRICS_PREFS,
  INITIAL_LYRICS_SNAPSHOT,
  type LyricsResultPayload,
  type LyricsSharedSnapshot,
  type LyricsUiPrefs,
  type LyricsUiPrefsPatch,
  type RequestLyricsResponse,
} from "../types/lyrics.ts";
import type { SpotifyStatus } from "../types/spotify.ts";
import { buildTrackKey, isTrackMatch } from "../utils/lyricsMatcher.ts";
import {
  computeEffectivePositionMs,
  findActiveLyricIndex,
  findNextNonBlankLyricIndex,
} from "../utils/lyricsSync.ts";
import { parseLrc, splitPlainLyrics } from "../utils/parseLrc.ts";

const SYNC_TICK_INTERVAL_MS = 33;

export interface UseLyricsOptions {
  spotifyStatus: SpotifyStatus;
  role: "coordinator" | "consumer";
}

export interface UseLyricsReturn {
  snapshot: LyricsSharedSnapshot;
  prefs: LyricsUiPrefs;
  trackKey: string | null;
  parsedLines: ReturnType<typeof parseLrc>["lines"];
  plainLines: string[];
  hasSyncedLines: boolean;
  activeIndex: number;
  nextNonBlankIndex: number;
  effectivePositionMs: number;
  retryLookup: () => void;
  updatePrefs: (patch: LyricsUiPrefsPatch) => void;
}

export function useLyrics({
  spotifyStatus,
  role,
}: UseLyricsOptions): UseLyricsReturn {
  const [snapshot, setSnapshot] = useState<LyricsSharedSnapshot>(
    INITIAL_LYRICS_SNAPSHOT,
  );
  const [prefs, setPrefs] = useState<LyricsUiPrefs>(INITIAL_LYRICS_PREFS);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [effectivePositionMs, setEffectivePositionMs] = useState<number>(0);

  const lyricsSeqRef = useRef(0);
  const prefsSeqRef = useRef(0);
  const lastTrackKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const spotifyRef = useRef<SpotifyStatus>(spotifyStatus);
  const snapshotPerfRef = useRef<number>(performance.now());
  const lastSpotifyPosRef = useRef<number | null>(null);
  const lastSpotifyStatusRef = useRef<string | null>(null);
  const lastSpotifyTitleRef = useRef<string | null>(null);

  const currentPos = spotifyStatus.positionMs ?? spotifyStatus.timeline?.positionMs ?? null;
  const currentStatus = spotifyStatus.playbackStatus;
  const currentTitle = spotifyStatus.title;

  if (
    currentPos !== lastSpotifyPosRef.current ||
    currentStatus !== lastSpotifyStatusRef.current ||
    currentTitle !== lastSpotifyTitleRef.current
  ) {
    lastSpotifyPosRef.current = currentPos;
    lastSpotifyStatusRef.current = currentStatus;
    lastSpotifyTitleRef.current = currentTitle;
    snapshotPerfRef.current = performance.now();
  }
  spotifyRef.current = spotifyStatus;

  const trackKey = useMemo(() => buildTrackKey(spotifyStatus), [
    spotifyStatus.connectionState,
    spotifyStatus.title,
    spotifyStatus.artist,
    spotifyStatus.album,
  ]);

  // Subscribe cleanly to shared cross-window lyrics state & prefs from Rust backend
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) {
      return;
    }

    let cancelled = false;
    const unlistenFns: Array<() => void> = [];

    const setup = async () => {
      try {
        const unlistenState = await listen<LyricsSharedSnapshot>(
          "lyrics-state-changed",
          (event) => {
            if (!cancelled && event.payload) {
              lyricsSeqRef.current += 1;
              setSnapshot(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenState();
        } else {
          unlistenFns.push(unlistenState);
        }
      } catch (err) {
        console.error("[vynora::lyrics] listen lyrics-state-changed failed", err);
      }

      try {
        const unlistenOpened = await listen<LyricsSharedSnapshot>(
          "lyrics-player-opened",
          (event) => {
            if (!cancelled && event.payload) {
              lyricsSeqRef.current += 1;
              setSnapshot(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenOpened();
        } else {
          unlistenFns.push(unlistenOpened);
        }
      } catch (err) {
        console.error("[vynora::lyrics] listen lyrics-player-opened failed", err);
      }

      try {
        const unlistenPrefs = await listen<LyricsUiPrefs>(
          "lyrics-prefs-changed",
          (event) => {
            if (!cancelled && event.payload) {
              prefsSeqRef.current += 1;
              setPrefs(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenPrefs();
        } else {
          unlistenFns.push(unlistenPrefs);
        }
      } catch (err) {
        console.error("[vynora::lyrics] listen lyrics-prefs-changed failed", err);
      }

      const seqAtStart = lyricsSeqRef.current;
      void invoke<LyricsSharedSnapshot>("get_lyrics_state")
        .then((initial) => {
          if (!cancelled && lyricsSeqRef.current === seqAtStart && initial) {
            setSnapshot(initial);
          }
        })
        .catch((err) => {
          console.error("[vynora::lyrics] get_lyrics_state failed", err);
        });

      const prefsSeqAtStart = prefsSeqRef.current;
      void invoke<LyricsUiPrefs>("get_lyrics_prefs")
        .then((initialPrefs) => {
          if (!cancelled && prefsSeqRef.current === prefsSeqAtStart && initialPrefs) {
            setPrefs(initialPrefs);
          }
        })
        .catch((err) => {
          console.error("[vynora::lyrics] get_lyrics_prefs failed", err);
        });
    };

    void setup();

    // Rehydrate snapshot on focus or visibility change to ensure no missed events while hidden
    const handleRehydrate = () => {
      if (!window.__TAURI_INTERNALS__) return;
      const seqAtStart = lyricsSeqRef.current;
      void invoke<LyricsSharedSnapshot>("get_lyrics_state")
        .then((latest) => {
          if (!cancelled && lyricsSeqRef.current === seqAtStart && latest && latest.state !== "idle") {
            setSnapshot(latest);
          }
        })
        .catch(() => {});
    };

    window.addEventListener("focus", handleRehydrate);
    document.addEventListener("visibilitychange", handleRehydrate);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleRehydrate);
      document.removeEventListener("visibilitychange", handleRehydrate);
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  }, []);

  const runLookup = useCallback(
    async (statusSnapshot: SpotifyStatus, key: string, forceRefresh: boolean) => {
      if (!window.__TAURI_INTERNALS__ || !statusSnapshot.title) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await invoke<RequestLyricsResponse>("request_lyrics_lookup", {
          request: {
            trackKey: key,
            title: statusSnapshot.title,
            artist: statusSnapshot.artist,
            album: statusSnapshot.album,
            forceRefresh,
          },
        });

        if (controller.signal.aborted) {
          return;
        }

        lyricsSeqRef.current += 1;
        setSnapshot(response.snapshot);

        if (response.action !== "fetch") {
          return;
        }

        const payload: LyricsResultPayload = await fetchTrackLyrics({
          trackKey: key,
          title: statusSnapshot.title,
          artist: statusSnapshot.artist,
          album: statusSnapshot.album,
          durationMs: () => {
            return (
              spotifyRef.current.durationMs ??
              spotifyRef.current.timeline?.durationMs ??
              statusSnapshot.durationMs ??
              statusSnapshot.timeline?.durationMs ??
              null
            );
          },
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        const resolved = await invoke<LyricsSharedSnapshot>("publish_lyrics_result", {
          result: payload,
        });
        if (!controller.signal.aborted) {
          lyricsSeqRef.current += 1;
          setSnapshot(resolved);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (!controller.signal.aborted) {
          console.error("[vynora::lyrics] lookup failed", err);
          const errorPayload: LyricsResultPayload = {
            trackKey: key,
            state: "error",
            syncedLyrics: null,
            plainLyrics: null,
            matchedTrackName: null,
            matchedArtistName: null,
            matchedAlbumName: null,
            matchedDurationSec: null,
            source: "lrclib",
            error: err instanceof Error ? err.message : "Failed to fetch lyrics",
          };
          void invoke<LyricsSharedSnapshot>("publish_lyrics_result", {
            result: errorPayload,
          }).catch(() => {});
        }
      }
    },
    [],
  );

  // Coordinator effect: fetch ONLY when track identity key changes or Spotify disconnects
  useEffect(() => {
    if (role !== "coordinator" || !window.__TAURI_INTERNALS__) {
      return;
    }

    if (!trackKey) {
      abortRef.current?.abort();
      abortRef.current = null;
      if (lastTrackKeyRef.current !== null || snapshot.state !== "idle") {
        lastTrackKeyRef.current = null;
        void invoke<LyricsSharedSnapshot>("clear_lyrics_state")
          .then((cleared) => {
            lyricsSeqRef.current += 1;
            setSnapshot(cleared);
          })
          .catch(() => {});
      }
      return;
    }

    if (lastTrackKeyRef.current === trackKey) {
      return;
    }

    lastTrackKeyRef.current = trackKey;
    void runLookup(spotifyRef.current, trackKey, false);
  }, [role, trackKey, runLookup, snapshot.state]);

  // Consumer fallback: if consumer is active with a track but lyrics are idle/missing, trigger lookup
  useEffect(() => {
    if (role !== "consumer" || !window.__TAURI_INTERNALS__ || !trackKey) {
      return;
    }

    if (snapshot.state === "idle" && spotifyRef.current.title) {
      void invoke<LyricsSharedSnapshot>("get_lyrics_state")
        .then((latest) => {
          if (latest && latest.state !== "idle") {
            lyricsSeqRef.current += 1;
            setSnapshot(latest);
          } else {
            void runLookup(spotifyRef.current, trackKey, false);
          }
        })
        .catch(() => {});
    }
  }, [role, trackKey, snapshot.state, runLookup]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const retryLookup = useCallback(() => {
    if (!trackKey) {
      return;
    }
    void runLookup(spotifyRef.current, trackKey, true);
  }, [trackKey, runLookup]);

  const updatePrefs = useCallback((patch: LyricsUiPrefsPatch) => {
    if (!window.__TAURI_INTERNALS__) {
      setPrefs((prev) => ({ ...prev, ...patch }));
      return;
    }
    void invoke<LyricsUiPrefs>("set_lyrics_prefs", { patch })
      .then((nextPrefs) => {
        prefsSeqRef.current += 1;
        setPrefs(nextPrefs);
      })
      .catch((err) => {
        console.error("[vynora::lyrics] set_lyrics_prefs failed", err);
      });
  }, []);

  // Check whether current snapshot belongs to the active track (resilient to GSMTC duration updates)
  const isTrackActive = Boolean(
    trackKey &&
      (snapshot.trackKey === trackKey ||
        isTrackMatch(spotifyStatus, snapshot)),
  );

  const activeResult = isTrackActive ? snapshot.result : null;

  const parsedDoc = useMemo(() => {
    if (
      !isTrackActive ||
      snapshot.state !== "synced" ||
      !activeResult?.syncedLyrics
    ) {
      return { lines: [], hasSyncedLines: false };
    }
    return parseLrc(activeResult.syncedLyrics);
  }, [isTrackActive, snapshot.state, activeResult?.syncedLyrics]);

  const plainLines = useMemo(() => {
    if (
      !isTrackActive ||
      snapshot.state !== "plain" ||
      !activeResult?.plainLyrics
    ) {
      return [];
    }
    return splitPlainLyrics(activeResult.plainLyrics);
  }, [isTrackActive, snapshot.state, activeResult?.plainLyrics]);

  // Recalculate active line immediately whenever GSMTC status or parsed lines change,
  // and run lightweight 33ms tick ONLY while playing synchronized lyrics.
  useEffect(() => {
    if (!parsedDoc.hasSyncedLines || parsedDoc.lines.length === 0) {
      setActiveIndex((prev) => (prev === -1 ? prev : -1));
      return;
    }

    const updateActiveLine = () => {
      const posMs = computeEffectivePositionMs(
        spotifyRef.current,
        snapshotPerfRef.current,
        performance.now(),
      );
      setEffectivePositionMs(posMs ?? 0);
      const next = findActiveLyricIndex(parsedDoc.lines, posMs);
      setActiveIndex((prev) => (prev === next ? prev : next));
    };

    updateActiveLine();

    const isPlaying =
      spotifyStatus.connectionState === "connected" &&
      spotifyStatus.playbackStatus === "playing";
    if (!isPlaying) {
      return;
    }

    const timer = window.setInterval(updateActiveLine, SYNC_TICK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [
    parsedDoc,
    spotifyStatus.connectionState,
    spotifyStatus.playbackStatus,
    spotifyStatus.positionMs,
    spotifyStatus.timeline?.positionMs,
  ]);

  const nextNonBlankIndex = useMemo(() => {
    if (!parsedDoc.hasSyncedLines) {
      return -1;
    }
    return findNextNonBlankLyricIndex(parsedDoc.lines, activeIndex);
  }, [parsedDoc, activeIndex]);

  return {
    snapshot,
    prefs,
    trackKey,
    parsedLines: parsedDoc.lines,
    plainLines,
    hasSyncedLines: parsedDoc.hasSyncedLines,
    activeIndex,
    nextNonBlankIndex,
    effectivePositionMs,
    retryLookup,
    updatePrefs,
  };
}
