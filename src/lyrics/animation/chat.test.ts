import assert from "node:assert/strict";
import test from "node:test";
import {
  generateChatConversationPlan,
  getOrGenerateChatPlan,
  clearChatPlanCache,
  getLinePresentationDuration,
  type ChatPlannedMessage,
} from "./styles/chatConversationPlanner.ts";
import {
  matchLyricEmoji,
  assignContextualEmojis,
} from "./styles/chatEmojiEngine.ts";
import { loadStudioSettings, type StorageLike } from "./studioSettingsStorage.ts";
import type { ParsedLyricLine } from "../../types/lyrics.ts";

function createDummyLines(
  count: number,
  intervalMs = 3000,
  prefix = "Lyric line",
): ParsedLyricLine[] {
  const lines: ParsedLyricLine[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({
      id: `line_${i + 1}`,
      timeMs: i * intervalMs,
      text: `${prefix} ${i + 1}`,
      isBlank: false,
    });
  }
  return lines;
}

// 1. Maximum two consecutive messages per participant
test("chat: maximum two consecutive messages per participant across varied song tempos and lengths", () => {
  const fastLines = createDummyLines(60, 1500, "Fast track");
  const slowLines = createDummyLines(30, 5000, "Slow track");
  const shortLines = createDummyLines(6, 3000, "Short track");
  const longLines = createDummyLines(100, 2500, "Long track");

  for (const [name, lines] of [
    ["fast", fastLines],
    ["slow", slowLines],
    ["short", shortLines],
    ["long", longLines],
  ] as const) {
    const plan = generateChatConversationPlan(`track_${name}`, lines);
    assert.equal(plan.messages.length, lines.length);

    let currentGroupId = -1;
    let burstLength = 0;
    let currentSide = "";

    for (const msg of plan.messages) {
      if (msg.groupId !== currentGroupId) {
        if (currentGroupId !== -1) {
          assert.ok(
            burstLength >= 1 && burstLength <= 2,
            `${name}: burst length ${burstLength} must be 1 or 2`,
          );
        }
        currentGroupId = msg.groupId;
        burstLength = 1;
        assert.notEqual(
          msg.side,
          currentSide,
          `${name}: side must alternate on group boundary`,
        );
        currentSide = msg.side;
      } else {
        burstLength++;
        assert.equal(
          msg.side,
          currentSide,
          `${name}: side must match within burst`,
        );
      }
    }
    assert.ok(
      burstLength >= 1 && burstLength <= 2,
      `${name}: final burst length ${burstLength} must be 1 or 2`,
    );
  }
});

// 2. Short A-B-A-B sequences are allowed
test("chat: short A-B-A-B sequences are allowed and natural", () => {
  const lines = createDummyLines(50, 3000);
  const plan = generateChatConversationPlan("track_short_abab", lines);

  // Group messages by groupId
  const burstLengths: number[] = [];
  let currentGroupId = -1;
  for (const msg of plan.messages) {
    if (msg.groupId !== currentGroupId) {
      burstLengths.push(msg.burstLength);
      currentGroupId = msg.groupId;
    }
  }

  // Find consecutive single-message bursts (representing A-B-A-B alternation)
  let maxSingleRun = 0;
  let currentSingleRun = 0;
  for (const len of burstLengths) {
    if (len === 1) {
      currentSingleRun++;
      if (currentSingleRun > maxSingleRun) {
        maxSingleRun = currentSingleRun;
      }
    } else {
      currentSingleRun = 0;
    }
  }

  // Verify that short A-B-A-B sequences exist (at least 2 consecutive single bursts)
  assert.ok(
    maxSingleRun >= 2,
    `Short A-B-A-B sequences must occur naturally (found max run of ${maxSingleRun})`,
  );
  // Verify that pair bursts (variations) also exist
  assert.ok(
    burstLengths.includes(2),
    "Natural pair variations must also occur",
  );
});

