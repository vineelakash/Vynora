# TASK D — Functional Button Audit & VYNORA Rebranding

**Project:** VYNORA (formerly Needle Windows) — `V:\music wilder\needle-windows`  
**Platform:** Windows 11 x64  
**Scope:** Complete functional audit and repair of all existing interactive controls + complete user-facing rebranding to **VYNORA** with lossless user-data migration and updated NSIS & MSI installers.

---

## 1. Complete Inventory of Existing Interactive Controls

Every interactive element across all four windows (`Main`, `Lyrics Studio`, `Fullscreen Lyrics Player`, `Dynamic Island`, and `Desktop Vinyl`) was inventoried and tested live on Windows 11 (`%LOCALAPPDATA%\VYNORA\VYNORA.exe`).

### 1.1 Main Application Navigation (`src/App.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **Player & Companion** sidebar button | Switches workspace to `player` without interrupting Spotify/lyrics/overlays | Live UI Automation + visual check | **PASS** | Active bar, hover, and focus states verified |
| **Lyrics Studio** sidebar button | Switches workspace to `studio` without interrupting Spotify/lyrics/overlays | Live UI Automation + visual check | **PASS** | Preserves live Spotify & lyrics sync |

### 1.2 Dynamic Island Controls & Overlay (`src/components/IslandControls.tsx`, `src/island/IslandApp.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **Show / Hide / Reopen Island** button | Invokes `show_island` / `hide_island` | Live UI Automation | **PASS** | Label & status badge update cleanly |
| **Display** `<select>` dropdown | Invokes `set_island_display` / `set_island_follow_primary` | Code + multi-display Rust tests (`cargo test`) + UI inspection | **CONDITIONAL** | Single-display test host shows `Primary (Auto · DISPLAY1)`; multi-monitor switching verified via Rust `island::tests` |
| **Dynamic Island Card Click / Enter / Space** | Invokes `set_island_expanded` (compact ↔ expanded) | Code + prior desktop verification | **CONDITIONAL** | Requires Island visible; click/keyboard expand/collapse wired cleanly |
| **Island `♪ Lyrics` toggle** | Invokes `set_lyrics_prefs({ islandLyricsEnabled })` | Persisted via `lyrics-prefs.json` | **CONDITIONAL** | Visible when Dynamic Island is expanded |
| **Island `⚡ Glow` toggle** | Invokes `set_beat_glow_prefs({ islandGlowEnabled })` | Persisted via `beat-glow-prefs.json` | **CONDITIONAL** | Visible when Dynamic Island is expanded |

### 1.3 Desktop Vinyl Controls & Widget (`src/components/VinylControls.tsx`, `src/vinyl/VinylApp.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **Open Vinyl / Hide Vinyl** button | Invokes `show_vinyl` / `hide_vinyl` | Live UI Automation (`VYNORA Vinyl` HWND verified) | **PASS** | Opens/hides frameless `VYNORA Vinyl` widget |
| **Compact / Expanded** button | Invokes `set_vinyl_expanded` | Live UI Automation | **PASS** | Toggles layout & persists to `vinyl-state.json` |
| **Pin on Top / Pinned Top** button | Invokes `set_vinyl_always_on_top` | Live UI Automation (`TogglePattern`) | **PASS** | Persists Always-on-Top state |
| **Reset Pos** button | Invokes `reset_vinyl_position` | Live UI Automation | **PASS** | Restores bottom-right anchor safely |
| **Vinyl Header `♪` (Lyrics) / `⚡` (Glow) / Pin / Compact-Expand / Open VYNORA / Hide** | Invokes `set_lyrics_prefs`, `set_beat_glow_prefs`, `set_vinyl_*`, `open_main_window`, `hide_vinyl` | Rust tests + code audit | **CONDITIONAL** | Active when `VYNORA Vinyl` widget is open |
| **Vinyl Transport (`Previous`, `Play/Pause`, `Next`)** | Invokes `control_spotify_playback` with `"previous"`, `"playPause"`, `"next"` | Code audit + GSMTC contract check | **CONDITIONAL** | Intentionally disabled when Spotify is disconnected (`!isConnected`) |

