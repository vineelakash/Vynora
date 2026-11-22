export type MediaControlAction = "playPause" | "next" | "previous";

export interface VinylUiState {
  visible: boolean;
  expanded: boolean;
  alwaysOnTop: boolean;
  logicalWidth: number;
  logicalHeight: number;
  positionX: number | null;
  positionY: number | null;
}

export const INITIAL_VINYL_STATE: VinylUiState = {
  visible: true,
  expanded: true,
  alwaysOnTop: false,
  logicalWidth: 540,
  logicalHeight: 340,
  positionX: null,
  positionY: null,
};
