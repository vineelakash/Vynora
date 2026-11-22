# TASK B.1 — Global Lyric Synchronization & Smoothness Optimization

**Project:** Needle Windows (`V:\music wilder\needle-windows`)  
**Platform:** Windows 11 x64  
**Scope:** All lyric animation styles (Big Words, Lines, Lens, Constellation, Terminal, Karaoke) & Lyrics Panel  
**Constraint:** Synchronization & smoothness engineering only — zero visual redesign.

---

## 1. Executive Summary

Previously, the built-in sample song preview provided crisp, responsive, fluid lyric synchronization, while real playback (Spotify Desktop via Windows GSMTC) exhibited a noticeable visual lag (~120–900ms behind vocals) and subtle rubber-banding between 1-second backend updates.

TASK B.1 eliminates the entire gap between sample playback and real playback by fixing three compounding synchronization defects in the timing pipeline, introducing automatic Windows audio/GSMTC transport lookahead compensation, and adding native inline word-level LRC timestamp parsing.

---

## 2. Root Cause Comparison: Sample Playback vs Real Playback

| Dimension | Built-in Sample Benchmark | Real Playback (Before TASK B.1) | Real Playback (After TASK B.1) |
|---|---|---|---|
| **Clock Anchor Stability** | Continuous 16ms monotonic timer (`performance.now() - lastTime`) | **`useLyrics.ts` Snapshot Overwrite Bug**: `snapshotPerfRef.current = performance.now()` executed on every render, resetting elapsed time to 0 on every 100ms tick. Position stayed frozen at `base + ~100ms` for up to 900ms before leaping forward. | Guarded `snapshotPerfRef.current` updates **only** when `positionMs`, `playbackStatus`, or track `title` changes. Strictly monotonic 33ms (~30Hz) progression between GSMTC polls. |
| **Canvas Drift Handling** | Zero disparity ($\Delta \approx 0\text{ms}$), zero drag | **Negative Drift Drag**: Canvas advanced at 60 FPS while React repeatedly fed the frozen `effectivePositionMs`. Disparity was constantly negative (-200ms to -800ms), dragging the canvas clock backward every frame. | `LyricsCanvasEngine.setPosition` tracks `lastAuthoritativePosMs`, ignores stale duplicates and sub-15ms micro-jitter, absorbs 15–500ms drift smoothly, and snaps instantly on seeks (>500ms). |
| **Audio Transport Latency** | 0ms (synthetic audio computed in same JS frame) | **Uncompensated ~100–140ms Lag**: Windows WASAPI shared mixer + soundcard DAC buffer (~60–100ms) + GSMTC IPC (~40–60ms) caused lyrics to trigger late after vocal onset. | Automatic **+120ms transport lookahead** (`syncOffsetMs`) applied to visual timing during real playback, while Sample Mode retains **0ms** lookahead. User-adjustable `-200ms` to `+400ms` in Lyrics Studio. |
| **Word Timing Precision** | Estimated conservative pacing | Inline `<mm:ss.xx>` karaoke tags stripped and discarded | Native inline `<mm:ss.xx>` word-level timestamp extraction (`mode: 'actual'`, `confidence: 'high'`) with seamless fallback to conservative estimation. |
| **Background / Sleep Safety** | N/A | Unclamped `deltaMs` could leap on window restore | `deltaMs` clamped to `[0, 100]` ms per frame to prevent runaway clock jumps after minimize/sleep. |

---

## 3. Architecture & File Changes

### 3.1 Monotonic Extrapolation Fix (`src/hooks/useLyrics.ts`)
- Guarded `snapshotPerfRef.current` with `lastSpotifyPosRef`, `lastSpotifyStatusRef`, and `lastSpotifyTitleRef` so React re-renders triggered by `setEffectivePositionMs` never overwrite the GSMTC snapshot anchor timestamp.
- Increased `SYNC_TICK_INTERVAL_MS` frequency from `100ms` (10Hz) to `33ms` (~30Hz) during active playback for responsive scrubber, active line, and engine updates.