// 3. Continuous alternation breaks strictly before reaching 25 seconds
test("chat: continuous alternation breaks strictly before reaching 25 seconds", () => {
  // Test across multiple line intervals: 2000ms, 2500ms, 3000ms, 3500ms, 4000ms
  for (const interval of [2000, 2500, 3000, 3500, 4000]) {
    const lines = createDummyLines(60, interval);
    const plan = generateChatConversationPlan(`track_break_${interval}`, lines);

    // Track every sequence of single-message bursts and measure cumulative presentation duration
    let alternatingStartMs = -1;
    let consecutiveSingles = 0;
    let maxAlternatingDuration = 0;

    for (let i = 0; i < plan.messages.length; ) {
      const msg = plan.messages[i]!;
      const burstLen = msg.burstLength;

      if (burstLen === 1) {
        const lineDur = getLinePresentationDuration(lines, msg.lineIndex);
        if (consecutiveSingles === 0) {
          alternatingStartMs = msg.timeMs;
        }
        consecutiveSingles++;
        const presentationEnd = msg.timeMs + lineDur;
        const dur = presentationEnd - alternatingStartMs;
        if (dur > maxAlternatingDuration) {
          maxAlternatingDuration = dur;
        }
        // Continuous alternation must NEVER reach or exceed 25 seconds
        assert.ok(
          dur < 25000,
          `Interval ${interval}ms: continuous alternation duration (${dur}ms) must be strictly < 25000ms`,
        );
        i++;
      } else {
        // Variation occurred (pair burst)
        consecutiveSingles = 0;
        alternatingStartMs = -1;
        i += burstLen;
      }
    }

    assert.ok(
      maxAlternatingDuration < 25000,
      `Max alternating duration (${maxAlternatingDuration}ms) for interval ${interval}ms must be < 25000ms`,
    );
  }
});

// 4. Alternation resumes naturally after a variation
test("chat: alternation resumes naturally after a variation", () => {
  const lines = createDummyLines(40, 3000);
  const plan = generateChatConversationPlan("track_resume", lines);

  // Find bursts
  const bursts: { groupId: number; burstLength: number; side: string }[] = [];
  let currentGroupId = -1;
  for (const msg of plan.messages) {
    if (msg.groupId !== currentGroupId) {
      bursts.push({
        groupId: msg.groupId,
        burstLength: msg.burstLength,
        side: msg.side,
      });
      currentGroupId = msg.groupId;
    }
  }

  // Verify that after a pair burst (length 2), subsequent bursts resume natural alternation
  let foundPairFollowedBySingle = false;
  for (let b = 0; b < bursts.length - 1; b++) {
    if (bursts[b]!.burstLength === 2 && bursts[b + 1]!.burstLength === 1) {
      foundPairFollowedBySingle = true;
      // Participant side must alternate cleanly
      assert.notEqual(
        bursts[b]!.side,
        bursts[b + 1]!.side,
        "Side must switch after pair burst",
      );
      break;
    }
  }

  assert.ok(
    foundPairFollowedBySingle,
    "Alternation must resume naturally after a 2-message variation",
  );
});

// 5. Boundary cases around 24 and 25 seconds
test("chat: boundary cases around 24 and 25 seconds", () => {
  // Case A: 3000ms intervals where 8 single messages would reach exactly 24000ms
  // Line 0: 0s, Line 1: 3s, Line 2: 6s, Line 3: 9s, Line 4: 12s, Line 5: 15s, Line 6: 18s, Line 7: 21s (ends at 24s).
  // A 9th single line starting at 24s would reach 27s (>= 25s), so line 8 MUST be paired into a 2-message burst!
  const lines3s = createDummyLines(20, 3000);
  // Force PRNG to try single messages by using a seed that tends to 1
  const plan3s = generateChatConversationPlan("track_boundary_3s", lines3s, {
    seed: 42,
  });

  // Check the messages around 24s
  let altStart = -1;
  let singles = 0;
  for (const msg of plan3s.messages) {
    if (msg.burstLength === 1) {
      if (singles === 0) altStart = msg.timeMs;
      singles++;
      const end = msg.timeMs + 3000;
      assert.ok(
        end - altStart < 25000,
        `Alternation duration (${end - altStart}ms) must remain strictly under 25000ms`,
      );
    } else {
      singles = 0;
      altStart = -1;
    }
  }

  // Case B: 5000ms intervals where 4 single lines end at 20s.
  // A 5th single line at 20s would end at 25s (>= 25s), so it must be interrupted!
  const lines5s = createDummyLines(10, 5000);
  const plan5s = generateChatConversationPlan("track_boundary_5s", lines5s, {
    seed: 99,
  });

  altStart = -1;
  singles = 0;
  for (const msg of plan5s.messages) {
    if (msg.burstLength === 1) {
      if (singles === 0) altStart = msg.timeMs;
      singles++;
      const end = msg.timeMs + 5000;
      assert.ok(
        end - altStart < 25000,
        `5s interval alternation duration (${end - altStart}ms) must remain strictly under 25000ms`,
      );
    } else {
      singles = 0;
      altStart = -1;
    }
  }
});

