/**
 * Curated offline sample tracks for the Lyrics Animation Studio.
 * Includes English, Telugu, and Hindi songs with synchronized LRC lyrics and custom palettes.
 */

import type { SampleTrack } from './animationTypes.ts';

// 1. English Pop: "Blinding Lights" - The Weeknd (Crimson / Scarlet Synthwave Palette)
const BLINDING_LIGHTS_LRC = `[00:00.00]Yeah
[00:02.50]I've been tryin' to call
[00:06.00]I've been on my own for long enough
[00:10.50]Maybe you can show me how to love, maybe
[00:15.50]I'm going through withdrawals
[00:20.00]You don't even have to do too much
[00:24.50]You can turn me on with just a touch, baby
[00:29.80]I look around and Sin City's cold and empty
[00:34.50]No one's around to judge me
[00:38.20]I can't see clearly when you're gone
[00:43.00]I said, ooh, I'm blinded by the lights
[00:49.00]No, I can't sleep until I feel your touch
[00:54.00]I said, ooh, I'm drowning in the night
[01:00.00]Oh, when I'm like this, you're the one I trust
[01:06.00]Hey, hey, hey
`;

// 2. Telugu Melody: "Vellake" - Bharatt-Saurabh (Warm Sunset Amber / Gold Palette)
const VELLAKE_LRC = `[00:00.00]వెళ్ళకే వెళ్ళకే నన్ను వదిలి
[00:04.50]ఉండలేనే పిచ్చిదానా నిన్ను వీడి
[00:09.20]గుండెలోన దాచుకున్న ప్రేమ నీది
[00:14.00]కళ్ళలోనే నిండిపోయావే చెలీ
[00:19.50]నీ నీడై నేనుంటా ప్రతి క్షణమూ
[00:24.20]నీ శ్వాసలో చేరిపోతా సుందరీ
[00:29.00]కాలమే ఆగిపోయే నీతో ఉంటే
[00:34.50]లోకమే మరచిపోతా నీ ప్రేమలో
[00:40.00]వెళ్ళకే వెళ్ళకే నన్ను వదిలి
`;

// 3. Hindi Classical / Romantic: "Kesariya" - Arijit Singh / Pritam (Vibrant Saffron / Amber / Crimson Palette)
const KESARIYA_LRC = `[00:00.00]मुझको इतना बताए कोई
[00:04.80]कैसे तुझसे दिल ना लगाए कोई
[00:10.20]रब्बा ने तुझको बनाने में
[00:14.60]कर दी है हुस्न की खाली तिजोरियां
[00:20.00]काजल की सियाही से लिखी
[00:24.50]है तूने जाने कितनों की लव स्टोरियां
[00:30.00]केसरिया तेरा इश्क है पिया
[00:35.80]रंग जाऊं जो मैं हाथ लगाऊं
[00:40.50]दिन बीते सारा तेरी फिक्र में
[00:45.50]रैन सारी तेरी खैर मनाऊं
[00:51.00]केसरिया तेरा इश्क है पिया
`;

// Lightweight SVG gradient covers encoded as data URLs
function createCoverDataUrl(colorA: string, colorB: string, title: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="${colorA}" />
        <stop offset="100%" stop-color="${colorB}" />
      </radialGradient>
    </defs>
    <rect width="300" height="300" fill="url(#g)" />
    <circle cx="150" cy="150" r="80" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
    <circle cx="150" cy="150" r="30" fill="rgba(0,0,0,0.4)" />
    <text x="150" y="270" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-weight="700" font-size="14" opacity="0.8">${title}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const SAMPLE_TRACKS: SampleTrack[] = [
  {
    id: 'sample-blinding-lights',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    language: 'English',
    lrc: BLINDING_LIGHTS_LRC,
    durationMs: 70000,
    palette: {
      trackKey: 'sample::blinding-lights',
      dominant: { r: 220, g: 38, b: 38 },
      secondary: { r: 185, g: 28, b: 28 },
      accent: { r: 248, g: 113, b: 113 },
      background: { r: 12, g: 8, b: 10 },
      foreground: { r: 255, g: 255, b: 255 },
      dominantCss: 'rgb(220, 38, 38)',
      secondaryCss: 'rgb(185, 28, 28)',
      accentCss: 'rgb(248, 113, 113)',
      backgroundCss: 'rgb(12, 8, 10)',
      foregroundCss: 'rgb(255, 255, 255)',
      isMonochrome: false,
    },
    artworkDataUrl: createCoverDataUrl('#dc2626', '#450a0a', 'BLINDING LIGHTS'),
  },
  {
    id: 'sample-vellake',
    title: 'Vellake (వెళ్ళకే)',
    artist: 'Bharatt-Saurabh',
    album: 'Vellake',
    language: 'Telugu',
    lrc: VELLAKE_LRC,
    durationMs: 46000,
    palette: {
      trackKey: 'sample::vellake',
      dominant: { r: 217, g: 119, b: 6 },
      secondary: { r: 180, g: 83, b: 9 },
      accent: { r: 251, g: 191, b: 36 },
      background: { r: 14, g: 11, b: 7 },
      foreground: { r: 255, g: 255, b: 255 },
      dominantCss: 'rgb(217, 119, 6)',
      secondaryCss: 'rgb(180, 83, 9)',
      accentCss: 'rgb(251, 191, 36)',
      backgroundCss: 'rgb(14, 11, 7)',
      foregroundCss: 'rgb(255, 255, 255)',
      isMonochrome: false,
    },
    artworkDataUrl: createCoverDataUrl('#d97706', '#451a03', 'VELLAKE'),
  },
  {
    id: 'sample-kesariya',
    title: 'Kesariya (केसरिया)',
    artist: 'Arijit Singh, Pritam',
    album: 'Brahmastra',
    language: 'Hindi',
    lrc: KESARIYA_LRC,
    durationMs: 58000,
    palette: {
      trackKey: 'sample::kesariya',
      dominant: { r: 234, g: 88, b: 12 },
      secondary: { r: 194, g: 65, b: 12 },
      accent: { r: 253, g: 186, b: 116 },
      background: { r: 15, g: 9, b: 8 },
      foreground: { r: 255, g: 255, b: 255 },
      dominantCss: 'rgb(234, 88, 12)',
      secondaryCss: 'rgb(194, 65, 12)',
      accentCss: 'rgb(253, 186, 116)',
      backgroundCss: 'rgb(15, 9, 8)',
      foregroundCss: 'rgb(255, 255, 255)',
      isMonochrome: false,
    },
    artworkDataUrl: createCoverDataUrl('#ea580c', '#431407', 'KESARIYA'),
  },
];
