# TASK C — Desktop-First UI/UX Redesign

**Project:** Needle Windows (`V:\music wilder\needle-windows`)  
**Platform:** Windows 11 x64  
**Scope:** Frontend desktop layout, navigation, typography density, and control ergonomics for the main application shell  
**Core Principle:** Restructure how the main application is arranged and presented for desktop PCs — without changing how it works or altering any protected visual experiences.

---

## 1. Original Layout Problems

Before TASK C, the main Needle application used a vertical, phone-like layout:

1. **Narrow Vertical Window (`500 × 770` default in `tauri.conf.json`)**:
   - The main content column in `src/App.tsx` was locked to `max-w-md` (`448px`), wasting screen width on desktop monitors and laptops.
2. **High-DPI Clipping & Wrapping**:
   - At standard Windows 11 laptop display scaling (`125%`–`150%`), the narrow `500px` window clipped right-side status pills (`Connected`, `windows · x86_64`) and forced `Beat Glow` header controls to wrap and clip horizontally.
3. **Excessive Vertical Stacking**:
   - Header, full-width segmented tab bar, Status card, Spotify Connection card, Beat Glow card, Synchronized Lyrics (`h-[248px]`), Dynamic Island controls, Desktop Vinyl controls, and footer were all stacked in one long vertical column — pushing Synchronized Lyrics, Dynamic Island, and Desktop Vinyl below the fold.
4. **Mobile-Style Proportions**:
   - Oversized mobile-style segmented tabs, generous card padding (`px-5 py-4` / `rounded-2xl`), and a tiny `248px` scrolling box for lyrics despite abundant desktop viewport height.

---

## 2. New Desktop-First Layout Structure

The redesigned interface adopts a native Windows desktop application architecture while preserving Needle's dark zinc palette (`#09090b`, `bg-zinc-900/50`, `border-zinc-800/80`) and emerald/amber status accents:

### 2.1 Persistent Left Sidebar (`180px` – `220px` responsive)
- **Compact Brand Header**: 36px vinyl emblem + `Needle` title + `Windows Companion` subtitle.
- **Desktop Navigation (`Workspace`)**: Vertical mouse- and keyboard-accessible navigation items for **`Player & Companion`** and **`Lyrics Studio`**, with 16px icons, active left emerald accent bar, hover styling, and `focus-visible` outlines.
- **Live Companion Overview**: Read-only compact status summary (Spotify playback state, Dynamic Island visibility, Desktop Vinyl visibility, and Lyrics sync status) driven directly by existing application state.
- **Compact System Status Footer**: Displays `Application initialized`, `windows · x86_64`, and `v0.1.0` neatly docked at the bottom of the sidebar instead of consuming a full-width card at the top of the workspace.

### 2.2 Wide Main Workspace (`flex-1 min-w-0`)
- **Compact Workspace Header Bar (`48px`)**: Shows the active section title, concise subtitle, and a live Spotify track pill on the right.
- **`Player & Companion` (Horizontal 2-Column Split)**:
  - **Left Primary Column**:
    1. **`SpotifyPanel` (Now Playing)**: Sleek horizontal card arranging album artwork (`76×76`), track title/artist/album, playback badge, and full-width inline progress bar cleanly across the card.
    2. **Companion Controls Row (`IslandControls` + `VinylControls`)**: Paired side-by-side in a 2-column grid at `xl:` (`>= 1280px` CSS / `1920 × 1080` desktop) and full-width horizontal rows on narrower laptop widths so every button and dropdown stays unclipped and readable.
    3. **`BeatGlowPanel` (Protected — Untouched)**: Rendered cleanly with full horizontal room for its header controls and audio-reactive canvas.
  - **Right Contextual Reading Column (Sticky)**:
    - **`LyricsPanel`**: Occupies a dedicated, full-height desktop column (`md:h-[calc(100vh-13.75rem)]`) right beside Now Playing and companion controls, preserving all lyrics typography, auto-scroll, and controls unchanged.
- **`Lyrics Studio` (Full-Width Centered Workspace)**:
  - Renders the protected **`LyricsAnimationStudio`** component completely untouched inside a spacious `max-w-5xl` centered desktop container.

### 2.3 Desktop Buttons & Controls
- Standardized desktop control heights (`h-8` / `32px` for primary/secondary actions, `h-7` / `28px` for compact header icon buttons) and `rounded-lg` corners.
- Clear visual hierarchy between primary actions (`Show Island`, `Open Vinyl`) and secondary utility actions (`Compact`/`Expanded`, `Pin on Top`, `Reset Pos`, `Refresh`).
- Consistent hover, active (`active:scale-[0.98]`), disabled, and keyboard `focus-visible` outline states.

---

## 3. Components & Files Changed

