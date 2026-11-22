import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import VinylDisc from "./VinylDisc";
import { useBeatGlow } from "../hooks/useBeatGlow";
import { useLyrics } from "../hooks/useLyrics";
import {
  INITIAL_SPOTIFY_STATUS,
  type SpotifyStatus,
} from "../types/spotify";
import {
  INITIAL_VINYL_STATE,
  type MediaControlAction,
  type VinylUiState,
} from "../types/vinyl";
import { formatPlaybackStatus, formatTimeMs } from "../utils/formatTime";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const RESIZE_ZONES: Array<{
  direction: ResizeDirection;
  className: string;
}> = [
  { direction: "North", className: "inset-x-3 top-0 h-1.5 cursor-n-resize" },
  { direction: "South", className: "inset-x-3 bottom-0 h-1.5 cursor-s-resize" },
  { direction: "West", className: "inset-y-3 left-0 w-1.5 cursor-w-resize" },
  { direction: "East", className: "inset-y-3 right-0 w-1.5 cursor-e-resize" },
  { direction: "NorthWest", className: "top-0 left-0 h-3 w-3 cursor-nw-resize" },
  { direction: "NorthEast", className: "top-0 right-0 h-3 w-3 cursor-ne-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-3 w-3 cursor-sw-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-3.5 w-3.5 cursor-se-resize" },
];

