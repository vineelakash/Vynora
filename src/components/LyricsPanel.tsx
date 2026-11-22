import { useEffect, useRef, useState } from "react";
import type { LyricsSharedSnapshot, ParsedLyricLine } from "../types/lyrics";
import type { SpotifyStatus } from "../types/spotify";

interface LyricsPanelProps {
  spotifyStatus: SpotifyStatus;
  snapshot: LyricsSharedSnapshot;
  trackKey: string | null;
  parsedLines: ParsedLyricLine[];
  plainLines: string[];
  hasSyncedLines: boolean;
  activeIndex: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onRetry: () => void;
}

function getBadgeMeta(
  isConnected: boolean,
  isCurrentTrack: boolean,
  snapshot: LyricsSharedSnapshot,
) {
  if (!isConnected) {
    return {
      label: "Disconnected",
      pillClass: "border-zinc-800 bg-zinc-900 text-zinc-500",
      dotClass: "bg-zinc-600",
    };
  }
  if (!isCurrentTrack || snapshot.state === "loading") {
    return {
      label: "Loading",
      pillClass: "border-zinc-700/80 bg-zinc-800/80 text-zinc-300",
      dotClass: "bg-zinc-300 animate-pulse",
    };
  }
  switch (snapshot.state) {
    case "synced":
      return {
        label: "Synced",
        pillClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        dotClass: "bg-emerald-400",
      };
    case "plain":
      return {
        label: "Plain",
        pillClass: "border-sky-500/30 bg-sky-500/10 text-sky-300",
        dotClass: "bg-sky-400",
      };
    case "instrumental":
      return {
        label: "Instrumental",
        pillClass: "border-violet-500/30 bg-violet-500/10 text-violet-300",
        dotClass: "bg-violet-400",
      };
    case "error":
      return {
        label: "Error",
        pillClass: "border-rose-500/30 bg-rose-500/10 text-rose-200",
        dotClass: "bg-rose-400",
      };
    case "unavailable":
    default:
      return {
        label: "Unavailable",
        pillClass: "border-zinc-800 bg-zinc-900 text-zinc-400",
        dotClass: "bg-zinc-500",
      };
  }
}