// 6 & 7. Pause freezes timeline and Resume continues correctly
test("chat: pause freezes conversation state and resume continues cleanly without regeneration", () => {
  const lines = createDummyLines(12, 3000);
  clearChatPlanCache();

  // Load initial plan
  const plan1 = getOrGenerateChatPlan("track_pause_test", lines);
  assert.equal(plan1.messages.length, 12);

  // Simulate playback at 7000ms (Line 0, 1, 2 visible)
  const visibleAt7s = plan1.messages.filter((m) => m.timeMs <= 7000);
  assert.equal(visibleAt7s.length, 3); // 0ms, 3000ms, 6000ms

  // Simulate Pause: frames pass but positionMs remains frozen at 7000ms
  for (let frame = 0; frame < 60; frame++) {
    const planFrozen = getOrGenerateChatPlan("track_pause_test", lines);
    assert.equal(planFrozen, plan1, "Plan must NOT regenerate during pause");
    const visibleFrozen = planFrozen.messages.filter((m) => m.timeMs <= 7000);
    assert.equal(visibleFrozen.length, 3, "Visible messages must remain frozen during pause");
  }

  // Simulate Resume: positionMs advances to 10000ms (Line 3 at 9000ms becomes visible)
  const visibleAt10s = plan1.messages.filter((m) => m.timeMs <= 10000);
  assert.equal(visibleAt10s.length, 4, "Resumed playback reveals next message at expected time");
});

// 8. Seeking calculates correct conversation state without plan regeneration
test("chat: seeking calculates correct conversation state without regenerating plan", () => {
  const lines = createDummyLines(20, 2500);
  clearChatPlanCache();

  const planInitial = getOrGenerateChatPlan("track_seek_test", lines);

  // Seek forward to 30000ms
  const planSeekFwd = getOrGenerateChatPlan("track_seek_test", lines);
  assert.equal(planSeekFwd, planInitial, "Plan instance must remain unchanged on seek forward");
  const visibleFwd = planSeekFwd.messages.filter((m) => m.timeMs <= 30000);
  assert.equal(visibleFwd.length, 13); // lines 0..12

  // Seek backward to 5000ms
  const planSeekBack = getOrGenerateChatPlan("track_seek_test", lines);
  assert.equal(planSeekBack, planInitial, "Plan instance must remain unchanged on seek backward");
  const visibleBack = planSeekBack.messages.filter((m) => m.timeMs <= 5000);
  assert.equal(visibleBack.length, 3); // lines 0, 1, 2
});

