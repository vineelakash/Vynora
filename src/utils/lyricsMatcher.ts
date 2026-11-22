import type { LrclibApiRecord, LyricsSharedSnapshot } from "../types/lyrics.ts";
import type { SpotifyStatus } from "../types/spotify.ts";
import { parseLrc } from "./parseLrc.ts";

const NOISE_PARENS_PATTERN =
  /\s*[\(\[]\s*(?:feat\.?[^)\]]*|ft\.?[^)\]]*|featuring[^)\]]*|with\s+[^)\]]+|(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s*\d{4})?(?:\s+version)?|live(?:\s+[^)\]]*)?|explicit|clean|radio\s+edit|single\s+version|album\s+version|deluxe(?:\s+edition)?|bonus\s+track|acoustic(?:\s+version)?|mono|stereo|from\s+["'“”]?([^"')\]]+)["'“”]?|original\s+motion\s+picture\s+soundtrack|soundtrack(?:\s+version)?|(?:extended|club|original|dance|radio|single|album|vip)\s+(?:mix|edit|version)|(?:official\s+)?(?:music\s+)?(?:video|audio|lyric\s+video|visualizer)|taylor's\s+version(?:\s*\[from\s+the\s+vault\])?|re-recorded|anniversary(?:\s+edition)?|\d+th\s+anniversary(?:\s+edition)?|telugu|hindi|tamil|kannada|malayalam|punjabi|japanese|korean|spanish)\s*[\)\]]/giu;

