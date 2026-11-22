import type { VinylUiState } from "../types/vinyl";

interface VinylControlsProps {
  vinylState: VinylUiState;
  busy?: boolean;
  error?: string | null;
  onShow: () => void;
  onHide: () => void;
  onToggleExpanded: () => void;
  onToggleAlwaysOnTop: () => void;
  onResetPosition: () => void;
}

export default function VinylControls({
  vinylState,
  busy = false,
  error = null,
  onShow,
  onHide,
  onToggleExpanded,
  onToggleAlwaysOnTop,
  onResetPosition,
}: VinylControlsProps) {
  const statusText = vinylState.visible
    ? `${vinylState.expanded ? "Expanded" : "Compact"} desktop widget${vinylState.alwaysOnTop ? " · Always on top" : ""}`
    : "Hidden from desktop (Spotify monitor active)";

  return (
    <section
      aria-labelledby="vinyl-heading"
      className="flex h-full flex-col justify-between rounded-xl border border-[#292638] bg-[#0B0B13]/80 p-3.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="vinyl-heading" className="text-[13px] font-semibold text-[#F5F3FA]">
            Desktop Vinyl
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-[#A6A2B3]" title={statusText}>
            {statusText}
          </p>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            vinylState.visible
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-[#292638] bg-[#07070D] text-[#A6A2B3]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              vinylState.visible ? "bg-emerald-400" : "bg-zinc-600"
            }`}
          />
          {vinylState.visible ? "Visible" : "Hidden"}
        </span>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={vinylState.visible ? onHide : onShow}
          className={`inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border px-3 text-xs font-medium transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-50 ${
            vinylState.visible
              ? "border-[#292638] bg-[#12121D] text-[#F5F3FA] hover:border-[#8650FF]/40 hover:bg-[#1A192B]"
              : "border-transparent bg-[#8650FF] text-white shadow-sm shadow-[#8650FF]/25 hover:bg-[#7843F0]"
          }`}
        >
          {vinylState.visible ? "Hide Vinyl" : "Open Vinyl"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onToggleExpanded}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#292638] bg-[#12121D] px-2.5 text-xs font-medium text-[#A6A2B3] transition hover:border-[#8650FF]/40 hover:bg-[#1A192B] hover:text-[#F5F3FA] active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
        >
          {vinylState.expanded ? "Compact" : "Expanded"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onToggleAlwaysOnTop}
          aria-pressed={vinylState.alwaysOnTop}
          className={`inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border px-2.5 text-xs font-medium transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-50 ${
            vinylState.alwaysOnTop
              ? "border-[#8650FF]/50 bg-[#161626] text-[#F5F3FA]"
              : "border-[#292638] bg-[#0B0B13] text-[#A6A2B3] hover:border-[#8650FF]/40 hover:text-[#F5F3FA]"
          }`}
        >
          {vinylState.alwaysOnTop ? "Pinned Top" : "Pin on Top"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onResetPosition}
          className="ml-auto inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#292638] bg-[#07070D] px-2.5 text-[11px] font-medium text-[#A6A2B3] transition hover:border-[#8650FF]/40 hover:text-[#F5F3FA] active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
        >
          Reset Pos
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs leading-relaxed text-rose-200"
        >
          {error}
        </p>
      )}
    </section>
  );
}
