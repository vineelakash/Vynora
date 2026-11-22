# TASK B — Terminal Style: Cinematic Code-Inspired Lyric Writing

**Project:** Needle Windows  
**Milestone:** TASK B — Terminal Style Rebuild  
**Platform:** Windows 11 x64  
**Date:** November 2026  
**Status:** Completed & Desktop Verified  

---

## 1. Executive Summary & Objective

The previous **Terminal** kinetic style rendered plain monospaced text centered in a single line and abruptly reset the screen on every lyric transition. 

**TASK B** transforms Terminal into a premium, developer-editor-inspired lyric experience. The lyrics visually resemble text being written live inside a high-end coding editor (such as VS Code, Sublime Text, or JetBrains), but remain **100% original lyrics without converting them into executable software code or introducing programming terminology**.

### Core Achievements:
1. **Developer Code-Editor Aesthetic**: Deep charcoal editor window with macOS-style window controls (red, amber, green dots), tab title (`lyrics.live // UTF-8 // [Line X/Y]`), left gutter with line numbers (`01`, `02`, ...), and vertical gutter separator.
2. **Strict Preservation of Original Lyrics**: 100% original lyric words, spelling, casing, order, and punctuation are preserved. Zero programming keywords (`const`, `let`, `var`, `function`, `class`, `import`, `export`, `if`, etc.) are introduced.
3. **Deterministic Code-Editor Syntax Wrappers**: Natural programming punctuation (`[]`, `{}`, `""`, `()`, `<>`, `//`, `=>`, `;`, `...`) and natural 2-space and 4-space block indentation.
4. **Exactly Two Lines Visible**: Slot 0 (Upper) displays the immediately preceding completed line; Slot 1 (Lower) displays the actively writing line.
5. **Smooth 350ms Vertical Scroll Transition**: Upward ease-out cubic scroll when advancing to a new line ($i-2$ scrolls off and fades, $i-1$ slides to Slot 0, $i$ enters into Slot 1).
6. **Zero-Latency Typing Synchronized to Vocal Delivery**: Progressive character reveal tied directly to word timings or responsive line intervals without artificial typing queues.
7. **Sleek Insertion Cursor**: 2.5px vertical bar with starlight glow following the writing head, solid during active typing, blinking gently during vocal pauses.
8. **Robust Multilingual Unicode Support**: `Intl.Segmenter` grapheme cluster preservation for Telugu (తెలుగు) viramas/matras and Hindi (हिन्दी) Devanagari conjuncts.
9. **Instant Seeking & State Continuity**: $O(1)$ state reconstruction on forward/backward seek without replaying from line 0.
10. **Zero Regression**: Constellation, Big Words, Lines, Lens, and Karaoke remain 100% untouched.

---

## 2. Visual Architecture & Component Breakdown

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🔴 🟡 🟢   lyrics.live // UTF-8 // [Line 3/15]                              LIVE SYNC │
├──────────┬─────────────────────────────────────────────────────────────────────────────┤
│  02      │      { I've been tryin' to call; }                  [Preceding Line: Slot 0]│
│          │                                                                             │
│  03      │  "I've been on their |                              [Active Line: Slot 1]   │
│          │                        ▲ Cursor follows write head                          │
└──────────┴─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 The Editor Canvas
- **Background**: High-contrast deep charcoal `#0a0c10` with subtle rounded corners (`12px`) and soft album-palette tinted border.
- **Window Controls**: Three macOS-style header dots (`#ef4444`, `#f59e0b`, `#10b981`) with soft transparency.
- **Editor Header Bar**: Darkened top bar (`#11151c`) containing the live document breadcrumb `lyrics.live // UTF-8 // [Line X/Y]` and playback status indicator (`LIVE SYNC` in emerald or `PAUSED` in amber).
- **Line Gutter**: Left gutter housing zero-padded line numbers (`01`, `02`, `03`...) right-aligned with 16px padding.
- **Vertical Separator**: Subtle translucent divider line (`rgba(255, 255, 255, 0.07)`) separating gutter from text buffer.

---

## 3. Preservation of Original Lyrics (No Code Semantics)

Strict adherence to the user constraint:
- **No Programming Keywords**: The forbidden list (`const`, `let`, `var`, `return`, `function`, `array`, `class`, `import`, `export`, `if`, `else`, `async`, `await`, etc.) is strictly absent from both prefix and suffix formatting.
- **No Text Manipulation**: Lyric words, spelling, casing, punctuation within the lyrics, and word sequence are never altered.
- **No Artificial Logic**: No fake conditional branches, loops, or function wrappers.

---

## 4. Decorative Formatting Strategy & Patterns

The formatting layer (`terminalFormatter.ts`) applies 8 balanced, deterministic code-editor syntax patterns based on `lineIndex % 8`:

