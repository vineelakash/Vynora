# Needle Windows — Project Setup & Foundation Guide

`needle-windows` is the Windows desktop application foundation for the **Needle** music companion, built with **Tauri 2**, **React**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Rust** targeting Windows x64.

---

## 1. Verified Development Environment

| Component | Version / Detail |
| --- | --- |
| Operating System | Windows 11 (Build 26200) |
| Architecture / Rust Target | `x86_64-pc-windows-msvc` (Windows x64) |
| Node.js | `24.14.0` |
| npm | `11.8.0` |
| Rust / Cargo | `1.99.1` |
| C++ Build Toolchain | MSVC v145 (Visual Studio Build Tools) |
| Windows SDK | Windows 11 SDK `10.0.26100.0` |
| WebView Runtime | Microsoft Edge WebView2 Runtime |

---

## 2. Technology Stack

- **Desktop Runtime**: Tauri 2 (`tauri` v2, `@tauri-apps/api`, `@tauri-apps/cli`)
- **Frontend**: React 19, TypeScript, Vite 8
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`)
- **Backend**: Rust (`2021` edition) configured explicitly for `x86_64-pc-windows-msvc`

---

## 3. Project Structure

```text
needle-windows/
├── docs/
│   └── PROJECT_SETUP.md          # Setup, commands, and milestone notes
├── index.html                    # Dark-mode HTML entry shell
├── package.json                  # Frontend scripts and minimal dependencies
├── tsconfig.json                 # Strict TypeScript compiler configuration
├── vite.config.ts                # Vite + React + Tailwind v4 configuration (port 1420)
├── src/
│   ├── main.tsx                  # React DOM entry point
│   ├── App.tsx                   # Minimal Needle UI & Spotify Connection placeholder
│   └── styles/
│       └── index.css             # Tailwind CSS v4 entry & dark base styling
└── src-tauri/
    ├── .cargo/
    │   └── config.toml           # Pins default Cargo target to x86_64-pc-windows-msvc
    ├── Cargo.toml                # Minimal Rust dependencies (tauri, serde)
    ├── build.rs                  # Tauri build script
    ├── tauri.conf.json           # Window settings, product metadata, and icons
    ├── capabilities/
    │   └── default.json          # Default desktop window permissions (`core:default`)
    ├── icons/                    # Generated desktop PNG and Windows ICO assets
    └── src/
        ├── main.rs               # Windows GUI subsystem entrypoint
        └── lib.rs                # Tauri builder and `get_app_info` IPC command
```

---

## 4. Setup & Development Commands

Run all commands from the `needle-windows` project root (`v:\music wilder\needle-windows`):

### Install Dependencies

```powershell
npm install
```

### TypeScript Type Check

```powershell
npm run typecheck
```

Runs `tsc --noEmit` across `src/`.

### Frontend Production Build

```powershell
npm run build
```

Runs `tsc --noEmit` followed by `vite build` into `dist/`.

### Rust Backend Check (Windows x64)

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

### Run Tauri Desktop App in Development Mode

```powershell
npm run tauri dev
```

Starts the Vite dev server on `http://localhost:1420`, compiles the Rust backend for `x86_64-pc-windows-msvc`, and launches the native `Needle` desktop window.

### Build Release Desktop Binary / Installer

```powershell
npm run tauri build
```

---

## 5. Current Foundation Scope & Boundaries

Included in this milestone:
- Clean Tauri 2 + React + TypeScript + Vite + Tailwind CSS project scaffold
- Explicit Windows x64 Rust build configuration (`src-tauri/.cargo/config.toml`)
- Minimal dark native Windows desktop window titled **Needle**
- Display of application name (`Needle`), subtitle (`Windows Music Companion`), runtime status (`Application initialized`), and an honest unconfigured `Spotify Connection` placeholder

Intentionally deferred to later milestones:
- Spotify OAuth / PKCE authentication
- Spotify Web API / playback control / audio streaming
- Windows Global System Media Transport Controls (GSMTC) detection
