import assert from "node:assert/strict";
import test from "node:test";
import type { LrclibApiRecord } from "../types/lyrics.ts";
import {
  buildTrackKey,
  cleanTrackTitle,
  extractCoreTitle,
  extractPrimaryArtist,
  isTrackMatch,
  normalizeComparableText,
  normalizeCompactText,
  scoreLrclibCandidate,
  selectBestLrclibCandidate,
} from "./lyricsMatcher.ts";

test("cleans remastered, featured artist, explicit, and soundtrack suffixes cleanly", () => {
  assert.equal(
    cleanTrackTitle("Bohemian Rhapsody - Remastered 2011"),
    "Bohemian Rhapsody",
  );
  assert.equal(
    cleanTrackTitle('Naatu Naatu (From "Rrr") (feat. Kala Bhairava)'),
    "Naatu Naatu",
  );
  assert.equal(cleanTrackTitle("Blinding Lights (Explicit)"), "Blinding Lights");
  assert.equal(
    cleanTrackTitle("Samayama (From \"Hi Nanna\") [Telugu]"),
    "Samayama",
  );
  assert.equal(
    cleanTrackTitle("Starboy - Extended Mix"),
    "Starboy",
  );
  assert.equal(extractPrimaryArtist("Anirudh Ravichander, Shilpa Rao"), "Anirudh Ravichander");
});

test("extractCoreTitle extracts fundamental title stem without trailing noise", () => {
  assert.equal(extractCoreTitle("Starboy (feat. Daft Punk)"), "Starboy");
  assert.equal(extractCoreTitle("Chaleya (From \"Jawan\") [Hindi]"), "Chaleya");
  assert.equal(extractCoreTitle("All Too Well (10 Minute Version) (Taylor's Version)"), "All Too Well");
});

test("normalizes compact text for artist abbreviation and diacritic matching", () => {
  assert.equal(normalizeCompactText("A.R. Rahman"), "arrahman");
  assert.equal(normalizeCompactText("AR Rahman"), "arrahman");
  assert.equal(normalizeCompactText("A. R. Rahman"), "arrahman");
  assert.equal(normalizeCompactText("Beyoncé"), "beyonce");
});

test("preserves Telugu Unicode script during normalization", () => {
  const normalized = normalizeComparableText("సామజవరగమన (From \"Ala Vaikunthapurramuloo\")");
  assert.ok(normalized.includes("సామజవరగమన"));
});

test("buildTrackKey stays identical across 1-second position updates and resets when disconnected", () => {
  const baseStatus = {
    connectionState: "connected" as const,
    title: "Chuttamalle",
    artist: "Shilpa Rao, Anirudh Ravichander",
    album: 'Devara Part 1 (Original Motion Picture Soundtrack)',
    durationMs: 222_140,
    timeline: null,
  };

  const key1 = buildTrackKey(baseStatus);
  const key2 = buildTrackKey({ ...baseStatus });
  assert.ok(key1);
  assert.equal(key1, key2);

  assert.equal(
    buildTrackKey({ ...baseStatus, connectionState: "notDetected" }),
    null,
  );
});

test("selectBestLrclibCandidate prefers synced duration match and rejects wrong recording lengths", () => {
  const wrongDurationCover: LrclibApiRecord = {
    id: 1,
    trackName: "Time",
    artistName: "Pink Floyd",
    albumName: "Cover Live",
    duration: 340,
    syncedLyrics: "[00:10.00]Wrong duration cover",
  };
  const plainSameTrack: LrclibApiRecord = {
    id: 2,
    trackName: "Time",
    artistName: "Pink Floyd",
    albumName: "The Dark Side of the Moon",
    duration: 413,
    plainLyrics: "Ticking away the moments that make up a dull day",
  };
  const syncedExactTrack: LrclibApiRecord = {
    id: 3,
    trackName: "Time (2011 Remaster)",
    artistName: "Pink Floyd",
    albumName: "The Dark Side of the Moon",
    duration: 414,
    syncedLyrics: "[02:27.00]Ticking away the moments that make up a dull day",
  };

  const best = selectBestLrclibCandidate(
    [wrongDurationCover, plainSameTrack, syncedExactTrack],
    {
      title: "Time",
      artist: "Pink Floyd",
      album: "The Dark Side of the Moon",
      durationSec: 413,
    },
  );

  assert.ok(best);
  assert.equal(best.record.id, 3);
  assert.equal(best.hasUsableSyncedLyrics, true);
});

test("short and single-word titles like Starboy or Hello are matched when candidate has extra descriptors", () => {
  const candidate: LrclibApiRecord = {
    id: 42,
    trackName: "Starboy (Original Track)",
    artistName: "The Weeknd, Daft Punk",
    albumName: "Starboy",
    duration: 230,
    syncedLyrics: "[00:15.00]I'm tryna put you in the worst mood, ah",
  };

  const scored = scoreLrclibCandidate(candidate, {
    title: "Starboy",
    artist: "The Weeknd",
    album: "Starboy",
    durationSec: 230,
  });

  assert.ok(scored);
  assert.ok(scored.score > 100);
});

test("matches artist with punctuation variations such as A.R. Rahman vs AR Rahman", () => {
  const candidate: LrclibApiRecord = {
    id: 99,
    trackName: "Kun Faya Kun",
    artistName: "AR Rahman, Javed Ali, Mohit Chauhan",
    albumName: "Rockstar",
    duration: 472,
    syncedLyrics: "[01:10.00]Ya Nizamuddin Auliya",
  };

  const scored = scoreLrclibCandidate(candidate, {
    title: "Kun Faya Kun",
    artist: "A.R. Rahman",
    album: "Rockstar",
    durationSec: 473,
  });

  assert.ok(scored);
  assert.ok(scored.score >= 120);
});

test("rejects duplicate track titles by different artists", () => {
  const wrongArtistSameTitle: LrclibApiRecord = {
    id: 10,
    trackName: "Closer",
    artistName: "Ne-Yo",
    albumName: "Year of the Gentleman",
    duration: 234,
    syncedLyrics: "[00:10.00]Turn the lights off in this place",
  };

  const best = selectBestLrclibCandidate([wrongArtistSameTitle], {
    title: "Closer",
    artist: "The Chainsmokers, Halsey",
    album: "Collage",
    durationSec: 244,
  });

  assert.equal(best, null);
});

test("isTrackMatch matches tracks across GSMTC duration update or album variations", () => {
  const liveStatus = {
    connectionState: "connected" as const,
    title: "Blinding Lights",
    artist: "The Weeknd",
  };

  const snapshot = {
    trackKey: "blinding lights::the weeknd::::0",
    title: "Blinding Lights",
    artist: "The Weeknd",
    state: "synced" as const,
  };

  assert.equal(isTrackMatch(liveStatus, snapshot), true);

  const differentTrack = {
    connectionState: "connected" as const,
    title: "Starboy",
    artist: "The Weeknd",
  };
  assert.equal(isTrackMatch(differentTrack, snapshot), false);
});
