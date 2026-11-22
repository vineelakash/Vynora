export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface AlbumPalette {
  trackKey: string;
  dominant: RgbColor;
  secondary: RgbColor;
  accent: RgbColor;
  background: RgbColor;
  foreground: RgbColor;
  isMonochrome: boolean;
  dominantCss: string;
  secondaryCss: string;
  accentCss: string;
  backgroundCss: string;
  foregroundCss: string;
}

export const DEFAULT_NEUTRAL_PALETTE: AlbumPalette = {
  trackKey: "idle::neutral",
  dominant: { r: 160, g: 165, b: 180 }, // Cool silver/slate
  secondary: { r: 100, g: 105, b: 120 }, // Charcoal
  accent: { r: 215, g: 220, b: 235 }, // Pale ash
  background: { r: 15, g: 16, b: 20 }, // Obsidian
  foreground: { r: 245, g: 245, b: 250 },
  isMonochrome: true,
  dominantCss: "rgb(160, 165, 180)",
  secondaryCss: "rgb(100, 105, 120)",
  accentCss: "rgb(215, 220, 235)",
  backgroundCss: "rgb(15, 16, 20)",
  foregroundCss: "rgb(245, 245, 250)",
};

export const MONOCHROME_PALETTE: AlbumPalette = {
  trackKey: "theme::monochrome",
  dominant: { r: 210, g: 210, b: 215 }, // Clean silver
  secondary: { r: 125, g: 125, b: 130 }, // Muted graphite
  accent: { r: 255, g: 255, b: 255 }, // Pure white
  background: { r: 14, g: 14, b: 16 }, // Deep neutral obsidian
  foreground: { r: 250, g: 250, b: 250 },
  isMonochrome: true,
  dominantCss: "rgb(210, 210, 215)",
  secondaryCss: "rgb(125, 125, 130)",
  accentCss: "rgb(255, 255, 255)",
  backgroundCss: "rgb(14, 14, 16)",
  foregroundCss: "rgb(250, 250, 250)",
};

export function rgbToCss(c: RgbColor, alpha?: number): string {
  if (alpha !== undefined) {
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha.toFixed(3)})`;
  }
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}