// 9. Emoji frequency averages approximately one per exchange
test("chat: emoji frequency averages approximately one per exchange with high coverage", () => {
  const englishLines: ParsedLyricLine[] = [
    { id: "1", timeMs: 0, text: "I miss those summer nights", isBlank: false },
    { id: "2", timeMs: 3000, text: "We had something special", isBlank: false },
    { id: "3", timeMs: 6000, text: "I wish we could go back", isBlank: false },
    { id: "4", timeMs: 9000, text: "Maybe some memories are better left there", isBlank: false },
    { id: "5", timeMs: 12000, text: "You still cross my mind", isBlank: false },
    { id: "6", timeMs: 15000, text: "More often than you think", isBlank: false },
    { id: "7", timeMs: 18000, text: "Burning like a wild fire in the dark", isBlank: false },
    { id: "8", timeMs: 21000, text: "Dancing till the morning light", isBlank: false },
  ];

  const plan = generateChatConversationPlan("track_emoji_freq", englishLines, {
    assignEmojis: (msgs) => assignContextualEmojis(msgs),
  });

  const exchangeIds = new Set(plan.messages.map((m) => m.groupId));
  const msgsWithEmoji = plan.messages.filter((m) => !!m.emoji);

  // 1. Every exchange receives at most 1 emoji
  const perExchange = new Map<number, number>();
  for (const m of msgsWithEmoji) {
    perExchange.set(m.groupId, (perExchange.get(m.groupId) ?? 0) + 1);
  }
  for (const [gid, count] of perExchange.entries()) {
    assert.equal(count, 1, `Exchange ${gid} must receive at most 1 emoji`);
  }

  // 2. Average frequency targets ~1 emoji per exchange (ratio >= 0.8)
  const ratio = msgsWithEmoji.length / exchangeIds.size;
  assert.ok(
    ratio >= 0.8 && ratio <= 1.0,
    `Emoji frequency ratio (${ratio.toFixed(2)}) must target ~1 emoji per exchange`,
  );

  // 3. No consecutive duplicate emojis
  for (let i = 1; i < msgsWithEmoji.length; i++) {
    assert.notEqual(
      msgsWithEmoji[i]!.emoji,
      msgsWithEmoji[i - 1]!.emoji,
      `Consecutive emojis must not be identical (${msgsWithEmoji[i]!.emoji} !== ${msgsWithEmoji[i - 1]!.emoji})`,
    );
  }
});

// 10. Emoji placement remains deterministic
test("chat: emoji placement remains completely deterministic across multiple invocations", () => {
  const lines: ParsedLyricLine[] = [
    { id: "1", timeMs: 0, text: "Under the moonlight and stars", isBlank: false },
    { id: "2", timeMs: 3000, text: "I can feel the cold wind blowing", isBlank: false },
    { id: "3", timeMs: 6000, text: "You broke my heart again", isBlank: false },
    { id: "4", timeMs: 9000, text: "Smile for me one more time", isBlank: false },
  ];

  const plan1 = generateChatConversationPlan("track_det_emoji", lines, {
    assignEmojis: (msgs) => assignContextualEmojis(msgs),
  });
  const plan2 = generateChatConversationPlan("track_det_emoji", lines, {
    assignEmojis: (msgs) => assignContextualEmojis(msgs),
  });

  assert.equal(plan1.messages.length, plan2.messages.length);
  for (let i = 0; i < plan1.messages.length; i++) {
    assert.equal(plan1.messages[i]!.emoji, plan2.messages[i]!.emoji);
    assert.equal(plan1.messages[i]!.emojiPlacement, plan2.messages[i]!.emojiPlacement);
  }
});

// 11. Original lyric text remains 100% unchanged
test("chat: preserves 100% of original lyric words, spelling, and punctuation", () => {
  const rawLyrics = [
    "I still remember you.",
    "Even after all this time...",
    "Nothing feels the same!?",
    "Power power trippin' trippin'",
    "నేను నిన్ను ప్రేమిస్తున్నాను, ఎప్పటికీ!",
    "तुम मेरे पास रहो, हमेशा।",
  ];

  const lines: ParsedLyricLine[] = rawLyrics.map((text, idx) => ({
    id: `l_${idx}`,
    timeMs: idx * 3000,
    text,
    isBlank: false,
  }));

  const plan = generateChatConversationPlan("track_exact_lyrics", lines, {
    assignEmojis: (msgs) => assignContextualEmojis(msgs),
  });

  for (let i = 0; i < plan.messages.length; i++) {
    assert.equal(
      plan.messages[i]!.text,
      rawLyrics[i],
      `Lyric line ${i} must match original raw string character-for-character`,
    );
  }
});

