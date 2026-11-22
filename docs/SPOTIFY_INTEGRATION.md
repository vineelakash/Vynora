# Spotify Desktop Media Detection (GSMTC) — Architecture & Integration Guide

`needle-windows` detects Spotify Desktop playback metadata locally on Windows 11 using the **Windows Runtime Global System Media Transport Controls (GSMTC)** API via the Rust `windows` crate (`0.62.2`).

This milestone implements **read-only session detection and metadata retrieval** without Spotify OAuth, the Spotify Web API, the Web Playback SDK, or audio capture/streaming.

---

## 1. Windows API & Crate Configuration

- **Windows Runtime API**: `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`
- **Rust Crate**: `windows` (`0.62`, locked at `0.62.2` in `src-tauri/Cargo.lock`)
- **Enabled Features** in `src-tauri/Cargo.toml`:
  - `Foundation`
  - `Foundation_Collections`
  - `Media_Control`
  - `Storage_Streams`
  - `Win32_System_WinRT`

---

## 2. Backend Module Layout (`src-tauri/src/media/`)

| File | Responsibility |
| --- | --- |
| `src-tauri/src/media/gsmtc.rs` | Initializes WinRT MTA (`RoInitialize(RO_INIT_MULTITHREADED)` with RAII cleanup), caches `GlobalSystemMediaTransportControlsSessionManager`, enumerates active GSMTC sessions, and re-acquires the manager once if an RPC/service error occurs. |
| `src-tauri/src/media/spotify.rs` | Filters enumerated sessions by `SourceAppUserModelId` (`Spotify.exe`, MSIX `SpotifyAB.SpotifyMusic*!Spotify`, or `...\Spotify.exe`) so browsers, YouTube tabs, and other media players are ignored even if they hold the active system session. Prioritizes active sessions (`Playing` > `Paused` > `Changing` > `Opened` > `Stopped`) and skips `Closed` sessions. |
| `src-tauri/src/media/metadata.rs` | Reads `TryGetMediaPropertiesAsync()`, `GetPlaybackInfo()`, and `GetTimelineProperties()`. Normalizes empty strings to `null`, converts Windows 100-ns `TimeSpan`/`DateTime` values to milliseconds, and extrapolates active `Playing` position from `LastUpdatedTime` clamped to track duration. |
| `src-tauri/src/media/thumbnail.rs` | Opens `IRandomAccessStreamReference`, reads bounded chunks (capped at 5 MB) via `DataReader`, validates image MIME type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`) from magic bytes / stream content type, and encodes a safe `data:<mime>;base64,...` URI in pure Rust. |
| `src-tauri/src/media/mod.rs` | Defines `SpotifyStatus`, `SpotifyDetector`, and `SpotifyMonitorHandle` (a single persistent `needle-gsmtc-monitor` thread with adaptive polling: `1000 ms` while `Playing`, `1500 ms` while connected/non-playing, `2500 ms` while idle, emitting `spotify-status-changed` events only when state changes). |

---

## 3. Tauri IPC Contract

### Command: `get_spotify_status`
Invoked from React on mount to retrieve the latest snapshot asynchronously via the `SpotifyMonitorHandle` worker channel (never blocking the main UI thread or creating duplicate WinRT managers).

### Event: `spotify-status-changed`
Emitted by the Rust monitor whenever the detected session, track metadata, artwork, playback state, or timeline position changes.

### Payload Shape (`SpotifyStatus`)

```ts
interface SpotifyStatus {
  connectionState: "connected" | "notDetected" | "unavailable";
  sourceAppId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork: {
    mimeType: string;
    dataUrl: string;
    byteLen: number;
  } | null;
  playbackStatus:
    | "playing"
    | "paused"
    | "stopped"
    | "opened"
    | "changing"
    | "closed"
    | "unknown";
  positionMs: number | null;
  durationMs: number | null;
  timeline: {
    startMs: number;
    endMs: number;
    positionMs: number;
    durationMs: number | null;
    lastUpdatedUnixMs: number | null;
  } | null;
  error: string | null;
}
```

---

## 4. Error & Edge-Case Handling

- **Spotify closed or open without an active session**: Returns `connectionState: "notDetected"` with `null` metadata fields and renders the `Not detected` empty state.
- **Other media players / browser tabs active**: Ignored unless `SourceAppUserModelId` matches Spotify Desktop.
- **Missing metadata or artwork**: Normalized to `null`; UI explicitly renders `Title unavailable` / `Artist unavailable` / `Album unavailable` / `--:--` or a fallback disc placeholder without fabricating data.
- **Session vanishing mid-query**: Caught on `SourceAppUserModelId()`, `GetPlaybackInfo()`, `TryGetMediaPropertiesAsync()`, or `OpenReadAsync()`; returns a structured `notDetected` / partial status without panicking.
- **GSMTC initialization / RPC failure**: Surfaces `connectionState: "unavailable"` with diagnostic text in `error` and automatically retries manager acquisition on the next cycle.

---

## 5. Verification Commands

Run from `v:\music wilder\needle-windows`:

```powershell
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

---

## 6. Observed Behavior & Current Limitations

- **Playback controls**: Intentionally excluded from this milestone (read-only metadata panel).
- **Spotify Free vs. Premium**: GSMTC reads OS-level media transport metadata published by Spotify Desktop regardless of account tier, though only the installed local Spotify Desktop session (`Spotify.exe`) was tested in this environment (Free and Premium account tiers were not separately tested).
- **Timeline resolution**: Windows GSMTC updates `Position` and `LastUpdatedTime` on state transitions and seeks rather than every second; `needle-windows` extrapolates live playback position between `LastUpdatedTime` and current UTC time while `Playing`, which depends on Spotify Desktop publishing accurate `LastUpdatedTime` updates.
- **Open without active playback**: When Spotify Desktop launches before a track is loaded or played, Windows GSMTC does not publish a `Spotify.exe` media session yet, so `needle-windows` reports `Not detected` until playback starts.
