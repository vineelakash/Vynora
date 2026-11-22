# Needle Windows Desktop Vinyl Player — Architecture & Implementation

`needle-windows` includes a native, frameless, interactive **Desktop Vinyl Record Player** (`label: "vinyl"`) inspired by the macOS Needle desktop vinyl experience, synchronized in real time with the existing Windows GSMTC Spotify monitor.

---

## 1. Architecture

The Desktop Vinyl Player runs as a dedicated multi-entry Tauri 2 desktop widget window alongside the `main` companion window and the top-center `island` overlay:

- **Backend State & Geometry Controller**: [src-tauri/src/vinyl.rs](../src-tauri/src/vinyl.rs) manages window geometry, Win32 widget styles, compact/expanded bounds, always-on-top state, work-area placement, and persistent user preferences (`%LOCALAPPDATA%\app.needle.windows\vinyl-state.json`).
- **Tauri IPC & Window Lifecycle**: [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) registers commands (`get_vinyl_state`, `show_vinyl`, `hide_vinyl`, `set_vinyl_expanded`, `set_vinyl_always_on_top`, `reset_vinyl_position`, `notify_vinyl_ready`, `open_main_window`, `control_spotify_playback`), initializes `VinylController`, and forwards `Moved`, `Resized`, `ScaleFactorChanged`, and `CloseRequested` events.
- **Dedicated Vinyl WebView Bundle**: [vinyl.html](../vinyl.html), [src/vinyl/main.tsx](../src/vinyl/main.tsx), [src/vinyl/VinylApp.tsx](../src/vinyl/VinylApp.tsx), [src/vinyl/VinylDisc.tsx](../src/vinyl/VinylDisc.tsx), and [src/vinyl/vinyl.css](../src/vinyl/vinyl.css), bundled as a separate Vite/Rollup entry in [vite.config.ts](../vite.config.ts).
- **Main Companion Integration**: [src/App.tsx](../src/App.tsx) and [src/components/VinylControls.tsx](../src/components/VinylControls.tsx) mirror and control widget visibility, Compact/Expanded layout, Always-on-Top pinning, and position reset via shared `vinyl-state-changed` events and lazy-safe `get_vinyl_state` initialization (`ensure_prefs_loaded`).

---

## 2. Window Configuration

Configured in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) and enforced natively by [src-tauri/src/vinyl.rs](../src-tauri/src/vinyl.rs):

- **Window Identity**: `label: "vinyl"`, `title: "Needle Vinyl"`, `url: "vinyl.html"`.
- **Frameless & Transparent**:
  - `decorations: false`, `transparent: true`, `shadow: false` (prevents the Windows 11 1px light border around undecorated transparent windows).
  - [src/vinyl/vinyl.css](../src/vinyl/vinyl.css) sets `html, body, #root { background: transparent !important; overflow: hidden; }`, isolated from the opaque `#09090b` main window stylesheet ([src/styles/index.css](../src/styles/index.css)).
  - `noRedirectionBitmap: false` ensures reliable DirectComposition rendering and screenshot capture support.
- **Taskbar & Z-Order**:
  - `skipTaskbar: true` + native Win32 `WS_EX_TOOLWINDOW` (and cleared `WS_EX_APPWINDOW`) keep the widget off the Windows taskbar and Alt+Tab switcher.
  - Unlike the `island` overlay, `vinyl` does **not** set `WS_EX_NOACTIVATE` or `focusable: false` because it hosts interactive transport buttons, layout toggles, dragging, and edge resizing; on startup it uses `ShowWindow(..., SW_SHOWNOACTIVATE)` so it appears smoothly without stealing foreground focus from other apps.
  - `alwaysOnTop` defaults to `false` (behaving like a desktop turntable widget) and can be toggled to `true` (`WS_EX_TOPMOST`) from either window.
- **Resizing & Bounds**:
  - **Expanded mode**: Default `540 × 340` logical px (`min 430 × 290`, `max 780 × 520`).
  - **Compact mode**: Default `310 × 360` logical px (`min 260 × 290`, `max 480 × 520`).
  - **Minimum `tauri.conf.json` bounds**: `260 × 290` (`resizable: true`, `maximizable: false`, `minimizable: false`), dynamically clamped per mode via `set_min_size` / `set_max_size`.
- **Capabilities**: [src-tauri/capabilities/default.json](../src-tauri/capabilities/default.json) grants `"vinyl"` `core:default`, `core:window:allow-start-dragging`, and `core:window:allow-start-resize-dragging`.