// 12. Conversation grouping remains deterministic
test("chat: grouping plan is completely deterministic across runs", () => {
  const lines = createDummyLines(24);
  const plan1 = generateChatConversationPlan("track_fixed_123", lines);
  const plan2 = generateChatConversationPlan("track_fixed_123", lines);

  assert.equal(plan1.messages.length, plan2.messages.length);
  for (let i = 0; i < plan1.messages.length; i++) {
    const m1 = plan1.messages[i]!;
    const m2 = plan2.messages[i]!;
    assert.equal(m1.side, m2.side, `Message ${i} side must match`);
    assert.equal(m1.groupPosition, m2.groupPosition, `Message ${i} position must match`);
    assert.equal(m1.groupId, m2.groupId, `Message ${i} groupId must match`);
    assert.equal(m1.burstLength, m2.burstLength, `Message ${i} burstLength must match`);
  }
});

// 13. Fullscreen and window modes use consistent conversation behaviour
test("chat: fullscreen and window modes use the exact same cached conversation plan", () => {
  clearChatPlanCache();
  const lines = createDummyLines(16, 2500);

  // Windowed mode retrieves plan
  const windowPlan = getOrGenerateChatPlan("track_mode_consistency", lines, (msgs) => {
    assignContextualEmojis(msgs);
  });

  // Immersive fullscreen mode retrieves plan for same track
  const fullscreenPlan = getOrGenerateChatPlan("track_mode_consistency", lines, (msgs) => {
    assignContextualEmojis(msgs);
  });

  // Verify same object reference (zero duplicate planners or independent timing systems)
  assert.equal(
    windowPlan,
    fullscreenPlan,
    "Windowed and fullscreen modes must share the identical conversation plan instance",
  );
  assert.equal(windowPlan.messages.length, fullscreenPlan.messages.length);
});

// 14. Track changes generate a new conversation plan
test("chat: track changes generate a new conversation plan", () => {
  clearChatPlanCache();
  const linesA = createDummyLines(10, 3000, "Song A line");
  const linesB = createDummyLines(14, 2500, "Song B line");

  const planA = getOrGenerateChatPlan("track_A", linesA);
  const planB = getOrGenerateChatPlan("track_B", linesB);

  assert.notEqual(planA, planB, "Different tracks must have separate plans");
  assert.equal(planA.messages.length, 10);
  assert.equal(planB.messages.length, 14);
});

// 15. Multilingual semantic emoji matching (English, Telugu, Hindi)
test("chat: multilingual contextual emoji matching across English, Telugu, and Hindi", () => {
  // English
  assert.equal(matchLyricEmoji("You broke my heart into a thousand pieces")?.emoji, "💔");
  assert.equal(matchLyricEmoji("I want you close to me, I miss you")?.emoji, "🥺");
  assert.equal(matchLyricEmoji("Tears are falling down like rain")?.emoji, "😢");
  assert.equal(matchLyricEmoji("Smile at me with sunshine in your eyes")?.emoji, "😊");
  assert.equal(matchLyricEmoji("Burning like an electric wild fire")?.emoji, "🔥");
  assert.equal(matchLyricEmoji("We danced all night to the groove")?.emoji, "💃");
  assert.equal(matchLyricEmoji("Under the moonlight and shining stars")?.emoji, "🌙");
  assert.equal(matchLyricEmoji("A single red rose in the garden")?.emoji, "🌹");
  assert.equal(matchLyricEmoji("I miss those summer nights")?.emoji, "☀️");
  assert.equal(matchLyricEmoji("You still cross my mind")?.emoji, "💭");

  // Telugu
  assert.equal(matchLyricEmoji("నా గుండె పగిలిపోయింది")?.emoji, "💔");
  assert.equal(matchLyricEmoji("నీ జ్ఞాపకం నన్ను వీడదు")?.emoji, "🫶");
  assert.equal(matchLyricEmoji("ప్రేమతో నిండిన మనసు")?.emoji, "❤️");
  assert.equal(matchLyricEmoji("వెన్నెల రాత్రి చందమామ")?.emoji, "🌙");
  assert.equal(matchLyricEmoji("మధురమైన పాట పాడు")?.emoji, "🎵");

  // Hindi
  assert.equal(matchLyricEmoji("मेरा दिल टूट गया है")?.emoji, "💔");
  assert.equal(matchLyricEmoji("तेरी याद सताती है")?.emoji, "🥺");
  assert.equal(matchLyricEmoji("सुहानी धूप खिली है")?.emoji, "☀️");
  assert.equal(matchLyricEmoji("चांद और सितारे चमके")?.emoji, "🌙");
  assert.equal(matchLyricEmoji("एक नया गीत सुनाओ")?.emoji, "🎵");
});

