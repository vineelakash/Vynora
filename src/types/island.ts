export interface DisplayInfo {
  index: number;
  name: string;
  positionX: number;
  positionY: number;
  widthPx: number;
  heightPx: number;
  workAreaX: number;
  workAreaY: number;
  workAreaWidth: number;
  workAreaHeight: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface IslandUiState {
  visible: boolean;
  expanded: boolean;
  userHidden: boolean;
  followPrimary: boolean;
  selectedDisplayIndex: number;
  spotifyActive: boolean;
}

export const INITIAL_ISLAND_STATE: IslandUiState = {
  visible: false,
  expanded: false,
  userHidden: false,
  followPrimary: true,
  selectedDisplayIndex: 0,
  spotifyActive: false,
};