---

## 3. Vinyl Animation Implementation

Implemented in [src/vinyl/VinylDisc.tsx](../src/vinyl/VinylDisc.tsx), [src/vinyl/VinylApp.tsx](../src/vinyl/VinylApp.tsx), and [src/vinyl/vinyl.css](../src/vinyl/vinyl.css):

- **GPU-Composited Rotation**: `.vinyl-rotor` runs a CSS keyframe transform (`@keyframes vinyl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`, `6.5s linear infinite`, `will-change: transform`) offloaded to the WebView2 GPU compositor thread with zero JavaScript animation timers (`requestAnimationFrame`).
- **Pause / Resume Rotational Continuity**: The `.vinyl-rotor` element stays mounted across `playing`, `paused`, and `idle` states and toggles `data-playing="true" | "false"` to switch `animation-play-state: running` vs `paused`, preserving the disc's exact angular orientation when paused and resumed.
- **Static Room Lighting**: The diagonal specular reflection (`.vinyl-sheen` conic gradient with `mix-blend-mode: screen`) sits in a non-rotating overlay layer above `.vinyl-rotor`, keeping light reflections anchored while the vinyl grooves and center label spin underneath.
- **Tonearm Animation**: An inline SVG mechanical tonearm anchored to the platter wrapper smoothly rotates (`duration-700 cubic-bezier(0.22,1,0.36,1)`) from resting (`-rotate-[14deg]`) onto the outer grooves (`rotate-[16deg]`) when playing, and lifts back cleanly when paused or idle.

---

## 4. Spotify Synchronization

- **Single Detection Engine**: Reuses the existing `needle-gsmtc-monitor` worker in [src-tauri/src/media/mod.rs](../src-tauri/src/media/mod.rs), reading via `get_spotify_status` on mount and subscribing to `spotify-status-changed` Tauri events. No second polling thread, OAuth flow, or Spotify Web API client exists.
- **Live Track & Timeline Updates**: Sequence tracking (`spotifySeqRef`) prevents stale initial invoke responses from overwriting newer pushed GSMTC events. Title, artist, album, playback status (`PLAYING` / `PAUSED` / `IDLE`), progress bar, and elapsed/duration timestamps update automatically.
- **Optional GSMTC Playback Transport**: Clicking Previous, Play/Pause, or Next in `VinylApp` invokes `control_spotify_playback`, which routes `TrySkipPreviousAsync()`, `TryTogglePlayPauseAsync()`, or `TrySkipNextAsync()` directly through [src-tauri/src/media/gsmtc.rs](../src-tauri/src/media/gsmtc.rs) to the active Spotify GSMTC session and immediately refreshes status.
- **Waiting / Empty State**: When no active Spotify session exists, the widget remains calm and legible (`"Waiting for Spotify"`, `"Start playback in Spotify"`, `"No active session"`, `"IDLE"` badge, disabled transport controls, stationary disc, parked tonearm).

---

## 5. Artwork Handling

- **Dual Surface Rendering**:
  - **Expanded Album Sleeve**: Square card (`clamp(96px, 41vh, 184px)`) displays the GSMTC `artwork.dataUrl` thumbnail peeking out behind the disc with subtle spine crease highlights.
  - **Rotating Center Vinyl Label**: Renders `artwork.dataUrl` clipped inside the circular inner collar (`inset-[31%]`) of `VinylDisc`, rotating smoothly beneath the static center spindle pin (`h-3.5 w-3.5`).
- **Neutral Fallbacks**: When `artwork` is `null` or Spotify is inactive, the sleeve displays a minimalist vinyl glyph labeled `"VINYL SLEEVE"` and the center disc label renders `"NEEDLE"` (idle) or `"SPOTIFY"` (connected without art) cleanly in the bottom arc below the spindle pin.
- **No Fabricated Data**: Missing title, artist, album, or artwork strictly show explicit fallback labels (`"Title unavailable"`, `"Artist unavailable"`, `"Album unavailable"`).

---

## 6. User Interactions

