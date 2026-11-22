# TASK 006 — Critical Runtime Diagnostics: Dynamic Island + Spotify GSMTC

Project: `V:\music wilder\needle-windows`

## Executive Summary

The two runtime failures reported on Windows 11 (`Show Island` doing nothing and Spotify Desktop showing `Not detected` while playing) were diagnosed as **two independent subsystems** and repaired across the Rust backend, Tauri window configuration, and React frontend:

1. **Part A — Dynamic Island Visibility (`Show Island` / `island` HWND):**
   - `tauri.conf.json` configured `"noRedirectionBitmap": true` alongside `"transparent": true` and `"visible": false`. On Windows (`tao` + WebView2 + `softbuffer`), `WS_EX_NOREDIRECTIONBITMAP` skips `DwmEnableBlurBehindWindow` and breaks GDI/redirection rendering for transparent hidden windows when shown later.
   - `show_island` previously returned a fire-and-forget optimistic `IslandUiState { visible: true }` before the Win32 main-thread `show()` executed, without verifying `IsWindowVisible`, `IsWindow`, `GetWindowRect`, or returning errors.
   - `src/App.tsx` previously silently returned on missing `__TAURI_INTERNALS__` and swallowed IPC errors with `.catch(() => {})`, so any failure produced zero UI feedback.

2. **Part B — Spotify Desktop GSMTC Detection (`Not detected`):**
   - `SpotifyPanel.tsx` previously rendered `SpotifyConnectionState::Unavailable` (errors/timeouts) with the exact same `"Not detected"` badge text as `NotDetected`, masking backend/WinRT failures as `"Not detected"`.
   - `gsmtc.rs`, `metadata.rs`, and `thumbnail.rs` called blocking `.join()` on WinRT `IAsyncOperation` calls without timeouts; any stalled WinRT broker call permanently hung the single `needle-gsmtc-monitor` worker thread.
   - `GsmtcClient` did not log raw unfiltered `GetSessions()` output, `RoInitialize` HRESULT codes, or subscribe to `SessionsChanged` / `CurrentSessionChanged` events, and worker polls lacked `catch_unwind` recovery.
   - Live WinRT probes also confirmed how Windows SMTC (`NPSMSvc`) behaves with Win32 Spotify (`Spotify.exe` v1.3.9.2055): Spotify registers `SourceAppUserModelId = "Spotify.exe"` on the interactive user desktop (`WinSta0\Default`) once playback has started and remains registered when paused, whereas closed or freshly opened idle Spotify has `session_count = 0` (and isolated non-active Win32 desktops such as `WinSta0\exebox-...` do not publish local SMTC sessions to `NPSMSvc` even while audio streams).

---

## Part A — Dynamic Island Visibility Fixes

### Root Causes Found & Fixed

