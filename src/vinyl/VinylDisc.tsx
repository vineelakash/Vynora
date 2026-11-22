import type { SpotifyArtwork } from "../types/spotify";
import type { AlbumPalette } from "../types/palette";
import type { ReactiveColor } from "../utils/audioMath";

interface VinylDiscProps {
  isPlaying: boolean;
  isConnected: boolean;
  artwork: SpotifyArtwork | null;
  album: string | null;
  sizeClassName?: string;
  glowEnabled?: boolean;
  isAudioActive?: boolean;
  palette?: AlbumPalette | null;
  reactiveColor?: ReactiveColor | null;
  bass?: number;
  beat?: boolean;
}

export default function VinylDisc({
  isPlaying,
  isConnected,
  artwork,
  album,
  sizeClassName = "h-44 w-44",
  glowEnabled = false,
  isAudioActive = false,
  palette = null,
  reactiveColor = null,
  bass = 0,
  beat = false,
}: VinylDiscProps) {
  return (
    <div
      className={`relative shrink-0 select-none ${sizeClassName}`}
      aria-label={isPlaying ? "Rotating vinyl record" : "Stationary vinyl record"}
    >
      {/* Outer platter ambient drop shadow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-1 rounded-full shadow-[0_18px_36px_rgba(0,0,0,0.88)]"
      />

      {/* Audio reactive platter glow */}
      {glowEnabled && isAudioActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-2 rounded-full blur-xl transition-all duration-75"
          style={{
            backgroundColor:
              reactiveColor?.cssRgba ??
              palette?.dominantCss ??
              "rgba(255, 255, 255, 0.2)",
            opacity: 0.25 + bass * 0.55 + (beat ? 0.2 : 0),
            transform: `scale(${1 + bass * 0.1 + (beat ? 0.05 : 0)})`,
          }}
        />
      )}

      {/* GPU-composited rotating vinyl disc (never unmounts so rotation angle is preserved) */}
      <div
        data-playing={isPlaying ? "true" : "false"}
        className="vinyl-rotor relative h-full w-full overflow-hidden rounded-full border border-white/[0.11] bg-[#0a0a0d] transition-shadow duration-100"
        style={{
          boxShadow:
            glowEnabled && isAudioActive && reactiveColor
              ? reactiveColor.cssBoxShadow
              : undefined,
        }}
      >
        {/* Concentric grooves */}
        <div
          aria-hidden="true"
          className="vinyl-grooves absolute inset-0 rounded-full"
        />

        {/* Subtle micro-groove ridges */}
        <div
          aria-hidden="true"
          className="absolute inset-[7%] rounded-full border border-white/[0.04]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-[14%] rounded-full border border-white/[0.03]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-[21%] rounded-full border border-white/[0.035]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-[28%] rounded-full border border-white/[0.03]"
        />

        {/* Deadwax inner collar */}
        <div
          aria-hidden="true"
          className="absolute inset-[29.5%] rounded-full border border-black/80 bg-zinc-950/65"
        />

        {/* Central circular record label displaying album artwork */}
        <div className="absolute inset-[31%] overflow-hidden rounded-full border border-white/15 bg-zinc-900 shadow-[inset_0_0_10px_rgba(0,0,0,0.8)]">
          {artwork ? (
            <img
              src={artwork.dataUrl}
              alt={album ? `${album} vinyl label artwork` : "Vinyl label artwork"}
              draggable={false}
              className="h-full w-full object-cover transition-opacity duration-500"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-end bg-gradient-to-br from-zinc-800/90 via-zinc-900 to-zinc-950 pb-[16%] text-zinc-500">
              <span className="text-[6.5px] font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                {isConnected ? "SPOTIFY" : "VYNORA"}
              </span>
            </div>
          )}

          {/* Subtle paper label inner ring */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[14%] rounded-full border border-white/[0.08]"
          />
        </div>

        {/* Authentic center spindle hole & silver pin */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 rounded-full border border-white/25 bg-zinc-950 shadow-[0_0_0_2px_rgba(0,0,0,0.65)] flex items-center justify-center"
        >
          <div className="h-1.5 w-1.5 rounded-full bg-zinc-300/85" />
        </div>
      </div>

      {/* Static diagonal specular reflection over the grooves (anchored to room light) */}
      <div
        aria-hidden="true"
        className="vinyl-sheen pointer-events-none absolute inset-0 rounded-full"
      />
    </div>
  );
}