| Pattern Index | Indentation | Opening Prefix | Closing Suffix | Visual Style Description |
|---|---|---|---|---|
| **0** | `  ` (2 spaces) | `[ ` | `... ]` | Array / bracketed block syntax |
| **1** | `    ` (4 spaces) | `{ ` | `; }` | Scoped code block with trailing semicolon |
| **2** | `  ` (2 spaces) | `"` | `"` | Quoted string literal |
| **3** | `    ` (4 spaces) | `( ` | ` );` | Parameterized statement with semicolon |
| **4** | `  ` (2 spaces) | `< ` | `... >` | Generic / template tag syntax |
| **5** | `    ` (4 spaces) | `[ ` | ` ];` | Indexed expression syntax |
| **6** | `  ` (2 spaces) | `// ` | *none* | Single-line comment notation |
| **7** | `    ` (4 spaces) | `=> { ` | ` }` | Arrow closure block notation |

This creates a natural, aesthetic code nesting structure without excessive indents or cluttered symbols.

---

## 5. Character-by-Character Writing Animation Mechanics

### 5.1 Unicode-Safe Grapheme Clustering
To prevent ugly glyph fragmentation in non-Latin scripts (such as splitting vowel signs or viramas from base consonants), `splitGraphemes()` utilizes the ECMAScript `Intl.Segmenter` API configured with `{ granularity: 'grapheme' }`:

```ts
export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}
```

- **Telugu (తెలుగు)**: `వెళ్ళకే` is segmented into `['వె', 'ళ్ళ', 'కే']`. Matras and conjuncts remain atomic units during typing.
- **Hindi (हिन्दी)**: `केसरिया` is segmented into `['के', 'स', 'रि', 'या']`. Syllable integrity is preserved.

### 5.2 Typing Synchronization & Latency Elimination
Typing latency was eliminated by binding character reveals directly to the synchronized lyric timeline:

1. **Word-Timed Mode (`mode !== 'line-only'`)**:
   - Completed words $0 \dots k-1$: fully revealed with spaces.
   - Active word $k$: characters reveal in real time as the singer delivers the word:
     $$\text{activeChars} = \text{clamp}(\lfloor \text{activeWordProgress} \cdot N_k \rfloor, 0, N_k)$$
   - During natural pauses between words, typing pauses naturally.
2. **Line-Only Mode (`mode === 'line-only'`)**:
   - Characters progress smoothly across the vocal interval ($\text{clamp}(\text{lineProgress} / 0.85, 0, 1)$), ensuring the line finishes typing before the line interval concludes.
3. **Closing Suffix Delivery**:
   - The closing syntax suffix (e.g. `; }`, `... ]`) snaps in immediately upon body completion.

---

## 6. Two-Line Window & Smooth Upward Scroll Transition

The Terminal view maintains exactly the latest two lyric lines:
- **Slot 0 (Upper)**: Preceding completed line (dimmed neutral, opacity $0.62$).
- **Slot 1 (Lower)**: Actively writing line (high contrast white, opacity $1.0$).

### 6.1 Transition Dynamics
When advancing from line $i-1$ to line $i$:
Let $\Delta t = \text{positionMs} - \text{lineStartMs}$. Over the first $350\text{ms}$:
$$\tau = \text{clamp}\left(\frac{\Delta t}{350}, 0, 1\right), \quad \eta = 1 - (1 - \tau)^3 \quad (\text{easeOutCubic})$$
$$\text{scrollOffsetY} = (1 - \eta) \cdot \text{lineHeight}$$

- Line $i-2$ (if present) scrolls upward from Slot 0 and fades to zero opacity: $\alpha = 0.5 \cdot (1 - \eta)$.
- Line $i-1$ slides smoothly from Slot 1 up to Slot 0: $Y = Y_0 + \text{scrollOffsetY}$.
- Line $i$ enters into Slot 1 from below: $Y = Y_1 + \text{scrollOffsetY}$, while its prefix and initial characters begin typing.
- Once $\tau \ge 1.0$, the lines remain stable in Slot 0 and Slot 1.

---

## 7. Syntax-Inspired Color Highlighting

Colors are decorative and reactive to the dynamic album artwork palette without programming semantics:

| Token / Symbol | Color Role | Palette Integration | Hex / RGBA Fallback |
|---|---|---|---|
| **Line Numbers** | Muted Gutter Slate | Static High Contrast | `rgba(148, 163, 184, 0.65)` (active) / `0.28` (idle) |
| **Comments (`//`)** | Muted Code Comment | Static Slate | `rgba(100, 116, 139, 0.78)` |
| **Quotes (`""`, `''`)** | String Literal Cyan | Vibrant Sky Cyan | `rgba(56, 189, 248, 0.78)` |
| **Brackets (`[]`, `{}`)** | Structural Silver | Tinted Secondary | `rgba(203, 213, 225, 0.78)` |
| **Angle Tags (`<>`)** | Template Mint | Tinted Accent | `rgba(52, 211, 153, 0.78)` |
| **Arrows (`=>`)** | Operator Violet | Tinted Violet | `rgba(167, 139, 250, 0.78)` |
| **Delimiters (`;`, `:`)** | Punctuation Slate | Dynamic Secondary | `rgba(palette.secondary, 0.78)` |
| **Active Lyric Text** | Primary Foreground | Crisp Bright Neutral | `#f8fafc` |
| **Completed Preceding** | Secondary Foreground | Dimmed Neutral | `rgba(226, 232, 240, 0.72)` |
| **Insertion Cursor** | Caret Highlight | Dynamic Accent | `palette.accentCss` with starlight glow |

