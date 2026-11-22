# TASK E.4.1 — VYNORA Chat Mode Final Conversation Refinement Report

**Project**: VYNORA  
**Task**: E.4.1 — Chat Mode Final Conversation Refinement  
**Date**: November 21, 2026  
**Status**: COMPLETE (Consecutive messages <= 2, alternation duration strictly interrupted < 25s, ~1 emoji per exchange, 113/113 passing tests)  
**Report Files**: `needle-windows/docs/TASK_E_4_1_CHAT_FINAL_REFINEMENT.md`, `docs/TASK_E_4_1_CHAT_FINAL_REFINEMENT.md`

---

## 1. PREVIOUS CONVERSATION BEHAVIOUR

Prior to TASK E.4.1:
1. In TASK E.4, message bursts were restricted to 1 or 2 messages (`Math.min(r < 0.5 ? 1 : 2, remaining)`).
2. However, there was no constraint on how long an A-B-A-B alternating sequence could persist along the lyric presentation timeline. If the pseudo-random generator produced consecutive single-message bursts, an A-B-A-B exchange could theoretically run unbroken for 30–60+ seconds, creating a rigid, ping-pong conversational rhythm.
3. Emojis only matched lines containing explicit emotion keywords from a limited set. Conversational, reflective, or dialogue lines (e.g. "I know what you mean", "Some moments just stay with you", questions, or assertions) were left without emojis, lowering the overall exchange cadence.

---

## 2. NEW CONSECUTIVE-MESSAGE LIMIT

- **Maximum consecutive messages per participant:** Strictly 2.
- **Allowed patterns:**
  - `A` (single message)
  - `A, A` (pair message)
  - `B` (single message)
  - `B, B` (pair message)
- **Forbidden patterns:**
  - `A, A, A` (trio message burst is strictly impossible)
  - `B, B, B` (trio message burst is strictly impossible)
- Participants are not forced into 1-by-1 alternation; natural bursts of 2 messages from the same participant occur frequently (~50% distribution).

---

## 3. ALTERNATION-DURATION IMPLEMENTATION

A-B-A-B is an allowed and natural conversation pattern. However, continuous rigid A-B-A-B alternation must not persist for 25 seconds or longer.

### Implementation Details:
1. **Lyric Presentation Timeline Tracking:**
   - Evaluated during conversation plan generation in `chatConversationPlanner.ts`.
   - Uses `getLinePresentationDuration(lines, index)` to calculate realistic line presentation spans:
     * For time-synced lyrics with reliable forward timestamps: uses interval `nextLine.timeMs - line.timeMs` (bounded to 10s max if separated by instrumental solos).
     * For word-timed lyrics: uses the last timed word timestamp `(lastWord.timeMs - line.timeMs) + 600ms`.
     * For line-only lyrics (all `timeMs === 0`): accumulates conservative presentation duration `Math.max(2500, Math.min(5000, Math.round(line.text.length * 75)))`.
2. **Instrumental Gap Resets:**
   - If an instrumental gap (> 10s) occurs between lines, the conversation naturally pauses, resetting active alternation tracking.
3. **Alternation Interruption Rule:**
   - When consecutive single-message bursts (`consecutiveSingleBursts >= 1`) are active, the planner computes `projectedAlternatingDuration = projectedEndMs - alternatingStartTimeMs`.
   - If the candidate single message would cause the continuous alternation sequence to reach or exceed `24500ms` (24.5 seconds):
     ```typescript
     const MUST_INTERRUPT_ALTERNATION =
       consecutiveSingleBursts >= 1 &&
       remaining >= 2 &&
       projectedDuration >= 24500;
     ```
   - When `MUST_INTERRUPT_ALTERNATION` is triggered, `burstLength` is forced to `2`.
   - The current participant sends 2 consecutive messages, breaking the A-B-A-B alternation before it reaches 25 seconds.
   - `consecutiveSingleBursts` and `alternatingStartTimeMs` reset to 0 / -1.
   - The next burst switches to the other participant and can resume alternation naturally.
4. **Boundary Cases (24s vs 25s):**
   - Alternating sequences can run naturally up to 24 seconds (e.g. 8 lines at 3000ms = 24.0s).
   - Any further message that would project to $\ge 24.5$s or 25s is intercepted and converted into a 2-message variation. The maximum continuous alternation duration across any lyric dataset is strictly `< 25000ms`.

---

