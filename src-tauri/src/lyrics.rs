use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::diagnostics;

pub const LYRICS_STATE_EVENT: &str = "lyrics-state-changed";
pub const LYRICS_PREFS_EVENT: &str = "lyrics-prefs-changed";
pub const LYRICS_PLAYER_OPENED_EVENT: &str = "lyrics-player-opened";
const MAX_CACHED_TRACKS: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LyricsLookupState {
    Idle,
    Loading,
    Synced,
    Plain,
    Instrumental,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResultPayload {
    pub track_key: String,
    pub state: LyricsLookupState,
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
    pub matched_track_name: Option<String>,
    pub matched_artist_name: Option<String>,
    pub matched_album_name: Option<String>,
    pub matched_duration_sec: Option<f64>,
    pub source: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSharedSnapshot {
    pub track_key: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub state: LyricsLookupState,
    pub result: Option<LyricsResultPayload>,
    pub updated_at_unix_ms: u64,
}

impl Default for LyricsSharedSnapshot {
    fn default() -> Self {
        Self {
            track_key: None,
            title: None,
            artist: None,
            album: None,
            state: LyricsLookupState::Idle,
            result: None,
            updated_at_unix_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLookupRequest {
    pub track_key: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    #[serde(default)]
    pub force_refresh: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LyricsRequestAction {
    Cached,
    Fetch,
    Wait,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestLyricsResponse {
    pub action: LyricsRequestAction,
    pub snapshot: LyricsSharedSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct LyricsUiPrefs {
    pub main_panel_open: bool,
    pub island_lyrics_enabled: bool,
    pub vinyl_lyrics_enabled: bool,
}

impl Default for LyricsUiPrefs {
    fn default() -> Self {
        Self {
            main_panel_open: true,
            island_lyrics_enabled: true,
            vinyl_lyrics_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsUiPrefsPatch {
    pub main_panel_open: Option<bool>,
    pub island_lyrics_enabled: Option<bool>,
    pub vinyl_lyrics_enabled: Option<bool>,
}

#[derive(Debug, Default)]
struct LyricsEngineCore {
    current: LyricsSharedSnapshot,
    in_flight_track_key: Option<String>,
    cache: HashMap<String, LyricsSharedSnapshot>,
    cache_order: VecDeque<String>,
    prefs: LyricsUiPrefs,
    prefs_loaded: bool,
    prefs_path: Option<PathBuf>,
}

impl LyricsEngineCore {
    fn touch_cache(&mut self, track_key: String, snapshot: LyricsSharedSnapshot) {
        if let Some(pos) = self.cache_order.iter().position(|k| k == &track_key) {
            self.cache_order.remove(pos);
        }
        self.cache_order.push_back(track_key.clone());
        self.cache.insert(track_key, snapshot);

        while self.cache_order.len() > MAX_CACHED_TRACKS {
            if let Some(oldest) = self.cache_order.pop_front() {
                self.cache.remove(&oldest);
            }
        }
    }

    fn request_lookup(
        &mut self,
        req: LyricsLookupRequest,
        now_ms: u64,
    ) -> (RequestLyricsResponse, bool) {
        let track_key = req.track_key.trim().to_string();
        if track_key.is_empty() {
            let cleared = self.clear(now_ms);
            return (
                RequestLyricsResponse {
                    action: LyricsRequestAction::Cached,
                    snapshot: cleared.0,
                },
                cleared.1,
            );
        }

        if !req.force_refresh {
            let matched_cached = self.cache.get(&track_key).cloned().or_else(|| {
                if let (Some(req_title), Some(req_artist)) = (&req.title, &req.artist) {
                    let req_title_trimmed = req_title.trim();
                    let req_artist_trimmed = req_artist.trim();
                    if !req_title_trimmed.is_empty() && !req_artist_trimmed.is_empty() {
                        self.cache.values().find(|snap| {
                            snap.title.as_deref().map(str::trim).map(str::to_lowercase)
                                == Some(req_title_trimmed.to_lowercase())
                                && snap.artist.as_deref().map(str::trim).map(str::to_lowercase)
                                    == Some(req_artist_trimmed.to_lowercase())
                        }).cloned()
                    } else {
                        None
                    }
                } else {
                    None
                }
            });

            if let Some(cached) = matched_cached {
                let mut active = cached;
                active.title = req.title.or(active.title);
                active.artist = req.artist.or(active.artist);
                active.album = req.album.or(active.album);
                active.updated_at_unix_ms = now_ms;
                let changed = self.current != active;
                self.current = active.clone();
                if self.in_flight_track_key.as_deref() == Some(track_key.as_str()) {
                    self.in_flight_track_key = None;
                }
                return (
                    RequestLyricsResponse {
                        action: LyricsRequestAction::Cached,
                        snapshot: active,
                    },
                    changed,
                );
            }

            if self.in_flight_track_key.as_deref() == Some(track_key.as_str())
                && self.current.track_key.as_deref() == Some(track_key.as_str())
                && self.current.state == LyricsLookupState::Loading
            {
                return (
                    RequestLyricsResponse {
                        action: LyricsRequestAction::Wait,
                        snapshot: self.current.clone(),
                    },
                    false,
                );
            }
        }

        let loading = LyricsSharedSnapshot {
            track_key: Some(track_key.clone()),
            title: req.title,
            artist: req.artist,
            album: req.album,
            state: LyricsLookupState::Loading,
            result: None,
            updated_at_unix_ms: now_ms,
        };
        let changed = self.current != loading;
        self.current = loading.clone();
        self.in_flight_track_key = Some(track_key);

        (
            RequestLyricsResponse {
                action: LyricsRequestAction::Fetch,
                snapshot: loading,
            },
            changed,
        )
    }

    fn publish_result(
        &mut self,
        payload: LyricsResultPayload,
        now_ms: u64,
    ) -> (LyricsSharedSnapshot, bool) {
        let track_key = payload.track_key.trim().to_string();
        let is_current_track = self.current.track_key.as_deref() == Some(track_key.as_str());

        if self.in_flight_track_key.as_deref() == Some(track_key.as_str()) {
            self.in_flight_track_key = None;
        }

        let title = if is_current_track {
            self.current.title.clone()
        } else {
            payload.matched_track_name.clone()
        };
        let artist = if is_current_track {
            self.current.artist.clone()
        } else {
            payload.matched_artist_name.clone()
        };
        let album = if is_current_track {
            self.current.album.clone()
        } else {
            payload.matched_album_name.clone()
        };

        let resolved = LyricsSharedSnapshot {
            track_key: Some(track_key.clone()),
            title,
            artist,
            album,
            state: payload.state,
            result: Some(payload.clone()),
            updated_at_unix_ms: now_ms,
        };

        let should_cache = matches!(
            payload.state,
            LyricsLookupState::Synced
                | LyricsLookupState::Plain
                | LyricsLookupState::Instrumental
                | LyricsLookupState::Unavailable
        );
        if should_cache && !track_key.is_empty() {
            self.touch_cache(track_key, resolved.clone());
        }

        if is_current_track {
            let changed = self.current != resolved;
            self.current = resolved.clone();
            (resolved, changed)
        } else {
            // Stale track completed after the user already switched songs; cached for later, do not overwrite active view.
            (self.current.clone(), false)
        }
    }

    fn clear(&mut self, now_ms: u64) -> (LyricsSharedSnapshot, bool) {
        let already_idle = self.current.state == LyricsLookupState::Idle
            && self.current.track_key.is_none()
            && self.current.result.is_none();

        self.in_flight_track_key = None;

        if already_idle {
            return (self.current.clone(), false);
        }

        self.current = LyricsSharedSnapshot {
            track_key: None,
            title: None,
            artist: None,
            album: None,
            state: LyricsLookupState::Idle,
            result: None,
            updated_at_unix_ms: now_ms,
        };
        (self.current.clone(), true)
    }

    fn apply_prefs_patch(&mut self, patch: LyricsUiPrefsPatch) -> LyricsUiPrefs {
        if let Some(v) = patch.main_panel_open {
            self.prefs.main_panel_open = v;
        }
        if let Some(v) = patch.island_lyrics_enabled {
            self.prefs.island_lyrics_enabled = v;
        }
        if let Some(v) = patch.vinyl_lyrics_enabled {
            self.prefs.vinyl_lyrics_enabled = v;
        }
        self.prefs.clone()
    }
}

#[derive(Clone, Default)]
pub struct LyricsController {
    inner: Arc<Mutex<LyricsEngineCore>>,
}

impl LyricsController {
    pub fn new() -> Self {
        Self::default()
    }

    fn log(&self, stage: &str, message: impl Into<String>) {
        diagnostics::log_event("lyrics", stage, message);
    }

    pub fn get_state(&self) -> LyricsSharedSnapshot {
        self.inner
            .lock()
            .expect("lyrics state mutex poisoned")
            .current
            .clone()
    }

    pub fn ensure_prefs_loaded(&self, app: &AppHandle) -> LyricsUiPrefs {
        {
            let guard = self.inner.lock().expect("lyrics state mutex poisoned");
            if guard.prefs_loaded {
                return guard.prefs.clone();
            }
        }

        let prefs_path = app
            .path()
            .app_local_data_dir()
            .ok()
            .map(|dir| dir.join("lyrics-prefs.json"));

        let loaded = prefs_path
            .as_ref()
            .and_then(|p| load_prefs_from_disk(p))
            .unwrap_or_default();

        let mut guard = self.inner.lock().expect("lyrics state mutex poisoned");
        if !guard.prefs_loaded {
            guard.prefs = loaded;
            guard.prefs_path = prefs_path;
            guard.prefs_loaded = true;
        }
        guard.prefs.clone()
    }

    pub fn set_prefs(&self, app: &AppHandle, patch: LyricsUiPrefsPatch) -> LyricsUiPrefs {
        let _ = self.ensure_prefs_loaded(app);
        let (prefs, path) = {
            let mut guard = self.inner.lock().expect("lyrics state mutex poisoned");
            let updated = guard.apply_prefs_patch(patch);
            (updated, guard.prefs_path.clone())
        };

        if let Some(path) = path {
            if let Err(err) = save_prefs_to_disk(&path, &prefs) {
                self.log("prefs_save_error", err);
            }
        }

        if let Err(err) = app.emit(LYRICS_PREFS_EVENT, &prefs) {
            self.log("prefs_emit_error", format!("Failed to emit {LYRICS_PREFS_EVENT}: {err}"));
        }

        prefs
    }

    pub fn request_lookup(&self, app: &AppHandle, req: LyricsLookupRequest) -> RequestLyricsResponse {
        let now_ms = unix_now_ms();
        let (response, changed) = {
            let mut guard = self.inner.lock().expect("lyrics state mutex poisoned");
            guard.request_lookup(req, now_ms)
        };

        match response.action {
            LyricsRequestAction::Cached => {
                self.log(
                    "cache_hit",
                    format!(
                        "track_key={:?} state={:?}",
                        response.snapshot.track_key, response.snapshot.state
                    ),
                );
            }
            LyricsRequestAction::Fetch => {
                self.log(
                    "lookup_start",
                    format!(
                        "track_key={:?} title={:?} artist={:?}",
                        response.snapshot.track_key,
                        response.snapshot.title,
                        response.snapshot.artist
                    ),
                );
            }
            LyricsRequestAction::Wait => {}
        }

        if changed {
            self.emit_state(app, &response.snapshot);
        }

        response
    }

    pub fn publish_result(
        &self,
        app: &AppHandle,
        payload: LyricsResultPayload,
    ) -> LyricsSharedSnapshot {
        let now_ms = unix_now_ms();
        let result_state = payload.state;
        let result_key = payload.track_key.clone();
        let result_err = payload.error.clone();

        let (snapshot, changed) = {
            let mut guard = self.inner.lock().expect("lyrics state mutex poisoned");
            guard.publish_result(payload, now_ms)
        };

        self.log(
            if changed {
                "lookup_resolved"
            } else {
                "lookup_stale_cached"
            },
            format!(
                "track_key='{}' state={:?} changed={} err={:?}",
                result_key, result_state, changed, result_err
            ),
        );

        if changed {
            self.emit_state(app, &snapshot);
        }

        snapshot
    }

    pub fn clear(&self, app: &AppHandle) -> LyricsSharedSnapshot {
        let now_ms = unix_now_ms();
        let (snapshot, changed) = {
            let mut guard = self.inner.lock().expect("lyrics state mutex poisoned");
            guard.clear(now_ms)
        };

        if changed {
            self.log("clear", "Cleared active lyrics state");
            self.emit_state(app, &snapshot);
        }

        snapshot
    }

    fn emit_state(&self, app: &AppHandle, snapshot: &LyricsSharedSnapshot) {
        if let Err(err) = app.emit(LYRICS_STATE_EVENT, snapshot) {
            self.log(
                "state_emit_error",
                format!("Failed to emit {LYRICS_STATE_EVENT}: {err}"),
            );
        }
    }
}

fn load_prefs_from_disk(path: &PathBuf) -> Option<LyricsUiPrefs> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<LyricsUiPrefs>(&raw).ok()
}

fn save_prefs_to_disk(path: &PathBuf, prefs: &LyricsUiPrefs) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed creating lyrics prefs directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(prefs)
        .map_err(|err| format!("Failed serializing lyrics prefs: {err}"))?;
    fs::write(path, json).map_err(|err| format!("Failed writing lyrics prefs file: {err}"))?;
    Ok(())
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload(track_key: &str, state: LyricsLookupState) -> LyricsResultPayload {
        LyricsResultPayload {
            track_key: track_key.to_string(),
            state,
            synced_lyrics: if state == LyricsLookupState::Synced {
                Some("[00:10.00]Line one".to_string())
            } else {
                None
            },
            plain_lyrics: if state == LyricsLookupState::Plain {
                Some("Line one".to_string())
            } else {
                None
            },
            matched_track_name: Some("Sample Track".to_string()),
            matched_artist_name: Some("Sample Artist".to_string()),
            matched_album_name: Some("Sample Album".to_string()),
            matched_duration_sec: Some(210.0),
            source: Some("lrclib".to_string()),
            error: if state == LyricsLookupState::Error {
                Some("Network timeout".to_string())
            } else {
                None
            },
        }
    }

    #[test]
    fn single_flight_dedup_and_cache_hit() {
        let mut core = LyricsEngineCore::default();

        let (first, changed1) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-a".into(),
                title: Some("Track A".into()),
                artist: Some("Artist A".into()),
                album: None,
                force_refresh: false,
            },
            1000,
        );
        assert!(changed1);
        assert_eq!(first.action, LyricsRequestAction::Fetch);
        assert_eq!(first.snapshot.state, LyricsLookupState::Loading);

        // Second concurrent request for the same in-flight track returns Wait
        let (second, changed2) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-a".into(),
                title: Some("Track A".into()),
                artist: Some("Artist A".into()),
                album: None,
                force_refresh: false,
            },
            1050,
        );
        assert!(!changed2);
        assert_eq!(second.action, LyricsRequestAction::Wait);

        let (published, changed3) =
            core.publish_result(sample_payload("track-a", LyricsLookupState::Synced), 1100);
        assert!(changed3);
        assert_eq!(published.state, LyricsLookupState::Synced);

        // Subsequent request hits cache cleanly
        let (third, changed4) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-a".into(),
                title: Some("Track A".into()),
                artist: Some("Artist A".into()),
                album: None,
                force_refresh: false,
            },
            1200,
        );
        assert!(changed4 || third.snapshot.state == LyricsLookupState::Synced);
        assert_eq!(third.action, LyricsRequestAction::Cached);
        assert_eq!(third.snapshot.state, LyricsLookupState::Synced);
    }

    #[test]
    fn transient_errors_are_not_cached_and_force_refresh_bypasses_cache() {
        let mut core = LyricsEngineCore::default();
        let _ = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-err".into(),
                title: Some("Err Song".into()),
                artist: Some("Artist".into()),
                album: None,
                force_refresh: false,
            },
            100,
        );
        let _ = core.publish_result(sample_payload("track-err", LyricsLookupState::Error), 200);

        // Next request must re-fetch rather than serving stale transient error cache
        let (retry_req, _) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-err".into(),
                title: Some("Err Song".into()),
                artist: Some("Artist".into()),
                album: None,
                force_refresh: false,
            },
            300,
        );
        assert_eq!(retry_req.action, LyricsRequestAction::Fetch);

        let _ = core.publish_result(
            sample_payload("track-err", LyricsLookupState::Unavailable),
            400,
        );

        // Normal request returns cached unavailable
        let (cached_unavail, _) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-err".into(),
                title: Some("Err Song".into()),
                artist: Some("Artist".into()),
                album: None,
                force_refresh: false,
            },
            500,
        );
        assert_eq!(cached_unavail.action, LyricsRequestAction::Cached);
        assert_eq!(cached_unavail.snapshot.state, LyricsLookupState::Unavailable);

        // Explicit force_refresh bypasses negative cache
        let (forced, _) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "track-err".into(),
                title: Some("Err Song".into()),
                artist: Some("Artist".into()),
                album: None,
                force_refresh: true,
            },
            600,
        );
        assert_eq!(forced.action, LyricsRequestAction::Fetch);
    }

    #[test]
    fn stale_track_completion_does_not_overwrite_newer_track() {
        let mut core = LyricsEngineCore::default();

        let _ = core.request_lookup(
            LyricsLookupRequest {
                track_key: "song-1".into(),
                title: Some("Song 1".into()),
                artist: None,
                album: None,
                force_refresh: false,
            },
            100,
        );
        let _ = core.request_lookup(
            LyricsLookupRequest {
                track_key: "song-2".into(),
                title: Some("Song 2".into()),
                artist: None,
                album: None,
                force_refresh: false,
            },
            200,
        );

        // Song 1 finishes late
        let (snap_after_stale, changed) =
            core.publish_result(sample_payload("song-1", LyricsLookupState::Synced), 300);
        assert!(!changed);
        assert_eq!(snap_after_stale.track_key.as_deref(), Some("song-2"));
        assert_eq!(snap_after_stale.state, LyricsLookupState::Loading);

        // Yet Song 1 WAS cached in case user goes back
        let (back_to_1, _) = core.request_lookup(
            LyricsLookupRequest {
                track_key: "song-1".into(),
                title: Some("Song 1".into()),
                artist: None,
                album: None,
                force_refresh: false,
            },
            400,
        );
        assert_eq!(back_to_1.action, LyricsRequestAction::Cached);
        assert_eq!(back_to_1.snapshot.state, LyricsLookupState::Synced);
    }

    #[test]
    fn clear_resets_to_idle_and_prefs_patch_updates_cleanly() {
        let mut core = LyricsEngineCore::default();
        let _ = core.request_lookup(
            LyricsLookupRequest {
                track_key: "song-x".into(),
                title: Some("నాటు నాటు".into()),
                artist: Some("Rahul Sipligunj".into()),
                album: None,
                force_refresh: false,
            },
            100,
        );
        let (cleared, changed) = core.clear(200);
        assert!(changed);
        assert_eq!(cleared.state, LyricsLookupState::Idle);
        assert!(cleared.track_key.is_none());

        let (_, changed_again) = core.clear(300);
        assert!(!changed_again);

        let updated = core.apply_prefs_patch(LyricsUiPrefsPatch {
            main_panel_open: Some(false),
            island_lyrics_enabled: None,
            vinyl_lyrics_enabled: Some(false),
        });
        assert!(!updated.main_panel_open);
        assert!(updated.island_lyrics_enabled);
        assert!(!updated.vinyl_lyrics_enabled);
    }
}