export default function VinylApp() {
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus>(
    INITIAL_SPOTIFY_STATUS,
  );
  const [vinylState, setVinylState] = useState<VinylUiState>(
    INITIAL_VINYL_STATE,
  );
  const [controlBusy, setControlBusy] = useState(false);

  const lyrics = useLyrics({
    spotifyStatus,
    role: "consumer",
  });

  const beatGlow = useBeatGlow({ spotifyStatus });

  const spotifySeqRef = useRef(0);
  const vinylSeqRef = useRef(0);

  useEffect(() => {
    const unlistenFns: Array<() => void> = [];
    let cancelled = false;

    const setup = async () => {
      try {
        const unlistenSpotify = await listen<SpotifyStatus>(
          "spotify-status-changed",
          (event) => {
            if (!cancelled && event.payload) {
              spotifySeqRef.current += 1;
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
        console.error("[needle::vinyl-ui] listen spotify-status-changed failed", err);
      }

      try {
        const unlistenVinyl = await listen<VinylUiState>(
          "vinyl-state-changed",
          (event) => {
            if (!cancelled && event.payload) {
              vinylSeqRef.current += 1;
              setVinylState(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenVinyl();
        } else {
          unlistenFns.push(unlistenVinyl);
        }
      } catch (err) {
        console.error("[needle::vinyl-ui] listen vinyl-state-changed failed", err);
      }

      const vinylSeqAtStart = vinylSeqRef.current;
      void invoke<VinylUiState>("get_vinyl_state")
        .then((initialVinyl) => {
          if (!cancelled && vinylSeqRef.current === vinylSeqAtStart) {
            setVinylState(initialVinyl);
          }
        })
        .catch((err) => {
          console.error("[needle::vinyl-ui] get_vinyl_state failed", err);
        });

      const spotifySeqAtStart = spotifySeqRef.current;
      void invoke<SpotifyStatus>("get_spotify_status")
        .then((initialSpotify) => {
          if (!cancelled && spotifySeqRef.current === spotifySeqAtStart) {
            setSpotifyStatus(initialSpotify);
          }
        })
        .catch((err) => {
          console.error("[needle::vinyl-ui] get_spotify_status failed", err);
        });

      void invoke("notify_vinyl_ready").catch((err) => {
        console.error("[needle::vinyl-ui] notify_vinyl_ready failed", err);
      });
    };

    void setup();

    return () => {
      cancelled = true;
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  }, []);

  const handleToggleExpanded = () => {
    void invoke<VinylUiState>("set_vinyl_expanded", {
      expanded: !vinylState.expanded,
    })
      .then((next) => {
        vinylSeqRef.current += 1;
        setVinylState(next);
      })
      .catch((err) => {
        console.error("[needle::vinyl-ui] set_vinyl_expanded failed", err);
      });
  };

  const handleToggleAlwaysOnTop = () => {
    void invoke<VinylUiState>("set_vinyl_always_on_top", {
      alwaysOnTop: !vinylState.alwaysOnTop,
    })
      .then((next) => {
        vinylSeqRef.current += 1;
        setVinylState(next);
      })
      .catch((err) => {
        console.error("[needle::vinyl-ui] set_vinyl_always_on_top failed", err);
      });
  };

  const handleOpenMainWindow = () => {
    void invoke("open_main_window").catch((err) => {
      console.error("[needle::vinyl-ui] open_main_window failed", err);
    });
  };

  const handleHideVinyl = () => {
    void invoke<VinylUiState>("hide_vinyl")
      .then((next) => {
        vinylSeqRef.current += 1;
        setVinylState(next);
      })
      .catch((err) => {
        console.error("[needle::vinyl-ui] hide_vinyl failed", err);
      });
  };

  const handleTransport = (action: MediaControlAction) => {
    if (!isConnected || controlBusy) {
      return;
    }
    setControlBusy(true);
    void invoke<SpotifyStatus>("control_spotify_playback", { action })
      .then((nextStatus) => {
        spotifySeqRef.current += 1;
        setSpotifyStatus(nextStatus);
      })
      .catch((err) => {
        console.warn("[needle::vinyl-ui] GSMTC playback control error", err);
      })
      .finally(() => {
        setControlBusy(false);
      });
  };

  const handleStartDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) {
      return;
    }
    void getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.error("[needle::vinyl-ui] startDragging failed", err);
      });
  };

  const handleStartResize = (
    direction: ResizeDirection,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    void getCurrentWindow()
      .startResizeDragging(direction)
      .catch((err) => {
        console.error("[needle::vinyl-ui] startResizeDragging failed", err);
      });
  };

  const isConnected = spotifyStatus.connectionState === "connected";
  const isUnavailable = spotifyStatus.connectionState === "unavailable";
  const isPlaying = isConnected && spotifyStatus.playbackStatus === "playing";
  const isPaused = isConnected && spotifyStatus.playbackStatus === "paused";
  const isExpanded = vinylState.expanded;

  const displayTitle = isConnected
    ? (spotifyStatus.title ?? "Title unavailable")
    : isUnavailable
      ? "Monitor unavailable"
      : "Waiting for Spotify";
  const displayArtist = isConnected
    ? (spotifyStatus.artist ?? "Artist unavailable")
    : isUnavailable
      ? "Windows media session error"
      : "Start playback in Spotify";
  const displayAlbum = isConnected
    ? (spotifyStatus.album ?? "Album unavailable")
    : "No active session";
  const statusBadge = isConnected
    ? formatPlaybackStatus(spotifyStatus.playbackStatus)
    : isUnavailable
      ? "Unavailable"
      : "Idle";

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
    <div className="relative h-full w-full bg-transparent p-3">
      {/* Main obsidian turntable container */}
      <div
        onPointerDown={handleStartDrag}
        style={{
          boxShadow:
            beatGlow.prefs.vinylGlowEnabled &&
            beatGlow.prefs.enabled &&
            beatGlow.isAudioActive
              ? beatGlow.reactiveColor.cssBoxShadow
              : undefined,
        }}
        className="group relative flex h-full w-full flex-col overflow-hidden rounded-[22px] border border-white/[0.09] bg-[#09090c]/95 shadow-[0_10px_24px_rgba(0,0,0,0.72)] backdrop-blur-2xl"
      >
        {/* Subtle ambient specular top wash */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/[0.035] to-transparent"
        />

        {/* Drag header bar & window controls */}
        <header
          data-tauri-drag-region
          className="relative z-20 flex shrink-0 cursor-grab items-center justify-between gap-2 px-3.5 pt-2.5 pb-1 active:cursor-grabbing"
        >
          <div className="pointer-events-none flex min-w-0 items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                isPlaying
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]"
                  : isPaused
                    ? "bg-amber-400/90"
                    : "bg-zinc-600"
              }`}
            />
            <span className="truncate text-[10px] font-medium tracking-[0.14em] text-zinc-400 uppercase">
              {statusBadge}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Optional Lyrics toggle */}
            <button
              type="button"
              onClick={() =>
                lyrics.updatePrefs({
                  vinylLyricsEnabled: !lyrics.prefs.vinylLyricsEnabled,
                })
              }
              aria-pressed={lyrics.prefs.vinylLyricsEnabled}
              aria-label={
                lyrics.prefs.vinylLyricsEnabled
                  ? "Hide lyrics on vinyl player"
                  : "Show lyrics on vinyl player"
              }
              title={
                lyrics.prefs.vinylLyricsEnabled
                  ? "Lyrics: On"
                  : "Lyrics: Off"
              }
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border text-[11px] font-medium transition ${
                lyrics.prefs.vinylLyricsEnabled
                  ? "border-white/20 bg-white/[0.11] text-zinc-100"
                  : "border-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              }`}
            >
              ♪
            </button>

            {/* Audio reactive Beat Glow toggle */}
            <button
              type="button"
              onClick={() =>
                beatGlow.updatePrefs({
                  vinylGlowEnabled: !beatGlow.prefs.vinylGlowEnabled,
                })
              }
              aria-pressed={beatGlow.prefs.vinylGlowEnabled}
              aria-label={
                beatGlow.prefs.vinylGlowEnabled
                  ? "Turn off audio reactive vinyl glow"
                  : "Turn on audio reactive vinyl glow"
              }
              title={
                beatGlow.prefs.vinylGlowEnabled
                  ? "Beat Glow: On"
                  : "Beat Glow: Off"
              }
              style={
                beatGlow.prefs.vinylGlowEnabled
                  ? {
                      borderColor: `rgba(${beatGlow.palette.dominant.r}, ${beatGlow.palette.dominant.g}, ${beatGlow.palette.dominant.b}, 0.45)`,
                      backgroundColor: `rgba(${beatGlow.palette.dominant.r}, ${beatGlow.palette.dominant.g}, ${beatGlow.palette.dominant.b}, 0.18)`,
                      color: beatGlow.palette.accentCss,
                      boxShadow: `0 0 10px rgba(${beatGlow.palette.dominant.r}, ${beatGlow.palette.dominant.g}, ${beatGlow.palette.dominant.b}, 0.35)`,
                    }
                  : undefined
              }
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border text-[11px] font-medium transition ${
                beatGlow.prefs.vinylGlowEnabled
                  ? ""
                  : "border-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              }`}
            >
              ⚡
            </button>

            {/* Pin / Always on Top toggle */}
            <button
              type="button"
              onClick={handleToggleAlwaysOnTop}
              aria-pressed={vinylState.alwaysOnTop}
              aria-label={
                vinylState.alwaysOnTop
                  ? "Unpin vinyl from top"
                  : "Keep vinyl always on top"
              }
              title={
                vinylState.alwaysOnTop ? "Always on top: On" : "Always on top: Off"
              }
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border transition ${
                vinylState.alwaysOnTop
                  ? "border-white/20 bg-white/[0.11] text-zinc-100"
                  : "border-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5.5 2.5h5l-.8 3.6 1.8 1.9v1H4.5V8l1.8-1.9-.8-3.6Z" />
                <path d="M8 9v4.5" />
              </svg>
            </button>

            {/* Compact / Expanded toggle */}
            <button
              type="button"
              onClick={handleToggleExpanded}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded ? "Switch to compact vinyl layout" : "Expand vinyl layout"
              }
              title={isExpanded ? "Compact view" : "Expanded view"}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
            >
              {isExpanded ? (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2" />
                  <path d="M6.5 3.2v9.6" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.8 2.8h3.4v3.4M6.2 13.2H2.8V9.8M13.2 2.8 9.2 6.8M2.8 13.2l4-4" />
                </svg>
              )}
            </button>

            {/* Open Main VYNORA app */}
            <button
              type="button"
              onClick={handleOpenMainWindow}
              aria-label="Open VYNORA main window"
              title="Open VYNORA"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2.5" y="3" width="11" height="10" rx="2" />
                <path d="M6 8h4M8 6v4" />
              </svg>
            </button>

            {/* Hide vinyl widget */}
            <button
              type="button"
              onClick={handleHideVinyl}
              aria-label="Hide vinyl player"
              title="Hide vinyl player"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-100"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
              </svg>
            </button>
          </div>
        </header>

        {/* Body */}
        {isExpanded ? (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-between px-4 pb-3.5 pt-1">
            {/* Turntable + Sleeve stage */}
            <div className="flex min-h-0 flex-1 items-center gap-4">
              {/* Album sleeve + emerging vinyl */}
              <div className="relative flex shrink-0 items-center pr-3">
                {/* Square Album Sleeve */}
                <div className="relative z-10 h-[clamp(96px,41vh,184px)] w-[clamp(96px,41vh,184px)] shrink-0 overflow-hidden rounded-[14px] border border-white/[0.12] bg-zinc-900 shadow-[0_14px_28px_rgba(0,0,0,0.75)]">
                  {spotifyStatus.artwork ? (
                    <img
                      src={spotifyStatus.artwork.dataUrl}
                      alt={
                        spotifyStatus.album
                          ? `${spotifyStatus.album} album sleeve`
                          : "Album sleeve artwork"
                      }
                      draggable={false}
                      className="h-full w-full object-cover transition-opacity duration-500"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900 via-[#101014] to-zinc-950 p-3 text-center">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-8 w-8 text-zinc-700"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.35"
                      >
                        <circle cx="12" cy="12" r="8.5" />
                        <circle cx="12" cy="12" r="2.2" />
                      </svg>
                      <span className="text-[10px] font-medium tracking-wider text-zinc-600 uppercase">
                        Vinyl Sleeve
                      </span>
                    </div>
                  )}

                  {/* Sleeve spine crease & rim sheen */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/45 to-transparent"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-black/50"
                  />
                </div>

                {/* Emerging Rotating Vinyl + Tonearm */}
                <div className="relative -ml-[clamp(26px,11vh,48px)] flex items-center">
                  <VinylDisc
                    isPlaying={isPlaying}
                    isConnected={isConnected}
                    artwork={spotifyStatus.artwork}
                    album={spotifyStatus.album}
                    sizeClassName="h-[clamp(108px,46vh,204px)] w-[clamp(108px,46vh,204px)]"
                    glowEnabled={
                      beatGlow.prefs.vinylGlowEnabled && beatGlow.prefs.enabled
                    }
                    isAudioActive={beatGlow.isAudioActive}
                    palette={beatGlow.palette}
                    reactiveColor={beatGlow.reactiveColor}
                    bass={beatGlow.frame.bass}
                    beat={beatGlow.frame.beat}
                  />

                  {/* Subtle mechanical tonearm */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 64 96"
                    className={`pointer-events-none -top-[5%] -right-[8%] absolute z-20 h-[52%] w-[34%] origin-[48px_14px] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isPlaying ? "rotate-[16deg]" : "-rotate-[14deg]"
                    }`}
                  >
                    <circle
                      cx="48"
                      cy="14"
                      r="7"
                      fill="#18181b"
                      stroke="rgba(255,255,255,0.22)"
                      strokeWidth="1.5"
                    />
                    <circle cx="48" cy="14" r="2.5" fill="#d4d4d8" />
                    <path
                      d="M48 16 L41 56 L30 74"
                      fill="none"
                      stroke="#a1a1aa"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <rect
                      x="25"
                      y="71"
                      width="8"
                      height="12"
                      rx="2"
                      transform="rotate(24 29 77)"
                      fill="#27272a"
                      stroke="rgba(255,255,255,0.28)"
                      strokeWidth="1"
                    />
                  </svg>
                </div>
              </div>

              {/* Editorial Track Metadata */}
              <div className="min-w-0 flex-1 space-y-1.5 pr-1">
                <p
                  className={`truncate text-base font-semibold tracking-tight ${
                    isConnected && spotifyStatus.title
                      ? "text-zinc-50"
                      : "text-zinc-300"
                  }`}
                  title={spotifyStatus.title ?? undefined}
                >
                  {displayTitle}
                </p>
                <p
                  className="truncate text-[13px] text-zinc-300"
                  title={spotifyStatus.artist ?? undefined}
                >
                  {displayArtist}
                </p>
                <p
                  className="truncate text-xs text-zinc-500"
                  title={spotifyStatus.album ?? undefined}
                >
                  {displayAlbum}
                </p>

                {/* Playback Transport (GSMTC) */}
                <div className="flex items-center gap-1.5 pt-2.5">
                  <button
                    type="button"
                    disabled={!isConnected || controlBusy}
                    onClick={() => handleTransport("previous")}
                    aria-label="Previous track"
                    title="Previous track"
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.1] hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                      <path d="M3.2 3.5a.6.6 0 0 1 1.2 0v9a.6.6 0 0 1-1.2 0v-9Zm8.8.4a.6.6 0 0 0-.95-.49L5.4 7.5a.6.6 0 0 0 0 .98l5.65 4.1a.6.6 0 0 0 .95-.49V3.9Z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    disabled={!isConnected || controlBusy}
                    onClick={() => handleTransport("playPause")}
                    aria-label={isPlaying ? "Pause Spotify" : "Play Spotify"}
                    title={isPlaying ? "Pause" : "Play"}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-zinc-100 text-zinc-950 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                  >
                    {isPlaying ? (
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                        <rect x="4.4" y="3.5" width="2.5" height="9" rx="0.8" />
                        <rect x="9.1" y="3.5" width="2.5" height="9" rx="0.8" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" className="ml-0.5 h-3.5 w-3.5" fill="currentColor">
                        <path d="M4.8 3.2a.6.6 0 0 0-.9.52v8.56a.6.6 0 0 0 .9.52l7.4-4.28a.6.6 0 0 0 0-1.04L4.8 3.2Z" />
                      </svg>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={!isConnected || controlBusy}
                    onClick={() => handleTransport("next")}
                    aria-label="Next track"
                    title="Next track"
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.1] hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                      <path d="M12.8 3.5a.6.6 0 0 0-1.2 0v9a.6.6 0 0 0 1.2 0v-9ZM4 3.9a.6.6 0 0 1 .95-.49L10.6 7.5a.6.6 0 0 1 0 .98L4.95 12.6A.6.6 0 0 1 4 12.1V3.9Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Optional Synchronized Lyrics Ribbon */}
            {lyrics.prefs.vinylLyricsEnabled && isConnected && (
              <div className="mt-1.5 flex min-h-[38px] flex-col justify-center rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-1.5">
                {!isCurrentLyricsTrack || lyrics.snapshot.state === "loading" ? (
                  <p className="truncate text-[11px] text-zinc-400">
                    Finding synchronized lyrics...
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
                    Unsynchronized lyrics available in main window
                  </p>
                ) : lyrics.snapshot.state === "instrumental" ? (
                  <p className="truncate text-[11px] text-zinc-400">
                    Instrumental track
                  </p>
                ) : (
                  <p className="truncate text-[11px] text-zinc-500">
                    {lyrics.snapshot.state === "error"
                      ? "Lyrics unavailable (network error)"
                      : "Lyrics unavailable for this track"}
                  </p>
                )}
              </div>
            )}

            {/* Bottom precision timeline */}
            <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2.5">
              <div
                role="progressbar"
                aria-label="Track playback progress"
                aria-valuemin={0}
                aria-valuemax={durationMs ?? 0}
                aria-valuenow={positionMs ?? 0}
                className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]"
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    isPlaying ? "bg-zinc-100" : "bg-zinc-500"
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between font-mono text-[10.5px] tabular-nums text-zinc-400">
                <span>{formatTimeMs(positionMs)}</span>
                <span>{formatTimeMs(durationMs)}</span>
              </div>
            </div>
          </div>
        ) : (
          /* Compact Layout */
          <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-between px-4 pb-3.5 pt-1">
            <div className="flex min-h-0 flex-1 w-full items-center justify-center py-1">
              <div className="relative flex items-center justify-center">
                <VinylDisc
                  isPlaying={isPlaying}
                  isConnected={isConnected}
                  artwork={spotifyStatus.artwork}
                  album={spotifyStatus.album}
                  sizeClassName="h-[clamp(110px,46vh,228px)] w-[clamp(110px,46vh,228px)]"
                  glowEnabled={
                    beatGlow.prefs.vinylGlowEnabled && beatGlow.prefs.enabled
                  }
                  isAudioActive={beatGlow.isAudioActive}
                  palette={beatGlow.palette}
                  reactiveColor={beatGlow.reactiveColor}
                  bass={beatGlow.frame.bass}
                  beat={beatGlow.frame.beat}
                />

                <svg
                  aria-hidden="true"
                  viewBox="0 0 64 96"
                  className={`pointer-events-none -right-[9%] -top-[4%] absolute z-20 h-[52%] w-[34%] origin-[48px_14px] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isPlaying ? "rotate-[16deg]" : "-rotate-[14deg]"
                  }`}
                >
                <circle
                  cx="48"
                  cy="14"
                  r="7"
                  fill="#18181b"
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth="1.5"
                />
                <circle cx="48" cy="14" r="2.5" fill="#d4d4d8" />
                <path
                  d="M48 16 L41 56 L30 74"
                  fill="none"
                  stroke="#a1a1aa"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                  <rect
                    x="25"
                    y="71"
                    width="8"
                    height="12"
                    rx="2"
                    transform="rotate(24 29 77)"
                    fill="#27272a"
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth="1"
                  />
                </svg>
              </div>
            </div>

            <div className="w-full space-y-2 text-center">
              <div className="min-w-0">
                <p
                  className={`truncate text-sm font-semibold tracking-tight ${
                    isConnected && spotifyStatus.title
                      ? "text-zinc-50"
                      : "text-zinc-300"
                  }`}
                  title={spotifyStatus.title ?? undefined}
                >
                  {displayTitle}
                </p>
                <p
                  className="truncate text-xs text-zinc-400"
                  title={spotifyStatus.artist ?? undefined}
                >
                  {displayArtist}
                </p>
                {lyrics.prefs.vinylLyricsEnabled &&
                  isConnected &&
                  isCurrentLyricsTrack &&
                  lyrics.hasSyncedLines &&
                  currentLyricLine &&
                  !currentLyricLine.isBlank && (
                    <p
                      className="mt-1 truncate px-1 text-[11px] font-medium leading-[1.35] text-zinc-200"
                      title={currentLyricLine.text}
                    >
                      ♪ {currentLyricLine.text}
                    </p>
                  )}
              </div>

              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={!isConnected || controlBusy}
                  onClick={() => handleTransport("previous")}
                  aria-label="Previous track"
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white/[0.05] text-zinc-300 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                    <path d="M3.2 3.5a.6.6 0 0 1 1.2 0v9a.6.6 0 0 1-1.2 0v-9Zm8.8.4a.6.6 0 0 0-.95-.49L5.4 7.5a.6.6 0 0 0 0 .98l5.65 4.1a.6.6 0 0 0 .95-.49V3.9Z" />
                  </svg>
                </button>

                <button
                  type="button"
                  disabled={!isConnected || controlBusy}
                  onClick={() => handleTransport("playPause")}
                  aria-label={isPlaying ? "Pause Spotify" : "Play Spotify"}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-zinc-100 text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {isPlaying ? (
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                      <rect x="4.5" y="3.5" width="2.4" height="9" rx="0.8" />
                      <rect x="9.1" y="3.5" width="2.4" height="9" rx="0.8" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" className="ml-0.5 h-3 w-3" fill="currentColor">
                      <path d="M4.8 3.2a.6.6 0 0 0-.9.52v8.56a.6.6 0 0 0 .9.52l7.4-4.28a.6.6 0 0 0 0-1.04L4.8 3.2Z" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!isConnected || controlBusy}
                  onClick={() => handleTransport("next")}
                  aria-label="Next track"
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white/[0.05] text-zinc-300 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                    <path d="M12.8 3.5a.6.6 0 0 0-1.2 0v9a.6.6 0 0 0 1.2 0v-9ZM4 3.9a.6.6 0 0 1 .95-.49L10.6 7.5a.6.6 0 0 1 0 .98L4.95 12.6A.6.6 0 0 1 4 12.1V3.9Z" />
                  </svg>
                </button>
              </div>

              <div className="space-y-1">
                <div
                  role="progressbar"
                  aria-label="Track playback progress"
                  aria-valuemin={0}
                  aria-valuemax={durationMs ?? 0}
                  aria-valuenow={positionMs ?? 0}
                  className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      isPlaying ? "bg-zinc-100" : "bg-zinc-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-zinc-500">
                  <span>{formatTimeMs(positionMs)}</span>
                  <span>{formatTimeMs(durationMs)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Subtle bottom-right resize grip indicator */}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="pointer-events-none absolute right-2 bottom-2 z-20 h-2.5 w-2.5 text-zinc-600/70 opacity-60 transition-opacity group-hover:opacity-100"
        >
          <path
            d="M10.5 3.5 3.5 10.5M10.5 7.5 7.5 10.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>

        {/* Native edge/corner resize handles */}
        {RESIZE_ZONES.map((zone) => (
          <div
            key={zone.direction}
            onPointerDown={(e) => handleStartResize(zone.direction, e)}
            className={`absolute z-30 ${zone.className}`}
          />
        ))}
      </div>
    </div>
  );
}
