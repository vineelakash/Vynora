import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import IslandControls from "./components/IslandControls";
import LyricsPanel from "./components/LyricsPanel";
import SpotifyPanel from "./components/SpotifyPanel";
import VinylControls from "./components/VinylControls";
import { StartupIntroOverlay } from "./components/StartupIntroOverlay";
import { BeatGlowPanel } from "./components/visualizer/BeatGlowPanel";
import { LyricsAnimationStudio } from "./components/lyrics/LyricsAnimationStudio";
import { useBeatGlow } from "./hooks/useBeatGlow";
import { useLyrics } from "./hooks/useLyrics";
import {
  INITIAL_ISLAND_STATE,
  type DisplayInfo,
  type IslandUiState,
} from "./types/island";
import {
  INITIAL_SPOTIFY_STATUS,
  type SpotifyStatus,
} from "./types/spotify";
import {
  INITIAL_VINYL_STATE,
  type VinylUiState,
} from "./types/vinyl";

interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  status: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function formatError(err: unknown): string {
  if (typeof err === "string" && err.trim().length > 0) {
    return err;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return "Unknown IPC error";
}

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus>(
    INITIAL_SPOTIFY_STATUS,
  );
  const [islandState, setIslandState] = useState<IslandUiState>(
    INITIAL_ISLAND_STATE,
  );
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [islandError, setIslandError] = useState<string | null>(null);
  const [islandBusy, setIslandBusy] = useState(false);

  const [vinylState, setVinylState] = useState<VinylUiState>(
    INITIAL_VINYL_STATE,
  );
  const [vinylError, setVinylError] = useState<string | null>(null);
  const [vinylBusy, setVinylBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"player" | "studio">("player");

  const handleSelectTab = (tab: "player" | "studio") => {
    setActiveTab(tab);
    try {
      sessionStorage.setItem("vynora_active_tab", tab);
    } catch {}
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.altKey) && e.key === "2") {
        e.preventDefault();
        handleSelectTab("studio");
      } else if ((e.ctrlKey || e.altKey) && e.key === "1") {
        e.preventDefault();
        handleSelectTab("player");
      } else if (e.key === "F11") {
        e.preventDefault();
        if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
          import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => {
              const win = getCurrentWindow();
              win.isFullscreen().then((isFs) => win.setFullscreen(!isFs)).catch(() => {});
            })
            .catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const spotifySeqRef = useRef(0);
  const islandSeqRef = useRef(0);
  const vinylSeqRef = useRef(0);

  const lyrics = useLyrics({
    spotifyStatus,
    role: "coordinator",
  });

  const beatGlow = useBeatGlow({
    spotifyStatus,
    role: "coordinator",
  });

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) {
      const msg =
        "Tauri runtime bridge (__TAURI_INTERNALS__) is unavailable; commands cannot execute.";
      console.error("[needle::main-ui]", msg);
      setIslandError(msg);
      setSpotifyStatus({
        ...INITIAL_SPOTIFY_STATUS,
        connectionState: "unavailable",
        error: msg,
      });
      return;
    }

    let cancelled = false;
    const unlistenFns: Array<() => void> = [];

    const setup = async () => {
      try {
        const unlistenSpotify = await listen<SpotifyStatus>(
          "spotify-status-changed",
          (event) => {
            if (!cancelled && event.payload) {
              spotifySeqRef.current += 1;
              console.info("[needle::main-ui] spotify-status-changed", {
                connectionState: event.payload.connectionState,
                playbackStatus: event.payload.playbackStatus,
                title: event.payload.title,
                error: event.payload.error,
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
        console.error("[needle::main-ui] listen spotify-status-changed failed", err);
      }

      try {
        const unlistenIsland = await listen<IslandUiState>(
          "island-state-changed",
          (event) => {
            if (!cancelled && event.payload) {
              islandSeqRef.current += 1;
              console.info("[needle::main-ui] island-state-changed", event.payload);
              setIslandState(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenIsland();
        } else {
          unlistenFns.push(unlistenIsland);
        }
      } catch (err) {
        console.error("[needle::main-ui] listen island-state-changed failed", err);
      }

      try {
        const unlistenDisplays = await listen<DisplayInfo[]>(
          "displays-changed",
          (event) => {
            if (!cancelled && event.payload) {
              setDisplays(event.payload);
            }
          },
        );
        if (cancelled) {
          unlistenDisplays();
        } else {
          unlistenFns.push(unlistenDisplays);
        }
      } catch (err) {
        console.error("[needle::main-ui] listen displays-changed failed", err);
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
        console.error("[needle::main-ui] listen vinyl-state-changed failed", err);
      }

      invoke<AppInfo>("get_app_info")
        .then((info) => {
          if (!cancelled) {
            setAppInfo(info);
          }
        })
        .catch((err) => {
          console.error("[needle::main-ui] get_app_info failed", err);
        });

      const spotifySeqAtStart = spotifySeqRef.current;
      invoke<SpotifyStatus>("get_spotify_status")
        .then((status) => {
          if (!cancelled && spotifySeqRef.current === spotifySeqAtStart) {
            console.info("[needle::main-ui] initial get_spotify_status", {
              connectionState: status.connectionState,
              playbackStatus: status.playbackStatus,
              title: status.title,
              error: status.error,
            });
            setSpotifyStatus(status);
          }
        })
        .catch((err: unknown) => {
          const msg = `Unable to query Spotify media session status: ${formatError(err)}`;
          console.error("[needle::main-ui] get_spotify_status failed", err);
          if (!cancelled) {
            setSpotifyStatus({
              ...INITIAL_SPOTIFY_STATUS,
              connectionState: "unavailable",
              error: msg,
            });
          }
        });

      const islandSeqAtStart = islandSeqRef.current;
      Promise.all([
        invoke<IslandUiState>("get_island_state"),
        invoke<DisplayInfo[]>("get_available_displays"),
      ])
        .then(([initialIsland, availableDisplays]) => {
          if (!cancelled) {
            if (islandSeqRef.current === islandSeqAtStart) {
              setIslandState(initialIsland);
            }
            setDisplays(availableDisplays);
            setIslandError(null);
          }
        })
        .catch((err: unknown) => {
          const msg = `Failed to load Dynamic Island state: ${formatError(err)}`;
          console.error("[needle::main-ui]", msg);
          if (!cancelled) {
            setIslandError(msg);
          }
        });

      const vinylSeqAtStart = vinylSeqRef.current;
      invoke<VinylUiState>("get_vinyl_state")
        .then((initialVinyl) => {
          if (!cancelled && vinylSeqRef.current === vinylSeqAtStart) {
            setVinylState(initialVinyl);
            setVinylError(null);
          }
        })
        .catch((err: unknown) => {
          const msg = `Failed to load Desktop Vinyl state: ${formatError(err)}`;
          console.error("[needle::main-ui]", msg);
          if (!cancelled) {
            setVinylError(msg);
          }
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

  const requireTauriBridge = (): boolean => {
    if (!window.__TAURI_INTERNALS__) {
      const msg =
        "Tauri runtime bridge (__TAURI_INTERNALS__) is unavailable; cannot control Dynamic Island.";
      console.error("[needle::main-ui]", msg);
      setIslandError(msg);
      return false;
    }
    return true;
  };

  const handleShowIsland = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setIslandBusy(true);
    setIslandError(null);
    console.info("[needle::main-ui] invoking show_island");
    void invoke<IslandUiState>("show_island")
      .then((state) => {
        islandSeqRef.current += 1;
        setIslandState(state);
        setIslandError(null);
        console.info("[needle::main-ui] show_island succeeded", state);
      })
      .catch((err: unknown) => {
        const msg = `Show Island failed: ${formatError(err)}`;
        console.error("[needle::main-ui]", msg, err);
        setIslandError(msg);
      })
      .finally(() => {
        setIslandBusy(false);
      });
  };

  const handleHideIsland = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setIslandBusy(true);
    setIslandError(null);
    console.info("[needle::main-ui] invoking hide_island");
    void invoke<IslandUiState>("hide_island")
      .then((state) => {
        islandSeqRef.current += 1;
        setIslandState(state);
        setIslandError(null);
        console.info("[needle::main-ui] hide_island succeeded", state);
      })
      .catch((err: unknown) => {
        const msg = `Hide Island failed: ${formatError(err)}`;
        console.error("[needle::main-ui]", msg, err);
        setIslandError(msg);
      })
      .finally(() => {
        setIslandBusy(false);
      });
  };

  const handleSelectDisplay = (displayIndex: number) => {
    if (!requireTauriBridge()) {
      return;
    }
    setIslandError(null);
    void invoke<IslandUiState>("set_island_display", { displayIndex })
      .then((state) => {
        islandSeqRef.current += 1;
        setIslandState(state);
      })
      .catch((err: unknown) => {
        const msg = `Failed to switch island display: ${formatError(err)}`;
        console.error("[needle::main-ui]", msg, err);
        setIslandError(msg);
      });
  };

  const handleSelectFollowPrimary = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setIslandError(null);
    void invoke<IslandUiState>("set_island_follow_primary")
      .then((state) => {
        islandSeqRef.current += 1;
        setIslandState(state);
      })
      .catch((err: unknown) => {
        const msg = `Failed to follow primary display: ${formatError(err)}`;
        console.error("[needle::main-ui]", msg, err);
        setIslandError(msg);
      });
  };

  const handleShowVinyl = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setVinylBusy(true);
    setVinylError(null);
    void invoke<VinylUiState>("show_vinyl")
      .then((state) => {
        vinylSeqRef.current += 1;
        setVinylState(state);
      })
      .catch((err: unknown) => {
        setVinylError(`Show Vinyl failed: ${formatError(err)}`);
      })
      .finally(() => {
        setVinylBusy(false);
      });
  };

  const handleHideVinyl = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setVinylBusy(true);
    setVinylError(null);
    void invoke<VinylUiState>("hide_vinyl")
      .then((state) => {
        vinylSeqRef.current += 1;
        setVinylState(state);
      })
      .catch((err: unknown) => {
        setVinylError(`Hide Vinyl failed: ${formatError(err)}`);
      })
      .finally(() => {
        setVinylBusy(false);
      });
  };

  const handleToggleVinylExpanded = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setVinylBusy(true);
    setVinylError(null);
    void invoke<VinylUiState>("set_vinyl_expanded", {
      expanded: !vinylState.expanded,
    })
      .then((state) => {
        vinylSeqRef.current += 1;
        setVinylState(state);
      })
      .catch((err: unknown) => {
        setVinylError(`Vinyl layout switch failed: ${formatError(err)}`);
      })
      .finally(() => {
        setVinylBusy(false);
      });
  };

  const handleToggleVinylAlwaysOnTop = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setVinylBusy(true);
    setVinylError(null);
    void invoke<VinylUiState>("set_vinyl_always_on_top", {
      alwaysOnTop: !vinylState.alwaysOnTop,
    })
      .then((state) => {
        vinylSeqRef.current += 1;
        setVinylState(state);
      })
      .catch((err: unknown) => {
        setVinylError(`Always on top toggle failed: ${formatError(err)}`);
      })
      .finally(() => {
        setVinylBusy(false);
      });
  };

  const handleResetVinylPosition = () => {
    if (!requireTauriBridge()) {
      return;
    }
    setVinylBusy(true);
    setVinylError(null);
    void invoke<VinylUiState>("reset_vinyl_position")
      .then((state) => {
        vinylSeqRef.current += 1;
        setVinylState(state);
      })
      .catch((err: unknown) => {
        setVinylError(`Reset position failed: ${formatError(err)}`);
      })
      .finally(() => {
        setVinylBusy(false);
      });
  };

  const isSpotifyConnected = spotifyStatus.connectionState === "connected";
  const isSpotifyPlaying =
    isSpotifyConnected && spotifyStatus.playbackStatus === "playing";

  const lyricsStatusLabel = !isSpotifyConnected
    ? "Idle"
    : lyrics.snapshot.state === "synced"
      ? "Synced"
      : lyrics.snapshot.state === "plain"
        ? "Plain"
        : lyrics.snapshot.state === "loading"
          ? "Loading"
          : lyrics.snapshot.state === "instrumental"
            ? "Instrumental"
            : "Unavailable";

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#050509] text-[#F5F3FA]">
      {/* Cold-Launch Startup Video Intro Overlay */}
      <StartupIntroOverlay />

      {/* Subtle ambient background glow coordinated with VYNORA logo ribbon */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/3 h-72 w-96 -translate-x-1/2 rounded-full bg-gradient-to-tr from-[#8650FF]/10 via-[#416BFF]/10 to-[#FF9368]/5 blur-3xl"
      />

      {/* Persistent Left Desktop Sidebar */}
      <aside className="relative z-10 flex w-[180px] shrink-0 flex-col justify-between border-r border-[#292638] bg-[#0B0B13]/95 lg:w-[204px] xl:w-[220px]">
        <div className="flex flex-col gap-4 p-3 lg:p-4">
          {/* Compact Desktop Brand Header */}
          <header className="flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#292638] bg-black shadow-inner shadow-[#8650FF]/15">
              <img
                src="/vynora-logo.png"
                alt="VYNORA Logo"
                className="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0">
              <h1 className="truncate text-[15px] leading-tight font-semibold tracking-tight text-[#F5F3FA]">
                {appInfo?.name ?? "VYNORA"}
              </h1>
              <p className="truncate text-[11px] text-[#A6A2B3]">
                Windows Companion
              </p>
            </div>
          </header>

          {/* Desktop Sidebar Navigation */}
          <div className="flex flex-col gap-1.5">
            <span className="px-2 text-[10px] font-semibold tracking-wider text-[#A6A2B3] uppercase">
              Workspace
            </span>
            <nav aria-label="Main Navigation" className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => handleSelectTab("player")}
                aria-label="Player & Companion"
                aria-current={activeTab === "player" ? "page" : undefined}
                className={`group relative flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 text-left text-[13px] font-medium transition-colors ${
                  activeTab === "player"
                    ? "border-[#292638] bg-[#161626] text-[#F5F3FA] shadow-sm shadow-[#8650FF]/10"
                    : "border-transparent text-[#A6A2B3] hover:bg-[#12121D] hover:text-[#F5F3FA]"
                }`}
              >
                {activeTab === "player" && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-[#E65BFF] via-[#8650FF] to-[#416BFF]"
                  />
                )}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 shrink-0 ${
                    activeTab === "player"
                      ? "text-[#8650FF]"
                      : "text-[#A6A2B3] group-hover:text-[#F5F3FA]"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="2.25" />
                  <path d="M16.5 7.5 13.75 10.25" />
                </svg>
                <span className="truncate">Player & Companion</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectTab("studio")}
                aria-label="Lyrics Studio"
                aria-current={activeTab === "studio" ? "page" : undefined}
                className={`group relative flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 text-left text-[13px] font-medium transition-colors ${
                  activeTab === "studio"
                    ? "border-[#292638] bg-[#161626] text-[#F5F3FA] shadow-sm shadow-[#8650FF]/10"
                    : "border-transparent text-[#A6A2B3] hover:bg-[#12121D] hover:text-[#F5F3FA]"
                }`}
              >
                {activeTab === "studio" && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-[#E65BFF] via-[#8650FF] to-[#416BFF]"
                  />
                )}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 shrink-0 ${
                    activeTab === "studio"
                      ? "text-[#8650FF]"
                      : "text-[#A6A2B3] group-hover:text-[#F5F3FA]"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span className="truncate">Lyrics Studio</span>
              </button>
            </nav>
          </div>

          {/* Read-only Live Companion Status Overview */}
          <div className="flex flex-col gap-2 border-t border-[#292638] pt-4">
            <span className="px-2 text-[10px] font-semibold tracking-wider text-[#A6A2B3] uppercase">
              Companion Overview
            </span>
            <ul className="space-y-1.5 px-2 text-xs">
              <li className="flex items-center justify-between gap-2">
                <span className="text-[#A6A2B3]">Spotify</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#F5F3FA]">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      isSpotifyPlaying
                        ? "bg-emerald-400"
                        : isSpotifyConnected
                          ? "bg-amber-400/80"
                          : "bg-zinc-600"
                    }`}
                  />
                  {isSpotifyPlaying
                    ? "Playing"
                    : isSpotifyConnected
                      ? "Paused"
                      : "Offline"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-[#A6A2B3]">Island</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#F5F3FA]">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      islandState.visible ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                  {islandState.visible ? "Visible" : "Hidden"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-[#A6A2B3]">Vinyl</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#F5F3FA]">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      vinylState.visible ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                  {vinylState.visible ? "Visible" : "Hidden"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-[#A6A2B3]">Lyrics</span>
                <span className="text-[11px] font-medium text-[#F5F3FA]">
                  {lyricsStatusLabel}
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Compact System Status & Footer */}
        <div className="border-t border-[#292638] p-3.5">
          <section
            aria-labelledby="status-heading"
            className="rounded-lg border border-[#292638] bg-[#07070D]/80 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id="status-heading"
                className="text-[10px] font-semibold tracking-wider text-[#A6A2B3] uppercase"
              >
                Status
              </h2>
              <span className="font-mono text-[10px] text-[#A6A2B3]">
                v{appInfo?.version ?? "0.1.0"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/90 shadow-[0_0_8px_rgba(52,211,153,0.45)]"
              />
              <p className="truncate text-[11px] font-medium text-[#F5F3FA]">
                {appInfo?.status ?? "Application initialized"}
              </p>
            </div>
            {appInfo && (
              <p className="mt-1 truncate font-mono text-[10px] text-[#A6A2B3]">
                {appInfo.platform} · {appInfo.arch}
              </p>
            )}
          </section>
        </div>
      </aside>

      {/* Main Desktop Workspace */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Compact Workspace Header Bar */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[#292638] bg-[#050509]/80 px-5 backdrop-blur-sm xl:px-6">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="truncate text-sm font-semibold tracking-tight text-[#F5F3FA]">
              {activeTab === "player" ? "Player & Companion" : "Lyrics Studio"}
            </h2>
            <span className="hidden truncate text-xs text-[#A6A2B3] sm:inline">
              {activeTab === "player"
                ? "Spotify Desktop telemetry, Beat Glow, synced lyrics, and floating overlays"
                : "Kinetic typography preview, visual presets, and fullscreen player"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {isSpotifyConnected && spotifyStatus.title && (
              <span className="hidden max-w-[260px] truncate rounded-md border border-[#292638] bg-[#0B0B13]/90 px-2.5 py-1 text-[11px] text-[#F5F3FA] md:inline-flex md:items-center md:gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isSpotifyPlaying ? "bg-emerald-400" : "bg-amber-400/80"
                  }`}
                />
                <span className="truncate">{spotifyStatus.title}</span>
              </span>
            )}
          </div>
        </div>

        {/* Active Workspace Viewport */}
        <main className="lyrics-scroll flex-1 overflow-x-hidden overflow-y-auto p-3.5 lg:p-4 xl:p-5">
          {activeTab === "player" ? (
            <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-start gap-3.5 lg:gap-4 xl:gap-5 md:grid-cols-[minmax(390px,1.38fr)_minmax(240px,1fr)] lg:grid-cols-[minmax(480px,1.42fr)_minmax(285px,1fr)] xl:grid-cols-[minmax(580px,1.48fr)_minmax(340px,1fr)]">
              {/* Left Primary Column: Now Playing, Companion Overlays, Beat Glow */}
              <div className="flex min-w-0 flex-col gap-3.5">
                <SpotifyPanel status={spotifyStatus} />

                <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                  <IslandControls
                    islandState={islandState}
                    displays={displays}
                    busy={islandBusy}
                    error={islandError}
                    onShow={handleShowIsland}
                    onHide={handleHideIsland}
                    onSelectDisplay={handleSelectDisplay}
                    onSelectFollowPrimary={handleSelectFollowPrimary}
                  />

                  <VinylControls
                    vinylState={vinylState}
                    busy={vinylBusy}
                    error={vinylError}
                    onShow={handleShowVinyl}
                    onHide={handleHideVinyl}
                    onToggleExpanded={handleToggleVinylExpanded}
                    onToggleAlwaysOnTop={handleToggleVinylAlwaysOnTop}
                    onResetPosition={handleResetVinylPosition}
                  />
                </div>

                {/* Protected Beat Glow Component — Rendered Unchanged */}
                <BeatGlowPanel
                  spotifyStatus={spotifyStatus}
                  frame={beatGlow.frame}
                  prefs={beatGlow.prefs}
                  palette={beatGlow.palette}
                  reactiveColor={beatGlow.reactiveColor}
                  isAudioActive={beatGlow.isAudioActive}
                  onUpdatePrefs={beatGlow.updatePrefs}
                />
              </div>

              {/* Right Contextual Column: Synchronized Lyrics Reading Pane */}
              <div className="min-w-0 md:sticky md:top-0">
                <LyricsPanel
                  spotifyStatus={spotifyStatus}
                  snapshot={lyrics.snapshot}
                  trackKey={lyrics.trackKey}
                  parsedLines={lyrics.parsedLines}
                  plainLines={lyrics.plainLines}
                  hasSyncedLines={lyrics.hasSyncedLines}
                  activeIndex={lyrics.activeIndex}
                  isOpen={lyrics.prefs.mainPanelOpen}
                  onToggleOpen={() =>
                    lyrics.updatePrefs({ mainPanelOpen: !lyrics.prefs.mainPanelOpen })
                  }
                  onRetry={lyrics.retryLookup}
                />
              </div>
            </div>
          ) : (
            /* Protected Lyrics Studio Component — Rendered Unchanged in Wide Desktop Container */
            <div className="mx-auto w-full max-w-5xl">
              <LyricsAnimationStudio
                spotifyStatus={spotifyStatus}
                parsedLines={lyrics.parsedLines}
                timelinePositionMs={lyrics.effectivePositionMs}
                audioFrame={beatGlow.frame}
                palette={beatGlow.palette}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
