import type { ParsedLyricLine } from "../types/lyrics.ts";
import type { SpotifyStatus } from "../types/spotify.ts";

export const DEFAULT_SYNC_LOOKAHEAD_MS = 80;

/**
 * Computes effective playback position (ms) using GSMTC snapshot position plus
 * local monotonic elapsed extrapolation while status is "playing".
 * Returns null when Spotify is disconnected, and freezes immediately when paused.
 */
export function computeEffectivePositionMs(
  status: Pick<SpotifyStatus, "connectionState" | "playbackStatus" | "positionMs" | "durationMs" | "timeline">,
  snapshotReceivedPerfMs: number,
  nowPerfMs: number,
): number | null {
  if (status.connectionState !== "connected" || status.playbackStatus === "closed") {
    return null;
  }

  const basePosition = status.positionMs ?? status.timeline?.positionMs ?? null;
  if (basePosition === null || !Number.isFinite(basePosition)) {
    return null;
  }

  const clampedBase = Math.max(0, basePosition);
  const durationMs = status.durationMs ?? status.timeline?.durationMs ?? null;

  if (status.playbackStatus !== "playing") {
    return durationMs !== null && durationMs > 0
      ? Math.min(durationMs, clampedBase)
      : clampedBase;
  }

  const elapsedMs = Math.max(0, nowPerfMs - snapshotReceivedPerfMs);
  const extrapolated = clampedBase + elapsedMs;

  if (durationMs !== null && durationMs > 0) {
    return Math.min(durationMs, extrapolated);
  }
  return extrapolated;
}

/**
 * Binary-searches sorted LRC lines for the active index at positionMs.
 * Returns -1 when playback precedes the first timestamped line or lines is empty.
 */
export function findActiveLyricIndex(
  lines: ParsedLyricLine[],
  positionMs: number | null,
  lookaheadMs = DEFAULT_SYNC_LOOKAHEAD_MS,
): number {
  if (!lines.length || positionMs === null || !Number.isFinite(positionMs)) {
    return -1;
  }

  const effectiveTarget = positionMs + Math.max(0, lookaheadMs);
  if (effectiveTarget < lines[0].timeMs) {
    return -1;
  }

  let low = 0;
  let high = lines.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].timeMs <= effectiveTarget) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}

/**
 * Finds the next non-blank lyric line after activeIndex (used for Island / Vinyl previews).
 */
export function findNextNonBlankLyricIndex(
  lines: ParsedLyricLine[],
  activeIndex: number,
): number {
  const start = Math.max(0, activeIndex + 1);
  for (let i = start; i < lines.length; i += 1) {
    if (!lines[i].isBlank && lines[i].text.length > 0) {
      return i;
    }
  }
  return -1;
}
