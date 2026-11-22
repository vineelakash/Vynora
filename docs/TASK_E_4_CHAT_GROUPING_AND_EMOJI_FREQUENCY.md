# TASK E.4 — VYNORA Chat Conversation Grouping & Emoji Frequency Report

**Project**: VYNORA  
**Task**: E.4 — Chat Conversation Grouping & Emoji Frequency  
**Date**: November 21, 2026  
**Status**: COMPLETE (Group bursts limited to 1-2, ~1 emoji per exchange target, multilingual English/Telugu/Hindi, 104/104 passing tests)  
**Report Files**: `needle-windows/docs/TASK_E_4_CHAT_GROUPING_AND_EMOJI_FREQUENCY.md`, `docs/TASK_E_4_CHAT_GROUPING_AND_EMOJI_FREQUENCY.md`

---

## 1. OBJECTIVE & EXECUTIVE SUMMARY

The objective of **TASK E.4** was to update the Chat lyrics animation style's conversational behavior to feel more authentic, balanced, and expressive, without redesigning the UI or affecting any other animation style.

Two core requirements were implemented:
1. **Reduce Maximum Consecutive Messages from 3 to 2**:
   - Limit participant message bursts to 1 or 2 messages.
   - Eliminate 3-message bursts ("trios") while avoiding rigid A-B-A-B single-line alternation.
   - Allow natural conversational rhythm: 1 message from A, 2 from A, 1 from B, 2 from B.
2. **Increase Emoji Frequency to Approximately One Emoji per Exchange**:
   - Structure emoji assignment around conversational exchanges (`groupId` bursts).
   - Place emojis contextually at the end of selected concluding or emotionally significant messages.
   - Enforce a strict ceiling of at most 1 emoji per exchange to avoid clutter.
   - Expand multilingual keyword matching for English, Telugu, and Hindi lyrics.
   - Guarantee zero consecutive duplicate emojis.
   - Strictly preserve 100% of the original lyric text, order, and punctuation (no paraphrasing or inventing words).

---

## 2. DETAILED CODE CHANGES

### 2.1 Message Grouping (`chatConversationPlanner.ts`)

In `needle-windows/src/lyrics/animation/styles/chatConversationPlanner.ts`:

- **Previous Implementation**:
  ```typescript
  // Allowed bursts of 1, 2, or 3 messages
  const burstLength = Math.min(1 + Math.floor(prng() * 3), remaining);
  ```
- **Updated Implementation**:
  ```typescript
  // Burst length strictly 1 or 2 messages
  const burstCandidate = prng() < 0.5 ? 1 : 2;
  const burstLength = Math.min(burstCandidate, remaining);
  ```
- **Corner Style Mapping**:
  - For single-message bursts (`burstLength === 1`): corner style is `'single'`.
  - For two-message bursts (`burstLength === 2`): the first message is `'first'` and the second is `'last'`.
  - `'middle'` corner styling is never generated because 3+ message bursts no longer exist.
- **Determinism**:
  - The deterministic PRNG (`mulberry32`) is seeded from the track's content hash (`trackKey`), ensuring that repeated playbacks, seeking, pauses, and windowed/fullscreen transitions produce the exact same natural conversation structure.

### 2.2 Emoji Assignment & Frequency Engine (`chatEmojiEngine.ts`)

In `needle-windows/src/lyrics/animation/styles/chatEmojiEngine.ts`:

- **Exchange-Based Emoji Assignment**:
  - Messages are partitioned into exchanges using their `groupId`.
  - For each exchange, the engine scans the messages for emotional keywords (love, joy, heartbreak, night, thinking, music, celebration, fire, magic, summer, etc.).
  - If a message matches an emotion, the emoji is assigned to that message (prioritizing the concluding thought if multiple match).
  - If an exchange has emotional lyrics, at most **1 emoji** is attached to that exchange.
  - Neutral or instrumental-like lines remain emoji-free, preventing forced or robotic insertions.
- **Consecutive Emoji Deduplication**:
  - `matchLyricEmoji(text, excludeEmoji)` was introduced: if a matched category would reuse the immediately preceding emoji, the engine selects an alternate emoji from the category or skips to avoid visual repetition.
