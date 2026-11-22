# Needle Windows — Synchronized Lyrics Engine

## 1. Lyrics Provider

Needle uses **[LRCLIB](https://lrclib.net/docs)** as its primary public lyrics metadata provider.

- **Why LRCLIB**: Open, free, authentication-free API with native millisecond-precise `[mm:ss.xx]` synchronized LRC lyrics (`syncedLyrics`), plain lyrics fallback (`plainLyrics`), an explicit `instrumental` flag, and native UTF-8 multilingual coverage (English, Telugu, Hindi, and other non-Latin scripts).
- **Client identification**: Requests identify themselves with the custom header:
  ```text
  Lrclib-Client: Needle v0.1.0 (https://github.com/needle-windows)
  ```
- **Zero streaming / zero audio extraction**: Consistent with Needle's companion architecture, the lyrics engine queries metadata only and never downloads, caches, or plays Spotify audio streams.

---

## 2. API Endpoints Used

Implemented in [`src/services/lyricsService.ts`](../src/services/lyricsService.ts):

1. **`GET https://lrclib.net/api/get`**
   - Query parameters: `track_name`, `artist_name`, optional `album_name`, optional `duration` (rounded seconds).
   - Used in **Stage 1 (exact raw metadata)** and **Stage 2 (cleaned title + primary artist, omitting album)**.
   - HTTP `404` is treated as a clean miss (proceeding to search stages), not a network failure.
2. **`GET https://lrclib.net/api/search`**
   - Query parameters: `track_name` + `artist_name` (**Stage 3**), broad `q="<cleanTitle> <primaryArtist>"` and `track_name="<cleanTitle>"` (**Stage 4** fallback for soundtracks/OSTs where multi-artist credit order differs between Spotify GSMTC and LRCLIB).

Each HTTP call uses an **8-second per-request timeout** via `AbortController` and performs at most **1 automatic retry** (400 ms backoff) strictly on transient conditions (HTTP `429`, HTTP `5xx`, timeout, or network error), never retrying HTTP `404` or `4xx`.

---

## 3. Metadata Matching Strategy

GSMTC metadata arrives from Spotify Desktop (`Spotify.exe`) with track tags such as remaster years, soundtrack album tags, or featured artists. [`src/utils/lyricsMatcher.ts`](../src/utils/lyricsMatcher.ts) implements:

- **Unicode-preserving NFC normalization (`normalizeComparableText`)**:
  - Uses `.normalize("NFC").toLocaleLowerCase()` and `/[^\p{L}\p{M}\p{N}\s]/gu` so Telugu (`ఉ`, vowel matras `\p{M}`), Devanagari, CJK, and accented Latin characters are never stripped or corrupted.
- **Suffix / Noise Stripping (`cleanTrackTitle`)**:
  - Strips bracketed/hyphenated noise suffixes iteratively: `(2011 Remaster)`, `(Remastered 2023)`, `- 2011 Remaster`, `(feat. ...)`, `(ft. ...)`, `(Explicit)`, `(Clean)`, `(Live ...)`, `(Radio Edit)`, `(Deluxe Edition)`, and `(From "...")` Indian soundtrack tags.
- **Primary Artist Extraction (`extractArtists`, `extractPrimaryArtist`)**:
  - Splits multi-artist credits across `,`, `;`, `&`, `feat.`, `ft.`, `featuring`, `with`, and `x` while preserving raw full-artist strings for scoring.
- **Candidate Verification & Scoring (`scoreLrclibCandidate`)**:
  - **Title verification**: Exact clean/raw match (`+60` / `+52`), or token overlap >= `0.6` (`+42` scaled); mismatched titles are rejected.
  - **Artist verification**: Full match (`+40`), primary/credit substring match (`+30`), or token overlap >= `0.35`; unrelated artists are rejected.
  - **Duration tolerance**: Rejects candidates differing by **> 20 seconds** (`durationDeltaSec > 20 -> null`), strongly rewards <= 2s (`+40`) and <= 5s (`+28`), and mildly rewards matching album (`+14`).
  - **Synced preference**: Prefers usable timestamped `syncedLyrics` (`+25`) over `plainLyrics` (`+10`) and `instrumental` (`+4`).

---

## 4. LRC Parser

Implemented in [`src/utils/parseLrc.ts`](../src/utils/parseLrc.ts):

- **Full UTF-8 & Line-Ending Normalization**: Strips UTF-8 BOM (`\uFEFF`), normalizes `\r\n` / `\r` -> `\n`, normalizes text to Unicode `NFC`, and removes inline karaoke word tags (`<mm:ss.xx>`) cleanly.
- **Supported Timestamp Formats**:
  - `[mm:ss.xx]` (centiseconds)
  - `[mm:ss.xxx]` (milliseconds)
  - `[mm:ss.x]` (tenths of a second)
  - `[hh:mm:ss.xx]` (hours + minutes + seconds)
  - `[mm:ss]` (whole seconds)
- **Multi-Timestamp Expansion**: Lines like `[00:12.00][01:05.50] Chorus line` expand into separate timeline entries at every timestamp.
- **Metadata & `[offset:+/-ms]` Tags**: Parses `[ti:]`, `[ar:]`, `[al:]`, `[au:]`, `[by:]`, and `[offset:]` (clamped within +/-60,000 ms) and adjusts parsed timestamps chronologically (clamped >= 0 ms).
- **Resilience**: Malformed lines and untimed headers inside LRC text are safely ignored; entries are stably sorted by ascending `timeMs`, distinguishing vocal lines from blank/instrumental separator lines (`isBlank`).

---

## 5. Synchronization Algorithm

Implemented in [`src/utils/lyricsSync.ts`](../src/utils/lyricsSync.ts) and orchestrated by [`src/hooks/useLyrics.ts`](../src/hooks/useLyrics.ts):

- **Timeline Source**: Consumes the existing GSMTC `SpotifyStatus` stream (`get_spotify_status` + `spotify-status-changed`). Zero duplicate GSMTC polling engines or audio hooks are used.
- **Position Extrapolation (`computeEffectivePositionMs`)**:
  - When `playbackStatus === "playing"`, interpolates `positionMs + (performance.now() - snapshotReceivedPerfMs)` clamped to `durationMs`.
  - When `playbackStatus === "paused"` or `"stopped"`, freezes immediately at the GSMTC `positionMs`.
  - When `connectionState !== "connected"` or `playbackStatus === "closed"`, returns `null`.
- **Active Line Binary Search (`findActiveLyricIndex`)**:
  - Runs $O(\log n)$ binary search on sorted `ParsedLyricLine[]` with an 80 ms visual lookahead (`DEFAULT_SYNC_LOOKAHEAD_MS = 80`) so line highlights transition right on beat.
- **Lightweight Update Loop**:
  - Inside `useLyrics`, a `100 ms` interval runs **only** while `playbackStatus === "playing"` and synchronized lines exist, and calls `setActiveIndex((prev) => (prev === next ? prev : next))` so React re-renders only when the active line actually changes — never every 100 ms idle and never triggering network requests.
- **User Interactions**:
  - **Pause / Resume**: Freezes active line while paused; resumes seamlessly on play.
  - **Seek Forward / Backward**: GSMTC timeline updates recalculate `activeIndex` immediately on the next snapshot/tick.
  - **Manual Scroll Override**: Scrolling inside `LyricsPanel` pauses auto-centering and surfaces a floating **`Return to current line`** button to snap back cleanly.

---

## 6. Cache Strategy

Managed centrally in Rust inside [`src-tauri/src/lyrics.rs`](../src-tauri/src/lyrics.rs) (`LyricsController` + `LyricsEngineCore`):

- **Deterministic Track Identity Key (`buildTrackKey`)**:
  - `${normalizedTitle}::${normalizedArtist}::${normalizedAlbum}::${roundedDurationSec}`
  - Playback position changes do not change the track key, preventing redundant lookups.
- **FIFO / Recency In-Memory Cache**:
  - Stores resolved outcomes (`synced`, `plain`, `instrumental`, `unavailable`) up to **`MAX_CACHED_TRACKS = 64`** entries.
  - Re-playing or skipping back to a cached track returns `LyricsRequestAction::Cached` immediately with `[needle::lyrics] [cache_hit]` logged and zero HTTP traffic.
- **Transient Error Non-Caching**:
  - Results with `state === "error"` are never stored in cache so the user can retry cleanly or recover automatically on re-entry.
- **Single-Flight Coordinator & Request Deduplication**:
  - Tracks `in_flight_key`. Only the **Main window** (`role: "coordinator"`) invokes HTTP lookups; `request_lyrics_lookup` returns `Fetch` to the first requester, `Wait` if another request for the same key is already in flight, and `Cached` if already resolved.
  - `publish_lyrics_result` rejects stale async completions whose `trackKey` no longer matches `active_track_key`.

---

## 7. Multi-Window Integration

All three Tauri windows share one single backend source of truth (`lyrics-state-changed` and `lyrics-prefs-changed` events, plus commands `get_lyrics_state`, `request_lyrics_lookup`, `publish_lyrics_result`, `clear_lyrics_state`, `get_lyrics_prefs`, `set_lyrics_prefs`):

| Window | Hook Role | UI Integration | Persisted Pref Key |
| :--- | :--- | :--- | :--- |
| **`main`** | `"coordinator"` | Collapsible [`LyricsPanel`](../src/components/LyricsPanel.tsx) below `SpotifyPanel` with status pills, ambient artwork wash, auto-scrolling active highlight, manual scroll lock + `"Return to current line"`, plain lyrics view, retry button | `mainPanelOpen` |
| **`island`** | `"consumer"` | Compact pill unchanged (`296x48`); Expanded card (`388x208` inside `424x244` logical window) shows a 2-line current + next lyric strip and a top-right `♪ Lyrics` toggle button | `islandLyricsEnabled` |
| **`vinyl`** | `"consumer"` | Header `♪` toggle button; Expanded mode shows a full-width 2-line synced lyrics ribbon above the bottom progress bar; Compact mode shows a single active lyric caption without obstructing vinyl disc rotation or tonearm animation | `vinylLyricsEnabled` |

UI toggle preferences persist cleanly across restarts in `%LOCALAPPDATA%\app.needle.windows\lyrics-prefs.json`.

---

## 8. Error Handling

- **Track Switching**: Changing `trackKey` immediately aborts any in-flight HTTP `AbortController`, clears the active displayed lines (`state: "loading"`), and prevents stale previous-track lyrics or slow previous HTTP responses from flashing on screen.
- **Spotify Disconnected / Closed**: When GSMTC reports `connectionState !== "connected"` or `playbackStatus === "closed"`, coordinator calls `clear_lyrics_state` -> `LyricsLookupState::Idle`, clearing active lyrics and showing `Disconnected` / `"Spotify Desktop not active"`.
- **Network / Timeout / Rate-Limit**: Transient errors surface as `state: "error"` with explicit error text and a **Retry** (`force_refresh: true`) button; Island and Vinyl show subtle non-intrusive status copy.
- **Instrumental / Plain / Unavailable**: Distinct visual states with zero fabricated timestamps for plain lyrics or instrumental tracks.

---

## 9. Test Results

### Automated Verification

| Check | Command | Result |
| :--- | :--- | :--- |
| **TypeScript Typecheck** | `npm run typecheck` | **Passed** (`0` errors) |
| **Frontend Unit Tests** | `npm run test:unit` (`node --test`) | **15 / 15 passed** across `parseLrc.test.ts` (multi-format timestamps, multi-timestamp lines, offset adjustment, UTF-8 Telugu + Hindi scripts, malformed input), `lyricsMatcher.test.ts` (Unicode NFC preservation, `(2011 Remaster)` / `(From "...")` cleaning, duplicate title duration filtering), `lyricsSync.test.ts` (playing extrapolation, pause freeze, forward/backward seeks, boundary lookahead), `lyricsService.test.ts` (raw -> cleaned -> search fallback, 404/retry, network failure) |
| **Production Vite Bundle** | `npm run build` | **Passed** (`tsc --noEmit && vite build`) |
| **Rust Unit Tests** | `cargo test --manifest-path src-tauri/Cargo.toml` | **23 / 23 passed** (including 4 new `lyrics::tests` covering single-flight deduplication, FIFO cache hit, non-caching of transient errors + force refresh, stale completion protection, clear + prefs patching; plus 19 existing GSMTC/Island/Vinyl tests) |
| **Production Packaging & Install** | `npm run tauri build` | **Passed**; built `needle-windows.exe`, `Needle_0.1.0_x64-setup.exe` (`2.14 MiB`), `Needle_0.1.0_x64_en-US.msi` (`3.19 MiB`); silently installed to `%LOCALAPPDATA%\Needle\needle-windows.exe` |

### Live Spotify Desktop Integration Verification

Live tests executed against installed `Needle` (`%LOCALAPPDATA%\Needle\needle-windows.exe`) paired with real Spotify Desktop playback via Windows GSMTC:

- **Telugu Song (`Yedhalo Oka Mounam - The Innocence of Love` by `Anirudh Ravichander`)**: Resolved `state=Synced` via single coordinator lookup (`track_key='yedhalo oka mounam the innocence of love::anirudh ravichander::3 original motion picture soundtrack::207'`); rendered Telugu Unicode script cleanly across Main `LyricsPanel` and Expanded Vinyl without glyph clipping or mojibake.
- **English Songs (`Lavender Sunflower` by `Tory Lanez`, `Señorita` by `Shawn Mendes`, `Call Out My Name` by `The Weeknd`)**: Resolved `state=Synced` via coordinator; verified Main `LyricsPanel`, Expanded Dynamic Island (`530x305` physical / `424x244` logical with 2-line preview + `♪ Lyrics` toggle), and Expanded Desktop Vinyl (`♪` toggle + 2-line lyrics ribbon).
- **Pause / Resume & Seek**: Pausing froze playback position identically (`36963 ms -> 36963 ms` on English track; `44233 ms -> 44233 ms` on Telugu track); resuming continued progression (`38449 ms` / `44657 ms`); forward seeks (`75010 ms` / `87506 ms`) and backward seeks (`23590 ms` / `11006 ms`) updated active lines immediately.
- **Track Switch, Stale Abort & Cache Hit**: Skipping rapidly (`Señorita` -> `Call Out My Name` -> `Señorita` cache miss when first fetch was aborted mid-flight -> `Call Out My Name` -> `Señorita`) logged `[needle::lyrics] [cache_hit] track_key=Some("señorita::shawn mendes::señorita::191") state=Synced` with zero duplicate LRCLIB HTTP calls.
- **Manual Scroll & Preferences**: Scrolling manually in Main `LyricsPanel` paused auto-scroll (`ReturnBtnVisible=True`) and clicking **`Return to current line`** re-centered and dismissed the pill (`ReturnBtnClearedAfterClick=True`). Toggling `♪` persisted `%LOCALAPPDATA%\app.needle.windows\lyrics-prefs.json`.
- **Spotify Disconnected**: Closing Spotify cleared lyrics immediately (`[clear] Cleared active lyrics state`) and rendered `Disconnected` (`"Spotify Desktop not active"`).

---

## 10. Known Limitations

1. **LRCLIB Coverage Dependency**: Tracks absent from LRCLIB (or heavily modified titles whose cleaned tokens diverge completely from LRCLIB entries) resolve cleanly to `Unavailable` rather than falling back to web scraping or unofficial lyric sites. During live verification with the user's active playlists, every tested vocal track matched on LRCLIB; unavailable, plain-lyrics, instrumental, and network-error branches are covered deterministically by unit tests (`15/15` TS + `23/23` Rust).
2. **Timeline Resolution Quantization**: Spotify Desktop's Windows GSMTC integration reports playback timeline updates approximately once per second, and pause/seek propagation depends on Spotify Desktop's own SMTC updates. Needle smooths intra-second progression with local `performance.now()` extrapolation capped by track duration.
3. **Interactive Windows Desktop Requirement for GSMTC**: Windows scopes `GlobalSystemMediaTransportControls` sessions to active interactive `WinSta0\Default` desktop playback; automated processes running on isolated non-default Windows desktops do not register GSMTC media sessions.
