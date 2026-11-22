# TASK A — Kinetic Lyrics Animation Engine & Visual Style Studio

**Project:** `needle-windows`  
**Milestone:** Kinetic Lyrics Animation Engine & Visual Style Studio  
**Version:** 0.1.0  
**Target:** Windows 11 x64  
**Architecture:** Tauri 2 + React 19 + TypeScript + HTML5 Canvas + Rust GSMTC / WASAPI Backend  

---

## 1. Executive Summary

TASK A introduces a cinematic, high-performance **Kinetic Lyrics Animation Engine** and an interactive in-app **Lyrics Studio** to Needle Windows. Inspired by the design language of [Needle for Mac](https://needlemac.com/), this engine elevates synchronized lyrics from static scrolling text into an expressive visual music experience.

The implementation preserves every existing feature from TASK 001–010.1 (Spotify GSMTC detection, Dynamic Island, Desktop Vinyl Player, WASAPI loopback audio capture, Beat Glow reactive visualizer, and dynamic album artwork color extraction) without adding duplicate services or external cloud dependencies.

---

## 2. Dedicated Studio Tab & Hybrid Rendering Architecture

### 2.1 Studio Placement
- The **Lyrics Studio** is mounted as a dedicated, first-class tab in the Main Needle navigation bar alongside `Player & Companion`.
- Switching between tabs is instantaneous and **never interrupts Spotify playback, GSMTC synchronization, or WASAPI audio capture**.
- The standard `LyricsPanel` and the cinematic `Lyrics Studio` remain independent, complementary experiences.

### 2.2 Hybrid Canvas + DOM Architecture
- **HTML5 Canvas Viewport**: A single, elapsed-time-driven `requestAnimationFrame` loop orchestrates background diffusion, particle starfields, dynamic palette smoothing, and kinetic typography. This eliminates React state reconciliation bottlenecks and maintains fluid rendering.
- **High-DPI Scaling**: Automatically queries `window.devicePixelRatio` and scales canvas buffer dimensions so typography remains crisp across 100%, 125%, 150%, and 200% Windows display scaling settings.
- **Accessible DOM Controls**: Studio sliders, style tabs, background pickers, preset buttons, and offline transport scrubbers utilize accessible React DOM elements layered cleanly around the viewport.

---

## 3. Six Distinct Kinetic Animation Styles

Each of the six styles features a genuinely distinct visual composition, typography hierarchy, and motion physics:

| Style | Visual Composition | Typography & Weight | Motion & Transition | Audio Reactivity |
|---|---|---|---|---|
| **1. Big Words** | Massive focal word in center with supporting preceding word above and upcoming word below | 800 Ultra Bold, dynamically downscaled for words > 9 characters | Fluid scale ($0.7 \rightarrow 1.0$), slight dynamic tilt ($\pm 2^\circ$), soft settling | Bass scale pulse ($+5\%$) and beat glow halo |
| **2. Lines** | Elegant 3-line vertical progression with active line centered | 700 Bold active line, 500 Medium for past/upcoming lines | Subtle word-by-word horizontal illumination; line transition spacing ($1.2\times - 2.2\times$) | Gentle rhythmic breathing pulse on active line |
| **3. Lens** | Anamorphic horizontal focal strip with dual specular glass guides | 700 Bold in focal band, selective blur outside | Horizontal gliding camera centering active word; selective blur ($0 - 6\text{px}$) for out-of-focus words | Horizontal specular lens flare bloom |
| **4. Stars** | Spatial celestial constellation with subtle vector interconnects | 700 Bold active star, 500 Medium ambient stars | Collision-aware deterministic hash layout; subtle orbital starlight halo | Orbital node radius expansion on beat |
| **5. Terminal** | Retro CRT monospace terminal with scanline overlay and status prompt | Monospace (`ui-monospace, Consolas`), 600 Semibold | Character-by-character typewriter reveal timed to lyric clock; blinking block cursor (`█`) | Phosphor matrix glow and scanline flicker |
| **6. Karaoke** | Singing companion line with progressive sub-word fill and rhythmic bounce | 700 Bold large display typography | Progressive sub-word sweep fill matching word progress; clean uniform sweep fallback | Vertical bounce ($Y - 4\text{px}$) on beat spikes |

---

## 4. Conservative Word Timing & Confidence Engine

Rather than assuming a rigid fixed breath-gap or presuming the entire line interval represents singing vocalization, the word timing engine utilizes a conservative, multi-factor deterministic model:

### 4.1 Timing Modes
1. **Actual (`actual`)**: Syllable or word-level timestamps directly provided by the lyric source (when available).
2. **Estimated (`estimated`)**: Deterministically computed from word character length, punctuation weights, and interval bounds. Active only when timing feasibility checks pass.
3. **Line-Only Fallback (`line-only`)**: When confidence is low, singing rate is implausible, or intervals are extreme, the engine automatically falls back to line-level animation. **Estimated timing is never presented as actual synchronisation.**

### 4.2 Confidence Classification
- **High Confidence**:
  - Line interval between $1,000\text{ms}$ and $9,000\text{ms}$.
  - Singing rate between $2.2$ and $9.5$ characters per second.
  - Word count $\ge 2$.
- **Medium Confidence**:
  - Line interval between $600\text{ms}$ and $15,000\text{ms}$.
  - Singing rate between $1.2$ and $13.0$ characters per second.
- **Low Confidence (Automatic Line-Only Fallback)**:
  - Intervals $< 400\text{ms}$ or $> 20,000\text{ms}$ (e.g. instrumental solos).
  - Outlier character rates ($< 0.9$ or $> 16.0$ chars/s).
  - Empty or instrumental lines (`♪`).

### 4.3 Unicode & Multi-Language Robustness
- Uses `Intl.Segmenter` (granularity: `word`) with a safe regex fallback.
- Explicitly verified for **Telugu (తెలుగు)**, **Hindi (हिन्दी)**, and **English**:
  - Preserves Telugu vowel signs (*matras*) and viramas (e.g. `వెళ్ళకే`, `చెలీ`).
  - Preserves Hindi Devanagari conjuncts, anusvara, and viramas (e.g. `केसरिया`, `इश्क`).
  - Correctly weights Indian punctuation like the Danda (`।`) alongside standard punctuation (`.`, `,`, `!`, `?`).

---

## 5. Four Background Environments

1. **Album Aura**: Deep obsidian background with diffused multi-point radial gradients sampled from the active album palette (dominant, secondary, accent) with dynamic breathing bloom.
2. **Pure Black**: OLED pitch black (`#060608`) for distraction-free, ultra-high-contrast typography.
3. **Album Cover**: High-blur, dark-tinted ($70\%$ darkening vignette) reproduction of current album artwork filling the viewport.
4. **Ambient Motion**: Fluid moving gradient mesh with continuous slow orbital drift and bass-reactive expansion.

---

## 6. Advanced Customization & Presets

The Lyrics Studio includes a comprehensive, collapsible **Advanced Customization Drawer**:

- **Typography**: Font family (`Sans`, `Serif`, `Mono`, `Display`), Font size (`Small`, `Medium`, `Large`, `XL`), Font weight (`Normal`, `Medium`, `Semibold`, `Bold`), Letter spacing ($-1\text{px} - +4\text{px}$), Line spacing ($1.2\times - 2.2\times$), Text alignment (`Left`, `Center`, `Right`).
- **Motion & Effects**: Animation speed ($0.5\times - 2.0\times$), Animation intensity ($0.5\times - 2.0\times$), Glow intensity ($0.0 - 2.0$), Blur intensity ($0.0 - 1.5$), Particle intensity ($0.0 - 2.0$).
- **Accessibility & Modes**:
  - **Reduced-Motion Mode**: Replaces dynamic tilts, orbital drift, rapid scaling, and blur filters with gentle linear opacity fades.
  - **Audio-Reactive Effects**: Toggles Beat Glow integration on/off.
  - **Reset to Defaults**: Restores factory settings in one click.
- **Transition Presets**:
  - **Cinematic**: Big Words + Album Aura, high glow (1.3), balanced particles.
  - **Smooth**: Lines + Ambient Motion, soft glow (0.7), medium line spacing.
  - **Minimal**: Lines + Pure Black, zero blur, zero particles, subtle contrast.
  - **Expressive**: Stars + Album Cover, maximum audio pulse, rich starlight vectors.
- **Persistence**: All studio customizations are persisted in `localStorage` under `needle_lyrics_studio_settings`.

---

## 7. Offline Sample Studio

To enable deterministic verification without Spotify running, the Studio includes built-in offline preview tracks:
1. **English Pop**: "Blinding Lights" — The Weeknd (Crimson/Scarlet palette).
2. **Telugu Melody**: "Vellake (వెళ్ళకే)" — Bharatt-Saurabh (Warm Sunset Amber palette).
3. **Hindi Classical**: "Kesariya (केसरिया)" — Arijit Singh / Pritam (Vibrant Saffron palette).

Supports playback toggle (Play/Pause), scrubbing across track duration, time readout, and instant reset.

---

## 8. Verification & Test Results

- **Frontend Unit Tests**: `57 passed, 0 failed` across 4 suites (`node --test`).
- **Rust Backend Tests**: `32 passed, 0 failed` (`cargo test`).
- **TypeScript Typecheck**: `0 errors` (`tsc --noEmit`).
- **Vite Production Bundling**: Clean build in 318ms.