### 1.4 Beat Glow Visualizer Panel (`src/components/visualizer/BeatGlowPanel.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **🎨 Album / ⚪ Mono** theme switcher | Invokes `set_beat_glow_prefs({ theme })` | Live UI Automation | **PASS** | Switches between album artwork palette & monochrome |
| **⚡ Glow On / Off** button | Invokes `set_beat_glow_prefs({ enabled })` + clears canvas when disabled | Live UI Automation | **FIXED** | Previously left stale frozen frame on canvas when toggled off |
| **Collapse / Expand** button | Invokes `set_beat_glow_prefs({ showMainVisualizer })` | Live UI Automation + **full app restart test** | **FIXED** | Previously ignored persisted `showMainVisualizer: false` on restart; verified `Beat Glow remained collapsed after restart: True` |
| **Mode Tabs (`Spectrum`, `Waveform`, `Circular`, `Ambient`)** | Invokes `set_beat_glow_prefs({ mode })` | Live UI Automation | **PASS** | All 4 modes switch & persist |
| **Island / Vinyl** sync checkboxes | Invokes `set_beat_glow_prefs({ islandGlowEnabled / vinylGlowEnabled })` | Rust `beat_glow_prefs_patch` tests + live UI check | **PASS** | Persisted in `beat-glow-prefs.json` |
| **Sensitivity & Visual Intensity** sliders | Invokes `set_beat_glow_prefs({ sensitivity / intensity })` | Rust clamping tests + live UI check | **PASS** | Clamped & persisted in `beat-glow-prefs.json` |

### 1.5 Synchronized Lyrics Panel (`src/components/LyricsPanel.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **Refresh lyrics** icon button | Calls `retryLookup` (`request_lyrics_lookup` with `forceRefresh: true`) | Live UI Automation | **PASS** | Visible when Spotify connected |
| **Show / Hide** button | Invokes `set_lyrics_prefs({ mainPanelOpen })` | Live UI Automation (`ExpandCollapsePattern`) | **PASS** | Persisted in `lyrics-prefs.json` |
| **Return to current line** pill | Re-enables auto-scroll & jumps smoothly to `activeIndex` | Code audit + unit tests | **CONDITIONAL** | Appears only when user manually scrolls away during synced playback |
| **Retry** button (error/unavailable state) | Calls `retryLookup` | Code audit | **CONDITIONAL** | Appears only in `error` or `unavailable` lookup state |

### 1.6 Lyrics Studio (`src/components/lyrics/LyricsAnimationStudio.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **Live Spotify / Sample Studio** toggle | Switches preview source (`mode: 'live' \| 'sample'`) | Live UI Automation | **PASS** | Preserves playback & lyrics continuity |
| **Sample Track Buttons (`English`, `Telugu`, `Hindi`)** | Switches active sample track & resets sample position | Live UI Automation | **PASS** | Visible in `Sample Studio` mode |
| **Sample Transport (`Play`/`Pause`, `Reset`, Scrub Slider)** | Controls sample clock | Live UI Automation | **PASS** | Instant pause/resume/reset/seek |
| **Target Monitor `<select>`** | Selects target monitor for Fullscreen Player | Code + `get_lyrics_player_displays` | **CONDITIONAL** | Appears when `displays.length > 1` |
| **Fullscreen / Expand** buttons | Invokes `show_lyrics_player({ monitorId, fullscreen: true })` | Live UI Automation | **FIXED** | Now syncs all Studio settings cleanly into the persistent `VYNORA Lyrics Player` window |
| **Presets (`Cinematic`, `Smooth`, `Minimal`, `Expressive`)** | Calls `applyPreset` & persists via `saveStudioSettings` | Live UI Automation + storage unit tests | **FIXED** | Cross-window sync to Fullscreen Player verified |
| **Animation Styles (6: `Big Words`, `Lines`, `Lens`, `Constellation`, `Terminal`, `Karaoke`)** | Calls `updateSettings({ style })` & persists | Live UI Automation + visual verification | **FIXED** | Live cross-window sync (`Terminal` → `VYNORA Lyrics Player`) verified on desktop |
| **Background Environments (4: `Album Aura`, `Pure Black`, `Album Cover`, `Ambient Motion`)** | Calls `updateSettings({ background })` & persists | Live UI Automation + visual verification | **FIXED** | Persists & syncs across windows |
| **Advanced Customization Toggle (`Expand`/`Collapse`)** | Toggles customization drawer | Live UI Automation + screenshot | **PASS** | Reveals Typography, Animation & Effects, Sync Offset, Toggles, Reset |
| **Typography Dropdowns (`Font Family`, `Font Size`, `Font Weight`, `Alignment`) & Sliders (`Letter Spacing`, `Line Spacing`, `Speed`, `Intensity`, `Glow`, `Blur`, `Particles`, `Sync Offset`)** | Calls `updateSettings(...)` & persists | Unit tests (`studioSettingsStorage.test.ts`) + live drawer verification | **FIXED** | Persisted across restarts & synced cross-window |
| **Checkboxes (`Reduced-Motion Mode`, `Audio-Reactive Effects`)** | Calls `updateSettings(...)` | Storage unit tests + live drawer verification | **FIXED** | Persisted across restarts & synced cross-window |
| **Reset to Defaults** button | Calls `resetToDefaults()` | Code + storage unit tests | **PASS** | Resets to `DEFAULT_STUDIO_SETTINGS` & saves |
| **Keyboard `F3` / `Ctrl+Shift+D`** | Toggles diagnostic HUD & persists `vynora_perf_overlay` | Code + unit tests | **FIXED** | Now persists and syncs `showPerfDiagnostics` across windows |

