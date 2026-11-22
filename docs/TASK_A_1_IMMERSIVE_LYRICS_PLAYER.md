# TASK A.1 — Needle Windows: Immersive Fullscreen Lyrics Player & Cinematic Starfield

**Project:** `needle-windows`  
**Milestone:** Fullscreen Lyrics Experience & Celestial Animation Engine  
**Version:** 0.1.0  
**Platform:** Windows 11 x64  
**Framework:** Tauri 2 + React 19 + TypeScript + Rust + Tailwind CSS  

---

## 1. Executive Summary

TASK A.1 elevates the Needle Windows lyrics experience into a dedicated, cinematic fullscreen music player. Inspired by the desktop music presentation in premium music companion applications, this task delivers:

1. **Dedicated Fullscreen Player Window (`lyrics-player`):** A borderless, true fullscreen window capable of running on primary or secondary monitors with DPI awareness, smooth multi-monitor targeting, and resolution adaptability across standard and ultrawide displays.
2. **Rebuilt Connected Celestial Starfield Engine (`Stars`):** Replaced discrete per-word popping with a continuous parametric orbital trajectory model. Words travel in graceful celestial flight paths across deep space, trailing luminous falling-star light, interconnected by persistent sequential constellation ribbons, with radiant starlight halos and diffraction spikes on the focal word.
3. **Responsive Fullscreen Typography:** Dynamic scaling across all 6 kinetic styles (*Big Words*, *Lines*, *Lens*, *Stars*, *Terminal*, *Karaoke*) and 4 backgrounds (*Album Aura*, *Pure Black*, *Album Cover*, *Ambient Motion*) without artificial stretching or visual clipping.
4. **Auto-Hiding Minimalist Controls Overlay:** An elegant, non-intrusive control bar that automatically fades out after 3 seconds of mouse inactivity, hides the cursor (`cursor-none`), and reveals on mouse movement or keyboard navigation.
5. **Universal Multilingual Support & Offline Fallback:** Seamless support for complex scripts (English, Telugu, Hindi) with built-in sample track previews (*Starboy*, *Vellake*, *Kesariya*) for offline enjoyment, alongside real-time Spotify GSMTC synchronization.

---

## 2. Multi-Window Tauri Architecture

### 2.1 Window Configuration (`tauri.conf.json`)

The application registers four specialized Tauri windows:
- `main`: Main application companion controller (`500x770`, resizable).
- `island`: Floating top-center Dynamic Island (`324x74`, transparent, topmost).
- `vinyl`: Desktop Vinyl record player (`540x340`, transparent, draggable).
- `lyrics-player`: Dedicated edge-to-edge fullscreen lyrics player (`1280x800` default logical, borderless, resizable, visible on demand).

```json
{
  "label": "lyrics-player",
  "title": "Needle Lyrics Player",
  "url": "lyrics-player.html",
  "width": 1280,
  "height": 800,
  "minWidth": 800,
  "minHeight": 600,
  "decorations": false,
  "transparent": false,
  "shadow": false,
  "alwaysOnTop": false,
  "skipTaskbar": false,
  "resizable": true,
  "maximizable": true,
  "minimizable": true,
  "visible": false,
  "focus": false,
  "backgroundColor": "#060608"
}
```

### 2.2 Rust Window Management (`src-tauri/src/player.rs`)

Multi-monitor detection and window control are handled via high-performance Rust Tauri commands:

- `get_lyrics_player_displays(app)`: Queries system monitors via `app.available_monitors()`, returning names, logical/physical bounds, scale factors, and primary status.
- `show_lyrics_player(app, monitor_id, fullscreen)`: Positions the window onto the specified monitor coordinates, toggles true borderless fullscreen, unminimizes, shows, and focuses the player.
- `hide_lyrics_player(app)`: Exits fullscreen mode and hides the window cleanly.
- `toggle_lyrics_player_fullscreen(app)`: Toggles between borderless fullscreen and windowed presentation.
- `is_lyrics_player_fullscreen(app)`: Queries current window fullscreen state.

---

## 3. Cinematic Starfield Engine (`Stars.ts`)

### 3.1 Continuous Parametric Flight Trajectories

Rather than static coordinates that pop into existence, every word in a lyric phrase is assigned a continuous, deterministic flight path modeled via a quadratic Bézier curve:

$$B(p) = (1-p)^2 P_0 + 2(1-p)p P_c + p^2 P_1$$

Where:
- $p \in [0, 1]$ represents continuous flight progress across the word's celestial lifecycle:
  $$p = \frac{\text{positionMs} - (\text{word.startMs} - \text{leadInMs})}{\text{leadInMs} + \text{word.durationMs} + \text{trailOutMs}}$$
- $P_0$: Entry point in upper-right deep space ($x \approx 0.82 \cdot W$, $y \approx -0.12 \cdot H$).
- $P_c$: Central reading corridor ($x \approx 0.5 \cdot W + \text{laneOffset}$, $y \approx 0.48 \cdot H + \text{waveY}$).
- $P_1$: Exit point in lower-left deep space ($x \approx -0.12 \cdot W$, $y \approx 0.88 \cdot H$).

### 3.2 Deterministic Pseudo-Random Seeding

To prevent per-frame jitter while ensuring organic variety, each word's trajectory offset is seeded using FNV-1a hashing of the word text and line indices:

```typescript
function hashToFloat(str: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}
```

### 3.3 Visual Composition Features