- **Drag Anywhere**: Pointer down on non-button areas (header drag bar or container surface) invokes `getCurrentWindow().startDragging()`, moving smoothly across Windows desktops without losing WebView hit-testing.
- **8-Edge / Corner Resizing**: Transparent `RESIZE_ZONES` along North, South, East, West, and all four corners call `getCurrentWindow().startResizeDragging(direction)` while respecting per-mode min/max logical bounds.
- **Compact <-> Expanded Toggle**: Switchable from either the vinyl header button or the main window (`Compact` / `Expanded` button), automatically applying per-mode dimensions (`310×360` compact, `540×340` expanded, or user-resized per-mode sizes).
- **Always on Top Pin**: Toggles `always_on_top` (`Pin on Top` / `Pinned Top`) natively with Win32 `WS_EX_TOPMOST`.
- **Hide Without Quitting (`CloseRequested`)**: Clicking the widget close (`×`) button or closing `"Needle Vinyl"` (`WM_CLOSE`) intercepts close (`api.prevent_close()`), calls Win32 `ShowWindow(..., SW_HIDE)` + `vinyl.hide()`, persists `visible: false`, and keeps the main Needle app and GSMTC monitor alive so `"Open Vinyl"` reopens it cleanly.
- **Open Main Window & Reset Position**: `+` header button brings the main `"Needle"` window back into focus (`open_main_window`), and `Reset Pos` in the main window clears custom coordinates/sizes back to the primary monitor's bottom-right work-area default.
- **State Persistence**: Position (`positionX`, `positionY`), visibility (`visible`), layout (`expanded`), pin state (`alwaysOnTop`), and per-mode logical sizes are saved to `%LOCALAPPDATA%\app.needle.windows\vinyl-state.json` (debounced `350 ms` during continuous drags/resizes, flushed immediately on button changes and app exit). Move/resize persistence uses `guard.prefs.visible` so toggles such as `Pin on Top` never suppress geometry saving.

---

## 7. Multi-Monitor Behaviour

- **DPI-Aware Work-Area Placement**: All geometry math uses `monitor.work_area()` and `monitor.scale_factor()`, never hardcoded resolutions, keeping the widget clear of the Windows taskbar.
- **Initial / Reset Placement**: Computes `(work_area.x + work_area.width - phys_w - round(28 * scale), work_area.y + work_area.height - phys_h - round(28 * scale))` on the primary monitor's work area (`1210, 560, 675×425` @ `125%` on `1920×1080` with `1920×1020` work area).
- **Monitor Restoration & Unplug Recovery**:
  - On relaunch, `resolve_work_area_rect` locates the monitor containing the saved window center across all monitors (supporting negative virtual-screen coordinates and heterogeneous DPI scales) and clamps coordinates cleanly inside that monitor's `work_area()`.
  - If a saved external monitor is disconnected, `resolve_work_area_rect` falls back cleanly to the primary monitor's bottom-right work area instead of stranding the widget off-screen.
  - `WindowEvent::ScaleFactorChanged` re-applies logical-to-physical bounds when moving between displays of different DPI scaling.
- **Verification Scope Note**: Live interactive desktop verification ran on a single physical `1920×1080` monitor at `125%` scaling (`DISPLAY1`); multi-monitor coordinates (`-2560, 0`), unplugged-monitor fallback, and `100%`/`125%`/`150%` DPI clamping are verified by unit tests in [src-tauri/src/vinyl.rs](../src-tauri/src/vinyl.rs).

---

## 8. Performance Considerations

- **Zero JS Animation Loop**: Rotation relies purely on CSS transforms (`.vinyl-rotor`), minimizing main-thread JS/React CPU usage during playback.
- **No Redundant Media Timers**: No second GSMTC polling thread exists; `needle-gsmtc-monitor` drives both `island` and `vinyl` using adaptive polling (`1s` while actively playing, `2.5s` while paused or idle, plus immediate `SessionsChanged` / `MediaPropertiesChanged` callbacks).
- **Debounced Disk I/O**: Drag and resize `Moved`/`Resized` bursts coalesce over a `350 ms` trailing debounce timer (`save_gen` generation guard) before serializing `vinyl-state.json`.
- **Single-Instance Efficiency**: Launching Needle while already running exits the second process immediately via `tauri-plugin-single-instance` and focuses `"Needle"` without duplicating WebViews or GSMTC sessions.

---

## 9. Testing Results

### Automated Checks & Production Build