// 16. Line-only lyrics and word-timed lyrics handling
test("chat: handles line-only lyrics and word-timed lyrics safely", () => {
  // Line-only lyrics: all timeMs = 0
  const lineOnly: ParsedLyricLine[] = [
    { id: "1", timeMs: 0, text: "First line of unsynced lyrics", isBlank: false },
    { id: "2", timeMs: 0, text: "Second line of unsynced lyrics", isBlank: false },
    { id: "3", timeMs: 0, text: "Third line of unsynced lyrics", isBlank: false },
    { id: "4", timeMs: 0, text: "Fourth line of unsynced lyrics", isBlank: false },
    { id: "5", timeMs: 0, text: "Fifth line of unsynced lyrics", isBlank: false },
    { id: "6", timeMs: 0, text: "Sixth line of unsynced lyrics", isBlank: false },
    { id: "7", timeMs: 0, text: "Seventh line of unsynced lyrics", isBlank: false },
    { id: "8", timeMs: 0, text: "Eighth line of unsynced lyrics", isBlank: false },
    { id: "9", timeMs: 0, text: "Ninth line of unsynced lyrics", isBlank: false },
    { id: "10", timeMs: 0, text: "Tenth line of unsynced lyrics", isBlank: false },
  ];

  const lineOnlyPlan = generateChatConversationPlan("track_line_only", lineOnly);
  assert.equal(lineOnlyPlan.messages.length, 10);
  for (const m of lineOnlyPlan.messages) {
    assert.ok(m.burstLength >= 1 && m.burstLength <= 2);
  }

  // Word-timed lyrics: line with inlineWords
  const wordTimed: ParsedLyricLine[] = [
    {
      id: "w1",
      timeMs: 1000,
      text: "I remember that night",
      isBlank: false,
      inlineWords: [
        { text: "I", timeMs: 1000 },
        { text: "remember", timeMs: 1300 },
        { text: "that", timeMs: 1800 },
        { text: "night", timeMs: 2200 },
      ],
    },
    {
      id: "w2",
      timeMs: 4000,
      text: "Under the stars",
      isBlank: false,
      inlineWords: [
        { text: "Under", timeMs: 4000 },
        { text: "the", timeMs: 4400 },
        { text: "stars", timeMs: 4800 },
      ],
    },
  ];

  const wordTimedPlan = generateChatConversationPlan("track_word_timed", wordTimed);
  assert.equal(wordTimedPlan.messages.length, 2);
  assert.ok(wordTimedPlan.messages[0]!.burstLength >= 1 && wordTimedPlan.messages[0]!.burstLength <= 2);
});

// 17. Studio settings migration
test("chat: studio settings storage migrates legacy 'lens' to 'chat'", () => {
  const store = new Map<string, string>();
  const mockStorage: StorageLike = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, val),
  };

  mockStorage.setItem(
    "vynora_lyrics_studio_settings",
    JSON.stringify({ style: "lens", background: "black" }),
  );

  const loaded = loadStudioSettings(mockStorage);
  assert.equal(loaded.style, "chat", "Legacy 'lens' style must automatically migrate to 'chat'");
  assert.equal(loaded.background, "black");
});