- **Expanded Multilingual Keyword Coverage**:
  - **Telugu**:
    * Love: `prema`, `priya`, `valapu`, `hrudayam`, `kannula`, `manasu` (`❤️`)
    * Longing: `guruthu`, `kalise`, `veche`, `nee kosam` (`🥺`)
    * Joy/Smile: `navvu`, `aanandam`, `chinni`, `santhosham` (`😊`)
    * Night/Moon: `raathri`, `vennela`, `chandamama` (`🌙`)
    * Music/Song: `paata`, `geetham`, `swaram`, `raagam` (`🎵`)
  - **Hindi**:
    * Love: `pyar`, `ishq`, `mohabbat`, `dil`, `jaan` (`❤️`)
    * Longing: `yaad`, `intezar`, `tere bina`, `door` (`🥺`)
    * Joy/Smile: `muskurahat`, `khushi`, `hansi` (`😊`)
    * Night/Moon: `raat`, `chaand`, `sitare` (`🌙`)
    * Music/Song: `gaana`, `dhun`, `sureela`, `tarana` (`🎵`)
  - **English**:
    * Love: `love`, `heart`, `darling`, `baby`, `adore`, `kiss` (`❤️`)
    * Longing: `miss you`, `without you`, `alone`, `wish you were here` (`🥺`)
    * Joy/Smile: `smile`, `happy`, `laugh`, `sunshine` (`😊`)
    * Thinking: `wonder`, `thinking`, `thought`, `remember`, `in my mind` (`💭`)
    * Summer: `summer`, `bright day`, `sunrise`, `daylight` (`☀️`)
    * Night/Moon: `night`, `midnight`, `stars`, `moon` (`🌙`)
    * Fire/Energy: `burn`, `fire`, `wild`, `alive`, `electric` (`🔥`)
    * Celebration: `dance`, `party`, `celebrate`, `cheers` (`🎉`)

### 2.3 Frame 1 Transition Defensive Check (`Chat.ts`)

In `needle-windows/src/lyrics/animation/styles/Chat.ts`:
- Added a defensive check to regenerate the conversation plan if lines arrive on a frame where `currentPlan.messages.length === 0`:
  ```typescript
  if (!this.currentPlan || trackKey !== this.lastTrackKey || lyricSignature !== this.lastLyricSignature || (this.currentPlan.messages.length === 0 && lines && lines.length > 0)) {
    this.currentPlan = getOrGenerateChatPlan(trackKey, lines);
    this.lastLyricSignature = lyricSignature;
  }
  ```

---

## 3. TEST SUITE & VERIFICATION

Unit tests were updated and expanded in `needle-windows/src/lyrics/animation/chat.test.ts`.

### 3.1 Verification Results:
- **Total Test Suites**: 4 passed
- **Total Tests**: 104 passed, 0 failed
- **TypeScript Typecheck**: `npx tsc --noEmit` passed with 0 errors.

### 3.2 Key Assertions Verified:
1. `burstLength` is strictly `<= 2` across 100+ generated lines.
2. Both 1-message bursts and 2-message bursts are generated (natural distribution).
3. 3-message bursts never occur (`has3 === false`).
4. Participant sides alternate across bursts (A -> B -> A).
5. Corner positions are strictly `'single'` for length 1, and `'first'` / `'last'` for length 2.
6. Consecutive duplicate emojis never occur.
7. Exchange emoji frequency targets ~1 emoji per exchange without exceeding 1 per exchange.
8. Multilingual matching correctly pairs English, Telugu, and Hindi terms to appropriate emojis.

---

## 4. PRESERVATION OF SYSTEM INTEGRITY

- **Existing Styles Untouched**: Big Words, Lines, Constellation, Terminal, and Karaoke retain 100% of their logic, styling, and rendering code.
- **Removed Styles Remain Removed**: Lens and Stars are not present.
- **Dynamic Theming & Canvas**: Dynamic Island, Beat Glow, and Desktop Vinyl Player continue functioning as expected.
- **Lyric Content Preservation**: Zero modification to lyric text, line breaks, or punctuation.