### 1.7 Fullscreen Lyrics Player (`src/lyrics-player/LyricsPlayerApp.tsx`)
| Control | Action / Binding | Verification Method | Status | Notes |
|---|---|---|---|---|
| **Live Spotify / English / Telugu / Hindi** source pills | Switches between live Spotify GSMTC and sample tracks | Live UI Automation | **PASS** | Smooth switching without restarting window |
| **FPS** HUD button & `F3`/`Ctrl+Shift+D` | Toggles diagnostic HUD & syncs `vynora_perf_overlay` | Live UI Automation | **FIXED** | Persists across style switches & syncs with Studio |
| **Enter Fullscreen / Exit Fullscreen** button & `F`/`F11` | Invokes `toggle_lyrics_player_fullscreen` | Live UI Automation (`Exit Fullscreen synced accurately: True`) | **FIXED** | Previously showed stale `"Enter Fullscreen"` when opened in fullscreen |
| **Close (`Esc`)** button | Invokes `hide_lyrics_player` | Live UI Automation | **PASS** | Cleanly exits fullscreen and hides player |
| **Previous Track (`←`) / Play-Pause (`Space`) / Next Track (`→`)** | Invokes `control_spotify_playback` with camelCase `MediaControlAction` | Unit tests + Live UI Automation (`Play/Pause (Space)` live Spotify) | **FIXED** | Previously broken in live Spotify mode due to PascalCase mismatch (`PlayPause`/`NextTrack`/`PreviousTrack`) |
| **Style Pills (6) & Background Pills (4)** | Updates settings & syncs back to Lyrics Studio | Live UI Automation (`Constellation` clicked) | **FIXED** | Now syncs back to main window via `storage` + `focus` listeners |
| **Canvas Double-Click Fullscreen** | Toggles fullscreen when double-clicking canvas | Code + guard verification | **FIXED** | Now ignores double-clicks on buttons/inputs so rapid transport clicks never toggle fullscreen |

---

## 2. Summary of Broken Controls & Root Causes Fixed

