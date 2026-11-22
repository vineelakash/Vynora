/**
 * Shared Lyrics Studio settings persistence, legacy Needle -> VYNORA key migration,
 * cross-window synchronization helpers, and transport action mapping.
 */

import type { MediaControlAction } from '../../types/vinyl.ts';
import {
  DEFAULT_STUDIO_SETTINGS,
  type KineticStudioSettings,
} from './animationTypes.ts';

export const VYNORA_SETTINGS_STORAGE_KEY = 'vynora_lyrics_studio_settings';
export const LEGACY_SETTINGS_STORAGE_KEY = 'needle_lyrics_studio_settings';

export const VYNORA_PERF_OVERLAY_KEY = 'vynora_perf_overlay';
export const LEGACY_PERF_OVERLAY_KEY = 'needle_perf_overlay';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage access
  }
  return null;
}

export function loadPerfOverlayPreference(storage: StorageLike | null = getDefaultStorage()): boolean {
  if (!storage) return false;
  try {
    const vynoraVal = storage.getItem(VYNORA_PERF_OVERLAY_KEY);
    if (vynoraVal !== null) {
      return vynoraVal === '1';
    }
    const legacyVal = storage.getItem(LEGACY_PERF_OVERLAY_KEY);
    if (legacyVal !== null) {
      storage.setItem(VYNORA_PERF_OVERLAY_KEY, legacyVal);
      return legacyVal === '1';
    }
  } catch {
    // Ignore storage read errors
  }
  return false;
}

export function savePerfOverlayPreference(
  enabled: boolean,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    const val = enabled ? '1' : '0';
    storage.setItem(VYNORA_PERF_OVERLAY_KEY, val);
    storage.setItem(LEGACY_PERF_OVERLAY_KEY, val);
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Loads Lyrics Studio settings with safe backward-compatible migration from
 * legacy Needle storage keys so existing users never lose preferences on upgrade.
 */
export function loadStudioSettings(
  storage: StorageLike | null = getDefaultStorage(),
): KineticStudioSettings {
  const perfEnabled = loadPerfOverlayPreference(storage);
  if (!storage) {
    return { ...DEFAULT_STUDIO_SETTINGS, showPerfDiagnostics: perfEnabled };
  }

  try {
    let raw = storage.getItem(VYNORA_SETTINGS_STORAGE_KEY);
    let migratedFromLegacy = false;

    if (!raw) {
      raw = storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
      if (raw) {
        migratedFromLegacy = true;
      }
    }

    if (raw) {
      const parsed = JSON.parse(raw) as Omit<Partial<KineticStudioSettings>, 'style'> & {
        style?: string;
      };
      if (parsed.style === 'stars') {
        parsed.style = 'constellation';
      }
      if (parsed.style === 'lens') {
        parsed.style = 'chat';
      }
      const merged: KineticStudioSettings = {
        ...DEFAULT_STUDIO_SETTINGS,
        ...parsed,
        style: (parsed.style as KineticStudioSettings['style']) ?? DEFAULT_STUDIO_SETTINGS.style,
        showPerfDiagnostics:
          typeof parsed.showPerfDiagnostics === 'boolean'
            ? parsed.showPerfDiagnostics
            : perfEnabled,
      };

      if (migratedFromLegacy) {
        try {
          storage.setItem(VYNORA_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
        } catch {
          // Non-fatal migration write error
        }
      }
      return merged;
    }

    if (perfEnabled) {
      return { ...DEFAULT_STUDIO_SETTINGS, showPerfDiagnostics: true };
    }
  } catch {
    // Ignore malformed JSON in storage
  }

  return DEFAULT_STUDIO_SETTINGS;
}

export function saveStudioSettings(
  settings: KineticStudioSettings,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    const serialized = JSON.stringify(settings);
    storage.setItem(VYNORA_SETTINGS_STORAGE_KEY, serialized);
    // Keep legacy key mirrored for safe rollback compatibility
    storage.setItem(LEGACY_SETTINGS_STORAGE_KEY, serialized);
    if (typeof settings.showPerfDiagnostics === 'boolean') {
      savePerfOverlayPreference(settings.showPerfDiagnostics, storage);
    }
  } catch {
    // Ignore storage write errors
  }
}

export function isStudioSettingsStorageKey(key: string | null): boolean {
  return (
    key === VYNORA_SETTINGS_STORAGE_KEY ||
    key === LEGACY_SETTINGS_STORAGE_KEY ||
    key === VYNORA_PERF_OVERLAY_KEY ||
    key === LEGACY_PERF_OVERLAY_KEY ||
    key === null
  );
}

/**
 * Maps UI transport intents to the exact camelCase MediaControlAction expected by
 * Rust's `control_spotify_playback` Tauri command (`#[serde(rename_all = "camelCase")]`).
 */
export function mapPlayerTransportAction(
  action: 'PlayPause' | 'NextTrack' | 'PreviousTrack' | MediaControlAction,
): MediaControlAction {
  switch (action) {
    case 'PlayPause':
    case 'playPause':
      return 'playPause';
    case 'NextTrack':
    case 'next':
      return 'next';
    case 'PreviousTrack':
    case 'previous':
      return 'previous';
  }
}
