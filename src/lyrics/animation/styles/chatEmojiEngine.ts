/**
 * Contextual Emoji System for VYNORA Chat Style.
 *
 * Evaluates the semantic and emotional context of song lyrics across English,
 * Telugu, and Hindi, assigning natural emojis at an engaging cadence of approximately
 * one emoji per conversational exchange.
 *
 * Rules:
 * - 100% original lyric words are preserved without modification.
 * - Emojis appear approximately once per conversational exchange.
 * - Do not add emojis to every individual message.
 * - Contextual relevance strictly required: no random emoji insertion.
 * - Never repeats the same emoji consecutively.
 * - Selected emoji is placed at the end of the concluding thought of the exchange.
 */

import type { ChatPlannedMessage } from './chatConversationPlanner.ts';

export interface EmojiRule {
  id: string;
  emoji: string;
  patterns: RegExp[];
}

export const EMOJI_DICTIONARY: EmojiRule[] = [
  // Summer / Sunshine / Bright Day
  {
    id: 'summer',
    emoji: '☀️',
    patterns: [
      /\b(?:summer|bright\s+day|morning|sunrise|daylight|warm\s+day|golden\s+sun)\b/i,
      /ఎండ/u, /పగలు/u, /ఉదయం/u, /సూర్యు/u,       // Telugu: sunshine, daytime, morning, sun
      /धूप/u, /सूरज/u, /सुबह/u, /गर्मी/u,         // Hindi: sunshine, sun, morning, summer
    ],
  },
  // Thinking / Mind / Reflections / Conversation
  {
    id: 'thinking',
    emoji: '💭',
    patterns: [
      /\b(?:cross\s+my\s+mind|on\s+my\s+mind|think(?:ing)?|thought|wonder(?:ing)?|ponder|reflect|i\s+know\s+what\s+you\s+mean|say\s+anything|tell\s+me|hear\s+your\s+voice|in\s+my\s+head)\b/i,
      /ఆలోచన/u, /మనసులో/u, /మాట/u,               // Telugu: thinking, in my mind, word/talking
      /सोच/u, /ख्याल/u, /विचार/u, /बात/u,          // Hindi: think, thought, reflection, talk
    ],
  },
  // Heartbreak / Pain
  {
    id: 'heartbreak',
    emoji: '💔',
    patterns: [
      /\b(?:broke|broken|break\s+my\s+heart|heartbreak|heartbroken|tearing\s+me|torn|shattered|scars?|hurts?|hurting|pain|bleed|goodbye|over\s+now|fall\s+apart)\b/i,
      /గుండె\s*పగిలి/u, /విరిగి/u, /బాధ/u, /వీడ్కోలు/u, // Telugu: broken heart, broken, pain, farewell
      /दिल\s*टूट/u, /दर्द/u, /अलविदा/u, /बिछड़/u,     // Hindi: broken heart, pain, goodbye, parting
    ],
  },
  // Longing / Missing someone
  {
    id: 'missing',
    emoji: '🥺',
    patterns: [
      /\b(?:miss(?:ing)?\s+(?:you|your)|wish\s+we\s+could\s+go\s+back|wish\s+you\s+were|wish\s+i\s+could|need\s+you|want\s+you\s+(?:close|near|back)|where\s+are\s+you|far\s+away|call(?:ing)?\s+you|lonely|alone|come\s+back|stay\s+with\s+me|leave\s+me)\b/i,
      /గుర్తు/u, /దూరం/u, /కావాలి/u, /రావా/u, /వేచే/u, /నీ\s*కోసం/u, // Telugu: remember/miss, distance, need, come, waiting, for you
      /याद/u, /दूरी/u, /कमी/u, /पास\s*आओ/u, /काश/u, /इंतज़ार/u, /तेरे\s*बिना/u, // Hindi: memory/miss, distance, absence, come close, wish, waiting, without you
    ],
  },
  // Crying / Tears
  {
    id: 'crying',
    emoji: '😢',
    patterns: [
      /\b(?:crying|cry|tears?|weep(?:ing)?|rain\s+falling|sob(?:bing)?|drowning|drown)\b/i,
      /కన్నీరు/u, /ఏడ్వ/u,               // Telugu: tears, crying
      /आंसू/u, /रोना/u, /रो\s*रहा/u,        // Hindi: tears, crying
    ],
  },
  // Sadness / Melancholy
  {
    id: 'sadness',
    emoji: '😔',
    patterns: [
      /\b(?:sad|sorrow|depressed|empty|gloom|fade\s+away|lost|hopeless|heavy\s+heart|silence|darkness)\b/i,
      /దిగులు/u, /చీకటి/u,                 // Telugu: sadness, darkness
      /उदास/u, /अंधेरा/u, /मायूस/u,         // Hindi: sad, darkness, disappointed
    ],
  },
  // Heart / Love / Forever
  {
    id: 'love',
    emoji: '❤️',
    patterns: [
      /\b(?:love\s+you|in\s+love|my\s+heart|fall\s+in\s+love|adore|forever|always\s+yours|my\s+baby|my\s+darling|sweetheart|sweet\s+love|more\s+often\s+than\s+you\s+think|you\s+think|special|you\s+and\s+me|together|true\s+love)\b/i,
      /ప్రేమ/u, /నా\s*ప్రాణం/u, /మనసు/u, /హృదయం/u, /వలపు/u, /ప్రియ/u,   // Telugu: love, my life/soul, heart, affection, beloved
      /प्यार/u, /मोहब्बत/u, /इश्क/u, /दिल/u, /जान/u, /सनम/u, /हमसफ़र/u, // Hindi: love, affection, passion, heart, soul, beloved, companion
    ],
  },
  // Romance / Warmth / Affection
  {
    id: 'romance',
    emoji: '🥰',
    patterns: [
      /\b(?:kiss|kissing|embrace|hug|hold\s+(?:me|you)|warmth|tender|softly|whisper|sweet|precious|cherish|holding\s+hands)\b/i,
      /ముద్దు/u, /కౌగిలి/u, /చేయి/u,        // Telugu: kiss, hug, hand
      /चूम/u, /गले/u, /प्यारा/u,           // Hindi: kiss, embrace, lovely
    ],
  },
  // Happiness / Joy / Smile
  {
    id: 'joy',
    emoji: '😊',
    patterns: [
      /\b(?:smile|smiling|laugh(?:ing)?|happy|happiness|joy|bright|sunny|glad|good\s+time|beautiful\s+day|sunshine)\b/i,
      /నవ్వు/u, /సంతోషం/u, /వెలుగు/u, /ఆనందం/u, // Telugu: smile, happiness, light, bliss
      /हंसी/u, /मुस्कान/u, /खुशी/u, /सुंदर/u, /मुस्कुरा/u, // Hindi: laugh, smile, happiness, beautiful, smile
    ],
  },
  // Fire / Passion / Burning
  {
    id: 'fire',
    emoji: '🔥',
    patterns: [
      /\b(?:fire|burn(?:ing)?|flames?|ignite|hot|passion|fever|electric|heat|wild|power|blaze|alive)\b/i,
      /నిప్పు/u, /మంట/u, /జ్వాల/u,          // Telugu: fire, blaze, flame
      /आग/u, /शोला/u, /जलन/u, /धड़कन/u,     // Hindi: fire, flame, burning, heartbeat
    ],
  },
  // Dancing / Movement / Rhythm
  {
    id: 'dancing',
    emoji: '💃',
    patterns: [
      /\b(?:dance|dancing|groove|rhythm|move\s+your\s+body)\b/i,
      /నాట్యం/u, /ఆట/u,                   // Telugu: dance, play
      /नाच/u, /डांस/u, /झूम/u,              // Hindi: dance, dance, sway
    ],
  },
  // Celebration / Party
  {
    id: 'celebration',
    emoji: '🎉',
    patterns: [
      /\b(?:party|celebrat(?:e|ing)|cheers|raise\s+your\s+glass|tonight\s+we\s+live|good\s+vibes)\b/i,
      /వేడుక/u, /పండుగ/u,                 // Telugu: celebration, festival
      /जश्न/u, /पार्टी/u, /धमाल/u,          // Hindi: celebration, party, fun
    ],
  },
  // Stars / Night / Moon
  {
    id: 'night',
    emoji: '🌙',
    patterns: [
      /\b(?:stars?|moon(?:light)?|night|midnight|dark\s+sky|starlight|galaxy|universe|better\s+left\s+there|tonight|late\s+night)\b/i,
      /రాత్రి/u, /చంద్రు/u, /చుక్క/u, /వెన్నెల/u, /చందమామ/u, // Telugu: night, moon, star, moonlight
      /रात/u, /चांद/u, /तारे/u, /सितारे/u, /चांदनी/u,   // Hindi: night, moon, stars, moonlight
    ],
  },
  // Dreams / Magic / Sparkle / Special Moments
  {
    id: 'magic',
    emoji: '✨',
    patterns: [
      /\b(?:magic|dream(?:ing|s)?|sparkle|glitter|glow(?:ing)?|gleam|shine|shining|eyes\s+shine|miracle|wonder|special\s+moments?|stay\s+with\s+you|everything\s+changes|something\s+special|spark)\b/i,
      /కల/u, /మాయ/u, /వింత/u, /మెరుపు/u,   // Telugu: dream, magic, wonder, sparkle
      /सपना/u, /ख्वाब/u, /जादू/u, /रोशनी/u, /चमक/u, // Hindi: dream, vision, magic, light, glow
    ],
  },
  // Music / Melody / Song
  {
    id: 'music',
    emoji: '🎵',
    patterns: [
      /\b(?:song|sing(?:ing)?|melody|tune|notes?|soundtrack|radio|guitar|piano|chords?|rhythm|harmony)\b/i,
      /పాట/u, /సంగీతం/u, /స్వరం/u, /రాగం/u,  // Telugu: song, music, note, melody
      /गाना/u, /गीत/u, /सुर/u, /संगीत/u, /तराना/u, // Hindi: song, lyrics/song, tune, music
    ],
  },
  // Hope / Peace / Freedom
  {
    id: 'hope',
    emoji: '🕊️',
    patterns: [
      /\b(?:hope|peace|free(?:dom)?|fly(?:ing)?|wings|calm|breathe|heaven|angel|serenity|healing)\b/i,
      /శాంతి/u, /ఆశ/u, /స్వేచ్ఛ/u,           // Telugu: peace, hope, freedom
      /शांति/u, /उम्मीद/u, /आज़ाद/u, /सुकून/u, // Hindi: peace, hope, free, tranquility
    ],
  },
  // Flowers / Beauty / Bloom
  {
    id: 'flowers',
    emoji: '🌹',
    patterns: [
      /\b(?:rose|roses|flowers?|bloom(?:ing)?|garden|petals?)\b/i,
      /పువ్వు/u, /గులాబీ/u,                 // Telugu: flower, rose
      /फूल/u, /गुलाब/u,                   // Hindi: flower, rose
    ],
  },
  // Memories / Holding hands / Connection
  {
    id: 'memories',
    emoji: '🫶',
    patterns: [
      /\b(?:memories|remember|cherish|hold\s+my\s+hand|together|you\s+and\s+i|side\s+by\s+side|we\s+had)\b/i,
      /జ్ఞాపకం/u, /తోడుగా/u,                // Telugu: memory, companion
      /यादें/u, /साथी/u,                   // Hindi: memories, companion
    ],
  },
  // Loneliness / Dark
  {
    id: 'lonely',
    emoji: '🖤',
    patterns: [
      /\b(?:cold|black|shadows?|ghosts?|ice|frozen|alone\s+in\s+the\s+dark)\b/i,
      /చలి/u, /నీడ/u,                      // Telugu: cold, shadow
      /साया/u, /ठंड/u, /काली/u,             // Hindi: shadow, cold, dark
    ],
  },
  // Ocean / Waves / Rain
  {
    id: 'ocean',
    emoji: '🌊',
    patterns: [
      /\b(?:ocean|waves?|sea|river|water|flow(?:ing)?|rain(?:fall)?|storm|drift(?:ing)?)\b/i,
      /సముద్రం/u, /అలలు/u, /వాన/u,          // Telugu: ocean, waves, rain
      /समंदर/u, /लहरें/u, /बारिश/u,          // Hindi: ocean, waves, rain
    ],
  },
  // Eyes / Gazing / Vision
  {
    id: 'eyes',
    emoji: '👀',
    patterns: [
      /\b(?:look\s+at\s+you|look\s+into\s+my\s+eyes|see\s+you|watching|stare|vision|gaze)\b/i,
      /కన్నులు/u, /చూపు/u, /చూడు/u,         // Telugu: eyes, glance, look
      /आंखें/u, /नज़र/u, /देख/u,             // Hindi: eyes, sight, look
    ],
  },
];

