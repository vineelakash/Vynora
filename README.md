# VYNORA

A native Windows desktop music companion built with Tauri 2, React, TypeScript, Tailwind CSS, and Rust.

## Overview

**VYNORA** detects local **Spotify Desktop** playback through the Windows Global System Media Transport Controls API (`GSMTC`) and presents real-time track information, album artwork, playback state, synchronized lyrics, a kinetic **Lyrics Studio** & fullscreen player, audio-reactive **Beat Glow**, a floating **Dynamic Island** overlay, and an interactive **Desktop Vinyl** record player widget inside a desktop-first horizontal Windows interface.

No Spotify OAuth login, web API tokens, or bundled Spotify client are required.

## Implemented Features

- **Desktop-First Horizontal Interface (TASK C)**:
  - Persistent left workspace sidebar (`Player & Companion`, `Lyrics Studio`), live Companion Overview, and compact System Status footer.
  - Wide 2-column horizontal workspace pairing Now Playing, Dynamic Island, Desktop Vinyl, and Beat Glow alongside a dedicated full-height Synchronized Lyrics reading pane.
- **Local Spotify Desktop Detection (GSMTC)**:
  - Enumerates Windows media sessions via `GlobalSystemMediaTransportControlsSessionManager` and filters explicitly for Spotify (`Spotify.exe`).
  - Supports both Spotify Free and Spotify Desktop Premium.
  - Retrieves track title, artist, album, album artwork thumbnail bytes, playback status, playback position, duration, and smooth interpolated progress.
- **Floating Dynamic Island Overlay**:
  - Separate frameless, transparent, always-on-top Tauri window (`island`), hidden from the Windows taskbar (`WS_EX_TOOLWINDOW`) and non-focusable on display.
  - Compact pill mode and click-to-expand card with album artwork, lyrics preview toggle, audio-reactive Beat Glow toggle, and multi-monitor DPI-aware positioning.
- **Desktop Vinyl Record Player (`vinyl`)**:
  - Separate frameless, transparent, draggable, edge-resizable desktop widget with grooved spinning platter, specular sheen, animated tonearm, GSMTC playback controls, lyrics ribbon, and Always-on-Top pinning.
  - Persists position, compact/expanded mode, Always-on-Top state, visibility, and per-mode size across restarts (`vinyl-state.json`).
- **Beat Glow (Real-Time Audio Reactive Visualizer with Dynamic Album Artwork Theming)**:
  - Windows WASAPI loopback audio capture (`AUDCLNT_STREAMFLAGS_LOOPBACK`) processed locally in-memory in Rust (Hann windowing, Radix-2 FFT, 64-bin logarithmic spectrum, Bass/Mid/Treble meters, beat onset detection).
  - Automatic album artwork color extraction with 700 ms smooth transitions and `🎨 Album` vs `⚪ Mono` theme switcher, persisted in `%LOCALAPPDATA%\app.needle.windows\beat-glow-prefs.json` (preserving legacy preferences on upgrade).
- **Synchronized Lyrics Engine & Global Sync Optimization (TASK B.1)**:
  - Fetches synchronized LRC (`syncedLyrics`), inline word-level `<mm:ss.xx>` karaoke timestamps, plain lyrics, and instrumental flags from **LRCLIB** with full Unicode NFC support (English, Telugu, Hindi).
  - Monotonic 33 ms timeline extrapolation, continuous 60 FPS canvas clock without negative drift drag, and automatic `+120ms` Windows WASAPI/GSMTC transport lookahead compensation (adjustable `-200ms` to `+400ms`).
- **Lyrics Studio & Immersive Fullscreen Player (TASK A / A.1 / A.6.1 / B)**:
  - 6 distinct kinetic animation styles: **Big Words**, **Lines**, **Lens**, **Constellation**, **Terminal** (code-editor inspired lyric writing), and **Karaoke**.
  - 4 dynamic background environments: **Album Aura**, **Pure Black**, **Album Cover**, and **Ambient Motion**.
  - Dedicated borderless fullscreen player (`lyrics-player`) with multi-monitor support, auto-hiding controls, live cross-window settings sync, live Spotify GSMTC playback controls (`Space`, `ArrowLeft`, `ArrowRight`, `F`/`F11`, `Esc`, `F3`), and live FPS/Sync Diagnostics HUD.