### 3.2 Continuous Clock & Transport Lookahead (`src/lyrics/animation/render/LyricsCanvas.ts`)
- Added `isSampleMode` state (`setSampleMode(boolean)`) wired from both `LyricsPlayerApp.tsx` and `LyricsAnimationStudio.tsx`.
- Guarded `setPosition(authoritativePosMs, isPlaying)` with `lastAuthoritativePosMs`:
  - Duplicate stale timestamps are ignored (eliminating negative drift drag).
  - Sub-15ms jitter sets `driftCorrectionMs = 0` (eliminating micro-drag).
  - 15–500ms drift applies smooth exponential correction (~5% per frame).
  - Large seeks or skips (>500ms) snap immediately.
  - Track changes in `setLyrics()` reset `lastAuthoritativePosMs` and `driftCorrectionMs`.
- Applied transport latency compensation in `renderFrame()`:
  ```ts
  const lookaheadMs = this.isSampleMode ? 0 : (this.settings.syncOffsetMs ?? 120);
  this.positionMs = Math.max(0, this.currentPositionMs + lookaheadMs);
  ```
- Clamped frame `deltaMs` to `[0, 100]` ms so tab sleep or minimize never causes sudden leaps.

### 3.3 Configurable Sync Offset (`src/lyrics/animation/animationTypes.ts`, `src/components/lyrics/LyricsAnimationStudio.tsx`)
- Added `syncOffsetMs?: number` to `KineticStudioSettings` with `DEFAULT_STUDIO_SETTINGS.syncOffsetMs = 120`.
- Added a **Sync Offset** range slider (`-200ms` to `+400ms`, step `10ms`) in the Lyrics Studio customization drawer for fine-tuning Bluetooth headphones or external audio interfaces.

### 3.4 Exact Inline Word-Level Timestamps (`src/types/lyrics.ts`, `src/utils/parseLrc.ts`, `src/lyrics/animation/wordTiming.ts`)
- Added `InlineWordTiming` and optional `inlineWords?: InlineWordTiming[]` to `ParsedLyricLine`.
- Added `extractInlineWordTimestamps()` in `parseLrc.ts` to capture `<mm:ss.xx>` tags while preserving NFC-normalized multilingual scripts (English, Telugu, Hindi) and applying LRC `[offset]` metadata consistently.
- Updated `getEstimatedWordsForLine()` in `wordTiming.ts` to use `line.inlineWords` directly (`mode: 'actual'`, `confidence: 'high'`) whenever available, falling back cleanly to conservative word estimation when absent.

### 3.5 Sync Telemetry HUD (`src/lyrics/animation/render/PerformanceProfiler.ts`)
- Upgraded the `F3` / `Ctrl+Shift+D` diagnostic overlay (`DIAGNOSTICS & SYNC (TASK B.1)`) to display:
  - Rolling FPS, 1% Low FPS, Frame Time, Long Frames, and Stalls.
  - Live `Clock` vs `Auth` position and real-time Disparity ($\Delta$ in ms).
  - Active `Sync Lookahead` (`+120ms [SPOTIFY GSMTC]` or `+0ms [SAMPLE BENCHMARK]`).
  - Active Line Index, Lyric Preview, and Timing Mode (`actual` / `estimated` + confidence).

---

## 4. Verification Results

### 4.1 Automated Unit & Backend Tests
- **TypeScript Typecheck (`npm run typecheck`)**: 0 errors.
- **Unit Test Suite (`npm run test:unit`)**: **83 / 83 passing**, including 6 new tests in `src/lyrics/animation/syncSmoothness.test.ts`:
  - Monotonic 33ms position extrapolation without freezing.
  - Stale duplicate authoritative position immunity (zero negative drag).
  - `+120ms` real playback lookahead vs `0ms` sample benchmark separation.
  - Sub-15ms micro-jitter deadband & >500ms immediate seek snapping.
  - Runaway `deltaMs` clamping after sleep.
  - Inline `<mm:ss.xx>` word-level timestamp parsing & resolution across English, Telugu, and Hindi.
- **Rust Backend Tests (`cargo test`)**: **33 / 33 passing**.

### 4.2 Visual Integrity & Live Desktop Verification
- Verified production release binary (`needle-windows.exe`) deployed to `%LOCALAPPDATA%\Needle\needle-windows.exe`.
- Verified **zero visual changes** to Big Words, Lines, Lens, Constellation, Terminal, and Karaoke styles.
- Verified Stars was not reintroduced.
- Verified live desktop rendering across English, Telugu, and Hindi with the Sync Telemetry HUD active and smooth continuous motion capture.
