# TASK E — VYNORA Chat Lyrics Style Specification & Implementation

## 1. Overview & Objective

TASK E introduces a brand-new kinetic typography animation style called **Chat** to the VYNORA Lyrics Studio and dedicated Immersive Fullscreen Player. 

Inspired by desktop messaging applications (WhatsApp Web, Instagram Desktop Messages, and modern minimal communication tools), the Chat style transforms musical lyrics into a natural, conversational exchange between two distinct participants on screen.

### Key Deliverables:
1. **Lens Style Deprecation & Removal**:
   - Completely retired the former `lens` style from the style selector, storage schemas, and canvas orchestrator without affecting shared typography or rendering utilities.
   - Installed `chat` as the modern replacement style with safe backward-compatibility migrations for existing user preference profiles.
2. **Desktop-First Split Layout**:
   - **Left Panel (Album Identity)**: Features high-fidelity album artwork with subtle rounded corners, track title, artist name, album name, live playback status badge (`NOW PLAYING`), and audio-reactive mini spectrum bars. Strictly devoid of fake contact lists, fake user profiles, or extraneous chat threads.
   - **Right Panel (Conversation Area)**: Uses the remaining horizontal window space to render a clean, understated conversation between two distinct participants.
3. **Natural Conversation Dynamics & Random Grouping**:
   - Implements a deterministic Mulberry32 PRNG engine that partitions lyrics into **randomized bursts of 1 to 3 consecutive messages** per participant before alternating.
   - Group-aware bubble geometry: intra-burst bubbles sit tighter (6px gap) with flattened adjacent corner radii, while inter-burst bubbles maintain breathable spacing (24px gap).
4. **Contextual Semantic Emoji Engine**:
   - Multilingual semantic analyzer recognizing emotional context (love, heartbreak, crying, longing, joy, fire, night, flowers, dancing, peace, etc.) across English, Telugu, and Hindi lyrics.
   - Cadence regulation: accents messages at an authentic rate (~1 emoji per 2 exchanges) and strictly preserves 100% of original lyric words.
5. **Zero Interference with Protected Systems**:
   - Preserves all 5 existing styles (*Big Words*, *Lines*, *Constellation*, *Terminal*, *Karaoke*).
   - Leaves Beat Glow, Dynamic Island, Desktop Vinyl, WASAPI audio capture, and Rust backend 100% untouched.

---

## 2. Architecture & Modules

The Chat style is modularized into three core frontend components within `src/lyrics/animation/`:

```
needle-windows/src/lyrics/animation/
├── styles/
│   ├── Chat.ts                     # Main canvas rendering engine (left panel + conversation canvas)
│   ├── chatConversationPlanner.ts  # Deterministic 1-3 message grouping & participant assignment
│   └── chatEmojiEngine.ts          # Multilingual semantic emoji engine & cadence regulator
├── animationTypes.ts               # Replaced 'lens' with 'chat' in KineticStyleId & added TrackMetadata
├── studioSettingsStorage.ts        # Storage migrations ('lens' -> 'chat') and key synchronizer
└── render/
    └── LyricsCanvas.ts             # Canvas engine style registry & metadata pipeline
```

### 2.1 Conversation Planner (`chatConversationPlanner.ts`)
The conversation planner ingests the song's parsed lyric lines and a unique `trackKey` (e.g., `"Blinding Lights::The Weeknd"` or sample ID).

- **Mulberry32 PRNG**: A deterministic pseudo-random number generator initialized with an FNV-1a hash of the `trackKey`. This guarantees that grouping is:
  1. **Random**: Bursts vary unpredictably between 1, 2, and 3 messages.
  2. **Deterministic**: Grouping remains 100% identical across seeking, pausing, and window resizing without flickering or rearranging.
- **Group Metadata**:
  - `side`: `'left'` (Participant 1) or `'right'` (Participant 2).
  - `groupPosition`: `'single'`, `'first'`, `'middle'`, or `'last'`.
  - `timestamp`: Formatted as `mm:ss` based on line timing.
  - `showChecks`: Renders double read receipts (`✓✓`) exclusively on Participant 2's right-hand messages.

### 2.2 Semantic Emoji Engine (`chatEmojiEngine.ts`)
The emoji engine enriches lyric lines with expressive visual context:
- **Multilingual Vocabulary**:
  - **English**: Love (`❤️`), Heartbreak (`💔`), Crying/Tears (`😢`), Longing/Missing (`🥺`), Fire/Groove (`🔥`), Night/Stars (`🌙`), Dancing (`💃`), Flowers/Rose (`🌹`), Peace (`🕊️`), Mind/Thoughts (`💭`).
  - **Telugu**: ప్రేమ / ఇష్టం (`❤️`), కన్నీరు / ఏడుపు (`😢`), గుండె / ప్రాణం (`💓`), రాత్రి / వెన్నెల (`🌙`), నవ్వు (`😊`), అగ్ని (`🔥`).
  - **Hindi**: दिल / प्यार / मोहब्बत (`❤️`), दर्द / टूटा दिल (`💔`), आंसू / रोना (`😢`), रात / चाँद (`🌙`), आग / शोला (`🔥`), खुशी (`😊`).