const TRAILING_VERSION_DASH_PATTERN =
  /\s+[-–—]\s*(?:(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s*\d{4})?|live(?:\s+.*)?|radio\s+edit|single\s+version|acoustic(?:\s+version)?|explicit|clean|feat\.?\s+.*|featuring\s+.*|from\s+["'“”]?.*|(?:extended|club|original|dance|vip)\s+(?:mix|edit|version)|anniversary(?:\s+edition)?|\d+th\s+anniversary(?:\s+edition)?|stereo(?:\s*\/\s*remaster(?:ed)?)?|mono).*$/iu;

const ARTIST_SPLIT_PATTERN = /\s*(?:,|;|&|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/iu;

/**
 * Normalizes any multilingual string into comparable NFC lowercase tokens,
 * preserving Telugu, Devanagari, CJK, and other Unicode letters and combining marks.
 */
export function normalizeComparableText(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes artist name or title into compact lowercase alphanumeric form, removing dots, spaces,
 * and punctuation (e.g. "A.R. Rahman" -> "arrahman", "AR Rahman" -> "arrahman").
 */
export function normalizeCompactText(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Strips common Spotify edition/remaster/featured-artist/soundtrack suffixes
 * cleanly while preserving Unicode titles (including Telugu & Hindi film tracks).
 */
export function cleanTrackTitle(rawTitle: string): string {
  let cleaned = rawTitle.normalize("NFC").trim();
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned
      .replace(NOISE_PARENS_PATTERN, "")
      .replace(TRAILING_VERSION_DASH_PATTERN, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return cleaned || rawTitle.normalize("NFC").trim();
}

/**
 * Aggressive root title extraction that strips any remaining trailing bracketed/parenthetical metadata,
 * useful when searching LRCLIB's database for songs indexed only by their core title stem.
 */
export function extractCoreTitle(rawTitle: string): string {
  let cleaned = cleanTrackTitle(rawTitle);
  // Strip any remaining trailing parentheses or brackets
  cleaned = cleaned.replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/gu, "").trim();
  // Strip any trailing " - ..." if it contains trailing descriptors
  cleaned = cleaned.replace(/\s+[-–—]\s+.*$/u, "").trim();
  return cleaned || cleanTrackTitle(rawTitle);
}

export function extractArtists(rawArtist: string | null | undefined): string[] {
  if (!rawArtist) {
    return [];
  }
  return rawArtist
    .normalize("NFC")
    .split(ARTIST_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function extractPrimaryArtist(rawArtist: string | null | undefined): string {
  const parts = extractArtists(rawArtist);
  return parts[0] ?? (rawArtist?.normalize("NFC").trim() ?? "");
}

/**
 * Builds a deterministic, stable track identity key based on normalized song metadata (title, artist, album).
 * Strictly independent of transient playback position or GSMTC duration updates (0 -> durationMs),
 * preventing unnecessary request cancellation and in-flight lookup restarts.
 */
export function buildTrackKey(
  status: Pick<SpotifyStatus, "connectionState" | "title" | "artist" | "album" | "durationMs" | "timeline"> | null | undefined,
): string | null {
  if (!status || status.connectionState !== "connected") {
    return null;
  }

  const rawTitle = status.title?.normalize("NFC").trim() ?? "";
  if (!rawTitle) {
    return null;
  }

  const normTitle = normalizeComparableText(rawTitle);
  const normArtist = normalizeComparableText(status.artist);
  const normAlbum = normalizeComparableText(status.album);

  return `${normTitle}::${normArtist}::${normAlbum}`;
}

export interface MatchCandidateInput {
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
}

export interface ScoredCandidate {
  record: LrclibApiRecord;
  score: number;
  durationDeltaSec: number | null;
  hasUsableSyncedLyrics: boolean;
  hasPlainLyrics: boolean;
}

export function tokenOverlapMetrics(expected: string, actual: string): {
  overlapRatio: number;
  subsetRatio: number;
} {
  const expectedTokens = new Set(expected.split(" ").filter(Boolean));
  const actualTokens = new Set(actual.split(" ").filter(Boolean));
  if (expectedTokens.size === 0 || actualTokens.size === 0) {
    return { overlapRatio: 0, subsetRatio: 0 };
  }

  let matches = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) {
      matches += 1;
    }
  }

  const overlapRatio = matches / Math.max(expectedTokens.size, actualTokens.size);
  const subsetRatio = matches / Math.min(expectedTokens.size, actualTokens.size);
  return { overlapRatio, subsetRatio };
}

export function scoreLrclibCandidate(
  record: LrclibApiRecord,
  query: MatchCandidateInput,
): ScoredCandidate | null {
  const recordTitleRaw = (record.trackName ?? record.name ?? "").normalize("NFC").trim();
  const recordArtistRaw = (record.artistName ?? "").normalize("NFC").trim();
  const recordAlbumRaw = (record.albumName ?? "").normalize("NFC").trim();

  const expectedTitleRaw = normalizeComparableText(query.title);
  const expectedTitleClean = normalizeComparableText(cleanTrackTitle(query.title));
  const expectedTitleCore = normalizeComparableText(extractCoreTitle(query.title));
  const actualTitleRaw = normalizeComparableText(recordTitleRaw);
  const actualTitleClean = normalizeComparableText(cleanTrackTitle(recordTitleRaw));
  const actualTitleCore = normalizeComparableText(extractCoreTitle(recordTitleRaw));

  if (!actualTitleRaw || !expectedTitleRaw) {
    return null;
  }

  // Title verification — avoid matching completely different recordings.
  let titleScore = 0;
  if (actualTitleRaw === expectedTitleRaw) {
    titleScore = 60;
  } else if (actualTitleClean === expectedTitleClean && expectedTitleClean.length > 0) {
    titleScore = 54;
  } else if (actualTitleCore === expectedTitleCore && expectedTitleCore.length > 0) {
    titleScore = 50;
  } else {
    const rawMetrics = tokenOverlapMetrics(expectedTitleRaw, actualTitleRaw);
    const cleanMetrics = tokenOverlapMetrics(expectedTitleClean, actualTitleClean);
    const coreMetrics = tokenOverlapMetrics(expectedTitleCore, actualTitleCore);

    const bestOverlap = Math.max(rawMetrics.overlapRatio, cleanMetrics.overlapRatio, coreMetrics.overlapRatio);
    const bestSubset = Math.max(rawMetrics.subsetRatio, cleanMetrics.subsetRatio, coreMetrics.subsetRatio);

    // If expected title is a complete subset of actual or vice versa (e.g. single-word titles like "Starboy"),
    // don't reject when subset match is 100% and core words match!
    const isStrongSubset = bestSubset >= 0.99;
    if (bestOverlap < 0.6 && !isStrongSubset) {
      return null;
    }
    titleScore = Math.round(Math.max(bestOverlap, isStrongSubset ? 0.85 : 0) * 44);
  }

  // Artist verification
  let artistScore = 0;
  const expectedArtists = extractArtists(query.artist).map((a) => normalizeComparableText(a));
  const actualArtistNorm = normalizeComparableText(recordArtistRaw);
  const expectedArtistFull = normalizeComparableText(query.artist);
  const actualArtistCompact = normalizeCompactText(recordArtistRaw);
  const expectedArtistCompact = normalizeCompactText(query.artist);

  if (expectedArtistFull) {
    if (
      actualArtistNorm === expectedArtistFull ||
      (actualArtistCompact.length > 0 && actualArtistCompact === expectedArtistCompact)
    ) {
      artistScore = 40;
    } else if (
      expectedArtists.some((artist) => {
        const compactExpected = normalizeCompactText(artist);
        return (
          artist.length > 0 &&
          (actualArtistNorm.includes(artist) ||
            artist.includes(actualArtistNorm) ||
            (compactExpected.length > 0 && actualArtistCompact.includes(compactExpected)))
        );
      })
    ) {
      artistScore = 32;
    } else {
      const { overlapRatio: artistOverlap, subsetRatio: artistSubset } = tokenOverlapMetrics(
        expectedArtistFull,
        actualArtistNorm,
      );
      if (artistOverlap < 0.35 && artistSubset < 0.6) {
        return null;
      }
      artistScore = Math.round(Math.max(artistOverlap, artistSubset * 0.7) * 28);
    }
  }

  // Duration verification (critical for live / remix / duplicate title disambiguation)
  let durationDeltaSec: number | null = null;
  let durationScore = 0;
  if (
    query.durationSec !== null &&
    query.durationSec > 0 &&
    typeof record.duration === "number" &&
    Number.isFinite(record.duration) &&
    record.duration > 0
  ) {
    durationDeltaSec = Math.abs(record.duration - query.durationSec);
    if (durationDeltaSec > 20) {
      return null;
    }
    if (durationDeltaSec <= 2) {
      durationScore = 40;
    } else if (durationDeltaSec <= 5) {
      durationScore = 28;
    } else if (durationDeltaSec <= 10) {
      durationScore = 14;
    } else {
      durationScore = -10;
    }
  }

  // Album bonus (helpful when duplicate studio/compilation recordings exist)
  let albumScore = 0;
  const expectedAlbumClean = normalizeComparableText(cleanTrackTitle(query.album ?? ""));
  const actualAlbumClean = normalizeComparableText(cleanTrackTitle(recordAlbumRaw));
  if (expectedAlbumClean && actualAlbumClean) {
    if (expectedAlbumClean === actualAlbumClean) {
      albumScore = 14;
    } else if (tokenOverlapMetrics(expectedAlbumClean, actualAlbumClean).overlapRatio >= 0.6) {
      albumScore = 7;
    }
  }

  const parsedSynced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null;
  const hasUsableSyncedLyrics = Boolean(parsedSynced?.hasSyncedLines);
  const hasPlainLyrics = Boolean(record.plainLyrics && record.plainLyrics.trim().length > 0);
  const isInstrumental = Boolean(record.instrumental);

  if (!hasUsableSyncedLyrics && !hasPlainLyrics && !isInstrumental) {
    return null;
  }

  let contentScore = 0;
  if (hasUsableSyncedLyrics) {
    contentScore = 25;
  } else if (hasPlainLyrics) {
    contentScore = 10;
  } else if (isInstrumental) {
    contentScore = 4;
  }

  return {
    record,
    score: titleScore + artistScore + durationScore + albumScore + contentScore,
    durationDeltaSec,
    hasUsableSyncedLyrics,
    hasPlainLyrics,
  };
}

export function selectBestLrclibCandidate(
  records: LrclibApiRecord[],
  query: MatchCandidateInput,
): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const record of records) {
    const scored = scoreLrclibCandidate(record, query);
    if (!scored) {
      continue;
    }
    if (!best || scored.score > best.score) {
      best = scored;
    }
  }
  return best;
}

/**
 * Evaluates whether an active SpotifyStatus and LyricsSharedSnapshot represent the same track,
 * resilient to GSMTC duration updates (0 -> durationMs) and album subtitle variations.
 */
export function isTrackMatch(
  status: Pick<SpotifyStatus, "connectionState" | "title" | "artist"> | null | undefined,
  snapshot: Pick<LyricsSharedSnapshot, "trackKey" | "title" | "artist" | "state"> | null | undefined,
): boolean {
  if (!status || !snapshot || status.connectionState !== "connected" || !status.title) {
    return false;
  }

  const snapTitle = snapshot.title?.trim();
  const statusTitle = status.title.trim();
  if (!snapTitle || !statusTitle) {
    return false;
  }

  // Exact title match (case-insensitive)
  if (snapTitle.localeCompare(statusTitle, undefined, { sensitivity: "accent" }) === 0) {
    return true;
  }

  // Cleaned title match
  const cleanSnap = cleanTrackTitle(snapTitle).toLowerCase();
  const cleanStatus = cleanTrackTitle(statusTitle).toLowerCase();
  if (cleanSnap && cleanSnap === cleanStatus) {
    const snapArtist = normalizeCompactText(snapshot.artist);
    const statusArtist = normalizeCompactText(status.artist);
    if (
      !snapArtist ||
      !statusArtist ||
      snapArtist === statusArtist ||
      snapArtist.includes(statusArtist) ||
      statusArtist.includes(snapArtist)
    ) {
      return true;
    }
  }

  return false;
}