| Check | Command | Observed Result |
| --- | --- | --- |
| TypeScript check | `npm run typecheck` | **Passed** (0 errors) |
| Production frontend bundle | `npm run build` | **Passed** (`dist/index.html`, `dist/island.html`, `dist/vinyl.html`) |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | **Passed** (`19 passed; 0 failed`), including 4 new `vinyl` geometry/clamping/prefs tests |
| Tauri production & installer build | `npm run tauri build` | **Passed** (`needle-windows.exe` `10,023,424` bytes, `Needle_0.1.0_x64-setup.exe` `2,216,317` bytes, `Needle_0.1.0_x64_en-US.msi` `3,297,280` bytes) |

### Installed Standalone Runtime & Live Desktop Verification

Verified against the NSIS-installed binary (`%LOCALAPPDATA%\Needle\needle-windows.exe`, `Needle_0.1.0_x64-setup.exe /S` exited `0`) on Windows 11 Build 26200 (`1920×1080`, `125%` scale):

- **Waiting State & Startup**: Main `"Needle"` (`643×1010` @ `125%`, `500×770` logical, zero scrollbar) and `"Needle Vinyl"` (`675×425` @ `125%` at bottom-right `(1210, 560)`, `ToolWin=True`, `AppWin=False`, `Topmost=False`, `"Waiting for Spotify"` + `"NEEDLE"` fallback) launched cleanly while `"Needle Island"` remained auto-hidden (`Vis=False`).
- **Live Spotify GSMTC Sync & Transport Controls**:
  - Detected active Spotify Desktop playback (`"Often - Kygo Remix"`, `"The Weeknd"`, `"Often (Kygo Remix)"`), rotated center label artwork and expanded sleeve artwork smoothly, swung tonearm onto grooves (`+16deg`), and updated progress (`3:28 / 3:54`).
  - GSMTC track skip (`"Wasted Times"`, `"My Dear Melancholy,"`) and pause updated metadata, artwork, `PAUSED` badge, and lifted tonearm (`-14deg`) cleanly without restarting rotation from scratch.
  - Dynamic Island continued operating normally alongside the vinyl widget (`task008-island-regression.png`).
- **Layout, Z-Order, Move/Resize Persistence & Restart Sync**:
  - Switched cleanly between Expanded (`675×425`) and Compact (`388×450`) modes; toggled `Pin on Top` (`Topmost=True`) -> `Pinned Top` (`Topmost=False`).
  - Moved and resized the widget to `(860, 290, 440×510)` (`352×408` logical in compact mode), persisted automatically to `vinyl-state.json`, and verified across full app restart that **both** `"Needle Vinyl"` restored `(860, 290, 440×510)` and `"Needle"` synchronized its `Compact desktop widget` / `Expanded` button state immediately.
  - Clicked `Expanded` + `Reset Pos` to restore default bottom-right `(1210, 560, 675×425)`.
- **Hide Without Quitting & Single-Instance**:
  - Sending `WM_CLOSE` to `"Needle Vinyl"` hid its native HWND (`Vis=False`) while keeping `"Needle"` (`Vis=True`) alive; clicking `Open Vinyl` restored `"Needle Vinyl"` (`Vis=True`).
  - Launching a second instance exited immediately (`SecondLaunchExited=True, RunningNeedleCount=1`).
  - Closing `"Needle"` exited cleanly with zero leftover processes (`LeftoverNeedle=0`).

---

## 10. Known Limitations

- **Angular Continuity Scope**: Rotational continuity is preserved within a running session across play/pause and track transitions via CSS `animation-play-state`; restarting the Needle process resets the initial CSS rotation angle to `0deg`.
- **Single Physical Monitor Hardware**: Multi-monitor coordinate restoration, unplugged-monitor fallback, and `100%` / `150%` DPI clamping are verified via Rust unit tests (`vinyl.rs`) and runtime Win32 work-area math; live interactive captures ran on a single physical `1920×1080` `125%`-scaled display (`DISPLAY1`).
- **Simulated vs Interactive Drag in Automated Script**: Earlier interactive desktop runs verified real pointer dragging and edge resizing directly on `WinSta0\Default`; inside the final automated background harness, synthetic `mouse_event` drag was blocked by the non-interactive desktop session, so automated restart-persistence regression exercised native `WM_MOVE` / `WM_SIZE` via Win32 `MoveWindow`.
- **Installer Signing & MSI Elevation**: Binaries remain unsigned for local development/testing (SmartScreen warning possible until Authenticode-signed), and per-machine `.msi` UAC installation was not automated in the non-elevated test shell (verified `.msi` WiX build artifact only).