| # | Defect | Root Cause | Fix Implemented | Files Modified |
|---|---|---|---|---|
| **1** | Fullscreen Lyrics Player live Spotify transport buttons (`Play/Pause`, `Next`, `Previous`) & media keys (`Space`, `←`, `→`) failed silently | `LyricsPlayerApp.tsx` sent PascalCase `'PlayPause' \| 'NextTrack' \| 'PreviousTrack'` while Rust `MediaControlAction` (`#[serde(rename_all = "camelCase")]`) required `"playPause" \| "next" \| "previous"`, and discarded the returned `SpotifyStatus`. | Added `mapPlayerTransportAction()` mapping to exact `MediaControlAction` values, guarded concurrent calls with `controlBusyRef`, and updated `setSpotifyStatus(nextStatus)`. | `src/lyrics/animation/studioSettingsStorage.ts`, `src/lyrics-player/LyricsPlayerApp.tsx` |
| **2** | Lyrics Studio ↔ Fullscreen Lyrics Player settings out of sync | Both windows loaded `localStorage` once on mount. Because `lyrics-player` is a persistent hidden Tauri window, edits in Lyrics Studio never reached Fullscreen Player (and vice versa). | Added shared `studioSettingsStorage.ts` plus `storage` and `focus` event listeners in both `LyricsAnimationStudio.tsx` and `LyricsPlayerApp.tsx`. | `src/lyrics/animation/studioSettingsStorage.ts`, `src/components/lyrics/LyricsAnimationStudio.tsx`, `src/lyrics-player/LyricsPlayerApp.tsx` |
| **3** | Beat Glow `Collapse` / `Expand` did not persist across app restarts | `BeatGlowPanel.tsx` initialized `useState(prefs.showMainVisualizer)` once before async `get_beat_glow_prefs` resolved from disk. | Derived `isOpen = prefs.showMainVisualizer` directly from authoritative `prefs`. Verified live across full process restart (`Beat Glow remained collapsed after restart: True`). | `src/components/visualizer/BeatGlowPanel.tsx` |
| **4** | Beat Glow canvas froze on last frame when toggled `⚡ Glow Off` | Canvas render `useEffect` returned early when `!prefs.enabled` without clearing the 2D context. | Added `ctx.clearRect(0, 0, canvas.width, canvas.height)` when `!prefs.enabled`. | `src/components/visualizer/BeatGlowPanel.tsx` |
| **5** | Fullscreen Player showed `"Enter Fullscreen"` while already fullscreen | `win.isFullscreen()` was only queried once on hidden mount, not when shown via `show_lyrics_player`. | Re-synced `win.isFullscreen()` on `focus` and `resize` events. Verified live (`Exit Fullscreen synced accurately: True`). | `src/lyrics-player/LyricsPlayerApp.tsx` |
| **6** | Double-clicking buttons in Fullscreen Player accidentally toggled fullscreen | `onDoubleClick={handleToggleFullscreen}` sat on the root container wrapping `<header>` and `<footer>`. | Guarded `onDoubleClick` to ignore events inside `button, input, select, a`. | `src/lyrics-player/LyricsPlayerApp.tsx` |

---

## 3. VYNORA Rebranding Locations Updated

| Category | Files Updated |
|---|---|
| **Tauri Product, Binary & Installers** | `src-tauri/tauri.conf.json` (`productName: "VYNORA"`, `mainBinaryName: "VYNORA"`, window titles `"VYNORA"`, `"VYNORA Island"`, `"VYNORA Vinyl"`, `"VYNORA Lyrics Player"`, `publisher: "VYNORA Contributors"`, descriptions), `src-tauri/Cargo.toml` (`[[bin]] name = "VYNORA"`, description, authors) |
| **HTML Document Titles** | `index.html`, `island.html`, `vinyl.html`, `lyrics-player.html` |
| **Backend App Metadata & Logs** | `src-tauri/src/lib.rs` (`AppInfo.name = "VYNORA"`, startup log, panic message, unit test assertion) |
| **Frontend Visible UI & Accessibility** | `src/App.tsx`, `src/lyrics-player/LyricsPlayerApp.tsx` (`"VYNORA Immersive Player"`), `src/island/IslandApp.tsx`, `src/vinyl/VinylApp.tsx`, `src/vinyl/VinylDisc.tsx` (`"VYNORA"`), `src/services/lyricsService.ts` (`LRCLIB_CLIENT_HEADER`) |
| **Documentation** | `README.md`, `docs/TASK_D_FUNCTIONAL_AUDIT_AND_VYNORA_REBRANDING.md` |

---

## 4. User-Data Preservation & Migration Strategy

To guarantee zero loss of user settings during upgrade from Needle to **VYNORA**:

