export type SpotifyConnectionState = "connected" | "notDetected" | "unavailable";

export type PlaybackStatus =
  | "playing"
  | "paused"
  | "stopped"
  | "opened"
  | "changing"
  | "closed"
  | "unknown";

export interface SpotifyArtwork {
  mimeType: string;
  dataUrl: string;
  byteLen: number;
}

export interface TimelineInfo {
  startMs: number;
  endMs: number;
  positionMs: number;
  durationMs: number | null;
  lastUpdatedUnixMs: number | null;
}

export interface SpotifyStatus {
  connectionState: SpotifyConnectionState;
  sourceAppId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork: SpotifyArtwork | null;
  playbackStatus: PlaybackStatus;
  positionMs: number | null;
  durationMs: number | null;
  timeline: TimelineInfo | null;
  error: string | null;
}

export const INITIAL_SPOTIFY_STATUS: SpotifyStatus = {
  connectionState: "notDetected",
  sourceAppId: null,
  title: null,
  artist: null,
  album: null,
  artwork: null,
  playbackStatus: "unknown",
  positionMs: null,
  durationMs: null,
  timeline: null,
  error: null,
};
