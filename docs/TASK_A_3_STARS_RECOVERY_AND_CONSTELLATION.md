# TASK A.3 — Stars Recovery and Rebuilt Constellation Animation Engine

## Executive Summary

TASK A.3 successfully resolves two independent objectives within Needle Windows:
1. **Objective 1 (Recovery First)**: Fully restored and verified the authentic, original **Stars** animation (TASK A.1) with its continuous celestial falling-star trajectories, luminous tapered trails, starlight embers, persistent constellation ribbons, and radiant 4-point telescopic diffraction spikes. Confirmed 100% intact, non-regressed, and backed up at `src/lyrics/animation_backup_task_a2/`.
2. **Objective 2 (New Implementation)**: Designed and implemented a completely separate, new **Constellation** animation style inspired by the observable design language of Needle for Mac. Words are distributed organically across 2D canvas space into astronomical asterisms, multiple words coexist simultaneously, words are strictly stationary (never traveling along lines, never falling down the screen), active words command a 1.4x prominent visual hierarchy, and an exact staggered fade lifecycle ensures the lyric word fades *first* while the star point and structural connecting lines linger visibly before gradually fading.

---

## 1. Objective 1: Stars Recovery & Non-Regression Audit

### 1.1 Authentic Stars Implementation
The file [src/lyrics/animation/styles/Stars.ts](file:///V:/music%20wilder/needle-windows/src/lyrics/animation/styles/Stars.ts) has been confirmed as the complete 392-line falling-star trajectory implementation:
- **Parametric Flight Trajectory**:
  $$B(p) = (1-p)^2 P_0 + 2(1-p)p P_c + p^2 P_1$$
  Words enter from top-right $(P_0)$, arc through the central focal plane $(P_c)$ where depth reaches $Z \approx 1.15$, and recede towards bottom-left $(P_1)$.
- **Tapered 5-Step Historical Trails**: Each star samples previous positions along the Bézier curve, rendering a tapered starlight tail with decaying radii and alpha gradients.
- **Starlight Embers**: Microscopic starlight particles drift off trailing words based on deterministic FNV-1a pseudo-random seeds.
- **Persistent Constellation Ribbons**: Smooth quadratic spline ribbons connect adjacent words in the active phrase.
- **4-Point Diffraction Spikes**: Active focal words feature radiant horizontal and vertical diffraction spikes and an orbital halo ring responsive to audio beat energy.

### 1.2 Automated Verification & Tests
All Stars-specific test suites pass without regressions:
- `src/lyrics/animation/stars.test.ts` (4/4 passed): Continuous trajectory progression, FNV-1a repeatability, multi-word lane distribution, and coordinate bounds clamping.
- `src/lyrics/animation/engine.test.ts`: Deterministic trajectory evaluation and non-overlapping lane separation.

### 1.3 Preserved Backup
The complete animation engine directory was archived to:
`src/lyrics/animation_backup_task_a2/`

---

## 2. Objective 2: Rebuilt Constellation Animation Engine

### 2.1 Astronomical Asterism Geometry (2D Spatial Distribution)
Unlike conventional players that arrange lyrics in horizontal rows or scrolling subtitles, Constellation maps lyric phrases into genuine 2D astronomical asterisms across the display canvas ($X \in [0.12W, 0.88W], Y \in [0.18H, 0.82H]$):
- **Template 0 (Pegasus)**: Grand celestial polygon with radiating wing stars.
- **Template 1 (Cassiopeia)**: Dynamic 2D crown zigzag traversing both horizontal and vertical dimensions.
- **Template 2 (Cygnus / Northern Cross)**: Central celestial hub with 4 radiating cross arms.
- **Template 3 (Orion)**: Shoulders, central 3-star diagonal belt, and lower star bases.
- **Template 4 (Lyra)**: Bright apex alpha star (Vega) connecting to a 2D quad loop.
- **Template 5 (Corona Borealis)**: Graceful semicircular celestial crescent.

Seeded with deterministic 32-bit FNV-1a hashes based on track line index and word text, every line forms a unique, organic, reproducible constellation structure.

### 2.2 Stationary Word Anchoring (Strict Non-Movement)
- **Positioning**: Each lyric word is statically anchored beside its assigned star point (placed above the star when in the lower half of the screen, below the star when in the upper half).
- **Strict Invariance**: A word's $(X, Y)$ coordinate is 100% constant throughout its entire lifecycle.
- **Zero Travel**: Lyric words **NEVER** travel along connecting lines.
- **Zero Falling**: Lyric words **NEVER** fall or drift down the screen.

### 2.3 Structural Network Connecting Lines
- Thin ($1.2\text{px}$), straight, luminous lines connect adjacent stars in the constellation.
- Additional structural cross-lines provide astronomical polygon rigidity.
- Subtle background anchor stars (3–6 stars per line) add celestial spatial depth.
- Connecting lines leading into and out of the currently active word illuminate with increased luminance ($0.55–0.60$ alpha) and album artwork accent color.

### 2.4 Visual Hierarchy & Multi-Word Coexistence
- **Active Word**: Scaled to $1.40\times$ prominent size, bold weight, radiant starlight glow with current Spotify album artwork accent color, and crisp white foreground text.
- **Coexisting Recent Words**: Scaled to $0.85\times$ secondary size, medium weight, gentle foreground alpha, coexisting simultaneously across the network to preserve poetic reading context.
- **Upcoming Words**: Alpha strictly $0.0$ (invisible) while their star points and connecting lines remain visible in the network.
- **Simultaneous Coexistence**: Generous word fade duration ($650\text{ms}–1300\text{ms}$) ensures that as consecutive words appear across the screen, 3 to 5 words remain visible together.

### 2.5 Exact Staggered Fade Lifecycle
Every word and star node progresses through 8 deterministic phases:

```
[t < s - lead]             WAITING: Star dormant (alpha 0.25), word strictly invisible (alpha 0)
[s - lead <= t < s]        STAR_ACTIVATING: Star illuminates (alpha -> 1.0, halo expands), word alpha = 0
[s <= t < s + reveal]      WORD_REVEAL: Word fades in beside star (alpha -> 1.0, scale -> 1.40x)
[s + reveal <= t < e]      WORD_EMPHASIS: Active word singing (scale 1.40x, glow halo, white text)
[e <= t < wordFadeEnd]     WORD_FADING: Word fades OUT FIRST in place (alpha -> 0, scale -> 0.85x)
                           --> STAR AND CONNECTING LINES REMAIN FULLY VISIBLE (alpha 0.80+)
[wordFadeEnd <= t < linger]STAR_LINGERING: Word is completely gone (alpha = 0)
                           --> Star point and lines linger visibly illuminated
[linger <= t < starFadeEnd]STAR_FADING: Star point and lines gradually fade away afterwards
[t >= starFadeEnd]         COMPLETED: Star settles into soft ambient celestial background
```

---

## 3. Configuration & UI Integration

### 3.1 Expressive Preset Defaults
The Expressive preset has been updated to showcase Constellation out of the box:
- `style`: `'constellation'`
- `background`: `'ambient'` (Ambient Motion)
- `particleIntensity`: `0.0` (Particles strictly OFF for a clean astronomical canvas)
- `glowIntensity`: `0.8`
- `audioReactive`: `true`

### 3.2 Dual Style Selectors
Both styles are independently available across:
1. **Lyrics Studio Tab**: Interactive controls grid with both `Stars` and `Constellation` buttons.
2. **Fullscreen Lyrics Player**: Top-right selector pills containing:
   - Big Words
   - Lines
   - Lens
   - **Stars** (Restored falling celestial trajectories with trails)
   - **Constellation** (New 2D spatial astronomical network)
   - Terminal
   - Karaoke

---

## 4. Multilingual & Fallback Support

- **Unicode Grapheme Preservation**: Full native support for Telugu (తెలుగు) and Hindi (हिन्दी) without splitting complex conjuncts, viramas, or matras.
- **Line-Only Fallback**: When lyrics lack word-level timestamps or confidence is low, the engine automatically synthesizes conservative word intervals using conservative durations ($75\%$ line interval) and renders the exact same constellation lifecycle.

---

## 5. Verification Evidence & Artifacts

| Artifact | Description |
|---|---|
| [task-a3-stars-restored.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-stars-restored.png) | Desktop capture of restored Stars style with falling trajectories, luminous trails, and diffraction spikes |
| [task-a3-constellation-controls.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-controls.png) | Fullscreen player with Constellation style pill and Motion preset active |
| [task-a3-constellation-multiword.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-multiword.png) | Multiple words coexisting simultaneously across the 2D astronomical network |
| [task-a3-constellation-hierarchy.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-hierarchy.png) | Visual hierarchy: Active word prominent ($1.40\times$) vs smaller secondary words ($0.85\times$) |
| [task-a3-constellation-staggered-fade.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-staggered-fade.png) | Staggered fade proof: Word has faded first (alpha = 0) while star node and lines linger |
| [task-a3-constellation-motion.gif](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-motion.gif) | 40-frame continuous motion recording demonstrating non-falling 2D constellation evolution |
| [task-a3-constellation-telugu.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-telugu.png) | Constellation rendering Telugu lyrics with accurate conjuncts |
| [task-a3-constellation-hindi.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-a3-constellation-hindi.png) | Constellation rendering Hindi lyrics in Devanagari script |

### 5.1 Test Results
- **TypeScript Unit Tests**: 69/69 passed (`npm run test:unit`)
- **Rust Backend Tests**: 33/33 passed (`cargo test`)
- **Type Check**: 0 errors (`npm run typecheck`)
- **Frontend & Binary Build**: 0 errors (`npm run build`, `npm run tauri build`)