export default function LyricsPanel({
  spotifyStatus,
  snapshot,
  trackKey,
  parsedLines,
  plainLines,
  hasSyncedLines,
  activeIndex,
  isOpen,
  onToggleOpen,
  onRetry,
}: LyricsPanelProps) {
  const [userScrolledAway, setUserScrolledAway] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const prevTrackKeyRef = useRef<string | null>(null);

  const isConnected =
    spotifyStatus.connectionState === "connected" &&
    spotifyStatus.playbackStatus !== "closed";
  const isCurrentTrack = Boolean(trackKey && snapshot.trackKey === trackKey);
  const badge = getBadgeMeta(isConnected, isCurrentTrack, snapshot);

  const scrollActiveLineIntoView = (behavior: ScrollBehavior) => {
    const container = scrollContainerRef.current;
    if (!container || activeIndex < 0) {
      return;
    }
    const lineEl = lineRefs.current[activeIndex];
    if (!lineEl) {
      return;
    }

    const containerHeight = container.clientHeight;
    const targetTop =
      lineEl.offsetTop - containerHeight * 0.38 + lineEl.offsetHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
  };

  // Reset manual scroll lock and scroll position cleanly when switching tracks
  useEffect(() => {
    if (prevTrackKeyRef.current !== trackKey) {
      prevTrackKeyRef.current = trackKey;
      setUserScrolledAway(false);
      lineRefs.current = [];
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [trackKey]);

  // Auto-scroll smoothly when active line advances unless user scrolled away
  useEffect(() => {
    if (!isOpen || !hasSyncedLines || userScrolledAway || activeIndex < 0) {
      return;
    }
    scrollActiveLineIntoView("smooth");
  }, [activeIndex, isOpen, hasSyncedLines, userScrolledAway]);

  const handleUserScrollIntent = () => {
    if (hasSyncedLines) {
      setUserScrolledAway(true);
    }
  };

  const handleReturnToCurrentLine = () => {
    setUserScrolledAway(false);
    scrollActiveLineIntoView("smooth");
  };

  const previewSnippet = (() => {
    if (!isConnected) {
      return "Waiting for Spotify playback";
    }
    if (!isCurrentTrack || snapshot.state === "loading") {
      return "Searching LRCLIB for lyrics...";
    }
    if (snapshot.state === "synced" && hasSyncedLines) {
      if (activeIndex >= 0 && parsedLines[activeIndex]?.text) {
        return parsedLines[activeIndex].text;
      }
      return `${parsedLines.length} timed lines ready`;
    }
    if (snapshot.state === "plain") {
      return "Unsynchronized plain lyrics available";
    }
    if (snapshot.state === "instrumental") {
      return "Instrumental track";
    }
    if (snapshot.state === "error") {
      return snapshot.result?.error ?? "Lyrics provider unreachable";
    }
    return "No lyrics available for this track";
  })();

  return (
    <section
      aria-labelledby="lyrics-heading"
      className="relative flex flex-col overflow-hidden rounded-xl border border-[#292638] bg-[#0B0B13]/80 p-4 shadow-sm"
    >
      {/* Subtle album artwork ambient wash */}
      {isOpen && isConnected && spotifyStatus.artwork && (
        <img
          src={spotifyStatus.artwork.dataUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-10 h-44 w-44 rounded-full object-cover opacity-[0.07] blur-2xl"
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="lyrics-heading" className="text-[13px] font-semibold text-[#F5F3FA]">
              Synchronized Lyrics
            </h2>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badge.pillClass}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`}
              />
              {badge.label}
            </span>
          </div>
          {!isOpen && (
            <p className="mt-0.5 truncate text-xs text-[#A6A2B3]">
              {previewSnippet}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isConnected && (
            <button
              type="button"
              onClick={onRetry}
              aria-label="Refresh lyrics lookup"
              title="Refresh lyrics"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[#292638] bg-[#0B0B13] text-[#A6A2B3] transition hover:border-[#8650FF]/40 hover:bg-[#12121D] hover:text-[#F5F3FA]"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.55" />
                <path d="M13.5 2.7v2.4h-2.4" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={isOpen}
            className="inline-flex h-7 cursor-pointer items-center justify-center rounded-lg border border-[#292638] bg-[#12121D] px-2.5 text-xs font-medium text-[#F5F3FA] transition hover:border-[#8650FF]/40 hover:bg-[#1A192B]"
          >
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="relative mt-3.5">
          {!isConnected ? (
            <div className="rounded-xl border border-dashed border-[#292638] bg-[#07070D]/80 px-4 py-6 text-center">
              <p className="text-sm font-medium text-[#F5F3FA]">
                Spotify Desktop not active
              </p>
              <p className="mt-1 text-xs text-[#A6A2B3]">
                Play a track in Spotify to load synchronized lyrics automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Contextual track strip */}
              <div className="flex items-center gap-2.5 rounded-xl border border-[#292638]/60 bg-[#07070D]/90 px-3 py-2">
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-[#292638] bg-[#0B0B13]">
                  {spotifyStatus.artwork ? (
                    <img
                      src={spotifyStatus.artwork.dataUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-600">
                      <span className="text-xs">♪</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-zinc-100">
                    {spotifyStatus.title ?? "Unknown track"}
                  </p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {spotifyStatus.artist ?? "Unknown artist"}
                  </p>
                </div>
                {isCurrentTrack && snapshot.result?.source && snapshot.state !== "loading" && (
                  <span className="shrink-0 font-mono text-[10px] tracking-wider text-zinc-600 uppercase">
                    {snapshot.result.source}
                  </span>
                )}
              </div>

              {/* Body states */}
              {!isCurrentTrack || snapshot.state === "loading" ? (
                <div className="space-y-2.5 rounded-xl border border-white/[0.05] bg-zinc-950/60 px-4 py-6">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-zinc-800" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-800/80" />
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-800/60" />
                  <p className="pt-1 text-xs text-zinc-500">
                    Matching track and loading lyrics...
                  </p>
                </div>
              ) : snapshot.state === "synced" && hasSyncedLines ? (
                <div className="relative rounded-xl border border-white/[0.06] bg-zinc-950/75">
                  <div
                    ref={scrollContainerRef}
                    onWheel={handleUserScrollIntent}
                    onTouchMove={handleUserScrollIntent}
                    onPointerDown={(event) => {
                      // Trigger manual scroll pause if user grabs the scrollbar area cleanly
                      const el = event.currentTarget;
                      if (event.clientX >= el.getBoundingClientRect().right - 14) {
                        handleUserScrollIntent();
                      }
                    }}
                    className="lyrics-scroll h-[280px] min-h-[210px] overflow-y-auto px-4 py-5 md:h-[calc(100vh-13.75rem)]"
                  >
                    <div className="space-y-2.5 pb-12">
                      {parsedLines.map((line, index) => {
                        const isActive = index === activeIndex;
                        const isPast = activeIndex >= 0 && index < activeIndex;
                        return (
                          <p
                            key={line.id}
                            ref={(el) => {
                              lineRefs.current[index] = el;
                            }}
                            data-active={isActive ? "true" : "false"}
                            className={`transition-all duration-300 select-text ${
                              line.isBlank
                                ? "py-1 text-xs tracking-[0.35em] text-zinc-700"
                                : isActive
                                  ? "py-0.5 text-[17px] leading-[1.55] font-semibold tracking-tight text-zinc-50"
                                  : isPast
                                    ? "text-[14.5px] leading-[1.55] text-zinc-500/85"
                                    : "text-[14.5px] leading-[1.55] text-zinc-300/80"
                            }`}
                          >
                            {line.isBlank ? "♪ · ♪" : line.text}
                          </p>
                        );
                      })}
                    </div>
                  </div>

                  {userScrolledAway && activeIndex >= 0 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                      <button
                        type="button"
                        onClick={handleReturnToCurrentLine}
                        className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-zinc-900/95 px-3 py-1 text-[11px] font-medium text-zinc-100 shadow-lg backdrop-blur-md transition hover:border-white/25 hover:bg-zinc-800"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Return to current line
                      </button>
                    </div>
                  )}
                </div>
              ) : snapshot.state === "plain" && plainLines.length > 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-950/75">
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2 text-[11px] text-zinc-400">
                    <span>Unsynchronized lyrics</span>
                    <span className="text-zinc-500">Scroll manually</span>
                  </div>
                  <div className="lyrics-scroll h-[260px] min-h-[200px] space-y-1.5 overflow-y-auto px-4 py-3.5 select-text md:h-[calc(100vh-15.5rem)]">
                    {plainLines.map((line, idx) =>
                      line.length === 0 ? (
                        <div key={`gap-${idx}`} className="h-2.5" />
                      ) : (
                        <p
                          key={`plain-${idx}`}
                          className="text-[14px] leading-[1.6] text-zinc-200/90"
                        >
                          {line}
                        </p>
                      ),
                    )}
                  </div>
                </div>
              ) : snapshot.state === "instrumental" ? (
                <div className="rounded-xl border border-dashed border-[#292638] bg-[#07070D]/80 px-4 py-6 text-center">
                  <p className="text-sm font-medium text-[#F5F3FA]">
                    Instrumental track
                  </p>
                  <p className="mt-1 text-xs text-[#A6A2B3]">
                    LRCLIB marks this recording as instrumental without vocal lyrics.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#292638] bg-[#07070D]/80 px-4 py-6 text-center">
                  <p className="text-sm font-medium text-[#F5F3FA]">
                    {snapshot.state === "error"
                      ? "Unable to fetch lyrics"
                      : "Lyrics unavailable"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[#A6A2B3]">
                    {snapshot.state === "error"
                      ? (snapshot.result?.error ?? "Network error contacting LRCLIB.")
                      : "No reliable matching lyrics were found on LRCLIB for this track."}
                  </p>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 inline-flex cursor-pointer items-center justify-center rounded-xl border border-[#292638] bg-[#12121D] px-3 py-1.5 text-xs font-medium text-[#F5F3FA] transition hover:border-[#8650FF]/40 hover:bg-[#1A192B]"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
