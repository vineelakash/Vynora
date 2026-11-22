import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStudioSettingsStorageKey,
  LEGACY_PERF_OVERLAY_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  loadPerfOverlayPreference,
  loadStudioSettings,
  mapPlayerTransportAction,
  savePerfOverlayPreference,
  saveStudioSettings,
  VYNORA_PERF_OVERLAY_KEY,
  VYNORA_SETTINGS_STORAGE_KEY,
  type StorageLike,
} from './studioSettingsStorage.ts';
import { DEFAULT_STUDIO_SETTINGS } from './animationTypes.ts';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

test('studio storage migration: preserves legacy Needle settings and migrates cleanly to VYNORA key', () => {
  const storage = createMemoryStorage({
    [LEGACY_SETTINGS_STORAGE_KEY]: JSON.stringify({
      style: 'terminal',
      background: 'black',
      syncOffsetMs: 160,
      fontSize: 'large',
    }),
    [LEGACY_PERF_OVERLAY_KEY]: '1',
  });

  const loaded = loadStudioSettings(storage);
  assert.equal(loaded.style, 'terminal');
  assert.equal(loaded.background, 'black');
  assert.equal(loaded.syncOffsetMs, 160);
  assert.equal(loaded.fontSize, 'large');
  assert.equal(loaded.showPerfDiagnostics, true);

  // Confirm migrated into VYNORA keys without deleting legacy keys
  assert.ok(storage.data[VYNORA_SETTINGS_STORAGE_KEY]);
  assert.equal(storage.data[VYNORA_PERF_OVERLAY_KEY], '1');
  assert.ok(storage.data[LEGACY_SETTINGS_STORAGE_KEY]);
});

test('studio storage migration: migrates removed stars style to constellation safely', () => {
  const storage = createMemoryStorage({
    [LEGACY_SETTINGS_STORAGE_KEY]: JSON.stringify({ style: 'stars', speed: 1.3 }),
  });

  const loaded = loadStudioSettings(storage);
  assert.equal(loaded.style, 'constellation');
  assert.equal(loaded.speed, 1.3);
});

test('studio storage persistence: saveStudioSettings persists and triggers storage key matching', () => {
  const storage = createMemoryStorage();
  const updated = {
    ...DEFAULT_STUDIO_SETTINGS,
    style: 'karaoke' as const,
    background: 'cover' as const,
    showPerfDiagnostics: true,
    syncOffsetMs: 90,
  };

  saveStudioSettings(updated, storage);
  const reloaded = loadStudioSettings(storage);
  assert.equal(reloaded.style, 'karaoke');
  assert.equal(reloaded.background, 'cover');
  assert.equal(reloaded.showPerfDiagnostics, true);
  assert.equal(reloaded.syncOffsetMs, 90);
  assert.equal(loadPerfOverlayPreference(storage), true);

  savePerfOverlayPreference(false, storage);
  assert.equal(loadPerfOverlayPreference(storage), false);

  assert.equal(isStudioSettingsStorageKey(VYNORA_SETTINGS_STORAGE_KEY), true);
  assert.equal(isStudioSettingsStorageKey(LEGACY_SETTINGS_STORAGE_KEY), true);
  assert.equal(isStudioSettingsStorageKey(VYNORA_PERF_OVERLAY_KEY), true);
  assert.equal(isStudioSettingsStorageKey('unrelated_key'), false);
});

test('transport action mapping: converts all UI actions to Rust camelCase MediaControlAction', () => {
  assert.equal(mapPlayerTransportAction('PlayPause'), 'playPause');
  assert.equal(mapPlayerTransportAction('NextTrack'), 'next');
  assert.equal(mapPlayerTransportAction('PreviousTrack'), 'previous');
  assert.equal(mapPlayerTransportAction('playPause'), 'playPause');
  assert.equal(mapPlayerTransportAction('next'), 'next');
  assert.equal(mapPlayerTransportAction('previous'), 'previous');
});
