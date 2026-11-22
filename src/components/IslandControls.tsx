import type { DisplayInfo, IslandUiState } from "../types/island";

interface IslandControlsProps {
  islandState: IslandUiState;
  displays: DisplayInfo[];
  busy?: boolean;
  error?: string | null;
  onShow: () => void;
  onHide: () => void;
  onSelectDisplay: (displayIndex: number) => void;
  onSelectFollowPrimary: () => void;
}

export default function IslandControls({
  islandState,
  displays,
  busy = false,
  error = null,
  onShow,
  onHide,
  onSelectDisplay,
  onSelectFollowPrimary,
}: IslandControlsProps) {
  const showLabel = islandState.spotifyActive ? "Reopen Island" : "Show Island";
  const primaryDisplay = displays.find((d) => d.isPrimary);

  const statusText = islandState.visible
    ? "Floating overlay active at top center"
    : islandState.spotifyActive && islandState.userHidden
      ? "Hidden while Spotify session remains active"
      : "Appears automatically when Spotify plays";

  return (
    <section
      aria-labelledby="island-heading"
      className="flex h-full flex-col justify-between rounded-xl border border-[#292638] bg-[#0B0B13]/80 p-3.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="island-heading" className="text-[13px] font-semibold text-[#F5F3FA]">
            Dynamic Island
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-[#A6A2B3]" title={statusText}>
            {statusText}
          </p>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            islandState.visible
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-[#292638] bg-[#07070D] text-[#A6A2B3]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              islandState.visible ? "bg-emerald-400" : "bg-zinc-600"
            }`}
          />
          {islandState.visible ? "Visible" : "Hidden"}
        </span>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={islandState.visible ? onHide : onShow}
          className={`inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border px-3 text-xs font-medium transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-50 ${
            islandState.visible
              ? "border-[#292638] bg-[#12121D] text-[#F5F3FA] hover:border-[#8650FF]/40 hover:bg-[#1A192B]"
              : "border-transparent bg-[#8650FF] text-white shadow-sm shadow-[#8650FF]/25 hover:bg-[#7843F0]"
          }`}
        >
          {islandState.visible ? "Hide Island" : showLabel}
        </button>

        {displays.length > 0 && (
          <label className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <span className="shrink-0 text-[11px] font-medium text-[#A6A2B3]">Display</span>
            <select
              aria-label="Dynamic Island display"
              value={
                islandState.followPrimary
                  ? "auto"
                  : String(islandState.selectedDisplayIndex)
              }
              onChange={(event) => {
                if (event.target.value === "auto") {
                  onSelectFollowPrimary();
                } else {
                  onSelectDisplay(Number(event.target.value));
                }
              }}
              className="h-8 w-full max-w-[190px] min-w-[96px] truncate rounded-lg border border-[#292638] bg-[#07070D] px-2 text-xs text-[#F5F3FA] transition hover:border-[#8650FF]/40 focus:border-[#8650FF]"
            >
              <option value="auto">
                Primary (Auto
                {primaryDisplay ? ` · ${primaryDisplay.name}` : ""})
              </option>
              {displays.map((display) => {
                const scalePct = Math.round(display.scaleFactor * 100);
                const primaryTag = display.isPrimary ? " · Primary" : "";
                return (
                  <option key={display.index} value={String(display.index)}>
                    {display.name} ({display.widthPx}×{display.heightPx} ·{" "}
                    {scalePct}%{primaryTag})
                  </option>
                );
              })}
            </select>
          </label>
        )}
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