- **Cadence Regulator**:
  - Enforces ~1 emoji per 2 conversational exchanges to avoid visual clutter.
  - Prevents back-to-back duplicate emoji glyphs.
  - Preserves original lyric text completely; emojis are appended with a single space or rendered as subtle accent pills.

### 2.3 Canvas Rendering Engine (`Chat.ts`)
- **Left Panel (Width = 280–340px)**:
  - Album Artwork: Rendered with 12px rounded corners and subtle drop shadows. If no artwork bitmap is supplied, generates a dark satin vinyl groove fallback.
  - Typography: Song title in bold Display font (18px), artist name in medium Sans (13px), and album name in muted zinc (11px).
  - Status Indicator: Glowing emerald badge with pulsating `NOW PLAYING` text.
  - Equalizer: Audio-reactive mini spectrum bars at the base driven by WASAPI audio frames.
- **Right Panel (Conversation Area)**:
  - Header: Subdued title `"Lyrics Chat"` with subtitle `"2 participants · Synced with playback"`.
  - Participant 1 (Left): Background `#1A1C26` (slate neutral dark), text `#E2E8F0`.
  - Participant 2 (Right): Background tinted with album accent (e.g., `#2A1E35` violet/rose or `#1E253A` indigo), text `#FFFFFF`.
  - Corner Radii:
    - `first`: `[18, 18, 18, 4]` (left) / `[18, 18, 4, 18]` (right).
    - `middle`: `[4, 18, 18, 4]` (left) / `[18, 4, 4, 18]` (right).
    - `last`: `[4, 18, 18, 18]` (left) / `[18, 4, 18, 18]` (right).
    - `single`: `[18, 18, 18, 18]`.
  - Upward Scroll Damping: Uses a critially damped `smoothDamp` spring equation to track active dialogue smoothly without sudden jumps.

---

## 3. Backward Compatibility & Migration

- **LocalStorage Migration**:
  In `studioSettingsStorage.ts`, `loadStudioSettings()` automatically migrates any saved configuration where `style === 'lens'` to `style === 'chat'`.
- **Default Style**:
  `DEFAULT_STUDIO_SETTINGS.style` is initialized to `'chat'`.
- **Fullscreen Synchronization**:
  Settings changes made in the main window immediately synchronize to the dedicated Fullscreen Player via the `storage` event pipeline.

---

## 4. Verification & Testing

### 4.1 Unit Test Coverage
The suite in `src/lyrics/animation/chat.test.ts` executes 7 dedicated unit tests:
1. `generates randomized 1 to 3 consecutive message groupings per participant without repeating patterns`
2. `grouping plan is completely deterministic and stable across seeks and pauses`
3. `assigns correct bubble corner positions (single, first, middle, last)`
4. `contextual emoji dictionary matches emotional lyrics across English, Telugu, and Hindi`
5. `regulates emoji cadence to ~once every 2 exchanges and avoids consecutive duplicate emojis`
6. `preserves 100% of original lyric words without alteration`
7. `studio settings storage migrates legacy 'lens' to 'chat'`

**Test Results**: All 94 project unit tests pass with zero failures.

### 4.2 Desktop Verification Screenshots
Captured from live Windows release binaries (`VYNORA.exe`):

1. **English Chat (`task-e-chat-english.png`)**:
   - Sample track: *Blinding Lights* by The Weeknd.
   - Shows red vinyl album artwork on the left, live playing indicator, and alternating conversation bubbles with double-check read receipts on the right.
2. **Telugu Chat (`task-e-chat-telugu.png`)**:
   - Sample track: *Vellake (వెళ్ళకే)* by Bharatt-Saurabh.
   - Shows gold vinyl artwork on the left and Telugu Unicode lyric bubbles with timestamps and receipts on the right.
3. **Hindi Chat (`task-e-chat-hindi.png`)**:
   - Sample track: *Kesariya (केसरिया)* by Arijit Singh.
   - Shows orange vinyl artwork on the left and Hindi Devanagari lyric bubbles with semantic contextual emoji reaction (`❤️` on "दिल").
4. **Fullscreen Chat (`task-e-chat-fullscreen.png`)**:
   - Immersive edge-to-edge dedicated player window displaying large vinyl cover, live reactive spectrum bars, and floating conversation bubbles with auto-hiding controls.

---

## 5. Scope Boundaries Maintained

- **Protected Styles**: *Big Words*, *Lines*, *Constellation*, *Terminal*, and *Karaoke* remain completely untouched.
- **Protected Visualizers**: *Beat Glow* visualizer modes (Spectrum, Waveform, Circular, Ambient) and WASAPI DSP engine remain 100% intact.
- **Protected Overlays**: *Dynamic Island* and *Desktop Vinyl* components remain 100% intact.
- **Protected Backend**: Rust Tauri commands, GSMTC Spotify integration, and audio capture pipeline remain 100% intact.