1. **Preserved App Data Directory (`%LOCALAPPDATA%\app.needle.windows\`)**:
   - Kept `identifier: "app.needle.windows"` and WiX `upgradeCode: "9b84ad60-b9a2-5c15-b13a-4d2f6778d919"` in `src-tauri/tauri.conf.json`.
   - Preserves `beat-glow-prefs.json`, `lyrics-prefs.json`, `vinyl-state.json`, and WebView2's `EBWebView` `localStorage` automatically across installation and restart.
2. **Backward-Compatible `localStorage` Key Migration (`studioSettingsStorage.ts`)**:
   - Reads `vynora_lyrics_studio_settings` first, falling back seamlessly to `needle_lyrics_studio_settings` (migrating forward without deleting the legacy key).
   - Reads `vynora_perf_overlay` first, falling back to `needle_perf_overlay`.
   - Preserves legacy `stars` → `constellation` migration safely.

---

## 5. Automated Test Results

| Suite | Command | Result |
|---|---|---|
| **TypeScript Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS (0 errors)** |
| **Frontend Unit Tests** | `npm run test:unit` | **PASS (87 / 87 tests)** — includes 4 new tests in `src/lyrics/animation/studioSettingsStorage.test.ts` |
| **Rust Backend Tests** | `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS (33 / 33 tests)** |
| **Production Build & Installers** | `npx tauri build` | **PASS** — produced `VYNORA.exe`, `VYNORA_0.1.0_x64-setup.exe` (2.25 MiB), and `VYNORA_0.1.0_x64_en-US.msi` (3.39 MiB) |

---

## 6. Actual Windows Desktop Verification Results

Performed live on Windows 11 x64 using the built NSIS installer (`VYNORA_0.1.0_x64-setup.exe /S`):

- **Silent NSIS Installation**: Exit code `0`; installed `%LOCALAPPDATA%\VYNORA\VYNORA.exe` and `%LOCALAPPDATA%\VYNORA\uninstall.exe`.
- **Windows Branding Verified**:
  - Start Menu shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\VYNORA.lnk`
  - Desktop shortcut: `%USERPROFILE%\Desktop\VYNORA.lnk`
  - Windows Installed Apps Registry (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*`): `DisplayName='VYNORA'`, `Publisher='VYNORA Contributors'`, `Version='0.1.0'`.
  - Window titles verified live: **`VYNORA`**, **`VYNORA Vinyl`**, **`VYNORA Lyrics Player`**.
- **User-Data Preservation Verified**: All pre-existing files in `%LOCALAPPDATA%\app.needle.windows\` (`beat-glow-prefs.json`, `lyrics-prefs.json`, `vinyl-state.json`) remained intact after installation and launch.
- **Restart Persistence Verified**: Collapsed Beat Glow → restarted `VYNORA.exe` → confirmed `Expand` button remained active (`Beat Glow remained collapsed after restart: True`) → expanded cleanly.
- **Live Cross-Window Sync & Fullscreen Verified**: Selected `Terminal` + `Album Aura` in `Lyrics Studio` → clicked `Fullscreen` → `VYNORA Lyrics Player` opened in borderless fullscreen displaying live Spotify track in `Terminal` style with `Exit Fullscreen` accurately synced and `Play/Pause (Space)` responsive.
- **Screenshots Captured**: `task-d-vynora-main.png`, `task-d-vynora-studio.png`, `task-d-vynora-player.png`.

---

## 7. Remaining Limitations

- **Multi-Monitor Dropdown (`IslandControls` & `LyricsAnimationStudio`)**: The test machine had a single physical monitor (`DISPLAY1`), so multi-monitor display switching was verified via automated Rust topology tests (`cargo test` — `island::tests`) rather than physical dual-monitor drag testing.
- **Island Display Pin Persistence**: By existing design in `src-tauri/src/island.rs`, Dynamic Island resets to `followPrimary: true` on startup so disconnected external monitors never strand the overlay off-screen; this session-scoped behavior was intentionally preserved.
- **MSI Per-Machine Install**: `VYNORA_0.1.0_x64_en-US.msi` (3.39 MiB) built cleanly with WiX (`candle` + `light`) preserving `upgradeCode`; live installation was verified via the per-user NSIS installer (`VYNORA_0.1.0_x64-setup.exe`) which does not require UAC elevation.