/**
 * Conversational sentiment cues for exchanges that don't trigger explicit dictionary words.
 */
const CONVERSATIONAL_CUES: EmojiRule[] = [
  // Thoughtful question / reflection
  {
    id: 'conv_reflection',
    emoji: '💭',
    patterns: [
      /\?|\b(?:why|how|what|where|who|when|if|maybe)\b/i,
      /ఎందుకు/u, /ఎలా/u, /ఏమిటి/u, /ఎక్కడ/u,
      /क्यों/u, /कैसे/u, /क्या/u, /कहाँ/u,
    ],
  },
  // Personal connection / dialogue
  {
    id: 'conv_connection',
    emoji: '✨',
    patterns: [
      /\b(?:you|we|us|me|i)\b/i,
      /నువ్వు/u, /నేను/u, /మనము/u,
      /तुम/u, /हम/u, /तू/u,
    ],
  },
  // Energy / exclamation
  {
    id: 'conv_energy',
    emoji: '🔥',
    patterns: [
      /!|\b(?:yeah|yes|oh|hey|alright)\b/i,
    ],
  },
];

/**
 * Evaluates a single lyric line against semantic context rules.
 * If excludeEmoji is provided, prefers an alternative matching rule to maintain variety.
 */
export function matchLyricEmoji(text: string, excludeEmoji?: string): EmojiRule | null {
  if (!text || !text.trim()) return null;
  let fallback: EmojiRule | null = null;

  for (const rule of EMOJI_DICTIONARY) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        if (!excludeEmoji || rule.emoji !== excludeEmoji) {
          return rule;
        }
        if (!fallback) fallback = rule;
      }
    }
  }

  return fallback;
}

