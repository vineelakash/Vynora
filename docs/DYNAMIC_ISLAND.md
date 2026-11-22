# Needle Windows Dynamic Island — Architecture & Implementation

`needle-windows` implements a native, transparent, always-on-top floating **Dynamic Island** overlay window (`label: "island"`) on Windows 11, powered by the existing TASK 003 Windows GSMTC Spotify monitor without introducing a second media polling loop.

---

## 1. Multi-Window Tauri Architecture

### Window Configuration ([src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json))
- **`main` window** (`480×730`, min `400×640`): Hosts the core Needle companion UI, Spotify connection panel, and Dynamic Island visibility/display controls. Closing `main` calls `app_handle.exit(0)` so the hidden overlay never leaves an orphan process.
- **`island` window** (`label: "island"`, `title: "Needle Island"`, `url: "island.html"`):
  - `decorations: false` — frameless window with no Windows title bar.
  - `transparent: true` and `noRedirectionBitmap: true` — enables a transparent DirectComposition swapchain canvas (`WS_EX_NOREDIRECTIONBITMAP`) without a startup white flash.
  - `shadow: false` — prevents Windows 11 from drawing a 1px white border around undecorated transparent windows.
  - `alwaysOnTop: true` — keeps the island pinned above normal application windows (`WS_EX_TOPMOST`).
  - `skipTaskbar: true` — removes the overlay from the Windows taskbar (`ITaskbarList::DeleteTab`), re-applied on show.
  - `focus: false` and `focusable: false` — applies `WS_EX_NOACTIVATE` and shows with `SW_SHOWNOACTIVATE` so appearing or clicking the island does not steal foreground focus.
  - `visible: false`, `resizable: false`, `maximizable: false`, `minimizable: false`.

### Capabilities & Multi-Entry Vite Bundle
- **[src-tauri/capabilities/default.json](../src-tauri/capabilities/default.json)**: Grants `core:default` permissions to `["main", "island"]` so both WebViews can invoke Tauri commands and listen to Tauri events.
- **[vite.config.ts](../vite.config.ts)** & **[island.html](../island.html)**: Multi-page Rollup configuration building `dist/index.html` (`src/main.tsx`) and `dist/island.html` (`src/island/main.tsx`).
- **[src/island/island.css](../src/island/island.css)**: Forces `html, body, #root` to `background: transparent !important;` cleanly isolated from the opaque `#09090b` body styling used by the main window.

---

## 2. Positioning & Windows DPI Scaling

All geometry calculations live in **[src-tauri/src/island.rs](../src-tauri/src/island.rs)** and never hardcode screen resolutions:

- **Logical Window Sizes** (include transparent outer margins for soft drop shadows):
  - **Compact HWND**: `324 × 74` logical px (renders a `296 × 48` pill centered horizontally, `4 px` from top).
  - **Expanded HWND**: `424 × 200` logical px (renders a `388 × 164` card centered horizontally, `4 px` from top).
  - **Top margin**: `10` logical px below the selected display's `work_area().position.y`.
- **Scaling & Top-Center Alignment**:
  - Resolves target monitor (`selected_display_index`, defaulting to the primary monitor via `available_monitors()` / `primary_monitor()`).
  - Computes physical dimensions using `monitor.scale_factor()`:
    - `phys_w = round(logical_w * scale)`
    - `phys_h = round(logical_h * scale)`
    - `x = work_area.x + (work_area.width - phys_w) / 2`
    - `y = work_area.y + round(10.0 * scale)`
  - Listens for `WindowEvent::ScaleFactorChanged` on `island` to reposition automatically if display DPI changes.

---

## 3. Playback Integration & Visibility Lifecycle

### Single GSMTC Source of Truth ([src-tauri/src/media/mod.rs](../src-tauri/src/media/mod.rs))
- The existing `needle-gsmtc-monitor` thread continues to drive all detection (`get_spotify_status` & `spotify-status-changed`).
- Whenever initial status is polled or changes, it notifies `IslandController::on_spotify_status(&app_handle, &status)` and emits `spotify-status-changed`. No second polling loop exists.

### Visibility Rules (`IslandController`)
- **Active Session (`Connected` + `Playing` or `Paused`)**: Shows `island` automatically if it was not manually dismissed during the current active session, emits `island-state-changed`, and keeps it visible across track switches, pauses, and resumes.
- **Session Gone (`NotDetected` / `Closed` / `Unavailable`)**: Emits `island-state-changed` (`visible: false, expanded: false`) so React plays its `300 ms` exit fade/translate animation before `schedule_delayed_hide` calls `island.hide()` and resets the HWND to compact dimensions.
- **Manual Control from Main App**:
  - `show_island` / `hide_island` allow hiding, manually peeking, or reopening the overlay via the `Dynamic Island` section in the main window (`src/components/IslandControls.tsx`).
  - Closing the `island` HWND directly is intercepted (`api.prevent_close()`) and converted to `hide_island` so the overlay can always be reopened without restarting Needle.
  - `get_available_displays` and `set_island_display` let the user switch which monitor hosts the island.