| File | Summary of Changes |
|---|---|
| `src/App.tsx` | Replaced `max-w-md` vertical stack with full-viewport horizontal desktop shell: persistent left sidebar, top workspace bar, 2-column `Player & Companion` grid, and wide centered `Lyrics Studio` workspace. |
| `src/components/SpotifyPanel.tsx` | Restructured into a compact horizontal desktop Now Playing card with inline artwork, metadata, playback badge, and progress bar. |
| `src/components/LyricsPanel.tsx` | Adapted outer container and scroll height (`md:h-[calc(100vh-13.75rem)]`) for the dedicated desktop reading pane and standardized header button sizing (`h-7 rounded-lg`). Preserved all lyrics typography and sync logic untouched. |
| `src/components/IslandControls.tsx` | Updated card proportions (`rounded-xl p-3.5 h-full`), desktop button sizing (`h-8`), primary/secondary visual hierarchy, and inline display `<select>` alignment. |
| `src/components/VinylControls.tsx` | Updated card proportions (`rounded-xl p-3.5 h-full`), compact horizontal `h-8` button bar, and clear primary/secondary visual hierarchy. |
| `src/styles/index.css` | Added desktop keyboard `focus-visible` outlines, `overflow: hidden` on `body` (delegating scrolling to workspace panes), and refined `.lyrics-scroll` width (`6px`). |
| `src-tauri/tauri.conf.json` | Updated **only** `main` window geometry (`width: 1200`, `height: 740`, `minWidth: 820`, `minHeight: 600`) so the app launches in desktop proportions. |

---

## 4. Components Deliberately Left Untouched (Protected Scope)

Zero lines were modified in any of the following protected systems:

- **Lyrics Studio**: `src/components/lyrics/LyricsAnimationStudio.tsx`, `src/lyrics/**`, `src/lyrics-player/**`
- **Beat Glow / Visualizer**: `src/components/visualizer/BeatGlowPanel.tsx`, `src/hooks/useBeatGlow.ts`, `src/utils/audioMath.ts`, `colorExtractor.ts`, `colorTransition.ts`
- **Dynamic Island UI**: `src/island/**` (`IslandApp.tsx`, `island.css`, `main.tsx`)
- **Desktop Vinyl UI**: `src/vinyl/**` (`VinylApp.tsx`, `VinylDisc.tsx`, `vinyl.css`, `main.tsx`)
- **Lyrics Synchronization & Services**: `src/hooks/useLyrics.ts`, `src/services/**`, `src/utils/**`, `src/types/**`
- **Rust Backend & Tauri IPC**: `src-tauri/src/**` (all Rust commands, WASAPI DSP, GSMTC polling, event bus, and multi-window managers)

---

## 5. Responsive Behaviour Across Tested Resolutions

Verified live on the compiled Windows desktop executable (`needle-windows.exe`) at all four target resolutions (including Windows 150% DPI scaling):

| Resolution | Layout Structure | Companion Controls | Lyrics Reading Pane | Horizontal Scroll / Clipping |
|---|---|---|---|---|
| **1920 × 1080** | Persistent `220px` sidebar + 2-column horizontal workspace | `Dynamic Island` & `Desktop Vinyl` side-by-side (`2 cols`) above `Beat Glow` | Full-height sticky right column | None (0 clipping, 0 overlap) |
| **1600 × 900** | Persistent `204px` sidebar + 2-column horizontal workspace | Crisp horizontal rows in left primary column above `Beat Glow` | Full-height sticky right column | None (0 clipping, 0 overlap) |
| **1366 × 768** | Persistent `180px` sidebar + 2-column horizontal workspace | Crisp horizontal rows in left primary column; all labels unclipped | Dedicated right column beside controls | None (0 clipping, 0 overlap) |
| **1280 × 720** | Persistent `180px` sidebar + 2-column horizontal workspace | Crisp horizontal rows in left primary column; all controls accessible | Dedicated right column beside controls | None (0 clipping, 0 overlap) |

---

## 6. Test & Build Results

| Verification Check | Command | Result |
|---|---|---|
| **TypeScript Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS (0 errors)** |
| **Frontend Unit Tests** | `npm run test:unit` | **PASS (83 / 83 tests)** |
| **Rust Backend Tests** | `cargo test` | **PASS (33 / 33 tests)** |
| **Production Bundle & Release Binary** | `npx tauri build --no-bundle` | **PASS** (`%LOCALAPPDATA%\Needle\needle-windows.exe`) |
| **Live Navigation & Controls Verification** | Automated UI Automation + multi-resolution capture | **PASS** (`Lyrics Studio`, `Player & Companion`, `Open/Hide Vinyl`, `Show/Hide Lyrics`) |

---

## 7. Before & After Verification Artifacts

Stored in the conversation artifact directory and embedded in `walkthrough.md`:

- **Before Redesign (`500 × 770` vertical phone-like layout)**:
  - `task-c-before-player.png`
  - `task-c-before-studio.png`
- **After Redesign (Horizontal Desktop-First UI)**:
  - `task-c-after-1920x1080-player.png` & `task-c-after-1920x1080-studio.png`
  - `task-c-after-1600x900-player.png`
  - `task-c-after-1366x768-player.png`
  - `task-c-after-1280x720-player.png` & `task-c-after-1280x720-studio.png`
