import type { SpotifyStatus } from "../types/spotify";
import { formatPlaybackStatus, formatTimeMs } from "../utils/formatTime";

interface SpotifyPanelProps {
  status: SpotifyStatus;
}

export default function SpotifyPanel({ status }: SpotifyPanelProps) {
  const isConnected = status.connectionState === "connected";
  const isUnavailable = status.connectionState === "unavailable";
  const isPlaying = status.playbackStatus === "playing";
  const playbackLabel = formatPlaybackStatus(status.playbackStatus);

  const durationMs = status.durationMs ?? status.timeline?.durationMs ?? null;
  const positionMs = status.positionMs ?? status.timeline?.positionMs ?? null;

  const progressPercent =
    durationMs !== null && durationMs > 0 && positionMs !== null
      ? Math.max(0, Math.min(100, (positionMs / durationMs) * 100))
      : 0;

  return (
    <section
      aria-labelledby="spotify-heading"
      className="rounded-xl border border-[#292638] bg-[#0B0B13]/80 p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 id="spotify-heading" className="text-xs font-semibold tracking-wider text-[#A6A2B3] uppercase">
            Now Playing
          </h2>
          {isConnected && status.sourceAppId && (
            <span className="truncate font-mono text-[11px] text-[#A6A2B3]/70">
              {status.sourceAppId}
            </span>
          )}
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            isConnected
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : isUnavailable
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-[#292638] bg-[#07070D] text-[#A6A2B3]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected
                ? "bg-emerald-400"
                : isUnavailable
                  ? "bg-amber-400"
                  : "bg-zinc-600"
            }`}
          />
          {isConnected ? "Connected" : isUnavailable ? "Unavailable" : "Not detected"}
        </span>
      </div>

      {isConnected ? (
        <div className="mt-3.5 flex items-center gap-4">
          <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-lg border border-[#292638] bg-[#050509] shadow-md shadow-black/40">
            {status.artwork ? (
              <img
                src={status.artwork.dataUrl}
                alt={
                  status.album
                    ? `${status.album} album artwork`
                    : "Album artwork"
                }
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#A6A2B3]/40">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-7 w-7"
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

          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={`truncate text-[15px] leading-snug font-semibold tracking-tight ${
                    status.title ? "text-[#F5F3FA]" : "text-[#A6A2B3]"
                  }`}
                  title={status.title ?? undefined}
                >
                  {status.title ?? "Title unavailable"}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                  <span
                    className={`truncate font-medium ${
                      status.artist ? "text-[#A6A2B3]" : "text-[#A6A2B3]/60"
                    }`}
                    title={status.artist ?? undefined}
                  >
                    {status.artist ?? "Artist unavailable"}
                  </span>
                  {status.album && (
                    <>
                      <span aria-hidden="true" className="text-[#292638]">·</span>
                      <span
                        className="truncate text-[#A6A2B3]/70"
                        title={status.album}
                      >
                        {status.album}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#292638] bg-[#07070D]/80 px-2 py-0.5 text-[11px] font-medium text-[#F5F3FA]">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    isPlaying ? "bg-emerald-400" : "bg-amber-400/80"
                  }`}
                />
                {playbackLabel}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#A6A2B3]">
                {formatTimeMs(positionMs)}
              </span>
              <div
                role="progressbar"
                aria-label="Track playback progress"
                aria-valuemin={0}
                aria-valuemax={durationMs ?? 0}
                aria-valuenow={positionMs ?? 0}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#12121D]"
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    isPlaying ? "bg-gradient-to-r from-[#8650FF] to-[#416BFF]" : "bg-[#A6A2B3]/60"
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#A6A2B3]/70">
                {formatTimeMs(durationMs)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3.5 rounded-lg border border-dashed border-[#292638] bg-[#07070D]/80 px-3.5 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#292638] bg-[#0B0B13] text-[#A6A2B3]/40">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="8.5" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[#F5F3FA]">
              {isUnavailable
                ? "Windows media session monitor unavailable"
                : "No active Spotify Desktop session"}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#A6A2B3]">
              {status.error
                ? status.error
                : "Start Spotify Desktop or begin playback to display track metadata from Windows media sessions."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