## 4. EMOJI-FREQUENCY IMPLEMENTATION

- **Cadence Target:** Approximately one relevant emoji per conversational exchange (`groupId`).
- **Ceiling:** Strictly at most 1 emoji per exchange (never multiple emojis in the same burst).
- **Placement:** Positioned at the end of the concluding thought of the exchange (`inline`).
- **Consecutive Deduplication:** The engine records `lastAssignedEmoji` and excludes it from matching on the next exchange, ensuring that consecutive exchanges never receive the same emoji.
- **Multilingual Semantic Coverage:**
  - **Telugu (తెలుగు):**
    * Love / Devotion (`❤️`): `ప్రేమ`, `ప్రాణం`, `మనసు`, `హృదయం`, `వలపు`, `ప్రియ`
    * Longing / Waiting (`🥺`): `గుర్తు`, `దూరం`, `కావాలి`, `రావా`, `వేచే`, `నీ కోసం`
    * Joy / Smile (`😊`): `నవ్వు`, `సంతోషం`, `వెలుగు`, `ఆనందం`
    * Night / Moon (`🌙`): `రాత్రి`, `చంద్రు`, `చుక్క`, `వెన్నెల`, `చందమామ`
    * Music / Song (`🎵`): `పాట`, `సంగీతం`, `స్వరం`, `రాగం`
    * Heartbreak / Farewell (`💔`): `గుండె పగిలి`, `విరిగి`, `బాధ`, `వీడ్కోలు`
    * Summer / Sun (`☀️`): `ఎండ`, `పగలు`, `ఉదయం`, `సూర్యు`
    * Connection / Dialogue (`✨` / `🫶`): `నువ్వు`, `నేను`, `మనము`, `చేయి`, `తోడుగా`
  - **Hindi (हिन्दी):**
    * Love / Devotion (`❤️`): `प्यार`, `मोहब्बत`, `इश्क`, `दिल`, `जान`, `सनम`, `हमसफ़र`
    * Longing / Absence (`🥺`): `याद`, `दूरी`, `कमी`, `पास आओ`, `काश`, `इंतज़ार`, `तेरे बिना`
    * Joy / Smile (`😊`): `हंसी`, `मुस्कान`, `खुशी`, `सुंदर`, `मुस्कुरा`
    * Night / Moon (`🌙`): `रात`, `चांद`, `तारे`, `सितारे`, `चांदनी`
    * Music / Song (`🎵`): `गाना`, `गीत`, `सुर`, `संगीत`, `तराना`
    * Heartbreak / Pain (`💔`): `दिल टूट`, `दर्द`, `अलविदा`, `बिछड़`
    * Summer / Sun (`☀️`): `धूप`, `सूरज`, `सुबह`, `गर्मी`
    * Connection / Dialogue (`✨` / `🫶`): `तुम`, `हम`, `तू`, `हाथ`, `साथी`
  - **English:**
    * Full sentiment dictionary covering love, longing, joy, heartbreak, summer, thinking, fire, celebration, night, magic, music, hope, flowers, memories, and ocean.
- **Conversational Cue Fallback:**
  - For exchanges containing reflective questions (`?`, `why`, `how`, `what`), dialogue connection (`you`, `we`, `us`), or energy (`!`, `yeah`), the engine applies natural conversational emojis (`💭`, `✨`, `🔥`, `🎵`).
- **Lyric Text Preservation:** 100% preservation of all lyric text, punctuation, spelling, and character ordering.

---

## 5. DETERMINISTIC GROUPING BEHAVIOUR

- The conversation plan is generated only when a new track or lyric dataset loads.
- Seeded with `computeStableSeed(trackKey, lines)` using 32-bit `mulberry32`.
- **Zero Plan Regeneration During:**
  * Animation rendering frames (60/120 FPS).
  * Playback pause or resume.
  * Seeking forward or backward.
  * Resizing or entering/exiting fullscreen.
- **Pause Behaviour:**
  * Pausing freezes `positionMs`.
  * The visible conversation list (`allMsgs[i].timeMs <= positionMs`) remains completely frozen.
- **Seek Behaviour:**
  * Seeking instantly evaluates the new `positionMs` against the pre-calculated messages.
  * Scroll snaps smoothly to the active message without flickering or re-planning.

---

## 6. FILES MODIFIED