---

## 4. Compact & Expanded Island Interface ([src/island/IslandApp.tsx](../src/island/IslandApp.tsx))

- **Compact Mode (`296 × 48` pill)**:
  - Dark obsidian (`#070709/95`) rounded capsule with hairline border (`border-white/[0.09]`) and soft shadow.
  - Shows circular album artwork thumbnail (or monochrome vinyl icon fallback), truncated track title, truncated artist name, and clean non-visualizer playback indicator (play triangle / pause bars / idle dot).
- **Expanded Mode (`388 × 164` card)**:
  - Clicking the compact pill grows the HWND to `424 × 200` first and transitions the inner card smoothly over `300 ms` (`cubic-bezier(0.22, 1, 0.36, 1)`) to show:
    - `76 × 76` hero album artwork
    - Playback status badge (`Playing` / `Paused` / `Not detected`)
    - Track title, artist, and album (explicit `unavailable` text if missing)
    - Read-only progress bar, current playback time, and total duration (`mm:ss`)
  - Clicking again animates the card smoothly back to compact before shrinking the HWND to `324 × 74` so the transparent region never clips animations or blocks underlying desktop apps longer than needed.

---

## 5. Verification & Observed Behavior

Verified on **Windows 11 Build 26200** (`x86_64-pc-windows-msvc`, `1920×1080` display at **125% / 120 DPI scaling**):

| Check | Command / Action | Result |
| --- | --- | --- |
| TypeScript & production bundle | `npm run typecheck` & `npm run build` | Passed; emitted both `dist/index.html` and `dist/island.html`. |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | Passed cleanly (`12 passed; 0 failed`, 0 compiler warnings), including DPI geometry & visibility state unit tests. |
| Startup with Spotify closed | Launched `npm run tauri dev` with `Spotify.exe` stopped | Main window (`Needle`, `618×960` px) opened cleanly; `Needle Island` stayed hidden (`Visible=False`). |
| Live Spotify playback & DPI bounds | Active `Spotify.exe` GSMTC playback (`Aeroplane (From "Scene")`, `0:29 / 2:27`) | `Needle Island` appeared top-center at `(757, 13)` with size `405×93` px (`324×74` @ `1.25×` scale), `Topmost=True`, `NoActivate=True`, `NoRedirectionBitmap=True`. |
| Expand & collapse via click | Sent `WM_LBUTTONDOWN`/`WM_LBUTTONUP` to `Chrome_RenderWidgetHostHWND` | Compact pill expanded to `(695, 13)` `530×250` px (`424×200` @ `1.25×`), then second click collapsed cleanly back to `(757, 13)` `405×93` px. |
| Track change, pause, resume | `TrySkipNextAsync()` -> `Niagara Falls` (`The Weeknd`); `TryPauseAsync()`; `TryPlayAsync()` | Artwork, title, artist, album, progress bar, timestamps, and `PLAYING` / `PAUSED` state updated automatically while keeping the island visible. |
| Hide / Reopen from Main UI | Invoked `Hide Island` then `Reopen Island` via Main window controls | `Needle Island` hid (`Visible=False`), Main UI updated to `Reopen Island`, then reopened (`Visible=True`). |
| Spotify closes | Stopped `Spotify.exe` | `Needle Island` hid gracefully (`Visible=False`) and Main UI reverted to `Not detected`. |

### Current Scope & Limitations
- **Intentionally Excluded**: Playback control buttons, synced lyrics, Beat Glow, audio visualizers, and Spotify OAuth are out of scope for this milestone.
- **UI Verification Scope**: Interactive desktop captures verified live playback, track changes, pause/resume, click expand/collapse, hide/reopen, and close transitions on a single `125%`-scaled monitor; multi-monitor live switching is handled in `IslandController` and unit-tested in `island.rs` (`computes_top_center_across_dpi_scales_and_multi_monitor_offsets`), though only one physical monitor was connected during live testing.
- **No-Redirection Capture Artifact**: Windows `PrintWindow(..., PW_RENDERFULLCONTENT)` captures transparent `WS_EX_NOREDIRECTIONBITMAP` margins as solid black pixels in standalone window PNG dumps rather than desktop wallpaper compositing (isolated sandbox desktops disallow `CopyFromScreen`).
