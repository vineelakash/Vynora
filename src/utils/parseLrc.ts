import type {
  InlineWordTiming,
  LrcMetadataTags,
  ParsedLrcDocument,
  ParsedLyricLine,
} from "../types/lyrics.ts";

const TIMESTAMP_PATTERN = /\[(\d{1,2}:)?(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const INLINE_WORD_TAG_PATTERN = /<(\d{1,2}:)?(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const METADATA_TAG_PATTERN = /^\[([a-zA-Z]{2,12}):(.*?)\]$/;

function parseTimestampMatchToMs(match: RegExpExecArray): number | null {
  const hoursPart = match[1];
  const minutesRaw = match[2];
  const secondsRaw = match[3];
  const fractionRaw = match[4];

  const hours = hoursPart ? Number.parseInt(hoursPart.slice(0, -1), 10) : 0;
  const minutes = Number.parseInt(minutesRaw, 10);
  const seconds = Number.parseInt(secondsRaw, 10);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    seconds >= 60
  ) {
    return null;
  }

  let fractionMs = 0;
  if (fractionRaw) {
    if (fractionRaw.length === 1) {
      fractionMs = Number.parseInt(fractionRaw, 10) * 100;
    } else if (fractionRaw.length === 2) {
      fractionMs = Number.parseInt(fractionRaw, 10) * 10;
    } else {
      fractionMs = Number.parseInt(fractionRaw.slice(0, 3), 10);
    }
    if (!Number.isFinite(fractionMs)) {
      return null;
    }
  }

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + fractionMs;
}

/**
 * Extracts inline karaoke word-level tags (<00:12.34>) and associated words if present.
 */
function extractInlineWordTimestamps(rawContent: string): InlineWordTiming[] | undefined {
  INLINE_WORD_TAG_PATTERN.lastIndex = 0;
  const matches: Array<{ match: RegExpExecArray; timeMs: number }> = [];
  let m: RegExpExecArray | null = null;

  while ((m = INLINE_WORD_TAG_PATTERN.exec(rawContent)) !== null) {
    const timeMs = parseTimestampMatchToMs(m);
    if (timeMs !== null) {
      matches.push({ match: m, timeMs });
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  const results: InlineWordTiming[] = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const wordStartIndex = current.match.index + current.match[0].length;
    const wordEndIndex = i + 1 < matches.length ? matches[i + 1]!.match.index : rawContent.length;
    const wordText = rawContent.slice(wordStartIndex, wordEndIndex).normalize("NFC").trim();
    if (wordText.length > 0) {
      results.push({
        text: wordText,
        timeMs: current.timeMs,
      });
    }
  }

  return results.length > 0 ? results : undefined;
}

/**
 * Removes inline karaoke word-level tags (<00:12.34>) if encountered inside an LRC line,
 * while preserving Unicode scripts (Telugu, Hindi, etc.) cleanly in NFC form.
 */
function sanitizeLyricText(rawText: string): string {
  return rawText
    .replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, "")
    .normalize("NFC")
    .trim();
}

export function parseLrc(rawInput: string | null | undefined): ParsedLrcDocument {
  const metadata: LrcMetadataTags = { offsetMs: 0 };
  if (!rawInput || rawInput.trim().length === 0) {
    return { lines: [], metadata, hasSyncedLines: false };
  }

  // Strip UTF-8 BOM if present and normalize line breaks.
  const normalizedInput = rawInput.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rawLines = normalizedInput.split("\n");

  const stagedEntries: Array<{
    timeMs: number;
    text: string;
    inlineWords?: InlineWordTiming[];
    order: number;
  }> = [];
  let orderCounter = 0;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    TIMESTAMP_PATTERN.lastIndex = 0;
    const timestamps: number[] = [];
    let lastTagEndIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = TIMESTAMP_PATTERN.exec(line)) !== null) {
      // Only treat leading or chained bracket timestamps as line timestamps;
      // stop if timestamps appear after non-whitespace prose.
      const prefixBetween = line.slice(lastTagEndIndex, match.index);
      if (prefixBetween.trim().length > 0) {
        break;
      }

      const ms = parseTimestampMatchToMs(match);
      if (ms !== null) {
        timestamps.push(ms);
      }
      lastTagEndIndex = match.index + match[0].length;
    }

    if (timestamps.length === 0) {
      const tagMatch = METADATA_TAG_PATTERN.exec(line);
      if (tagMatch) {
        const tagKey = tagMatch[1].toLowerCase();
        const tagValue = tagMatch[2].normalize("NFC").trim();
        switch (tagKey) {
          case "ti":
            metadata.title = tagValue;
            break;
          case "ar":
            metadata.artist = tagValue;
            break;
          case "al":
            metadata.album = tagValue;
            break;
          case "au":
            metadata.author = tagValue;
            break;
          case "by":
            metadata.by = tagValue;
            break;
          case "offset": {
            const parsedOffset = Number.parseInt(tagValue, 10);
            if (Number.isFinite(parsedOffset) && Math.abs(parsedOffset) <= 60_000) {
              metadata.offsetMs = parsedOffset;
            }
            break;
          }
          default:
            break;
        }
      }
      // Malformed or untimed lines inside LRC content are ignored safely.
      continue;
    }

    const rawContent = line.slice(lastTagEndIndex);
    const text = sanitizeLyricText(rawContent);
    const inlineWords = extractInlineWordTimestamps(rawContent);

    for (const timeMs of timestamps) {
      stagedEntries.push({
        timeMs,
        text,
        inlineWords,
        order: orderCounter++,
      });
    }
  }

  // LRC [offset:+/-ms]: positive offset shifts lyrics earlier; subtract cleanly clamped at >= 0.
  const lines: ParsedLyricLine[] = stagedEntries
    .map((entry, idx) => ({
      id: `line-${idx}-${entry.order}`,
      timeMs: Math.max(0, entry.timeMs - metadata.offsetMs),
      text: entry.text,
      isBlank: entry.text.length === 0,
      order: entry.order,
      inlineWords: entry.inlineWords?.map((iw) => ({
        ...iw,
        timeMs: Math.max(0, iw.timeMs - metadata.offsetMs),
      })),
    }))
    .sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : a.order - b.order))
    .map(({ id, timeMs, text, isBlank, inlineWords }) => ({
      id,
      timeMs,
      text,
      isBlank,
      ...(inlineWords && inlineWords.length > 0 ? { inlineWords } : {}),
    }));

  const hasSyncedLines = lines.some((line) => !line.isBlank);
  return { lines, metadata, hasSyncedLines };
}

export function splitPlainLyrics(rawPlain: string | null | undefined): string[] {
  if (!rawPlain) {
    return [];
  }
  return rawPlain
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.trim());
}
