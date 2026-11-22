# TASK 007 — Production Build & Standalone Windows Packaging

## 1. Files Changed

### Modified
- `src-tauri/Cargo.toml`: Added `tauri-plugin-single-instance = "2"` (resolved to `v2.5.5` in `src-tauri/Cargo.lock`).
- `src-tauri/src/lib.rs`: Registered `.plugin(tauri_plugin_single_instance::init(...))` as the first plugin on `tauri::Builder::default()`. When a second launch occurs, Needle logs `single_instance`, unminimizes, shows, and focuses only the `main` window without touching the `island` window or spawning a duplicate GSMTC monitor thread.
- `src-tauri/tauri.conf.json`: Enabled production bundling (`bundle.active: true`), configured `targets: ["nsis", "msi"]`, publisher/category/descriptions, full Windows icon list (including `icons/64x64.png` and multi-resolution `icons/icon.ico`), `webviewInstallMode: { type: "downloadBootstrapper", silent: true }`, `allowDowngrades: true`, NSIS `currentUser` / `lzma` settings, and WiX MSI `upgradeCode` / `en-US` settings.

### Created
- `README.md`: Project overview, implemented features, end-user installation instructions (`.exe` and `.msi`), requirements, development commands, and production build instructions.
- `docs/TASK_007_PRODUCTION_PACKAGING.md`: This packaging and verification report.

No changes were made to the GSMTC detection implementation (`src-tauri/src/media/`), Dynamic Island architecture (`src-tauri/src/island.rs`, `src/island/`), window labels (`main`, `island`), or `capabilities/default.json`.

---

## 2. Production Configuration

| Setting | Configured Value | Notes |
| --- | --- | --- |
| Product Name | `Needle` | Used in Start Menu, Desktop shortcut, and Installed Apps |
| Package Name | `needle-windows` | Release binary filename: `needle-windows.exe` |
| Version | `0.1.0` | Consistent across `package.json`, `Cargo.toml`, `tauri.conf.json` |
| Identifier | `app.needle.windows` | Single-instance mutex/pipe key & `%LOCALAPPDATA%\app.needle.windows` |
| Publisher | `Needle Contributors` | Shown in Windows Installed Apps & MSI/NSIS metadata |
| Target Architecture | `x86_64-pc-windows-msvc` | Pinned via `src-tauri/.cargo/config.toml`; verified PE `Machine=0x8664` |
| Windows Subsystem | GUI (`Subsystem=2`) | Enforced by `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in `src-tauri/src/main.rs` |
| Frontend Assets | `../dist` (`npm run build`) | Embedded in binary (`tauri::generate_context!()`); runtime loads `http://tauri.localhost/` and `http://tauri.localhost/island.html` with no `localhost:1420` dependency |
| WebView2 Mode | `downloadBootstrapper` (`silent: true`) | Uses system WebView2 Runtime (`157.0.4341.46` present); downloads Edge WebView2 bootstrapper silently only if absent on target Windows PC; never bundles offline WebView2 runtime or Spotify |
| Icons (`src-tauri/icons/`) | `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` (256px), `icon.ico` | All PNGs verified `Format32bppArgb`; `icon.ico` verified 6 RGBA sizes (`16, 24, 32, 48, 64, 256`) |
| Single Instance | `tauri-plugin-single-instance` (`v2.5.5`) | Second launch exits immediately and focuses `main`; leaves `island` untouched |

---

## 3. Installer Formats Generated

1. **NSIS Setup Executable (Primary)**: `Needle_0.1.0_x64-setup.exe`
   - Compression: `lzma` solid (`SetCompressor /SOLID "lzma"`).
   - Install scope: `currentUser` (`%LOCALAPPDATA%\Needle`, no UAC elevation required when WebView2 is already installed).
   - Start Menu shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Needle.lnk` (`AppUserModelID = app.needle.windows`).
   - Desktop shortcut: Optional finish-page checkbox in interactive GUI installs; automatically created in `/S` (silent) or `/P` (passive) installs.
   - Installed Apps registration: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Needle`.
   - Upgrade & Uninstall: Supports in-place reinstall/upgrade, preserves `%LOCALAPPDATA%\app.needle.windows` by default, and provides `uninstall.exe` (registered in Installed Apps) plus optional app-data removal checkbox in interactive uninstall.