/**
 * Evaluates conversational cues as a fallback for exchanges without explicit dictionary hits.
 */
export function matchConversationalEmoji(text: string, excludeEmoji?: string): EmojiRule | null {
  if (!text || !text.trim()) return null;
  let fallback: EmojiRule | null = null;

  for (const cue of CONVERSATIONAL_CUES) {
    for (const pattern of cue.patterns) {
      if (pattern.test(text)) {
        if (!excludeEmoji || cue.emoji !== excludeEmoji) {
          return cue;
        }
        if (!fallback) fallback = cue;
      }
    }
  }

  // General lyrical atmosphere fallback if needed
  if (!excludeEmoji || excludeEmoji !== '✨') {
    return { id: 'conv_sparkle', emoji: '✨', patterns: [] };
  }
  return fallback ?? { id: 'conv_music', emoji: '🎵', patterns: [] };
}

/**
 * Assigns contextual emojis across planned chat messages.
 * Targets approximately one emoji per conversational exchange, ensures contextual relevance,
 * and avoids consecutive duplicate emojis without forcing emojis into every individual message.
 */
export function assignContextualEmojis(messages: ChatPlannedMessage[]): void {
  if (!messages.length) return;

  // Group messages by their conversation exchange (groupId)
  const exchangeMap = new Map<number, ChatPlannedMessage[]>();
  for (const msg of messages) {
    const list = exchangeMap.get(msg.groupId) ?? [];
    list.push(msg);
    exchangeMap.set(msg.groupId, list);
  }

  let lastAssignedEmoji = '';
  let exchangeIndex = 0;

  for (const [_groupId, burstMsgs] of exchangeMap.entries()) {
    // 1. Find candidate message in this exchange matching semantic emoji dictionary
    let bestMsg: ChatPlannedMessage | null = null;
    let bestRule: EmojiRule | null = null;

    // Check concluding message first (concluding thought is most natural for emoji), then earlier messages
    for (let i = burstMsgs.length - 1; i >= 0; i--) {
      const msg = burstMsgs[i]!;
      const match = matchLyricEmoji(msg.text, lastAssignedEmoji);
      if (match && match.emoji !== lastAssignedEmoji) {
        bestMsg = msg;
        bestRule = match;
        break;
      }
    }

    // 2. If no rule matched without exclusion, try without exclusion if it's the only hit
    if (!bestRule) {
      for (let i = burstMsgs.length - 1; i >= 0; i--) {
        const msg = burstMsgs[i]!;
        const match = matchLyricEmoji(msg.text);
        if (match && match.emoji !== lastAssignedEmoji) {
          bestMsg = msg;
          bestRule = match;
          break;
        }
      }
    }

    // 3. Fallback: If no dictionary match was found, use conversational cue for the exchange
    if (!bestRule && burstMsgs.length > 0) {
      const concludingMsg = burstMsgs[burstMsgs.length - 1]!;
      const cueMatch = matchConversationalEmoji(concludingMsg.text, lastAssignedEmoji);
      if (cueMatch && cueMatch.emoji !== lastAssignedEmoji) {
        bestMsg = concludingMsg;
        bestRule = cueMatch;
      }
    }

    // 4. Assign emoji to the chosen message (at most 1 emoji per exchange)
    if (bestMsg && bestRule) {
      bestMsg.emoji = bestRule.emoji;
      bestMsg.emojiPlacement = 'inline';
      lastAssignedEmoji = bestRule.emoji;
    }

    exchangeIndex++;
  }
}