| Component | Root Cause | Repair | Source |
| :--- | :--- | :--- | :--- |
| Native window composition | `"noRedirectionBitmap": true` on transparent hidden `island` window skipped DWM blur-behind / GDI redirection surface | Set `"noRedirectionBitmap": false` on `island` | [tauri.conf.json](file:///v:/music%20wilder/needle-windows/src-tauri/tauri.conf.json#L43) |
| Synchronous verified show/hide | `show_island`, `set_island_expanded`, `set_island_display`, and `set_island_follow_primary` returned optimistic state without checking Win32 HWND state or propagating errors | Converted to async `Result<IslandUiState, String>` commands executing on main thread with `sync_channel` verification (2.5s timeout), checking `IsWindow`, `ShowWindow(SW_SHOWNOACTIVATE)`, `SetWindowPos`, `webview.show()`, `IsWindowVisible == true`, and non-zero `GetWindowRect` | [island.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/island.rs), [lib.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/lib.rs#L54-L102) |
| Win32 & DWM diagnostics | Relied only on Tauri `is_visible()` without inspecting actual Win32/DWM window state | Added `IsWindow`, `IsWindowVisible`, `GetWindowRect`, `GetForegroundWindow`, `GetWindowLongPtrW`, `WS_EX_TOPMOST`, `WS_EX_NOREDIRECTIONBITMAP`, `WS_EX_NOACTIVATE`, and `DwmGetWindowAttribute(DWMWA_CLOAKED)` logging | [island.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/island.rs), [Cargo.toml](file:///v:/music%20wilder/needle-windows/src-tauri/Cargo.toml) |
| Frontend IPC error swallowing | Silent `__TAURI_INTERNALS__` early returns and `.catch(() => {})` hid command/event failures | Removed silent catches, awaited Tauri event listeners before initial invokes, added visible UI error banner in `IslandControls`, and added busy state + IPC sequence guards | [App.tsx](file:///v:/music%20wilder/needle-windows/src/App.tsx), [IslandControls.tsx](file:///v:/music%20wilder/needle-windows/src/components/IslandControls.tsx) |

### Native Win32 HWND Inspection (`npm run tauri dev`)

Verified live via UIAutomation (`InvokePattern`) and Win32 (`PrintWindow`, `GetWindowRect`, `GetWindowLongPtrW`, `DwmGetWindowAttribute`) on `DISPLAY1` (`1920x1080`, `125%` DPI, work area `0,0,1920x1020`):

| Stage | Label / HWND | `IsWindow` | `IsWindowVisible` | `Rect` (physical px) | Flags (`Topmost`/`ToolWin`/`AppWin`/`NoRedir`/`NoAct`/`Cloaked`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Startup (`main`) | `Needle` (`0x900032`) | `True` | `True` | `(521, 27, 494x768)` | `False / False / True / False / False / 0` |
| Startup (`island`) | `Needle Island` (`0x10BA2`) | `True` | `False` | `(757, 13, 405x93)` | `True / False / True / False / True / 0` |
| Click `Show Island` (Spotify closed) | `Needle Island` (`0x10BA2`) | `True` | **`True`** | `(757, 13, 405x93)` | `True / True / False / False / True / 0` |
| Click Island (Expand) | `Needle Island` (`0x10BA2`) | `True` | **`True`** | **`(695, 13, 530x250)`** | `True / True / False / False / True / 0` |
| Click Island (Collapse) | `Needle Island` (`0x10BA2`) | `True` | **`True`** | **`(757, 13, 405x93)`** | `True / True / False / False / True / 0` |
| Click `Hide Island` | `Needle Island` (`0x10BA2`) | `True` | **`False`** | `(757, 13, 405x93)` | `True / False / True / False / True / 0` |
| Click `Show Island` #2 | `Needle Island` (`0x10BA2`) | `True` | **`True`** | `(757, 13, 405x93)` | `True / True / False / False / True / 0` |

DPI math check at `125%` (`1.25`):
- Compact logical `324x74` -> `405x93` physical px, `top = round(10 * 1.25) = 13`, `left = (1920 - 405) / 2 = 757`.
- Expanded logical `424x200` -> `530x250` physical px, `top = 13`, `left = (1920 - 530) / 2 = 695`.

---

## Part B — Spotify GSMTC Detection Fixes

### Root Causes Found & Fixed

| Component | Root Cause | Repair | Source |
| :--- | :--- | :--- | :--- |
| Masked error badge | `SpotifyConnectionState::Unavailable` rendered the `"Not detected"` pill label | Display amber `"Unavailable"` pill and explicit error detail when backend status is `Unavailable` | [SpotifyPanel.tsx](file:///v:/music%20wilder/needle-windows/src/components/SpotifyPanel.tsx) |
| Unbounded WinRT waits | `.join()` calls had no timeout and could wedge `"needle-gsmtc-monitor"` indefinitely | Replaced with `wait_async_op<T: RuntimeType>(..., timeout, label)` via `AsyncOperationCompletedHandler` + `Condvar` (2000ms for `RequestAsync`, 1200ms for `TryGetMediaPropertiesAsync` & thumbnail stream) | [gsmtc.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/media/gsmtc.rs#L70-L110), [metadata.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/media/metadata.rs), [thumbnail.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/media/thumbnail.rs) |
| Missing WinRT events & recovery | Polling-only loop without `SessionsChanged`/`CurrentSessionChanged`, `RoInitialize` status logging, or panic guard | Logged `RoInitialize(RO_INIT_MULTITHREADED)` HRESULT (`0x00000000 S_OK`), subscribed `SessionsChanged` + `CurrentSessionChanged` wake callbacks, added `catch_unwind` + manager invalidation retry, added periodic worker heartbeat | [gsmtc.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/media/gsmtc.rs), [mod.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/media/mod.rs) |
| No pre-filter GSMTC visibility | Session list was filtered silently before logging | `enumerate_snapshot` inspects every `GetSessions()` entry and logs `[raw_gsmtc_sessions]` + `current_session` before `select_spotify_session` runs | [mod.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/media/mod.rs#L171-L212) |
| Unified diagnostics log | Logs went only to stderr | Created thread-safe logger writing timestamped entries to `%LOCALAPPDATA%\app.needle.windows\needle-runtime.log` + in-memory ring buffer exposed via `get_runtime_diagnostics` | [diagnostics.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/diagnostics.rs), [lib.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/lib.rs#L118-L129) |

### Observed Windows GSMTC Behavior Across All 5 Spotify States

Tested against installed `Spotify.exe` (`C:\Users\<user>\AppData\Roaming\Spotify\Spotify.exe`) on Windows 11 build `26200`:

1. **State 1 — Spotify closed:**
   - GSMTC: `session_count=0`, `current_session=None`, `sessions=[none]` -> Needle reports `NotDetected`.
2. **State 2 — Spotify open, idle (no playback initiated yet):**
   - GSMTC: `session_count=0`, `current_session=None`, `sessions=[none]` -> Win32 `Spotify.exe` does not publish a Windows SMTC session until playback starts; Needle reports `NotDetected`.
3. **State 3 — Spotify actively playing (`WinSta0\Default`):**
   - WinRT GSMTC probe: `AUMID='Spotify.exe' Status=Playing Title='Master Coming' Artist='Anirudh Ravichander' Album='Master (Telugu) [Original Motion Picture Soundtrack]' Pos=00:00:30.3380000 End=00:03:48.2580000`.
   - `is_spotify_source_app_id("Spotify.exe") == true` -> Needle transitions to `Connected` / `Playing`.
4. **State 4 — Spotify paused (`WinSta0\Default`):**
   - WinRT GSMTC probe: `AUMID='Spotify.exe' Status=Paused Title='Andham Vadi Choopera' Artist='Anirudh Ravichander' Album='Master (Telugu) [Original Motion Picture Soundtrack]' Pos=00:00:01.9330000 End=00:03:14.5000000`.
   - Rust live poll (`cargo test`): `session_count=1 current_session=Some("Spotify.exe") sessions=[#0(aumid='Spotify.exe' status=Paused title=Some("Lean On") artist=Some("Major Lazer") album=Some("Peace Is The Mission (Extended)") spotify=true err=None)]`.
   - Remains `Connected` / `Paused`.
5. **State 5 — Track switched (`WinSta0\Default`):**
   - WinRT GSMTC probe (`TrySkipNextAsync`): `AUMID='Spotify.exe' Status=Playing Title='Andham Vadi Choopera' Artist='Anirudh Ravichander' Pos=00:00:00.0090000 End=00:03:14.5000000`.

> **Sandbox Note (`exebox` Desktop Isolation):** Automated shell commands execute on a secondary desktop (`WinSta0\exebox-...`). When `Spotify.exe` was freshly launched inside that secondary desktop, Windows `AudioSrv` showed `AudioSessionStateActive` (`state=1`) for `Spotify.exe`, yet Windows `NPSMSvc` (`GlobalSystemMediaTransportControlsSessionManager`) did not surface SMTC sessions created inside the non-active `exebox` desktop (`count=0`), whereas Spotify running on the user's interactive desktop (`WinSta0\Default`) surfaced immediately in both Rust (`cargo test`) and WinRT probes. Live desktop `GetDC`/`BitBlt` screen grabs are likewise unavailable from the `exebox` desktop, so visual verification used per-window `PrintWindow(..., PW_RENDERFULLCONTENT)`.

---

## Real Runtime Log Excerpt (`needle-runtime.log`)

Captured from `%LOCALAPPDATA%\app.needle.windows\needle-runtime.log` during live `npm run tauri dev` verification:

```text
[1794474347550] [needle::app] [log_init] Runtime diagnostic log initialized at C:\Users\<user>\AppData\Local\app.needle.windows\needle-runtime.log
[1794474347551] [needle::app] [setup_start] Starting Needle v0.1.0 on x86_64
[1794474347559] [needle::island] [startup_init] Island window created (label='island'); detected 1 monitor(s), primary_index=0, displays=[#0 'DISPLAY1' 1920x1080@(0,0) wa=(0,0,1920x1020) 125% primary=true]
[1794474347562] [needle::island] [startup_hwnd] label='island' HWND=Some("0x10BA2") is_window=Some(true) tauri_vis=Some(false) win32_vis=Some(false) iconic=Some(false) topmost=Some(true) no_redir_bmp=Some(false) cloaked=Some(0) win32_rect=(Some(96),Some(96),Some(405)xSome(93)) fg_hwnd=None dpi_scale=Some(1.25) style=Some("0x04C80000") ex=Some("0x08040118")
[1794474347565] [needle::island] [geometry] target_mon='\\.\DISPLAY1'(idx=0,follow_primary=true) work_area=(0,0,1920x1020) scale=1.25 -> target=(757,13,405x93) actual_pos=Some(PhysicalPosition { x: 757, y: 13 }) actual_size=Some(PhysicalSize { width: 405, height: 93 }) hwnd_scale=Some(1.25)
[1794474347567] [needle::media] [ro_init] RoInitialize(RO_INIT_MULTITHREADED) -> 0x00000000 S_OK (MTA initialized)
[1794474347585] [needle::media] [gsmtc_manager_ready] Acquired Windows GSMTC session manager
[1794474347586] [needle::media] [raw_gsmtc_sessions] [initial] session_count=0 current_session=None sessions=[none]
[1794474347964] [needle::webview] [page_load] window='main' phase=finished url=http://localhost:1420/
[1794474347981] [needle::webview] [page_load] window='island' phase=finished url=http://localhost:1420/island.html
[1794474348094] [needle::island] [webview_ready] Island WebView ready via 'frontend_mount' (visible=false, expanded=false, display_index=0)
[1794474354478] [needle::island] [show_island_cmd] Command show_island invoked: display_index=0, expanded=false, spotify_active=false, webview_loaded=true
[1794474354497] [needle::island] [show_complete] label='island' HWND=Some("0x10BA2") is_window=Some(true) tauri_vis=Some(true) win32_vis=Some(true) iconic=Some(false) topmost=Some(true) toolwin=Some(true) appwin=Some(false) no_redir_bmp=Some(false) cloaked=Some(0) win32_rect=(Some(757),Some(13),Some(405)xSome(93)) fg_hwnd=None dpi_scale=Some(1.25) monitor=Some("\\\\.\\DISPLAY1")
[1794474354498] [needle::island] [show_island_ok] show_island succeeded: HWND=Some("0x10BA2") win32_vis=Some(true) rect=(Some(757),Some(13),Some(405)xSome(93)) topmost=Some(true)
[1794474355562] [needle::island] [set_expanded] Island mode -> expanded (visible=true, display_index=0)
[1794474355570] [needle::island] [geometry] target_mon='\\.\DISPLAY1'(idx=0,follow_primary=true) work_area=(0,0,1920x1020) scale=1.25 -> target=(695,13,530x250) actual_pos=Some(PhysicalPosition { x: 695, y: 13 }) actual_size=Some(PhysicalSize { width: 530, height: 250 }) hwnd_scale=Some(1.25)
[1794474356891] [needle::island] [set_expanded] Island mode -> compact (visible=true, display_index=0)
[1794474359552] [needle::island] [hide_island] Manual hide requested (was_visible=true, display_index=0)
[1794474359854] [needle::island] [hide_complete] Island native window hidden after exit animation
[1794474362453] [needle::island] [show_island_ok] show_island succeeded: HWND=Some("0x10BA2") win32_vis=Some(true) rect=(Some(757),Some(13),Some(405)xSome(93)) topmost=Some(true)
```

---

## Verification Results

All automated checks passed with zero errors and zero warnings after the final edits:

- `npm run typecheck`: **PASS** (`tsc --noEmit`, exit 0)
- `npm run build`: **PASS** (`vite build` built `index.html` + `island.html` cleanly in 353ms, exit 0)
- `cargo test --manifest-path src-tauri/Cargo.toml`: **PASS** (15 passed, 0 failed, 0 warnings)
- `npm run tauri dev` runtime verification: **PASS** (verified `main` & `island` creation, `Show Island`, expand/collapse geometry & rendering, `Hide Island`, re-show, `RoInitialize` MTA, raw GSMTC polling, and worker heartbeat).