2. **MSI Windows Installer (Secondary, WiX Toolset)**: `Needle_0.1.0_x64_en-US.msi`
   - UpgradeCode: `9b84ad60-b9a2-5c15-b13a-4d2f6778d919` (`allowDowngrades: true`).
   - Language: `en-US`.
   - Install scope: `perMachine` (`C:\Program Files\Needle`, requires Administrator elevation).
   - Shortcuts: Start Menu (`Needle.lnk`), Desktop (`Needle.lnk`), and `Uninstall Needle` shortcut.

---

## 4. Installer Output Locations

Because `src-tauri/.cargo/config.toml` explicitly pins `target = "x86_64-pc-windows-msvc"`, Cargo and `npm run tauri build` emit x64 release artifacts under `src-tauri/target/x86_64-pc-windows-msvc/release/`:

| Artifact | Path | Exact Size |
| --- | --- | --- |
| Release Executable | `src-tauri/target/x86_64-pc-windows-msvc/release/needle-windows.exe` | `9,555,968` bytes (`9.11 MiB`) |
| NSIS Installer (`.exe`) | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Needle_0.1.0_x64-setup.exe` | `2,137,796` bytes (`2.04 MiB`) |
| MSI Installer (`.msi`) | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Needle_0.1.0_x64_en-US.msi` | `3,182,592` bytes (`3.04 MiB`) |

---

## 5. Build Results

All pre-build and packaging checks succeeded after final code/config edits:

- `npm run typecheck` (`tsc --noEmit`): **Passed** (0 errors).
- `npm run build` (`tsc --noEmit && vite build`): **Passed** (`dist/index.html`, `dist/island.html`, and bundled assets built).
- `cargo test --manifest-path src-tauri/Cargo.toml`: **Passed** (`15 passed; 0 failed; 0 warnings`).
- `npm run tauri build`: **Passed** (`needle-windows.exe`, `Needle_0.1.0_x64-setup.exe`, and `Needle_0.1.0_x64_en-US.msi` generated cleanly).
- PE header inspection on `needle-windows.exe`: `Machine=0x8664` (x64 AMD64), `Subsystem=2` (Windows GUI, no console window).

---

## 6. Installation Test Results

End-to-end automated installation, standalone runtime, reinstall/upgrade, and clean uninstallation verification was executed against **NSIS (`Needle_0.1.0_x64-setup.exe`)** after stopping the Vite dev server (`Port1420Listeners=0`) and verifying zero active `needle-windows.exe` processes:

1. **Silent Install (`Needle_0.1.0_x64-setup.exe /S`)**: Exited `0`.
   - Installed directory: `C:\Users\<user>\AppData\Local\Needle` (`needle-windows.exe` `9,555,968` bytes, `uninstall.exe` `94,674` bytes).
   - Start Menu shortcut created: `C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Needle.lnk`.
   - Desktop shortcut created: `C:\Users\<user>\Desktop\Needle.lnk`.
   - Registry entry created: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Needle` (`DisplayName="Needle"`, `DisplayVersion="0.1.0"`, `Publisher="Needle Contributors"`, `EstimatedSize=9424`).
   - WebView2 check reused existing system WebView2 Runtime (`157.0.4341.46`) without downloading.
2. **Standalone Launch Outside Project Directory**:
   - Launched via `Needle.lnk` with `WorkingDirectory = %TEMP%`.
   - Process path verified as `C:\Users\<user>\AppData\Local\Needle\needle-windows.exe` with no console window.
   - Runtime logs confirmed embedded asset URLs (`http://tauri.localhost/` and `http://tauri.localhost/island.html`) with no connection to `localhost:1420`.
3. **Single-Instance Verification**:
   - Launching `C:\Users\<user>\AppData\Local\Needle\needle-windows.exe` a second time exited the second process immediately (`SecondLaunchHasExited=True`), kept `RunningNeedleCount=1`, logged `[needle::app] [single_instance] Second launch detected; focusing existing main window`, and left the Dynamic Island visible (`IslandStillVisibleAfterSecondLaunch=True`).
4. **Idle Resource Usage & Clean Exit**:
   - Over an 8-second idle window on the installed binary, main process idle CPU measured `0%–0.012%` (`MainWorkingSetMB=48.61`–`54.43` MiB, `MainPrivateMB=10.07`–`10.17` MiB; 7 shared WebView2 helper processes totaling `485.1`–`494.2` MiB working set).
   - Closing `"Needle"` (`WM_CLOSE` to main HWND) logged `[needle::app] [exit] Main window close requested` and exited cleanly with `LeftoverProcesses=0`.
