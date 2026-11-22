import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useBeatGlow } from "../hooks/useBeatGlow";
import { useLyrics } from "../hooks/useLyrics";
import {
  INITIAL_ISLAND_STATE,
  type IslandUiState,
} from "../types/island";
import {
  INITIAL_SPOTIFY_STATUS,
  type SpotifyStatus,
} from "../types/spotify";
import { formatPlaybackStatus, formatTimeMs } from "../utils/formatTime";

const EXPAND_COLLAPSE_DURATION_MS = 300;

export default function IslandApp() {
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus>(
    INITIAL_SPOTIFY_STATUS,
  );
  const [islandState, setIslandState] = useState<IslandUiState>(
    INITIAL_ISLAND_STATE,
  );
  const [visualExpanded, setVisualExpanded] = useState(false);

  const lyrics = useLyrics({
    spotifyStatus,
    role: "consumer",
  });

  const beatGlow = useBeatGlow({ spotifyStatus });

  const cardRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const spotifySeqRef = useRef(0);
  const islandSeqRef = useRef(0);

  useEffect(() => {
    console.info("[needle::island-ui] IslandApp mounted", {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    });

    const unlistenFns: Array<() => void> = [];
    let cancelled = false;

    const applyIslandState = (next: IslandUiState, source: string) => {
      setIslandState(next);
      console.info(`[needle::island-ui] island state (${source})`, next);

      if (!next.visible) {
        if (collapseTimerRef.current !== null) {
          window.clearTimeout(collapseTimerRef.current);
          collapseTimerRef.current = null;
        }
        setVisualExpanded(false);
      } else if (collapseTimerRef.current === null) {
        setVisualExpanded(next.expanded);
      }
    };

    const setup = async () => {
      try {
        const unlistenSpotify = await listen<SpotifyStatus>(
          "spotify-status-changed",
          (event) => {
            if (!cancelled && event.payload) {
              spotifySeqRef.current += 1;
              console.info("[needle::island-ui] spotify-status-changed", {
                connectionState: event.payload.connectionState,
                playbackStatus: event.payload.playbackStatus,
                title: event.payload.title,
              });
              setSpotifyStatus(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenSpotify();
        } else {
          unlistenFns.push(unlistenSpotify);
        }
      } catch (err) {
        console.error("[needle::island-ui] listen spotify-status-changed failed", err);
      }

      try {
        const unlistenIsland = await listen<IslandUiState>(
          "island-state-changed",
          (event) => {
            if (cancelled || !event.payload) {
              return;
            }
            islandSeqRef.current += 1;
            applyIslandState(event.payload, "event");
          },
        );
        if (cancelled) {
          unlistenIsland();
        } else {
          unlistenFns.push(unlistenIsland);
        }
      } catch (err) {
        console.error("[needle::island-ui] listen island-state-changed failed", err);
      }

      const islandSeqAtStart = islandSeqRef.current;
      void invoke<IslandUiState>("get_island_state")
        .then((initialIsland) => {
          if (!cancelled && islandSeqRef.current === islandSeqAtStart) {
            applyIslandState(initialIsland, "initial_ipc");
          }
        })
        .catch((err) => {
          console.error("[needle::island-ui] get_island_state failed", err);
        });

      const spotifySeqAtStart = spotifySeqRef.current;
      void invoke<SpotifyStatus>("get_spotify_status")
        .then((initialSpotify) => {
          if (!cancelled && spotifySeqRef.current === spotifySeqAtStart) {
            console.info("[needle::island-ui] initial get_spotify_status", {
              connectionState: initialSpotify.connectionState,
              playbackStatus: initialSpotify.playbackStatus,
              title: initialSpotify.title,
            });
            setSpotifyStatus(initialSpotify);
          }
        })
        .catch((err) => {
          console.error("[needle::island-ui] get_spotify_status failed", err);
        });

      void invoke("notify_island_ready").catch((err) => {
        console.error("[needle::island-ui] notify_island_ready failed", err);
      });
    };

    void setup();

    return () => {
      cancelled = true;
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    console.info("[needle::island-ui] render geometry", {
      visible: islandState.visible,
      visualExpanded,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      opacity: style.opacity,
      visibility: style.visibility,
      windowInner: { width: window.innerWidth, height: window.innerHeight },
    });
  }, [islandState.visible, visualExpanded]);

  const handleToggleExpand = async () => {
    if (!islandState.visible) {
      return;
    }

    if (!visualExpanded) {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }

      try {
        const nextState = await invoke<IslandUiState>("set_island_expanded", {
          expanded: true,
        });
        islandSeqRef.current += 1;
        setIslandState(nextState);
      } catch (err) {
        console.error("[needle::island-ui] set_island_expanded(true) failed", err);
      }

      setVisualExpanded(true);
    } else {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }

      setVisualExpanded(false);
      collapseTimerRef.current = window.setTimeout(() => {
        collapseTimerRef.current = null;
        void invoke<IslandUiState>("set_island_expanded", {
          expanded: false,
        })
          .then((nextState) => {
            islandSeqRef.current += 1;
            setIslandState(nextState);
          })
          .catch((err) => {
            console.error("[needle::island-ui] set_island_expanded(false) failed", err);
          });
      }, EXPAND_COLLAPSE_DURATION_MS);
    }
  };

  const isConnected = spotifyStatus.connectionState === "connected";
  const isPlaying = spotifyStatus.playbackStatus === "playing";
  const isPaused = spotifyStatus.playbackStatus === "paused";
  const isShown = islandState.visible;

  const displayTitle = isConnected
    ? (spotifyStatus.title ?? "Title unavailable")
    : "No active Spotify";
  const displayArtist = isConnected
    ? (spotifyStatus.artist ?? "Artist unavailable")
    : "Waiting for playback";
  const displayAlbum = isConnected
    ? (spotifyStatus.album ?? "Album unavailable")
    : "Open Spotify Desktop";
  const playbackLabel = isConnected
    ? formatPlaybackStatus(spotifyStatus.playbackStatus)
    : "Not detected";

  const durationMs =
    spotifyStatus.durationMs ?? spotifyStatus.timeline?.durationMs ?? null;
  const positionMs =
    spotifyStatus.positionMs ?? spotifyStatus.timeline?.positionMs ?? null;
  const progressPercent =
    durationMs !== null && durationMs > 0 && positionMs !== null
      ? Math.max(0, Math.min(100, (positionMs / durationMs) * 100))
      : 0;

  const isCurrentLyricsTrack = Boolean(
    lyrics.trackKey && lyrics.snapshot.trackKey === lyrics.trackKey,
  );
  const currentLyricLine =
    isCurrentLyricsTrack &&
    lyrics.hasSyncedLines &&
    lyrics.activeIndex >= 0
      ? lyrics.parsedLines[lyrics.activeIndex]
      : null;
  const nextLyricLine =
    isCurrentLyricsTrack &&
    lyrics.hasSyncedLines &&
    lyrics.nextNonBlankIndex >= 0
      ? lyrics.parsedLines[lyrics.nextNonBlankIndex]
      : null;

  return (
    <div className="flex h-full w-full items-start justify-center bg-transparent pt-1">
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        onClick={() => void handleToggleExpand()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void handleToggleExpand();
          }
        }}
        aria-expanded={visualExpanded}
        aria-label={
          visualExpanded
            ? "Collapse VYNORA Dynamic Island"
            : "Expand VYNORA Dynamic Island"
        }
        style={{
          boxShadow:
            beatGlow.prefs.islandGlowEnabled &&
            beatGlow.prefs.enabled &&
            beatGlow.isAudioActive
              ? beatGlow.reactiveColor.cssBoxShadow
              : undefined,
        }}
        className={`group relative cursor-pointer overflow-hidden border border-white/[0.09] bg-[#070709]/95 text-left outline-none transition-[width,height,border-radius,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:border-white/25 ${
          isShown
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-2 scale-[0.96] opacity-0"
        } ${
          visualExpanded
            ? "h-[208px] w-[388px] rounded-[26px] shadow-[0_14px_28px_-6px_rgba(0,0,0,0.85)]"
            : "h-[48px] w-[296px] rounded-[24px] shadow-[0_10px_20px_-5px_rgba(0,0,0,0.8)] hover:border-white/[0.15]"
        }`}
      >
        {/* Compact layout */}
        <div
          aria-hidden={visualExpanded}
          className={`absolute inset-0 flex h-[48px] items-center gap-2.5 px-2.5 transition-opacity duration-200 ${
            visualExpanded ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/10 bg-zinc-900">
            {spotifyStatus.artwork ? (
              <img
                src={spotifyStatus.artwork.dataUrl}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <circle cx="12" cy="12" r="8.5" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium leading-tight tracking-tight text-zinc-100">
              {displayTitle}
            </p>
            <p className="truncate text-[11px] leading-tight text-zinc-400">
              {displayArtist}
            </p>
          </div>

          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.04]"
            title={playbackLabel}
          >
            {isPlaying ? (
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3 text-emerald-400"
                fill="currentColor"
              >
                <path d="M5.2 3.3a.6.6 0 0 0-.9.52v8.36a.6.6 0 0 0 .9.52l7.1-4.18a.6.6 0 0 0 0-1.04L5.2 3.3Z" />
              </svg>
            ) : isPaused ? (
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3 text-amber-300/90"
                fill="currentColor"
              >
                <rect x="4.5" y="3.5" width="2.4" height="9" rx="0.8" />
                <rect x="9.1" y="3.5" width="2.4" height="9" rx="0.8" />
              </svg>
            ) : (
              <span className="h-2 w-2 rounded-full bg-zinc-500" />
            )}
          </div>

          {beatGlow.prefs.islandGlowEnabled &&
            beatGlow.prefs.enabled &&
            beatGlow.isAudioActive && (
              <div
                className="flex items-end gap-[1.5px] h-3.5 shrink-0 pr-0.5"
                title="Audio reactive loopback active"
              >
                <div
                  className="w-[2px] rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(2, Math.round(beatGlow.frame.bass * 14))}px`,
                    backgroundColor: beatGlow.palette.dominantCss,
                  }}
                />
                <div
                  className="w-[2px] rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(2, Math.round(beatGlow.frame.mid * 14))}px`,
                    backgroundColor: beatGlow.palette.secondaryCss,
                  }}
                />
                <div
                  className="w-[2px] rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(2, Math.round(beatGlow.frame.treble * 14))}px`,
                    backgroundColor: beatGlow.palette.accentCss,
                  }}
                />
              </div>
            )}
        </div>

        {/* Expanded layout */}
        <div
          aria-hidden={!visualExpanded}
          className={`absolute inset-0 flex h-[208px] w-[388px] flex-col p-4 transition-opacity duration-200 ${
            visualExpanded
              ? "opacity-100 delay-75"
              : "pointer-events-none opacity-0"
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[14px] border border-white/10 bg-zinc-900 shadow-[0_6px_18px_rgba(0,0,0,0.65)]">
              {spotifyStatus.artwork ? (
                <img
                  src={spotifyStatus.artwork.dataUrl}
                  alt={
                    spotifyStatus.album
                      ? `${spotifyStatus.album} album artwork`
                      : "Album artwork"
                  }
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-600">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="12" cy="12" r="8.5" />
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isPlaying
                        ? "bg-emerald-400"
                        : isPaused
                          ? "bg-amber-400/90"
                          : "bg-zinc-500"
                    }`}
                  />
                  <span className="text-[10.5px] font-medium tracking-wide text-zinc-400 uppercase">
                    {playbackLabel}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    lyrics.updatePrefs({
                      islandLyricsEnabled: !lyrics.prefs.islandLyricsEnabled,
                    });
                  }}
                  aria-pressed={lyrics.prefs.islandLyricsEnabled}
                  aria-label="Toggle Dynamic Island lyrics preview"
                  title={
                    lyrics.prefs.islandLyricsEnabled
                      ? "Hide lyrics preview"
                      : "Show lyrics preview"
                  }
                  className={`flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition ${
                    lyrics.prefs.islandLyricsEnabled
                      ? "border-white/15 bg-white/[0.09] text-zinc-200"
                      : "border-white/[0.06] bg-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <span>♪</span>
                  <span>Lyrics</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    beatGlow.updatePrefs({
                      islandGlowEnabled: !beatGlow.prefs.islandGlowEnabled,
                    });
                  }}
                  aria-pressed={beatGlow.prefs.islandGlowEnabled}
                  aria-label="Toggle Dynamic Island audio reactive glow"
                  title={
                    beatGlow.prefs.islandGlowEnabled
                      ? "Disable audio reactive glow"
                      : "Enable audio reactive glow"
                  }
                  style={
                    beatGlow.prefs.islandGlowEnabled
                      ? {
                          borderColor: `rgba(${beatGlow.palette.dominant.r}, ${beatGlow.palette.dominant.g}, ${beatGlow.palette.dominant.b}, 0.45)`,
                          backgroundColor: `rgba(${beatGlow.palette.dominant.r}, ${beatGlow.palette.dominant.g}, ${beatGlow.palette.dominant.b}, 0.18)`,
                          color: beatGlow.palette.accentCss,
                          boxShadow: `0 0 10px rgba(${beatGlow.palette.dominant.r}, ${beatGlow.palette.dominant.g}, ${beatGlow.palette.dominant.b}, 0.35)`,
                        }
                      : undefined
                  }
                  className={`flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition ${
                    beatGlow.prefs.islandGlowEnabled
                      ? ""
                      : "border-white/[0.06] bg-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <span>⚡</span>
                  <span>Glow</span>
                </button>
              </div>

              <p
                className="mt-1 truncate text-[15px] font-semibold leading-snug tracking-tight text-zinc-50"
                title={spotifyStatus.title ?? undefined}
              >
                {displayTitle}
              </p>
              <p
                className="truncate text-[13px] leading-snug text-zinc-300"
                title={spotifyStatus.artist ?? undefined}
              >
                {displayArtist}
              </p>
              <p
                className="truncate text-[11.5px] leading-snug text-zinc-500"
                title={spotifyStatus.album ?? undefined}
              >
                {displayAlbum}
              </p>
            </div>
          </div>

          {/* Compact synchronized lyrics preview strip */}
          <div className="mt-2.5 flex min-h-[38px] flex-col justify-center rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-1.5">
            {!lyrics.prefs.islandLyricsEnabled ? (
              <p className="truncate text-[11px] text-zinc-500">
                Lyrics preview hidden
              </p>
            ) : !isConnected ? (
              <p className="truncate text-[11px] text-zinc-500">
                Waiting for Spotify playback
              </p>
            ) : !isCurrentLyricsTrack || lyrics.snapshot.state === "loading" ? (
              <p className="truncate text-[11px] text-zinc-400">
                Loading synchronized lyrics...
              </p>
            ) : lyrics.snapshot.state === "synced" && lyrics.hasSyncedLines ? (
              <>
                <p className="truncate text-[12px] font-medium leading-[1.4] text-zinc-100">
                  {currentLyricLine
                    ? currentLyricLine.isBlank
                      ? "♪ · ♪"
                      : currentLyricLine.text
                    : nextLyricLine
                      ? `Up next: ${nextLyricLine.text}`
                      : "♪ · ♪"}
                </p>
                {nextLyricLine && currentLyricLine && (
                  <p className="truncate text-[10.5px] leading-[1.35] text-zinc-500">
                    {nextLyricLine.text}
                  </p>
                )}
              </>
            ) : lyrics.snapshot.state === "plain" ? (
              <p className="truncate text-[11px] text-zinc-400">
                Unsynchronized lyrics available in VYNORA
              </p>
            ) : lyrics.snapshot.state === "instrumental" ? (
              <p className="truncate text-[11px] text-zinc-400">
                Instrumental track
              </p>
            ) : (
              <p className="truncate text-[11px] text-zinc-500">
                {lyrics.snapshot.state === "error"
                  ? "Lyrics temporarily unreachable"
                  : "Lyrics unavailable for this track"}
              </p>
            )}
          </div>

          {/* Mini audio reactive equalizer strip */}
          {beatGlow.prefs.islandGlowEnabled &&
            beatGlow.prefs.enabled &&
            beatGlow.isAudioActive && (
              <div
                className="my-1.5 flex items-end justify-between gap-[3px] h-3 px-1"
                title="Live loopback spectrum"
              >
                {beatGlow.frame.spectrum.slice(0, 32).map((val, idx) => {
                  const barColor =
                    idx < 10
                      ? beatGlow.palette.dominantCss
                      : idx < 22
                        ? beatGlow.palette.secondaryCss
                        : beatGlow.palette.accentCss;
                  return (
                    <div
                      key={idx}
                      className="w-1 rounded-full transition-all duration-75"
                      style={{
                        height: `${Math.max(2, Math.round(val * beatGlow.prefs.intensity * 12))}px`,
                        backgroundColor: barColor,
                        opacity: 0.85,
                      }}
                    />
                  );
                })}
              </div>
            )}

          <div className="mt-auto space-y-1.5 pt-2">
            <div
              role="progressbar"
              aria-label="Track playback progress"
              aria-valuemin={0}
              aria-valuemax={durationMs ?? 0}
              aria-valuenow={positionMs ?? 0}
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  isPlaying ? "bg-zinc-100" : "bg-zinc-500"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-zinc-400">
              <span>{formatTimeMs(positionMs)}</span>
              <span>{formatTimeMs(durationMs)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