---

## 8. Insertion Cursor Mechanics

- **Dimensions**: $2.5\text{px}$ width vertical bar, height matching $1.15 \times \text{fontSize}$.
- **Positioning**: Positioned exactly at `textStartX + indentW + prefixW + revealedBodyW + 2px`.
- **Typing Responsiveness**: While actively writing characters, the cursor stays solid ($100\%$ opacity).
- **Vocal Pause / Playback Pause**: During vocal pauses or when playback is paused, the cursor blinks smoothly on a $530\text{ms}$ cycle ($\lfloor \text{nowMs} / 530 \rfloor \% 2 == 0$).
- **Glow & Starlight**: Rendered with an audio-reactive starlight glow when `glowEnabled` is active.

---

## 9. Performance & Synchronization Results

### 9.1 Benchmarks
Testing via the built-in diagnostic profiler (`PerformanceProfiler.ts`) confirms top-tier rendering efficiency:

| Metric | Measured Value | Target | Status |
|---|---|---|---|
| **Average Frame Rate (FPS)** | **123.5 – 132.9 FPS** | $\ge 60\text{ FPS}$ | **EXCEEDED** |
| **1% Low FPS** | **70.9 – 71.4 FPS** | $\ge 55\text{ FPS}$ | **EXCEEDED** |
| **Frame Latency** | **6.9 ms** | $\le 16.6\text{ ms}$ | **EXCEEDED** |
| **Long Frames (>20ms)** | **1 / 1000 frames** | $\le 10$ | **EXCEEDED** |
| **Severe Stalls (>50ms)** | **0** | $0$ | **PERFECT** |
| **React Audio Rerenders** | **0 / sec** | $0$ | **PERFECT** |

---

## 10. Automated Test Results

### 10.1 Frontend Unit Tests (`npm run test:unit`)
- **Total Tests**: `77 passed, 0 failed` across 4 test suites.
- **Terminal Specific Suite (`src/lyrics/animation/terminal.test.ts`)**:
  - `terminal: preserves original lyric text 100% without modification` (PASS)
  - `terminal: strictly NEVER introduces forbidden programming keywords` (PASS)
  - `terminal: formats line numbers and patterns deterministically` (PASS)
  - `terminal: Unicode grapheme clustering preserves Telugu viramas and matras` (PASS)
  - `terminal: Unicode grapheme clustering preserves Hindi Devanagari conjuncts` (PASS)
  - `terminal: typing progression reveals characters and suffix upon completion` (PASS)
  - `terminal: word-synchronized typing follows active word progress` (PASS)

### 10.2 Rust Backend Tests (`cargo test`)
- **Total Tests**: `33 passed, 0 failed`.
- Zero regressions in GSMTC media monitor, multi-display targeting, or audio capture.

### 10.3 TypeScript Strict Typecheck (`npm run typecheck`)
- `0 errors` (`tsc --noEmit`).

---

## 11. Visual Evidence & Screenshots

All visual evidence captured live from the running Needle Windows desktop application:

1. **English Lyrics in Code Editor Window**:  
   [task-b-terminal-english.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-b-terminal-english.png)  
   Demonstrates Slot 0 completed line, Slot 1 actively writing line, insertion cursor, line numbering, and window controls.

2. **Telugu Unicode Support**:  
   [task-b-terminal-telugu.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-b-terminal-telugu.png)  
   Demonstrates Telugu compound grapheme preservation (`వెళ్ళకే`, `నన్ను`) in Terminal.

3. **Hindi Devanagari Support**:  
   [task-b-terminal-hindi.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-b-terminal-hindi.png)  
   Demonstrates Hindi conjunct preservation (`मुझको`, `कोई`) with line numbering.

4. **Performance Profiler HUD Telemetry**:  
   [task-b-terminal-profiler-active.png](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-b-terminal-profiler-active.png)  
   Shows active telemetry: 123.5 FPS, 6.9 ms frame latency, 0 stalls.

5. **Animated Typing & Upward Scroll Demonstration (GIF)**:  
   [task-b-terminal-typing.gif](file:///C:/Users/Vinee/.gemini/antigravity/brain/556c8aea-4f77-420d-8002-b5393e571b68/task-b-terminal-typing.gif)  
   30-frame live recording capturing responsive character typing and the smooth upward scroll transition.

---

## 12. Conclusion

TASK B delivers a sophisticated, minimal code-editor lyric animation that captures the developer aesthetic while keeping lyrics pure, poetic, and original.