- **Standalone Production Packaging & Single Instance**:
  - Single-instance enforcement (`tauri-plugin-single-instance`): launching VYNORA while already running focuses the existing main window.
  - Windows x64 **NSIS (`.exe`)** per-user installer and **MSI (`.msi`)** Windows Installer package with seamless user-data preservation for users upgrading from earlier Needle builds.

## Installation

### Option 1 — NSIS Setup Executable (Recommended)

1. Download or locate `VYNORA_0.1.0_x64-setup.exe`.
2. Run the installer (`currentUser` per-user install by default; no Administrator prompt required unless WebView2 Runtime needs system installation).
3. Launch **VYNORA** from the Windows Start Menu (or the optional Desktop shortcut).
4. Uninstall anytime via Windows **Installed Apps** (`Settings -> Apps -> Installed apps -> VYNORA`) or `uninstall.exe` in `%LOCALAPPDATA%\VYNORA`.

### Option 2 — Windows Installer (`.msi`)

1. Download or locate `VYNORA_0.1.0_x64_en-US.msi`.
2. Double-click the `.msi` file (or run `msiexec /i VYNORA_0.1.0_x64_en-US.msi`) to install per-machine to `C:\Program Files\VYNORA` (Administrator prompt required).
3. Launch **VYNORA** from the Start Menu or Desktop shortcut, and uninstall anytime via Windows **Installed Apps** (`msiexec /x`).

## Requirements

- Windows 10/11 (x64)
- Microsoft Edge WebView2 Runtime (pre-installed on Windows 11; automatically fetched silently by the installer if missing)
- Spotify Desktop (installed separately by the user)

## Development Setup

### Prerequisites

- Node.js 24+ and npm
- Rust (`x86_64-pc-windows-msvc` target) & Cargo
- MSVC C++ build tools & Windows 11 SDK
- Microsoft Edge WebView2 Runtime

### Commands

```powershell
cd "V:\music wilder\needle-windows"
npm install
npm run typecheck
npm run test:unit
npm run tauri dev
```

Run Rust unit tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## Production Build Instructions

Build the TypeScript/Vite frontend (`dist/`), compile the x64 Windows release binary (`VYNORA.exe`), and package both NSIS and MSI installers:

```powershell
cd "V:\music wilder\needle-windows"
npm run typecheck
npm run test:unit
cargo test --manifest-path src-tauri/Cargo.toml
npx tauri build
```

Generated artifacts:

- Release executable: `src-tauri/target/x86_64-pc-windows-msvc/release/VYNORA.exe`
- NSIS installer: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/VYNORA_0.1.0_x64-setup.exe`
- MSI installer: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/VYNORA_0.1.0_x64_en-US.msi`

## Documentation

- [Project Setup](docs/PROJECT_SETUP.md)
- [Spotify GSMTC Integration](docs/SPOTIFY_INTEGRATION.md)
- [Dynamic Island Architecture](docs/DYNAMIC_ISLAND.md)
- [Desktop Vinyl Player](docs/DESKTOP_VINYL_PLAYER.md)
- [Synchronized Lyrics Engine](docs/LYRICS_ENGINE.md)
- [Beat Glow Audio Visualizer](docs/TASK_010_BEAT_GLOW.md)
- [Dynamic Album Theming](docs/TASK_010_1_DYNAMIC_THEMING.md)
- [Kinetic Lyrics Animation Engine & Studio](docs/TASK_A_KINETIC_LYRICS_ENGINE.md)
- [Terminal Code-Inspired Writing](docs/TASK_B_TERMINAL_CODE_INSPIRED_WRITING.md)
- [Global Lyric Synchronization & Smoothness](docs/TASK_B_1_GLOBAL_LYRIC_SMOOTHNESS.md)
- [Desktop-First UI/UX Redesign](docs/TASK_C_DESKTOP_FIRST_UI_UX.md)
- [Functional Audit & VYNORA Rebranding](docs/TASK_D_FUNCTIONAL_AUDIT_AND_VYNORA_REBRANDING.md)
