# Needle Windows — Dynamic Island Visibility Diagnostic Report (TASK 004.1)

**Project:** `V:\music wilder\needle-windows`  
**Scope:** Runtime investigation and resolution of floating `island` window visibility on Windows 11 (including laptop + external monitor multi-DPI configurations).

---

## 1. Executive Summary & Confirmed Root Causes

During runtime inspection of the real `needle-windows.exe` process (`Needle` main HWND and `Needle Island` overlay HWND + Chromium/WebView2 child HWNDs) and Tauri 2 / `tao` / `wry` Windows internals, five concrete issues were identified that could leave the `island` window invisible, off-screen, mis-sized, or stuck hidden on real multi-monitor Windows setups:

1. **Multi-monitor & external-primary tracking bug (`src-tauri/src/island.rs`)**
   - Previously `initialize_selection` captured a static `selected_display_index: usize` once at startup with no monitor signature tracking, no `"Primary (Auto)"` mode, and no handler for `WM_DISPLAYCHANGE` / monitor connect/disconnect / primary-display switch / DPI changes.
   - If the user connected/disconnected an external monitor or changed Windows' primary display after launch, `selected_display_index` stayed stale or pointed to wrong/off-screen coordinates.

2. **Mixed-DPI `WM_DPICHANGED` clobber & wrong move/resize ordering (`src-tauri/src/island.rs`, `src-tauri/src/lib.rs`)**
   - `tao`'s `WM_DPICHANGED` handler (`tao/event_loop.rs`) emits `WindowEvent::ScaleFactorChanged` *before* Windows applies `SetWindowPos(..., suggested_rect)`. Calling `reposition` synchronously inside `on_window_event` caused `tao` to overwrite our coordinates right afterward with the OS-suggested rect.
   - `apply_geometry` previously called `set_size` (computed for the target monitor's DPI) *before* moving to that monitor (`set_position`), triggering an intermediate DPI rescaling glitch when moving between a laptop panel (e.g., 150%) and an external display (e.g., 100%/125%), plus asynchronous `SWP_ASYNCWINDOWPOS` drift.

3. **WebView2 initial hidden-window `Intermediate D3D Window` size mismatch (`1482x1022` inside `405x93`)**
   - Live Win32 child-window enumeration (`EnumChildWindows`) proved that because `"island"` starts with `"visible": false` in `src-tauri/tauri.conf.json`, showing `island` without explicitly calling `webview.show()`, `webview.set_bounds(...)`, `PageLoadEvent::Finished` re-sync, and `RedrawWindow` left WebView2's `Intermediate D3D Window` child at an un-synced `1482x1022` swapchain size right after initial creation.

4. **`requestAnimationFrame` (`hasMounted`) visibility gate & `Promise.all` startup race (`src/island/IslandApp.tsx`)**
   - `IslandApp` previously gated pill visibility with `const isShown = hasMounted && islandState.visible` (`opacity-0 -translate-y-2` until `requestAnimationFrame` fired) and blocked hydrating `get_island_state` behind `Promise.all([get_spotify_status, get_island_state])`.
   - On initially-hidden / unfocused WebView2 tool windows (`WS_EX_NOACTIVATE`), Chromium can throttle `requestAnimationFrame` or finish WebView load after `show()`, leaving the DOM pill stuck at `opacity: 0` or stale state even when the native window is visible.
   - Also removed `backdrop-blur-2xl` over the `noRedirectionBitmap: true` transparent surface so WebView2 does not depend on an extra Chromium backdrop-filter pass over desktop transparency.

5. **Win32 `WS_EX_APPWINDOW` / iconification drift (`src-tauri/src/island.rs`)**
   - `tao` creates top-level windows with `WS_EX_APPWINDOW` (`0x00040000`) and without `WS_EX_TOOLWINDOW` (`0x00000080`). Combined with `on_spotify_status` returning early whenever `spotify_active` did not change, a minimized or Win32-style-drifted `island` HWND could remain non-visible even while `IslandUiState.visible == true`.
   - `show_window_sync` now runs synchronously on the main UI thread (`app.run_on_main_thread`), unminimizes if needed, enforces `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST` (clearing `WS_EX_APPWINDOW`), calls `SetWindowPos(..., HWND_TOPMOST, ..., SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE)` and `RedrawWindow`, and self-heals on GSMTC ticks if native HWND state drifts from `visible && !user_hidden`.

---

## 2. End-to-End Runtime Visibility Flow (Verified)

```text
Spotify Desktop (GSMTC / WinRT)
  └─▶ needle-gsmtc-monitor thread (src-tauri/src/media/mod.rs)
        ├─▶ logs [needle::media] [initial | query_change | poll_change]
        ├─▶ app_handle.emit("spotify-status-changed", &status)
        └─▶ IslandController::on_spotify_status (src-tauri/src/island.rs)
              ├─▶ sync_display_topology(app)  [detects monitor/primary/DPI changes]
              ├─▶ self-heal check if visible && !user_hidden && !win32_visible
              ├─▶ app_handle.emit("island-state-changed", &ui_state)
              └─▶ app.run_on_main_thread -> show_window_sync / schedule_delayed_hide
                    ├─▶ unminimize() + compute_top_center_physical_rect(work_area, scale)
                    ├─▶ position first -> size -> re-position -> SetWindowPos(HWND_TOPMOST)
                    ├─▶ Webview::show() + Webview::set_bounds(0, 0, phys_w, phys_h)
                    ├─▶ SetWindowLongW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST)
                    └─▶ RedrawWindow(RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN)
                          └─▶ IslandApp.tsx renders directly from islandState.visible
                                (notifications re-synced on PageLoadEvent::Finished & mount)
```

---

## 3. Changes Applied

- **Rust Backend (`src-tauri/Cargo.toml`, `src-tauri/src/island.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/media/mod.rs`)**:
  - Enabled Win32 features (`Win32_Foundation`, `Win32_Graphics_Gdi`, `Win32_UI_WindowsAndMessaging`) on `windows = "0.62"`.
  - Added `follow_primary` (default `true` — **"Primary (Auto)"**), pinned monitor name retention across index reorders, fallback to Primary (Auto) when a pinned display disconnects, work-area clamping in `compute_top_center_physical_rect`, and `sync_display_topology` emitting `"displays-changed"`.
  - Dispatched all HWND/WebView mutations via `app.run_on_main_thread`, fixed mixed-DPI move-before-resize ordering + synchronous Win32 `SetWindowPos`, synced `Webview::set_bounds` & `Webview::show`, enforced `WS_EX_TOOLWINDOW` + `HWND_TOPMOST` + `RedrawWindow`, and added `WindowEvent::Moved` drift correction + `PageLoadEvent::Finished` re-sync + `main` focus topology sync.
  - Added structured `[needle::island]` and `[needle::media]` `stderr` logs, in-memory log ring buffer, and `get_island_diagnostics`, `set_island_follow_primary`, and `notify_island_ready` Tauri commands.
- **Frontend (`src/types/island.ts`, `src/island/IslandApp.tsx`, `src/components/IslandControls.tsx`, `src/App.tsx`)**:
  - Removed the `requestAnimationFrame` (`hasMounted`) visibility gate and `rAF` expand block so `IslandApp` transitions directly from `islandState.visible` / click state.
  - Replaced `Promise.all` startup gating with independent hydration guarded by event sequence counters, called `notify_island_ready`, removed `backdrop-blur-2xl` from the transparent overlay pill, and added `[needle::island-ui]` console diagnostics.
  - Added **"Primary (Auto)"** display selector support and live `"displays-changed"` listener in `App.tsx` / `IslandControls.tsx`.

---

## 4. Verification Results

### Automated Checks
- `cargo test --manifest-path src-tauri\Cargo.toml`: **14 / 14 passed** (0 warnings), including:
  - `island::tests::computes_top_center_across_dpi_scales_and_multi_monitor_offsets`
  - `island::tests::clamps_coordinates_inside_narrow_or_external_work_areas`
  - `island::tests::follows_primary_when_external_monitor_becomes_primary_or_unplugs`
  - `island::tests::evaluates_spotify_active_visibility_rules`
- `npm run typecheck && npm run build`: Passed (`tsc --noEmit` + Vite multi-entry build).

### Live `npm run tauri dev` Runtime Inspection (Windows 11 + Live Spotify Desktop)
Measured against `1920x1080` (`work_area=(0,0,1920x1020)`, `125%` DPI = `120 DPI`):

| Step | Native HWND (`Needle Island`) State & Child HWNDs | Result |
|---|---|---|
| Startup (`STEP1_INITIAL`) | `HWND=0x3C0902`, `pos=(757,13)`, `405x93`, `Dpi=120`, `Topmost=True`, `ToolWin=True`, `AppWin=False`, `NoRedir=True`, `NoAct=True`, `Cloaked=0` | Created & positioned at top-center |
| Spotify Playing (`STEP2_SPOTIFY_PLAYING`) | `Vis=True Iconic=False`, `WRY_WEBVIEW` + `Chrome_WidgetWin_*` + `Intermediate D3D Window` all synced to `405x93`; `PrintWindow` sampled `6,475` non-black pixels | Compact pill visible with artwork, truncated title, artist, play indicator |
| Click Expand (`STEP3_EXPANDED`) | `Pos=(695,13) Size=530x250`, all child HWNDs incl. `Intermediate D3D Window` resized cleanly to `530x250`; `28,218` non-black samples | Expanded card shows track, artist, album, progress bar, timestamps; updates on Next Track |
| Spotify Paused & Resumed (`STEP4_PAUSED`, `STEP5_RESUMED`) | `Vis=True Iconic=False Topmost=True ToolWin=True`, `Pos=(695,13) Size=530x250` | Remains visible while paused (`PAUSED`), updates live when resumed |
| Click Collapse (`STEP6_COLLAPSED`) | `Pos=(757,13) Size=405x93`, `Vis=True Topmost=True` | Smoothly collapses back to compact pill |
| Hide & Reopen (`STEP7_AFTER_HIDE`, `STEP8_AFTER_REOPEN`) | After `Hide Island`: `Vis=False`. After `Reopen Island`: `Vis=True Iconic=False Pos=(757,13) 405x93 Topmost=True ToolWin=True AppWin=False`, child swapchain `405x93` | Hides and restores reliably on primary top-center |
| Spotify Closed (`STEP9_AFTER_SPOTIFY_CLOSE`) | `Vis=False` cleanly; main `Needle` window updates to `Not detected` | Graceful hide with no orphaned taskbar entry |

### Environment Boundary Note (Sandbox Desktop Capture)
In this automated `exebox` execution environment, Windows Desktop session isolation limits `BitBlt(GetDC(0))` / `Graphics.CopyFromScreen` (`bitbltOk=False`) and presents a single virtualized `1920x1080 @ 125%` monitor to the sandboxed process. Because of that OS isolation boundary:
- **Verified inside live runtime:** Real `needle-windows.exe` HWND creation, Win32 styles (`WS_EX_TOPMOST`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, `WS_EX_NOREDIRECTIONBITMAP`), WebView2 child HWND bounds (`Intermediate D3D Window`), non-cloaked DWM status, top-center physical coordinates, `PrintWindow` rendered frames, GSMTC metadata/event flow, and interactive UI controls.
- **Verified via unit tests & architecture (confirm on your physical dual-monitor desktop):** Moving/switching primary between your laptop panel and external monitor with different Windows DPI scaling (`100%` / `125%` / `150%`). Launch `npm run tauri dev` normally on your desktop session and confirm visually in **Display -> Primary (Auto)** and explicit display selection; `[needle::island]` logs in the terminal will print every monitor topology change and target coordinate live.