5. **Reinstall / Upgrade & Uninstallation**:
   - Re-running `Needle_0.1.0_x64-setup.exe /S` over an existing installation succeeded (`ExitCode=0`) and preserved `%LOCALAPPDATA%\app.needle.windows\needle-runtime.log`.
   - Running `C:\Users\<user>\AppData\Local\Needle\uninstall.exe /S` removed `C:\Users\<user>\AppData\Local\Needle`, the Start Menu shortcut, the Desktop shortcut, and `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Needle` cleanly.
   - Followed by a clean `Needle_0.1.0_x64-setup.exe /S` reinstall so Needle remains ready in Start Menu for interactive desktop launch.
6. **MSI Installer (`Needle_0.1.0_x64_en-US.msi`)**:
   - Verified WiX build output and generated `main.wxs` (upgrade code, `perMachine` Program Files target, shortcuts, WebView2 check); interactive per-machine UAC installation of `.msi` was not automated inside the sandboxed session.

---

## 7. Spotify Integration Test Results

Observed directly from the **installed standalone executable** (`C:\Users\<user>\AppData\Local\Needle\needle-windows.exe`) launched from Start Menu with no dev server running:

- `RoInitialize(RO_INIT_MULTITHREADED)` succeeded (`0x00000000 S_OK`).
- GSMTC detected the active local Spotify Desktop session (`aumid='Spotify.exe'`) cleanly:
  - Initial detection: `"DARKSIDE"` by `"Neoni"` (`"Wars In A Wonderland"`), `playback=Playing`, `art_bytes=205015`.
  - Automatic live track transition verified while running: `"Uppenantha"` by `"Devi Sri Prasad"` (`"Aarya - 2 (Original Motion Picture Soundtrack)"`), `playback=Playing`, `art_bytes=125594`, live progress (`1:22 / 5:27`), and embedded album artwork rendered in both Main window and Dynamic Island.

---

## 8. Dynamic Island Test Results

Observed directly on the **installed standalone executable** at `125%` Windows display scaling (`1920x1080`, work area `1920x1020`):

- Both native windows (`main` `"Needle"` at `618x960` and `island` `"Needle Island"`) initialized synchronously with `no_redir_bmp=false`, `topmost=true`, `toolwin=true`, `appwin=false`, `cloaked=0`.
- Dynamic Island auto-appeared on active Spotify session at exact scaled physical coordinates `(757, 13, 405x93)`.
- Expanding the compact pill resized cleanly to `(695, 13, 530x250)` displaying larger rounded album art, `PLAYING` badge, full metadata, and progress bar; collapsing returned cleanly to `(757, 13, 405x93)`.
- Main window `Hide Island` and `Reopen Island` UIA button clicks hid the native HWND (`IsWindowVisible=False`) and restored it (`IsWindowVisible=True`) cleanly.
- Verified via DPI-aware `PrintWindow` visual inspection of main, compact island, expanded island, and collapsed island captures.

---

## 9. Known Limitations

- **Unsigned Binaries**: Neither `needle-windows.exe` nor the `.exe` / `.msi` installers are Authenticode code-signed yet; downloading or running on another Windows PC may trigger Microsoft Defender SmartScreen ("Windows protected your PC -> More info -> Run anyway") until signed with a trusted certificate.
- **No Auto-Updater or System Tray**: Application lifecycle ends cleanly when the `main` window is closed; background tray minimization and Tauri updater feeds are out of scope for v0.1.0.
- **User Interactive Verification Outside IDE**: Antigravity IDE shutdown, closing all user terminals, optional Windows reboot testing, and interactive `.msi` UAC installation remain user-side validation steps on the interactive desktop.
- **Existing Non-Production `console` / Diagnostic Behavior**: `needle-runtime.log` continues writing runtime diagnostics under `%LOCALAPPDATA%\app.needle.windows\needle-runtime.log` for supportability.

---

## 10. Instructions for Rebuilding and Distributing Needle

1. Ensure dependencies are installed and verified (`Node.js 24+`, `Rust MSVC x64`, `WiX`/NSIS bundled/downloaded by Tauri CLI).
2. From `V:\music wilder\needle-windows`:
   ```powershell
   npm install
   npm run typecheck
   npm run build
   cargo test --manifest-path src-tauri/Cargo.toml
   npm run tauri build
   ```
3. Distribute:
   - `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Needle_0.1.0_x64-setup.exe` for standard per-user installation.
   - `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Needle_0.1.0_x64_en-US.msi` for enterprise / per-machine deployment.
4. For public external distribution on Windows, sign `needle-windows.exe` and the generated `.exe` / `.msi` installers with an EV/OV Authenticode code-signing certificate (via `signtool` or `bundle.windows.signCommand`).
