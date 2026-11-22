import assert from "node:assert/strict";
import test from "node:test";
import { ChatStyle } from "./styles/Chat.ts";
import {
  computeLyricContentSignature,
  getOrGenerateChatPlan,
  clearChatPlanCache,
} from "./styles/chatConversationPlanner.ts";
import { buildTrackKey } from "../../utils/lyricsMatcher.ts";
import {
  fetchTrackLyrics,
  clearMemoryLyricsCache,
  LRCLIB_CLIENT_HEADER,
} from "../../services/lyricsService.ts";
import type { RenderContext, LineTimingContext } from "./animationTypes.ts";
import type { ParsedLyricLine } from "../../types/lyrics.ts";

function createMockContext2D(): {
  ctx: CanvasRenderingContext2D;
  filledTexts: string[];
} {
  const filledTexts: string[] = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    clip: () => {},
    rect: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke: () => {},
    arc: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    moveTo: () => {},
    lineTo: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    translate: () => {},
    scale: () => {},
    fillText: (text: string) => {
      filledTexts.push(text);
    },
    measureText: (text: string) => ({
      width: text.length * 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "top",
    shadowColor: "",
    shadowBlur: 0,
    setTransform: () => {},
  } as unknown as CanvasRenderingContext2D;

  return { ctx, filledTexts };
}

function createMockRenderContext(overrides?: Partial<RenderContext>): RenderContext {
  const { ctx } = createMockContext2D();
  return {
    ctx,
    width: 1280,
    height: 800,
    dpr: 1,
    nowMs: 1000,
    positionMs: 0,
    isPlaying: true,
    palette: {
      dominant: { r: 50, g: 30, b: 80 },
      secondary: { r: 80, g: 40, b: 120 },
      accent: { r: 160, g: 90, b: 240 },
      background: { r: 10, g: 10, b: 15 },
      foreground: { r: 240, g: 240, b: 245 },
      dominantCss: "rgb(50, 30, 80)",
      secondaryCss: "rgb(80, 40, 120)",
      accentCss: "rgb(160, 90, 240)",
      backgroundCss: "rgb(10, 10, 15)",
      foregroundCss: "rgb(240, 240, 245)",
    },
    settings: {
      style: "chat",
      background: "aura",
      preset: "cinematic",
      fontFamily: "sans",
      fontSize: "medium",
      fontWeight: "bold",
      letterSpacing: 0,
      lineSpacing: 1.5,
      textAlign: "center",
      speed: 1.0,
      intensity: 1.0,
      glowEnabled: true,
      glowIntensity: 1.0,
      blurIntensity: 1.0,
      particleIntensity: 1.0,
      reducedMotion: false,
      audioReactive: false,
      showPerfDiagnostics: false,
      syncOffsetMs: 120,
    },
    lines: [],
    metadata: {
      title: "Starboy",
      artist: "The Weeknd",
      album: "Starboy",
      trackKey: "starboy::the weeknd::starboy",
      lookupState: "loading",
      isConnected: true,
    },
    ...overrides,
  };
}

const dummyTimingContext: LineTimingContext = {
  lineIndex: 0,
  lineText: "Hello",
  lineStartMs: 0,
  lineEndMs: 5000,
  positionMs: 0,
  lineProgress: 0,
  words: [],
  activeWordIndex: -1,
  activeWordProgress: 0,
  mode: "line-only",
  confidence: "low",
  prevLineText: null,
  nextLineText: null,
};

test("Phase 1 & Phase 6A: Chat plan invalidation reacts immediately when lyrics arrive after empty initial frame", () => {
  clearChatPlanCache();
  const chat = new ChatStyle();
  const { ctx, filledTexts } = createMockContext2D();

  // 1. Initial Frame: Fullscreen opens with zero lines
  const initialRenderCtx = createMockRenderContext({
    ctx,
    lines: [],
    positionMs: 1500,
    metadata: {
      title: "Starboy",
      artist: "The Weeknd",
      album: "Starboy",
      trackKey: "starboy::the weeknd::starboy",
      lookupState: "loading",
      isConnected: true,
    },
  });

  chat.draw(ctx, dummyTimingContext, initialRenderCtx);
  assert.ok(
    filledTexts.some((t) => t.includes("Searching for lyrics")),
    "Should display 'Searching for lyrics…' while lookup is in flight on frame 1",
  );
  assert.ok(
    !filledTexts.some((t) => t.includes("Waiting for lyrics...")),
    "Must not show legacy 'Waiting for lyrics...'",
  );

  // 2. Lyrics arrive 100ms later: 3 parsed lines
  const populatedLines: ParsedLyricLine[] = [
    { timeMs: 1000, text: "I'm tryna put you in the worst mood, ah" },
    { timeMs: 4000, text: "P1 cleaner than your church shoes, ah" },
    { timeMs: 8000, text: "Milli point two just to hurt you, ah" },
  ];

  filledTexts.length = 0;
  const hydratedRenderCtx = createMockRenderContext({
    ctx,
    lines: populatedLines,
    positionMs: 2500, // Active on line 1
    metadata: {
      title: "Starboy",
      artist: "The Weeknd",
      album: "Starboy",
      trackKey: "starboy::the weeknd::starboy", // Same key!
      lookupState: "synced",
      isConnected: true,
    },
  });

  chat.draw(ctx, dummyTimingContext, hydratedRenderCtx);

  // Chat MUST have regenerated plan and rendered the active message
  assert.ok(
    filledTexts.some((t) => t.includes("worst mood")),
    "Active lyric message must appear on the very frame lyrics arrive without requiring style switch or reload!",
  );
  assert.ok(
    !filledTexts.some((t) => t.includes("Waiting for lyrics")),
    "Must not display 'Waiting for lyrics...' when lines are populated",
  );

  // 3. Same line count, but content changes (new version of same track)
  const updatedVersionLines: ParsedLyricLine[] = [
    { timeMs: 1000, text: "Different text for line 1" },
    { timeMs: 4000, text: "Different text for line 2" },
    { timeMs: 8000, text: "Different text for line 3" },
  ];

  filledTexts.length = 0;
  const updatedVersionCtx = createMockRenderContext({
    ctx,
    lines: updatedVersionLines,
    positionMs: 2500,
    metadata: {
      title: "Starboy",
      artist: "The Weeknd",
      album: "Starboy",
      trackKey: "starboy::the weeknd::starboy",
      lookupState: "synced",
      isConnected: true,
    },
  });

  chat.draw(ctx, dummyTimingContext, updatedVersionCtx);
  assert.ok(
    filledTexts.some((t) => t.includes("Different text for line 1")),
    "Content signature must detect lyric text change even when line count is identical",
  );

  // 4. Different track with the same line count
  const newTrackLines: ParsedLyricLine[] = [
    { timeMs: 2000, text: "Blinding Lights line 1" },
    { timeMs: 6000, text: "Blinding Lights line 2" },
    { timeMs: 9000, text: "Blinding Lights line 3" },
  ];

  filledTexts.length = 0;
  const newTrackCtx = createMockRenderContext({
    ctx,
    lines: newTrackLines,
    positionMs: 3000,
    metadata: {
      title: "Blinding Lights",
      artist: "The Weeknd",
      album: "After Hours",
      trackKey: "blinding lights::the weeknd::after hours",
      lookupState: "synced",
      isConnected: true,
    },
  });

  chat.draw(ctx, dummyTimingContext, newTrackCtx);
  assert.ok(
    filledTexts.some((t) => t.includes("Blinding Lights line 1")),
    "New track with same line count must generate and display its own conversation plan",
  );
});

test("Phase 2 & Phase 6B: Instrumental intro displays subtle intro indicator instead of 'Waiting for lyrics…'", () => {
  clearChatPlanCache();
  const chat = new ChatStyle();
  const { ctx, filledTexts } = createMockContext2D();

  // Song with 45-second instrumental intro
  const linesWithIntro: ParsedLyricLine[] = [
    { timeMs: 45000, text: "Ticking away the moments that make up a dull day" },
    { timeMs: 52000, text: "Fritter and waste the hours in an offhand way" },
  ];

  // 1. Playback is at 15 seconds (inside the instrumental intro)
  const introCtx = createMockRenderContext({
    ctx,
    lines: linesWithIntro,
    positionMs: 15000,
    metadata: {
      title: "Time",
      artist: "Pink Floyd",
      album: "The Dark Side of the Moon",
      trackKey: "time::pink floyd::the dark side of the moon",
      lookupState: "synced",
      isConnected: true,
    },
  });

  chat.draw(ctx, dummyTimingContext, introCtx);

  assert.ok(
    filledTexts.some((t) => t.includes("♪ Instrumental Intro ♪")),
    "Must display '♪ Instrumental Intro ♪' during intro when lyrics are loaded",
  );
  assert.ok(
    filledTexts.some((t) => t.includes("First lyric:")),
    "Optionally displays upcoming first lyric dimmed preview",
  );
  assert.ok(
    !filledTexts.some((t) => t.includes("Waiting for lyrics...")),
    "Must NEVER display 'Waiting for lyrics...' when lyrics are loaded!",
  );

  // 2. Playback crosses 45s: first lyric arrives
  filledTexts.length = 0;
  const vocalCtx = createMockRenderContext({
    ctx,
    lines: linesWithIntro,
    positionMs: 46000,
    metadata: {
      title: "Time",
      artist: "Pink Floyd",
      album: "The Dark Side of the Moon",
      trackKey: "time::pink floyd::the dark side of the moon",
      lookupState: "synced",
      isConnected: true,
    },
  });

  chat.draw(ctx, dummyTimingContext, vocalCtx);
  assert.ok(
    filledTexts.some((t) => t.includes("Ticking away")),
    "Vocal message must render as soon as playback reaches its timestamp",
  );
  assert.ok(
    !filledTexts.some((t) => t.includes("Instrumental Intro")),
    "Intro indicator clears once singing starts",
  );

  // 3. Confirm other honest states when lines is empty
  const honestStates = [
    { state: "instrumental" as const, expected: "♪ Instrumental Track ♪" },
    { state: "unavailable" as const, expected: "Lyrics unavailable for this track" },
    { state: "error" as const, expected: "Unable to retrieve lyrics" },
  ];

  for (const { state, expected } of honestStates) {
    filledTexts.length = 0;
    const stateCtx = createMockRenderContext({
      ctx,
      lines: [],
      positionMs: 5000,
      metadata: {
        title: "Test Track",
        artist: "Test Artist",
        trackKey: "test::track",
        lookupState: state,
        isConnected: true,
      },
    });
    chat.draw(ctx, dummyTimingContext, stateCtx);
    assert.ok(
      filledTexts.some((t) => t.includes(expected)),
      `Must display '${expected}' for state '${state}'`,
    );
  }

  // 4. Confirm disconnected state
  filledTexts.length = 0;
  const disconnCtx = createMockRenderContext({
    ctx,
    lines: [],
    positionMs: 0,
    metadata: {
      title: "",
      artist: "",
      trackKey: "",
      isConnected: false,
    },
  });
  chat.draw(ctx, dummyTimingContext, disconnCtx);
  assert.ok(
    filledTexts.some((t) => t.includes("Waiting for Spotify playback")),
    "Must display 'Waiting for Spotify playback…' when disconnected",
  );
});

test("Phase 3 & Phase 6C: buildTrackKey is stable across GSMTC duration updates (0 -> durationMs)", () => {
  const initialStatus = {
    connectionState: "connected" as const,
    title: "Starboy",
    artist: "The Weeknd, Daft Punk",
    album: "Starboy",
    durationMs: 0, // GSMTC initial 0ms packet
    timeline: null,
  };

  const keyAtStart = buildTrackKey(initialStatus);

  // 1.5 seconds later: GSMTC updates durationMs to 230,000 ms
  const updatedStatus = {
    ...initialStatus,
    durationMs: 230_000,
    timeline: { durationMs: 230_000, positionMs: 1500 },
  };

  const keyAfterUpdate = buildTrackKey(updatedStatus);

  assert.ok(keyAtStart);
  assert.equal(
    keyAtStart,
    keyAfterUpdate,
    "Track identity key MUST remain identical when GSMTC duration updates to prevent lookup cancellation",
  );

  // A genuine track change MUST produce a different key
  const nextTrackStatus = {
    connectionState: "connected" as const,
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    durationMs: 200_000,
    timeline: null,
  };

  const nextTrackKey = buildTrackKey(nextTrackStatus);
  assert.notEqual(keyAtStart, nextTrackKey, "New track title must produce a different track key");
});

test("Phase 4 & Phase 6D: LRCLIB retrieval uses memory cache, handles dynamic duration, and prevents duplicate requests", async () => {
  clearMemoryLyricsCache();
  const seenUrls: string[] = [];

  const mockFetch: typeof fetch = async (input) => {
    seenUrls.push(String(input));
    return new Response(
      JSON.stringify({
        id: 777,
        trackName: "Kesariya",
        artistName: "Arijit Singh",
        albumName: "Brahmastra",
        duration: 268,
        instrumental: false,
        syncedLyrics: "[00:10.00]केसरिया तेरा इश्क है पिया",
        plainLyrics: "केसरिया तेरा इश्क है पिया",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  let dynamicDuration = 0;

  // First call: initial fetch
  const t0 = performance.now();
  const result1 = await fetchTrackLyrics({
    trackKey: "kesariya::arijit singh::brahmastra",
    title: "Kesariya",
    artist: "Arijit Singh",
    album: "Brahmastra",
    durationMs: () => (dynamicDuration > 0 ? dynamicDuration : null),
    fetchImpl: mockFetch,
  });
  const dur1 = performance.now() - t0;

  assert.equal(result1.state, "synced");
  assert.equal(seenUrls.length, 1);
  assert.ok(result1.syncedLyrics?.includes("केसरिया"));

  // Dynamic duration updates while keeping same trackKey
  dynamicDuration = 268_000;

  // Second call with same trackKey: MUST hit memory cache in 0ms without hitting network
  const t1 = performance.now();
  const result2 = await fetchTrackLyrics({
    trackKey: "kesariya::arijit singh::brahmastra",
    title: "Kesariya",
    artist: "Arijit Singh",
    album: "Brahmastra",
    durationMs: () => dynamicDuration,
    fetchImpl: mockFetch,
  });
  const dur2 = performance.now() - t1;

  assert.equal(result2.state, "synced");
  assert.equal(seenUrls.length, 1, "Memory cache hit must NOT issue a second network request!");
  assert.ok(dur2 < dur1, `Cache hit (${dur2.toFixed(2)}ms) must be faster than initial fetch (${dur1.toFixed(2)}ms)`);
});
