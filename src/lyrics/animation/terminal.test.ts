import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTerminalLine,
  computeTerminalTokens,
  splitGraphemes,
  TERMINAL_PATTERNS,
} from './styles/terminalFormatter.ts';
import type { TimedWord } from './animationTypes.ts';

test('terminal: preserves original lyric text 100% without modification', () => {
  const originalEnglish = "Ooh, I've been tryin' to call";
  const formatted = formatTerminalLine(originalEnglish, 0);

  assert.equal(formatted.body, originalEnglish);
  assert.equal(formatted.lineNum, '01');
});

test('terminal: strictly NEVER introduces forbidden programming keywords', () => {
  const forbiddenKeywords = [
    'const', 'let', 'var', 'return', 'function', 'array', 'class',
    'import', 'export', 'if', 'else', 'async', 'await', 'switch',
    'case', 'break', 'default', 'new', 'typeof', 'void', 'delete',
  ];

  for (let i = 0; i < 30; i++) {
    const formatted = formatTerminalLine('Test Lyric Line', i);
    const fullRender = `${formatted.lineNum} ${formatted.indent}${formatted.prefix}${formatted.body}${formatted.suffix}`;

    for (const kw of forbiddenKeywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      assert.ok(
        !regex.test(formatted.prefix) && !regex.test(formatted.suffix),
        `Line ${i} should not contain programming keyword '${kw}' in formatting`,
      );
    }
  }
});

test('terminal: formats line numbers and patterns deterministically', () => {
  const line0 = formatTerminalLine('First line', 0);
  const line1 = formatTerminalLine('Second line', 1);
  const line2 = formatTerminalLine('Third line', 2);

  assert.equal(line0.lineNum, '01');
  assert.equal(line1.lineNum, '02');
  assert.equal(line2.lineNum, '03');

  // Verify pattern alternation and indentation
  assert.equal(line0.indent, '  ');
  assert.equal(line1.indent, '    ');
  assert.equal(line0.prefix, '[ ');
  assert.equal(line1.prefix, '{ ');
  assert.equal(line2.prefix, '"');
});

test('terminal: Unicode grapheme clustering preserves Telugu viramas and matras', () => {
  const teluguText = 'వెళ్ళకే నన్ను వదిలి';
  const graphemes = splitGraphemes(teluguText);

  // 'వె' is 1 grapheme, 'ళ్ళ' is 1 grapheme, 'కే' is 1 grapheme
  assert.ok(graphemes.length < teluguText.length);
  assert.ok(graphemes.includes('ళ్ళ'), 'Must preserve compound conjunct ళ్ళ intact');
  assert.ok(graphemes.includes('కే'), 'Must preserve consonant with matra కే intact');

  const formatted = formatTerminalLine(teluguText, 4);
  assert.equal(formatted.body, teluguText);

  // Progressive typing should never slice inside compound grapheme
  const partial = computeTerminalTokens(formatted, 0.3);
  assert.ok(teluguText.startsWith(partial.revealedBody));
});

test('terminal: Unicode grapheme clustering preserves Hindi Devanagari conjuncts', () => {
  const hindiText = 'केसरिया तेरा इश्क है पिया';
  const graphemes = splitGraphemes(hindiText);

  assert.ok(graphemes.includes('के'), 'Must preserve consonant with vowel matra के intact');
  assert.ok(graphemes.includes('रि') || graphemes.includes('रिया'), 'Must preserve vowel matra intact');

  const formatted = formatTerminalLine(hindiText, 1);
  assert.equal(formatted.body, hindiText);

  const tokens = computeTerminalTokens(formatted, 0.5);
  assert.ok(hindiText.startsWith(tokens.revealedBody));
});

test('terminal: typing progression reveals characters and suffix upon completion', () => {
  const line = formatTerminalLine('Singing in the rain', 0); // pattern 0 has suffix '... ]'

  // At 0% progress: 0 body characters revealed, no suffix
  const tokensStart = computeTerminalTokens(line, 0.0);
  assert.equal(tokensStart.revealedBody, '');
  assert.equal(tokensStart.suffix, '');
  assert.equal(tokensStart.isCompleted, false);

  // At 50% progress: roughly half revealed, no suffix yet
  const tokensMid = computeTerminalTokens(line, 0.45);
  assert.ok(tokensMid.revealedGraphemes > 0);
  assert.ok(tokensMid.revealedGraphemes < tokensMid.totalGraphemes);
  assert.equal(tokensMid.suffix, '');
  assert.equal(tokensMid.isCompleted, false);

  // At 100% progress: full body revealed, suffix appears
  const tokensDone = computeTerminalTokens(line, 1.0);
  assert.equal(tokensDone.revealedBody, 'Singing in the rain');
  assert.equal(tokensDone.suffix, '... ]');
  assert.equal(tokensDone.isCompleted, true);
});

test('terminal: word-synchronized typing follows active word progress', () => {
  const line = formatTerminalLine('Love is blind', 1); // pattern 1: "{ ...; }"
  const words: TimedWord[] = [
    { id: 'w0', text: 'Love', startMs: 1000, endMs: 1400, durationMs: 400, index: 0, lineIndex: 1 },
    { id: 'w1', text: 'is', startMs: 1400, endMs: 1700, durationMs: 300, index: 1, lineIndex: 1 },
    { id: 'w2', text: 'blind', startMs: 1700, endMs: 2200, durationMs: 500, index: 2, lineIndex: 1 },
  ];

  // While on word 0 halfway
  const t0 = computeTerminalTokens(line, 0.2, words, 0, 0.5);
  assert.ok(t0.revealedBody.startsWith('Lo') || t0.revealedBody.startsWith('Lov'));

  // When on word 1 partially typed
  const t1 = computeTerminalTokens(line, 0.5, words, 1, 0.5);
  assert.ok(t1.revealedBody.startsWith('Love i'));

  // When word 1 is fully typed
  const t1Full = computeTerminalTokens(line, 0.6, words, 1, 1.0);
  assert.ok(t1Full.revealedBody.startsWith('Love is'));

  // Preceding completed line
  const tCompleted = computeTerminalTokens(line, 0, undefined, -1, 0, true);
  assert.equal(tCompleted.revealedBody, 'Love is blind');
  assert.equal(tCompleted.suffix, '; }');
  assert.equal(tCompleted.isCompleted, true);
});