1. **Luminous Falling-Star Trails:** A 5-step historical trajectory sampling renders a glowing, tapered comet tail behind moving words.
2. **Persistent Sequential Constellation Ribbons:** Adjacent words within the active lyric phrase are interconnected by radiant quadratic spline ribbons (`bezierCurveTo`), establishing visual continuity and grammatical cohesion.
3. **Radiant Focal Starlight Halo:** When a word is actively sung, it reaches the camera focal plane ($Z \approx 1.15$), surrounded by a luminous starlight ring with a 4-point telescopic diffraction spike crosshair.
4. **Audio-Reactive Starlight Bloom:** WASAPI bass and beat energy dynamically pulse the celestial ring diameter and particle luminance in sync with Spotify playback.

---

## 4. Responsive Fullscreen Typography & Layout

All styles adapt to arbitrary display dimensions via the `getResponsiveFontSize` utility:

| Style | Embedded Preview (640x360) | Full HD 1080p (1920x1080) | 4K UHD (3840x2160) | Visual Focus |
|---|---|---|---|---|
| **Big Words** | 34 px | 58 px | 97 px | Center dominant focal word, past/future stack |
| **Lines** | 28 px | 48 px | 80 px | Active line centered, context lines dimmed |
| **Lens** | 26 px | 44 px | 74 px | Cylindrical glass slit with horizontal blur corridor |
| **Stars** | 32 px | 52 px | 88 px | Continuous celestial trajectory & constellation arcs |
| **Terminal** | 22 px | 36 px | 62 px | Retro CRT scanlines, cursor block, telemetry header |
| **Karaoke** | 34 px | 56 px | 94 px | Smooth continuous fill highlight with lyric sweep |

---

## 5. Controls Overlay & User Interaction

### 5.1 Auto-Hiding Minimalist Overlay

- **Inactivity Timer:** Controls automatically fade out after 3 seconds of mouse or keyboard inactivity.
- **Cursor Hiding:** The cursor disappears (`cursor-none`) during playback and reappears on movement.
- **Header:** Features app branding, window status, language/source selector, fullscreen toggle, and close button.
- **Footer:** Features track artwork and metadata, Spotify transport (Prev, Play/Pause, Next), timeline scrubber with elapsed/total time, style pills, background pills, and conservative timing confidence badge.

### 5.2 Keyboard Shortcuts & Canvas Gestures

| Trigger | Action |
|---|---|
| `Escape` | Close/hide fullscreen player |
| `Space` | Toggle Spotify play/pause |
| `F` or `F11` | Toggle borderless fullscreen |
| `Arrow Right` | Skip to next track (or next sample) |
| `Arrow Left` | Skip to previous track (or previous sample) |
| Double Click Canvas | Toggle borderless fullscreen |

---

## 6. Verification & Test Evidence

### 6.1 Test Suites

- **Node.js Unit Tests:** 63 passing tests across typography, easing, continuity, lyrics parsing, and trajectory models (`npm run test:unit`).
- **Rust Integration Tests:** 33 passing tests covering window management, GSMTC monitoring, WASAPI loopback, and single-instance coordination (`cargo test`).
- **TypeScript Typecheck:** 0 errors (`npm run typecheck`).
- **Vite & Tauri Production Bundles:** 4 entry points verified (`index.html`, `island.html`, `vinyl.html`, `lyrics-player.html`).

### 6.2 Visual Artifacts

| Artifact Name | Description |
|---|---|
| `task-a1-fullscreen-stars.png` | Rebuilt connected celestial starfield with active focal word |
| `task-a1-stars-trajectories.png` | Celestial flight paths, falling-star trails, and constellation ribbons |
| `task-a1-stars-motion.gif` | 24-frame animated GIF demonstrating continuous falling-star movement |
| `task-a1-fullscreen-bigwords.png` | Fullscreen Big Words style with responsive scaling |
| `task-a1-fullscreen-lines.png` | Fullscreen Lines style with active focus and context lines |
| `task-a1-fullscreen-lens.png` | Fullscreen Lens style with cylindrical optical slit |
| `task-a1-fullscreen-terminal.png` | Fullscreen Terminal style with CRT scanlines and cursor block |
| `task-a1-fullscreen-karaoke.png` | Fullscreen Karaoke style with continuous sweep highlight |
| `task-a1-fullscreen-aura.png` | Fullscreen Album Aura dynamic palette environment |
| `task-a1-fullscreen-cover.png` | Fullscreen Album Cover blurred backdrop environment |
| `task-a1-fullscreen-telugu.png` | Multilingual Telugu complex Unicode script rendering |
| `task-a1-fullscreen-english.png` | English typography rendering in fullscreen |
| `task-a1-controls-visible.png` | Fullscreen player with header, footer, and scrubber visible |
| `task-a1-controls-hidden.png` | Fullscreen player in edge-to-edge immersive view with controls auto-hidden |

---

## 7. Compliance & Boundary Verification

- **Preservation:** All features from TASK 001–010.1 and TASK A (GSMTC monitor, WASAPI Beat Glow, Dynamic Island, Desktop Vinyl Player) remain 100% operational.
- **Single Monitor:** No duplicate Spotify monitors or secondary background polling loops were introduced.
- **No Audio Retention:** Audio loopback capture analyzes rendered samples strictly for real-time visualization and never retains or transmits data.
- **Future Tasks:** TASK 012 and TASK 013 remain untouched.
