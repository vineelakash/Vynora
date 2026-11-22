import type { PlaybackStatus } from "../types/spotify";

export function formatTimeMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    const mm = minutes.toString().padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }

  return `${minutes}:${ss}`;
}

export function formatPlaybackStatus(status: PlaybackStatus): string {
  switch (status) {
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    case "stopped":
      return "Stopped";
    case "opened":
      return "Opened";
    case "changing":
      return "Changing";
    case "closed":
      return "Closed";
    case "unknown":
    default:
      return "Unavailable";
  }
}
