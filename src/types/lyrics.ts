export type LyricsLookupState =
  | "idle"
  | "loading"
  | "synced"
  | "plain"
  | "instrumental"
  | "unavailable"
  | "error";

export interface InlineWordTiming {
  text: string;
  timeMs: number;
}

export interface ParsedLyricLine {
  id: string;
  timeMs: number;
  text: string;
  isBlank: boolean;
  inlineWords?: InlineWordTiming[];
}

export interface LrcMetadataTags {
  title?: string;
  artist?: string;
  album?: string;
  author?: string;
  by?: string;
  offsetMs: number;
}

export interface ParsedLrcDocument {
  lines: ParsedLyricLine[];
  metadata: LrcMetadataTags;
  hasSyncedLines: boolean;
}

export interface LyricsResultPayload {
  trackKey: string;
  state: Exclude<LyricsLookupState, "idle" | "loading">;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  matchedTrackName: string | null;
  matchedArtistName: string | null;
  matchedAlbumName: string | null;
  matchedDurationSec: number | null;
  source: string | null;
  error: string | null;
}

export interface LyricsSharedSnapshot {
  trackKey: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  state: LyricsLookupState;
  result: LyricsResultPayload | null;
  updatedAtUnixMs: number;
}

export type LyricsRequestAction = "cached" | "fetch" | "wait";

export interface RequestLyricsResponse {
  action: LyricsRequestAction;
  snapshot: LyricsSharedSnapshot;
}

export interface LyricsUiPrefs {
  mainPanelOpen: boolean;
  islandLyricsEnabled: boolean;
  vinylLyricsEnabled: boolean;
}

export interface LyricsUiPrefsPatch {
  mainPanelOpen?: boolean;
  islandLyricsEnabled?: boolean;
  vinylLyricsEnabled?: boolean;
}

export interface LrclibApiRecord {
  id: number | string;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export const INITIAL_LYRICS_SNAPSHOT: LyricsSharedSnapshot = {
  trackKey: null,
  title: null,
  artist: null,
  album: null,
  state: "idle",
  result: null,
  updatedAtUnixMs: 0,
};

export const INITIAL_LYRICS_PREFS: LyricsUiPrefs = {
  mainPanelOpen: true,
  islandLyricsEnabled: true,
  vinylLyricsEnabled: true,
};
