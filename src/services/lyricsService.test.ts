import assert from "node:assert/strict";
import test from "node:test";
import { fetchTrackLyrics, LRCLIB_CLIENT_HEADER } from "./lyricsService.ts";

test("fetches exact synced Telugu lyrics from /api/get with Lrclib-Client header", async () => {
  const seenUrls: string[] = [];
  let seenClientHeader = "";

  const mockFetch: typeof fetch = async (input, init) => {
    seenUrls.push(String(input));
    const headers = new Headers(init?.headers);
    seenClientHeader = headers.get("Lrclib-Client") ?? "";

    return new Response(
      JSON.stringify({
        id: 101,
        trackName: "Naatu Naatu",
        artistName: "Rahul Sipligunj",
        albumName: "RRR",
        duration: 215,
        instrumental: false,
        syncedLyrics: "[00:05.00]నాటు నాటు నాటు వీర నాటు",
        plainLyrics: "నాటు నాటు నాటు వీర నాటు",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await fetchTrackLyrics({
    trackKey: "naatu::rahul::rrr::215",
    title: "Naatu Naatu",
    artist: "Rahul Sipligunj",
    album: "RRR",
    durationMs: 215_000,
    fetchImpl: mockFetch,
  });

  assert.equal(seenUrls.length, 1);
  assert.ok(seenUrls[0].includes("/api/get?"));
  assert.equal(seenClientHeader, LRCLIB_CLIENT_HEADER);
  assert.equal(result.state, "synced");
  assert.ok(result.syncedLyrics?.includes("నాటు నాటు"));
});

test("falls back cleanly from /api/get 404 to cleaned search without fabricating timestamps for plain lyrics", async () => {
  const calledEndpoints: string[] = [];

  const mockFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calledEndpoints.push(url.pathname);

    if (url.pathname === "/api/get") {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    if (url.pathname === "/api/search") {
      return new Response(
        JSON.stringify([
          {
            id: 202,
            trackName: "Butta Bomma",
            artistName: "Armaan Malik",
            albumName: "Ala Vaikunthapurramuloo",
            duration: 198,
            instrumental: false,
            syncedLyrics: null,
            plainLyrics: "ఇంతకన్నా మంచి పాట\nబుట్ట బొమ్మా",
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  };

  const result = await fetchTrackLyrics({
    trackKey: "buttabomma::armaan::ala::198",
    title: 'Butta Bomma (From "Ala Vaikunthapurramuloo")',
    artist: "Armaan Malik, Thaman S",
    album: "Ala Vaikunthapurramuloo",
    durationMs: 198_000,
    fetchImpl: mockFetch,
  });

  assert.ok(calledEndpoints.includes("/api/get"));
  assert.ok(calledEndpoints.includes("/api/search"));
  assert.equal(result.state, "plain");
  assert.equal(result.syncedLyrics, null);
  assert.ok(result.plainLyrics?.includes("బుట్ట బొమ్మా"));
});

test("aborts stale requests cleanly and surfaces network error separately from unavailable", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    fetchTrackLyrics({
      trackKey: "aborted-key",
      title: "Song",
      artist: "Artist",
      album: null,
      durationMs: 200_000,
      signal: controller.signal,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }),
    /AbortError/,
  );

  const errorResult = await fetchTrackLyrics({
    trackKey: "offline-key",
    title: "Song",
    artist: "Artist",
    album: null,
    durationMs: 200_000,
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
    timeoutMs: 100,
  });
  assert.equal(errorResult.state, "error");
  assert.ok(errorResult.error?.includes("Failed to fetch"));
});
