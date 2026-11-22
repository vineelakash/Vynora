import { invoke } from "@tauri-apps/api/core";
import type {
  LrclibApiRecord,
  LyricsResultPayload,
} from "../types/lyrics.ts";
import {
  cleanTrackTitle,
  extractCoreTitle,
  extractPrimaryArtist,
  scoreLrclibCandidate,
  selectBestLrclibCandidate,
  type MatchCandidateInput,
  type ScoredCandidate,
} from "../utils/lyricsMatcher.ts";
import { parseLrc } from "../utils/parseLrc.ts";

export const LRCLIB_BASE_URL = "https://lrclib.net";
export const LRCLIB_CLIENT_HEADER =
  "VYNORA v0.1.0 (https://github.com/vynora-windows)";
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const RETRY_BACKOFF_MS = 400;

export interface FetchLyricsParams {
  trackKey: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null | (() => number | null);
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface MemoryCachedLyrics {
  payload: LyricsResultPayload;
  timestamp: number;
}

const memoryLyricsCache = new Map<string, MemoryCachedLyrics>();
const MAX_MEMORY_CACHE_ENTRIES = 64;
const MEMORY_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function clearMemoryLyricsCache(): void {
  memoryLyricsCache.clear();
}

class TransientHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TransientHttpError";
    this.status = status;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

function logDiag(stage: string, message: string) {
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    invoke("log_lyrics_diagnostic", {
      subsystem: "lyrics-service",
      stage,
      message,
    }).catch(() => {});
  }
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchJsonWithRetry<T>(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ status: number; data: T | null }> {
  let attempt = 0;
  const maxAttempts = 2;

  while (true) {
    attempt += 1;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const onExternalAbort = () => timeoutController.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        throw new DOMException("Aborted", "AbortError");
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Lrclib-Client": LRCLIB_CLIENT_HEADER,
        },
        signal: timeoutController.signal,
      });

      if (response.status === 404) {
        return { status: 404, data: null };
      }

      if (response.status >= 500 || response.status === 429) {
        throw new TransientHttpError(
          `LRCLIB service returned HTTP ${response.status}`,
          response.status,
        );
      }

      if (!response.ok) {
        throw new Error(`LRCLIB request failed with HTTP ${response.status}`);
      }

      const data = (await response.json()) as T;
      return { status: response.status, data };
    } catch (err) {
      if (externalSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const retryable =
        err instanceof TransientHttpError ||
        isAbortError(err) ||
        err instanceof TypeError;

      if (retryable && attempt < maxAttempts) {
        await waitWithAbort(RETRY_BACKOFF_MS * attempt, externalSignal);
        continue;
      }

      if (isAbortError(err)) {
        throw new Error("Lyrics request timed out");
      }
      throw err;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

function buildGetUrl(
  trackName: string,
  artistName: string,
  albumName: string | null,
  durationSec: number | null,
): string {
  const params = new URLSearchParams();
  params.set("track_name", trackName);
  params.set("artist_name", artistName);
  if (albumName && albumName.trim().length > 0) {
    params.set("album_name", albumName.trim());
  }
  if (durationSec !== null && durationSec > 0) {
    params.set("duration", String(Math.round(durationSec)));
  }
  return `${LRCLIB_BASE_URL}/api/get?${params.toString()}`;
}

function buildSearchUrl(paramsObj: {
  trackName?: string;
  artistName?: string;
  albumName?: string | null;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (paramsObj.q) {
    params.set("q", paramsObj.q);
  } else {
    if (paramsObj.trackName) {
      params.set("track_name", paramsObj.trackName);
    }
    if (paramsObj.artistName) {
      params.set("artist_name", paramsObj.artistName);
    }
    if (paramsObj.albumName) {
      params.set("album_name", paramsObj.albumName);
    }
  }
  return `${LRCLIB_BASE_URL}/api/search?${params.toString()}`;
}

function toPayload(
  trackKey: string,
  candidate: ScoredCandidate | null,
): LyricsResultPayload {
  if (!candidate) {
    return {
      trackKey,
      state: "unavailable",
      syncedLyrics: null,
      plainLyrics: null,
      matchedTrackName: null,
      matchedArtistName: null,
      matchedAlbumName: null,
      matchedDurationSec: null,
      source: "lrclib",
      error: null,
    };
  }

  const { record, hasUsableSyncedLyrics, hasPlainLyrics } = candidate;
  const matchedTrackName = record.trackName ?? record.name ?? null;
  const matchedArtistName = record.artistName ?? null;
  const matchedAlbumName = record.albumName ?? null;
  const matchedDurationSec =
    typeof record.duration === "number" && Number.isFinite(record.duration)
      ? record.duration
      : null;

  if (hasUsableSyncedLyrics && record.syncedLyrics) {
    return {
      trackKey,
      state: "synced",
      syncedLyrics: record.syncedLyrics.normalize("NFC"),
      plainLyrics: record.plainLyrics ? record.plainLyrics.normalize("NFC") : null,
      matchedTrackName,
      matchedArtistName,
      matchedAlbumName,
      matchedDurationSec,
      source: "lrclib",
      error: null,
    };
  }

  if (hasPlainLyrics && record.plainLyrics) {
    return {
      trackKey,
      state: "plain",
      syncedLyrics: null,
      plainLyrics: record.plainLyrics.normalize("NFC"),
      matchedTrackName,
      matchedArtistName,
      matchedAlbumName,
      matchedDurationSec,
      source: "lrclib",
      error: null,
    };
  }

  if (record.instrumental) {
    return {
      trackKey,
      state: "instrumental",
      syncedLyrics: null,
      plainLyrics: null,
      matchedTrackName,
      matchedArtistName,
      matchedAlbumName,
      matchedDurationSec,
      source: "lrclib",
      error: null,
    };
  }

  return {
    trackKey,
    state: "unavailable",
    syncedLyrics: null,
    plainLyrics: null,
    matchedTrackName,
    matchedArtistName,
    matchedAlbumName,
    matchedDurationSec,
    source: "lrclib",
    error: null,
  };
}

function isHighConfidenceSyncedMatch(cand: ScoredCandidate | null): cand is ScoredCandidate {
  return Boolean(cand && cand.hasUsableSyncedLyrics && cand.score >= 70);
}

export async function fetchTrackLyrics(
  params: FetchLyricsParams,
): Promise<LyricsResultPayload> {
  const fetchImpl = params.fetchImpl ?? fetch;

  // 1. In-memory cache hit: instant 0ms return for repeated requests
  const cached = memoryLyricsCache.get(params.trackKey);
  if (
    cached &&
    (Date.now() - cached.timestamp < MEMORY_CACHE_TTL_MS || cached.payload.state === "synced")
  ) {
    logDiag("cache_hit", `trackKey=${params.trackKey} state=${cached.payload.state}`);
    return cached.payload;
  }

  const resolveDurationSec = (): number | null => {
    const raw = typeof params.durationMs === "function" ? params.durationMs() : params.durationMs;
    return raw !== null && Number.isFinite(raw) && raw > 0 ? Math.round(raw / 1000) : null;
  };

  let durationSec = resolveDurationSec();

  const rawTitle = params.title.normalize("NFC").trim();
  const rawArtist = params.artist?.normalize("NFC").trim() ?? "";
  const cleanedTitle = cleanTrackTitle(rawTitle);
  const coreTitle = extractCoreTitle(rawTitle);
  const primaryArtist = extractPrimaryArtist(rawArtist);
  const rawAlbum = params.album?.normalize("NFC").trim() ?? null;

  logDiag(
    "start",
    `trackKey=${params.trackKey} title="${rawTitle}" cleanTitle="${cleanedTitle}" coreTitle="${coreTitle}" artist="${rawArtist}" dur=${durationSec}`,
  );

  const matchQuery: MatchCandidateInput = {
    title: rawTitle,
    artist: rawArtist || null,
    album: rawAlbum,
    durationSec,
  };

  let bestCandidate: ScoredCandidate | null = null;
  let lastTransientError: string | null = null;
  let anySuccessResponse = false;

  // Bounded overall lookup deadline (9500ms) and bounded per-request timeouts
  const OVERALL_TIMEOUT_MS = 9500;
  const GET_TIMEOUT_MS = Math.min(params.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 3500);
  const SEARCH_TIMEOUT_MS = Math.min(params.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 4500);

  const overallController = new AbortController();
  const overallTimer = setTimeout(() => overallController.abort(), OVERALL_TIMEOUT_MS);
  const onExternalAbort = () => overallController.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      clearTimeout(overallTimer);
      throw new DOMException("Aborted", "AbortError");
    }
    params.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const effectiveSignal = overallController.signal;

  const queriedUrls = new Set<string>();
  const safeFetchJson = async <T>(
    url: string,
    timeout: number,
  ): Promise<{ status: number; data: T | null }> => {
    if (queriedUrls.has(url)) {
      return { status: 404, data: null };
    }
    queriedUrls.add(url);
    return fetchJsonWithRetry<T>(url, fetchImpl, timeout, effectiveSignal);
  };

  const considerRecord = (record: LrclibApiRecord | null | undefined, origin: string) => {
    if (!record) {
      return;
    }
    const scored = scoreLrclibCandidate(record, matchQuery);
    if (!scored) {
      return;
    }
    logDiag(
      "candidate",
      `origin=${origin} title="${record.trackName || record.name}" artist="${record.artistName}" dur=${record.duration} score=${scored.score} synced=${scored.hasUsableSyncedLyrics}`,
    );
    if (!bestCandidate || scored.score > bestCandidate.score) {
      bestCandidate = scored;
    }
  };

  const considerList = (records: LrclibApiRecord[] | null | undefined, origin: string) => {
    if (!Array.isArray(records) || records.length === 0) {
      return;
    }
    const bestFromList = selectBestLrclibCandidate(records, matchQuery);
    if (bestFromList) {
      logDiag(
        "candidate_list_best",
        `origin=${origin} count=${records.length} chosenTitle="${bestFromList.record.trackName || bestFromList.record.name}" score=${bestFromList.score} synced=${bestFromList.hasUsableSyncedLyrics}`,
      );
      if (!bestCandidate || bestFromList.score > bestCandidate.score) {
        bestCandidate = bestFromList;
      }
    }
  };

  const cacheAndReturn = (payload: LyricsResultPayload): LyricsResultPayload => {
    if (payload.state !== "error") {
      if (memoryLyricsCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
        const oldestKey = memoryLyricsCache.keys().next().value;
        if (oldestKey) memoryLyricsCache.delete(oldestKey);
      }
      memoryLyricsCache.set(params.trackKey, { payload, timestamp: Date.now() });
    }
    return payload;
  };

  try {
    // Stage 1: Exact metadata lookup via GET /api/get
    if (rawArtist.length > 0) {
      const stage1Url = buildGetUrl(rawTitle, rawArtist, rawAlbum, durationSec);
      try {
        const exactRes = await safeFetchJson<LrclibApiRecord>(stage1Url, GET_TIMEOUT_MS);
        if (exactRes.status === 200 || exactRes.status === 404) anySuccessResponse = true;
        considerRecord(exactRes.data, "stage1_exact_get");
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastTransientError = err instanceof Error ? err.message : String(err);
      }

      if (isHighConfidenceSyncedMatch(bestCandidate)) {
        return cacheAndReturn(toPayload(params.trackKey, bestCandidate));
      }
    }

    // Stage 2: Cleaned title + primary artist GET /api/get (omitting album to avoid deluxe/edition 404s)
    const shouldTryCleanedGet =
      primaryArtist.length > 0 &&
      (cleanedTitle !== rawTitle || primaryArtist !== rawArtist || rawAlbum !== null);

    if (shouldTryCleanedGet && (!bestCandidate || !(bestCandidate as ScoredCandidate).hasUsableSyncedLyrics)) {
      const stage2Url = buildGetUrl(cleanedTitle, primaryArtist, null, durationSec);
      try {
        const cleanedRes = await safeFetchJson<LrclibApiRecord>(stage2Url, GET_TIMEOUT_MS);
        if (cleanedRes.status === 200 || cleanedRes.status === 404) anySuccessResponse = true;
        considerRecord(cleanedRes.data, "stage2_cleaned_get");
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastTransientError = err instanceof Error ? err.message : String(err);
      }

      if (isHighConfidenceSyncedMatch(bestCandidate)) {
        return cacheAndReturn(toPayload(params.trackKey, bestCandidate));
      }
    }

    // Refresh duration if it became available during Stages 1/2
    if (durationSec === null) {
      durationSec = resolveDurationSec();
      if (durationSec !== null) {
        matchQuery.durationSec = durationSec;
      }
    }

    // Stage 2b: Duration-free exact GET /api/get if exact with duration was not found
    if (!bestCandidate && rawArtist.length > 0 && durationSec !== null) {
      const stage2bUrl = buildGetUrl(cleanedTitle, primaryArtist, null, null);
      try {
        const noDurRes = await safeFetchJson<LrclibApiRecord>(stage2bUrl, GET_TIMEOUT_MS);
        if (noDurRes.status === 200 || noDurRes.status === 404) anySuccessResponse = true;
        considerRecord(noDurRes.data, "stage2b_nodur_get");
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastTransientError = err instanceof Error ? err.message : String(err);
      }

      if (isHighConfidenceSyncedMatch(bestCandidate)) {
        return cacheAndReturn(toPayload(params.trackKey, bestCandidate));
      }
    }

    // Stage 3: Candidate search via GET /api/search with cleanedTitle
    try {
      const searchRes = await safeFetchJson<LrclibApiRecord[]>(
        buildSearchUrl({
          trackName: cleanedTitle,
          artistName: primaryArtist || undefined,
        }),
        SEARCH_TIMEOUT_MS,
      );
      anySuccessResponse = true;
      considerList(searchRes.data, "stage3_cleaned_search");
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastTransientError = err instanceof Error ? err.message : String(err);
    }

    // High confidence early exit: stop immediately if high-score synced candidate found
    if (isHighConfidenceSyncedMatch(bestCandidate)) {
      return cacheAndReturn(toPayload(params.trackKey, bestCandidate));
    }

    // Stage 4: Broad keyword / query search (handles multi-artist ordering differences)
    if (!bestCandidate && cleanedTitle.length > 0) {
      const qQuery = primaryArtist ? `${cleanedTitle} ${primaryArtist}` : cleanedTitle;
      try {
        const fallbackRes = await safeFetchJson<LrclibApiRecord[]>(
          buildSearchUrl({ q: qQuery }),
          SEARCH_TIMEOUT_MS,
        );
        anySuccessResponse = true;
        considerList(fallbackRes.data, "stage4_q_search");
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastTransientError = err instanceof Error ? err.message : String(err);
      }
    }

    if (isHighConfidenceSyncedMatch(bestCandidate)) {
      return cacheAndReturn(toPayload(params.trackKey, bestCandidate));
    }

    // Stage 5: Core Title root search (useful when song title has heavy subtitle/parenthetical tags)
    if (
      (!bestCandidate || !(bestCandidate as ScoredCandidate).hasUsableSyncedLyrics) &&
      coreTitle.length >= 2 &&
      coreTitle !== cleanedTitle
    ) {
      try {
        const coreRes = await safeFetchJson<LrclibApiRecord[]>(
          buildSearchUrl({
            trackName: coreTitle,
            artistName: primaryArtist || undefined,
          }),
          SEARCH_TIMEOUT_MS,
        );
        anySuccessResponse = true;
        considerList(coreRes.data, "stage5_core_search");
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastTransientError = err instanceof Error ? err.message : String(err);
      }
    }

    // Stage 6: Title-only search fallback
    if (
      (!bestCandidate || !(bestCandidate as ScoredCandidate).hasUsableSyncedLyrics) &&
      cleanedTitle.length >= 2 &&
      rawArtist.length > 0
    ) {
      try {
        const titleOnlyRes = await safeFetchJson<LrclibApiRecord[]>(
          buildSearchUrl({ trackName: cleanedTitle }),
          SEARCH_TIMEOUT_MS,
        );
        anySuccessResponse = true;
        considerList(titleOnlyRes.data, "stage6_title_only_search");
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastTransientError = err instanceof Error ? err.message : String(err);
      }
    }

    // Validate synced lyrics really parse cleanly before emitting
    if (bestCandidate) {
      const chosen = bestCandidate as ScoredCandidate;
      if (chosen.record.syncedLyrics && !parseLrc(chosen.record.syncedLyrics).hasSyncedLines) {
        chosen.hasUsableSyncedLyrics = false;
      }
      logDiag(
        "resolved",
        `trackKey=${params.trackKey} state=${chosen.hasUsableSyncedLyrics ? "synced" : chosen.hasPlainLyrics ? "plain" : chosen.record.instrumental ? "instrumental" : "unavailable"} score=${chosen.score}`,
      );
      return cacheAndReturn(toPayload(params.trackKey, chosen));
    }

    if (!anySuccessResponse && lastTransientError) {
      logDiag("error", `trackKey=${params.trackKey} err=${lastTransientError}`);
      return {
        trackKey: params.trackKey,
        state: "error",
        syncedLyrics: null,
        plainLyrics: null,
        matchedTrackName: null,
        matchedArtistName: null,
        matchedAlbumName: null,
        matchedDurationSec: null,
        source: "lrclib",
        error: lastTransientError,
      };
    }

    logDiag("unavailable", `trackKey=${params.trackKey} no match found`);
    return cacheAndReturn(toPayload(params.trackKey, null));
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : "Failed to fetch lyrics from LRCLIB";
    logDiag("exception", `trackKey=${params.trackKey} exception=${errMsg}`);
    return {
      trackKey: params.trackKey,
      state: "error",
      syncedLyrics: null,
      plainLyrics: null,
      matchedTrackName: null,
      matchedArtistName: null,
      matchedAlbumName: null,
      matchedDurationSec: null,
      source: "lrclib",
      error: errMsg,
    };
  } finally {
    clearTimeout(overallTimer);
    if (params.signal) {
      params.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