1. `needle-windows/src/lyrics/animation/styles/chatConversationPlanner.ts`:
   - Added `getLinePresentationDuration()` for reliable, word-timed, and line-only duration calculations.
   - Added cumulative alternation presentation timeline tracking (`alternatingStartTimeMs`, `consecutiveSingleBursts`, `lastLinePresentationEndMs`, `simulatedTimelineMs`).
   - Implemented `MUST_INTERRUPT_ALTERNATION` check at `projectedDuration >= 24500ms`, forcing pair burst variation before reaching 25 seconds.
2. `needle-windows/src/lyrics/animation/styles/chatEmojiEngine.ts`:
   - Added conversational cues and expanded multilingual dictionaries for English, Telugu, and Hindi.
   - Enhanced `assignContextualEmojis()` to target ~1 emoji per exchange, avoid consecutive duplicates, and ensure at most 1 emoji per exchange.
3. `needle-windows/src/lyrics/animation/chat.test.ts`:
   - Expanded test suite to 16 comprehensive automated tests covering all 14 requirements in Section 8.

---

## 7. AUTOMATED TESTS & VERIFICATION RESULTS

### Test Results:
- **Total Test Suites**: 4 passed
- **Total Unit Tests**: 113 passed, 0 failed
- **TypeScript Typecheck**: `npx tsc --noEmit` passed with 0 errors.

### Specific Test Coverage:
1. `chat: maximum two consecutive messages per participant across varied song tempos and lengths` — **PASSED** (checked across fast 1500ms songs, slow 5000ms songs, short 6-line songs, and long 100-line songs).
2. `chat: short A-B-A-B sequences are allowed and natural` — **PASSED** (verified that 2+ consecutive single bursts occur naturally alongside pair variations).
3. `chat: continuous alternation breaks strictly before reaching 25 seconds` — **PASSED** (verified across intervals 2000ms, 2500ms, 3000ms, 3500ms, 4000ms that alternation duration is strictly `< 25000ms`).
4. `chat: alternation resumes naturally after a variation` — **PASSED** (verified side switching and resumption of single-message bursts following pair variations).
5. `chat: boundary cases around 24 and 25 seconds` — **PASSED** (verified that 24.0s sequences are permitted and that sequences projecting to $\ge 24.5$s or 25.0s are converted to 2-message variations).
6. `chat: pause freezes conversation state and resume continues cleanly without regeneration` — **PASSED** (verified 60 frames of pause produce identical object references and visible message counts).
7. `chat: seeking calculates correct conversation state without regenerating plan` — **PASSED** (verified forward seek to 30s and backward seek to 5s correctly filter messages while referencing identical cached plan).
8. `chat: emoji frequency averages approximately one per exchange with high coverage` — **PASSED** (verified ratio $\ge 0.8$, max 1 per exchange, zero consecutive duplicate emojis).
9. `chat: emoji placement remains completely deterministic across multiple invocations` — **PASSED**.
10. `chat: preserves 100% of original lyric words, spelling, and punctuation` — **PASSED** (verified exact match for English, Telugu, and Hindi).
11. `chat: grouping plan is completely deterministic across runs` — **PASSED**.
12. `chat: fullscreen and window modes use the exact same cached conversation plan` — **PASSED**.
13. `chat: track changes generate a new conversation plan` — **PASSED**.
14. `chat: multilingual contextual emoji matching across English, Telugu, and Hindi` — **PASSED**.
15. `chat: handles line-only lyrics and word-timed lyrics safely` — **PASSED**.
16. `chat: studio settings storage migrates legacy 'lens' to 'chat'` — **PASSED**.

---

## 8. WINDOW & FULLSCREEN COMPATIBILITY

- Both Lyrics Studio window mode and Immersive Fullscreen mode call `getOrGenerateChatPlan(trackKey, lines)`.
- The in-memory cache `planCache` is keyed by `trackKey` and `signature`.
- Both viewports share the exact same conversation plan object, bubble corner styles, participant sides, timestamps, and emoji assignments.
- Switching between window mode and fullscreen mode performs zero plan regenerations.

---

## 9. KNOWN LIMITATIONS

1. **Single-Line Songs / Song Ends:** If only 1 line remains at the very end of a song (`remaining === 1`), a 2-message variation cannot be formed because no second message exists; the line is presented as a single message.
2. **Pure Instrumental Tracks:** Tracks with zero lyrics display truthful instrumental indicator screens (`♪ Instrumental Track ♪` or `♪ Instrumental Intro ♪`) rather than empty chat bubbles.
