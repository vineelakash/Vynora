import { useCallback, useEffect, useRef, useState } from "react";

const INTRO_STORAGE_KEY = "vynora_intro_played";
const SAFETY_TIMEOUT_MS = 4200;
const FADE_DURATION_MS = 650;
const FALLBACK_DISPLAY_MS = 1200;

export function StartupIntroOverlay() {
  const [shouldRender, setShouldRender] = useState(() => {
    try {
      return sessionStorage.getItem(INTRO_STORAGE_KEY) !== "true";
    } catch {
      return true;
    }
  });

  const [isFading, setIsFading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const completedRef = useRef(false);

  const handleFinish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    try {
      sessionStorage.setItem(INTRO_STORAGE_KEY, "true");
    } catch {
      // sessionStorage might be restricted in some sandboxes
    }

    setIsFading(true);
    setTimeout(() => {
      setShouldRender(false);
    }, FADE_DURATION_MS);
  }, []);

  const handleError = useCallback(() => {
    console.warn("[vynora::intro] Video playback error, displaying logo fallback.");
    setHasError(true);
    setTimeout(() => {
      handleFinish();
    }, FALLBACK_DISPLAY_MS);
  }, [handleFinish]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || completedRef.current) return;
    // When video is within 100ms of end, initiate smooth crossfade transition
    if (v.duration > 0 && v.currentTime >= v.duration - 0.10) {
      handleFinish();
    }
  }, [handleFinish]);

  useEffect(() => {
    if (!shouldRender) return;

    // Safety timeout ensures user is never stuck on a black screen
    const safetyTimer = setTimeout(() => {
      if (!completedRef.current) {
        console.warn("[vynora::intro] Intro reached safety timeout; transitioning to app.");
        handleFinish();
      }
    }, SAFETY_TIMEOUT_MS);

    // Ensure video attempts autoplay
    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.play().catch((err) => {
        console.warn("[vynora::intro] Autoplay rejected:", err);
        handleError();
      });
    }

    return () => {
      clearTimeout(safetyTimer);
    };
  }, [shouldRender, handleFinish, handleError]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      aria-label="VYNORA Startup Animation"
      aria-hidden={isFading}
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black transition-opacity ease-out select-none ${
        isFading ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${FADE_DURATION_MS}ms` }}
    >
      {hasError ? (
        <div className="flex flex-col items-center justify-center gap-4 animate-fade-in">
          <div className="h-28 w-28 overflow-hidden rounded-2xl border border-[#292638] bg-black p-2 shadow-2xl shadow-[#8650FF]/20">
            <img
              src="/vynora-logo.png"
              alt="VYNORA Logo"
              className="h-full w-full object-contain animate-pulse"
            />
          </div>
          <span className="text-xs font-semibold tracking-widest text-[#F5F3FA] uppercase">
            VYNORA
          </span>
        </div>
      ) : (
        <video
          ref={videoRef}
          src="/vynora-intro.mp4"
          autoPlay
          muted
          playsInline
          controls={false}
          disablePictureInPicture
          preload="auto"
          onPlaying={() => setIsVideoReady(true)}
          onCanPlayThrough={() => setIsVideoReady(true)}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleFinish}
          onError={handleError}
          className={`h-full w-full object-contain pointer-events-none transition-opacity duration-200 ${
            isVideoReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
