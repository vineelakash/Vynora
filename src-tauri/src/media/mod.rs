pub mod gsmtc;
pub mod metadata;
pub mod spotify;
pub mod thumbnail;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::diagnostics::{self, now_unix_ms};
use crate::island::IslandController;
use gsmtc::{GsmtcClient, WinRtMtaGuard};
use metadata::{extract_session_metadata, PlaybackStatus, TimelineInfo};
use spotify::select_spotify_session;
use thumbnail::{read_thumbnail_stream, SpotifyArtwork};

pub const SPOTIFY_STATUS_EVENT: &str = "spotify-status-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SpotifyConnectionState {
    Connected,
    NotDetected,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub connection_state: SpotifyConnectionState,
    pub source_app_id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork: Option<SpotifyArtwork>,
    pub playback_status: PlaybackStatus,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub timeline: Option<TimelineInfo>,
    pub error: Option<String>,
}

impl SpotifyStatus {
    pub fn not_detected() -> Self {
        Self {
            connection_state: SpotifyConnectionState::NotDetected,
            source_app_id: None,
            title: None,
            artist: None,
            album: None,
            artwork: None,
            playback_status: PlaybackStatus::Unknown,
            position_ms: None,
            duration_ms: None,
            timeline: None,
            error: None,
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            connection_state: SpotifyConnectionState::Unavailable,
            source_app_id: None,
            title: None,
            artist: None,
            album: None,
            artwork: None,
            playback_status: PlaybackStatus::Unknown,
            position_ms: None,
            duration_ms: None,
            timeline: None,
            error: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSessionDiagnostic {
    pub index: usize,
    pub source_app_id: String,
    pub playback_status: PlaybackStatus,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub matched_spotify: bool,
    pub read_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDiagnosticsSnapshot {
    pub worker_alive: bool,
    pub ro_init_status: Option<String>,
    pub poll_count: u64,
    pub last_poll_unix_ms: Option<u64>,
    pub last_error: Option<String>,
    pub current_session_app_id: Option<String>,
    pub raw_session_count: usize,
    pub raw_sessions: Vec<RawSessionDiagnostic>,
    pub last_status: SpotifyStatus,
}

#[derive(Clone, PartialEq, Eq)]
struct TrackKey {
    source_app_id: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
}

struct CachedArtwork {
    track_key: TrackKey,
    artwork: SpotifyArtwork,
}

pub struct PollReport {
    pub status: SpotifyStatus,
    pub current_session_app_id: Option<String>,
    pub raw_sessions: Vec<RawSessionDiagnostic>,
}

#[derive(Default)]
pub struct SpotifyDetector {
    gsmtc: GsmtcClient,
    cached_artwork: Option<CachedArtwork>,
    last_raw_signature: Option<String>,
}

impl SpotifyDetector {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn poll_status(&mut self) -> SpotifyStatus {
        self.poll_with_raw(None, "direct").status
    }

    pub fn poll_with_raw(
        &mut self,
        wake: Option<Arc<dyn Fn() + Send + Sync>>,
        trigger: &str,
    ) -> PollReport {
        let snapshot = match self.gsmtc.enumerate_snapshot(wake) {
            Ok(snapshot) => snapshot,
            Err(err) => {
                self.cached_artwork = None;
                let sig = format!("ERR:{err}");
                if self.last_raw_signature.as_ref() != Some(&sig) {
                    diagnostics::log_event(
                        "media",
                        "gsmtc_enum_error",
                        format!("[{trigger}] GSMTC enumeration failed: {err}"),
                    );
                    self.last_raw_signature = Some(sig);
                }
                return PollReport {
                    status: SpotifyStatus::unavailable(err),
                    current_session_app_id: None,
                    raw_sessions: Vec::new(),
                };
            }
        };

        let raw_sessions: Vec<RawSessionDiagnostic> = snapshot
            .sessions
            .iter()
            .map(|s| RawSessionDiagnostic {
                index: s.index,
                source_app_id: s.source_app_id.clone(),
                playback_status: s.playback_status,
                title: s.title.clone(),
                artist: s.artist.clone(),
                album: s.album.clone(),
                matched_spotify: s.matched_spotify,
                read_error: s.read_error.clone(),
            })
            .collect();

        let raw_signature = format_raw_signature(
            snapshot.current_session_app_id.as_deref(),
            &raw_sessions,
        );

        if self.last_raw_signature.as_ref() != Some(&raw_signature) {
            diagnostics::log_event(
                "media",
                "raw_gsmtc_sessions",
                format!(
                    "[{trigger}] session_count={} current_session={:?} sessions=[{}]",
                    raw_sessions.len(),
                    snapshot.current_session_app_id,
                    summarize_raw_sessions(&raw_sessions)
                ),
            );
            self.last_raw_signature = Some(raw_signature);
        }

        let Some(identified) = select_spotify_session(snapshot.sessions) else {
            self.cached_artwork = None;
            return PollReport {
                status: SpotifyStatus::not_detected(),
                current_session_app_id: snapshot.current_session_app_id,
                raw_sessions,
            };
        };

        let extracted = extract_session_metadata(
            &identified.session,
            identified.raw_playback_status,
            identified.media_properties,
            identified.title,
            identified.artist,
            identified.album,
        );

        let track_key = TrackKey {
            source_app_id: identified.source_app_id.clone(),
            title: extracted.title.clone(),
            artist: extracted.artist.clone(),
            album: extracted.album.clone(),
        };

        let has_identifying_metadata =
            track_key.title.is_some() || track_key.artist.is_some() || track_key.album.is_some();

        let artwork = if has_identifying_metadata {
            match &self.cached_artwork {
                Some(cached) if cached.track_key == track_key => Some(cached.artwork.clone()),
                _ => {
                    self.cached_artwork = None;
                    let fetched = extracted
                        .media_properties
                        .as_ref()
                        .and_then(|props| props.Thumbnail().ok())
                        .and_then(|thumb| read_thumbnail_stream(&thumb));
                    if let Some(art) = &fetched {
                        self.cached_artwork = Some(CachedArtwork {
                            track_key,
                            artwork: art.clone(),
                        });
                    }
                    fetched
                }
            }
        } else {
            self.cached_artwork = None;
            extracted
                .media_properties
                .as_ref()
                .and_then(|props| props.Thumbnail().ok())
                .and_then(|thumb| read_thumbnail_stream(&thumb))
        };

        let position_ms = extracted.timeline.as_ref().map(|t| t.position_ms);
        let duration_ms = extracted.timeline.as_ref().and_then(|t| t.duration_ms);

        let status = SpotifyStatus {
            connection_state: SpotifyConnectionState::Connected,
            source_app_id: Some(identified.source_app_id),
            title: extracted.title,
            artist: extracted.artist,
            album: extracted.album,
            artwork,
            playback_status: extracted.playback_status,
            position_ms,
            duration_ms,
            timeline: extracted.timeline,
            error: None,
        };

        PollReport {
            status,
            current_session_app_id: snapshot.current_session_app_id,
            raw_sessions,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaControlAction {
    PlayPause,
    Next,
    Previous,
}

enum MonitorCommand {
    Query(Sender<SpotifyStatus>),
    Control(MediaControlAction, Sender<Result<SpotifyStatus, String>>),
    Refresh,
    Shutdown,
}

pub struct SpotifyMonitorHandle {
    sender: Sender<MonitorCommand>,
    worker: Option<JoinHandle<()>>,
    worker_alive: Arc<AtomicBool>,
    diagnostics_state: Arc<Mutex<MediaDiagnosticsSnapshot>>,
}

impl SpotifyMonitorHandle {
    pub fn start(app_handle: AppHandle) -> Self {
        let (sender, receiver) = mpsc::channel::<MonitorCommand>();
        let worker_alive = Arc::new(AtomicBool::new(false));
        let diagnostics_state = Arc::new(Mutex::new(MediaDiagnosticsSnapshot {
            worker_alive: false,
            ro_init_status: None,
            poll_count: 0,
            last_poll_unix_ms: None,
            last_error: None,
            current_session_app_id: None,
            raw_session_count: 0,
            raw_sessions: Vec::new(),
            last_status: SpotifyStatus::not_detected(),
        }));

        let alive_flag = Arc::clone(&worker_alive);
        let diag_ref = Arc::clone(&diagnostics_state);
        let wake_sender = sender.clone();

        diagnostics::log_event("media", "worker_spawn", "Spawning needle-gsmtc-monitor thread");

        let worker = std::thread::Builder::new()
            .name("needle-gsmtc-monitor".to_string())
            .spawn(move || {
                alive_flag.store(true, Ordering::SeqCst);
                let _guard = scopeguard_reset(Arc::clone(&alive_flag), Arc::clone(&diag_ref));

                let winrt_guard = WinRtMtaGuard::init();
                if let Ok(mut d) = diag_ref.lock() {
                    d.worker_alive = true;
                    d.ro_init_status = Some(winrt_guard.status_label.clone());
                }

                let wake_cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                    let _ = wake_sender.send(MonitorCommand::Refresh);
                });

                let mut detector = SpotifyDetector::new();

                let initial = run_guarded_poll(
                    &mut detector,
                    Some(Arc::clone(&wake_cb)),
                    "initial",
                    &diag_ref,
                );
                log_spotify_status("initial", &initial);
                publish_status(&app_handle, &initial);

                let mut next_wait = poll_interval_for(&initial);
                let mut last_emitted = Some(initial);

                loop {
                    match receiver.recv_timeout(next_wait) {
                        Ok(MonitorCommand::Query(reply)) => {
                            let status = run_guarded_poll(
                                &mut detector,
                                Some(Arc::clone(&wake_cb)),
                                "query",
                                &diag_ref,
                            );
                            next_wait = poll_interval_for(&status);
                            if last_emitted.as_ref() != Some(&status) {
                                log_spotify_status("query_change", &status);
                                publish_status(&app_handle, &status);
                                last_emitted = Some(status.clone());
                            }
                            let _ = reply.send(status);
                        }
                        Ok(MonitorCommand::Control(action, reply)) => {
                            let control_res = execute_gsmtc_control(&mut detector, action);
                            let status = run_guarded_poll(
                                &mut detector,
                                Some(Arc::clone(&wake_cb)),
                                "control",
                                &diag_ref,
                            );
                            next_wait = poll_interval_for(&status);
                            if last_emitted.as_ref() != Some(&status) {
                                log_spotify_status("control_change", &status);
                                publish_status(&app_handle, &status);
                                last_emitted = Some(status.clone());
                            }
                            let _ = reply.send(control_res.map(|_| status));
                        }
                        Ok(MonitorCommand::Refresh) => {
                            // Coalesce bursty WinRT SessionsChanged notifications.
                            while let Ok(MonitorCommand::Refresh) = receiver.try_recv() {}
                            let status = run_guarded_poll(
                                &mut detector,
                                Some(Arc::clone(&wake_cb)),
                                "event_refresh",
                                &diag_ref,
                            );
                            next_wait = poll_interval_for(&status);
                            if last_emitted.as_ref() != Some(&status) {
                                log_spotify_status("event_change", &status);
                                publish_status(&app_handle, &status);
                                last_emitted = Some(status);
                            }
                        }
                        Ok(MonitorCommand::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                            diagnostics::log_event("media", "worker_stop", "Shutting down GSMTC monitor");
                            break;
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            let status = run_guarded_poll(
                                &mut detector,
                                Some(Arc::clone(&wake_cb)),
                                "poll",
                                &diag_ref,
                            );
                            let poll_count = diag_ref.lock().map(|d| d.poll_count).unwrap_or(0);
                            if poll_count == 2 || (poll_count > 2 && poll_count % 15 == 0) {
                                diagnostics::log_event(
                                    "media",
                                    "worker_heartbeat",
                                    format!(
                                        "GSMTC monitor alive poll_count={poll_count} conn={:?}",
                                        status.connection_state
                                    ),
                                );
                            }
                            next_wait = poll_interval_for(&status);
                            if last_emitted.as_ref() != Some(&status) {
                                log_spotify_status("poll_change", &status);
                                publish_status(&app_handle, &status);
                                last_emitted = Some(status);
                            } else if let Some(island) = app_handle.try_state::<IslandController>() {
                                island.sync_display_topology(&app_handle);
                            }
                        }
                    }
                }
            })
            .ok();

        Self {
            sender,
            worker,
            worker_alive,
            diagnostics_state,
        }
    }

    pub async fn query_async(&self) -> SpotifyStatus {
        let sender = self.sender.clone();
        tauri::async_runtime::spawn_blocking(move || query_via_sender(&sender))
            .await
            .unwrap_or_else(|_| {
                SpotifyStatus::unavailable("Media session query task failed unexpectedly")
            })
    }

    pub async fn send_control_async(&self, action: MediaControlAction) -> Result<SpotifyStatus, String> {
        let sender = self.sender.clone();
        tauri::async_runtime::spawn_blocking(move || control_via_sender(&sender, action))
            .await
            .map_err(|err| format!("Media control task failed unexpectedly: {err}"))?
    }

    pub fn diagnostics_snapshot(&self) -> MediaDiagnosticsSnapshot {
        let mut snap = self
            .diagnostics_state
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| MediaDiagnosticsSnapshot {
                worker_alive: false,
                ro_init_status: None,
                poll_count: 0,
                last_poll_unix_ms: None,
                last_error: Some("Diagnostics lock poisoned".to_string()),
                current_session_app_id: None,
                raw_session_count: 0,
                raw_sessions: Vec::new(),
                last_status: SpotifyStatus::unavailable("Diagnostics unavailable"),
            });
        snap.worker_alive = self.worker_alive.load(Ordering::SeqCst);
        snap
    }

    pub fn shutdown(&mut self) {
        let _ = self.sender.send(MonitorCommand::Shutdown);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

struct AliveResetGuard {
    alive: Arc<AtomicBool>,
    diag: Arc<Mutex<MediaDiagnosticsSnapshot>>,
}

impl Drop for AliveResetGuard {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut d) = self.diag.lock() {
            d.worker_alive = false;
        }
    }
}

fn scopeguard_reset(
    alive: Arc<AtomicBool>,
    diag: Arc<Mutex<MediaDiagnosticsSnapshot>>,
) -> AliveResetGuard {
    AliveResetGuard { alive, diag }
}

fn run_guarded_poll(
    detector: &mut SpotifyDetector,
    wake: Option<Arc<dyn Fn() + Send + Sync>>,
    trigger: &str,
    diag_ref: &Arc<Mutex<MediaDiagnosticsSnapshot>>,
) -> SpotifyStatus {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        detector.poll_with_raw(wake, trigger)
    }));

    match result {
        Ok(report) => {
            if let Ok(mut d) = diag_ref.lock() {
                d.poll_count = d.poll_count.saturating_add(1);
                d.last_poll_unix_ms = Some(now_unix_ms());
                d.last_error = report.status.error.clone();
                d.current_session_app_id = report.current_session_app_id.clone();
                d.raw_session_count = report.raw_sessions.len();
                d.raw_sessions = report.raw_sessions;
                d.last_status = report.status.clone();
            }
            report.status
        }
        Err(_) => {
            let msg = "Recovered from unexpected panic in GSMTC poll iteration".to_string();
            diagnostics::log_event("media", "worker_panic_recovered", &msg);
            detector.gsmtc.invalidate();
            let status = SpotifyStatus::unavailable(msg.clone());
            if let Ok(mut d) = diag_ref.lock() {
                d.poll_count = d.poll_count.saturating_add(1);
                d.last_poll_unix_ms = Some(now_unix_ms());
                d.last_error = Some(msg);
                d.last_status = status.clone();
            }
            status
        }
    }
}

fn publish_status(app_handle: &AppHandle, status: &SpotifyStatus) {
    if let Some(island) = app_handle.try_state::<IslandController>() {
        island.on_spotify_status(app_handle, status);
    }
    if let Err(err) = app_handle.emit(SPOTIFY_STATUS_EVENT, status) {
        diagnostics::log_event(
            "media",
            "emit_error",
            format!("Failed to emit spotify-status-changed: {err}"),
        );
    }
}

fn query_via_sender(sender: &Sender<MonitorCommand>) -> SpotifyStatus {
    let (reply_tx, reply_rx) = mpsc::channel();
    if sender.send(MonitorCommand::Query(reply_tx)).is_err() {
        return SpotifyStatus::unavailable("Media session monitor is unavailable");
    }

    reply_rx
        .recv_timeout(Duration::from_secs(4))
        .unwrap_or_else(|_| {
            SpotifyStatus::unavailable("Timed out waiting for Windows media session status")
        })
}

fn control_via_sender(
    sender: &Sender<MonitorCommand>,
    action: MediaControlAction,
) -> Result<SpotifyStatus, String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    sender
        .send(MonitorCommand::Control(action, reply_tx))
        .map_err(|_| "Media session monitor is unavailable".to_string())?;

    reply_rx
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| "Timed out waiting for Windows GSMTC control command".to_string())?
}

fn execute_gsmtc_control(
    detector: &mut SpotifyDetector,
    action: MediaControlAction,
) -> Result<(), String> {
    let snapshot = detector.gsmtc.enumerate_snapshot(None)?;
    let Some(identified) = select_spotify_session(snapshot.sessions) else {
        return Err("No active Spotify Desktop session found".to_string());
    };

    let op = match action {
        MediaControlAction::PlayPause => identified
            .session
            .TryTogglePlayPauseAsync()
            .map_err(|err| format!("TryTogglePlayPauseAsync failed: {err}"))?,
        MediaControlAction::Next => identified
            .session
            .TrySkipNextAsync()
            .map_err(|err| format!("TrySkipNextAsync failed: {err}"))?,
        MediaControlAction::Previous => identified
            .session
            .TrySkipPreviousAsync()
            .map_err(|err| format!("TrySkipPreviousAsync failed: {err}"))?,
    };

    let accepted = gsmtc::wait_async_op(&op, gsmtc::DEFAULT_WINRT_TIMEOUT, "GSMTC::Control")?;
    diagnostics::log_event(
        "media",
        "gsmtc_control",
        format!("GSMTC control {action:?} completed (accepted={accepted})"),
    );
    Ok(())
}

impl Drop for SpotifyMonitorHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn poll_interval_for(status: &SpotifyStatus) -> Duration {
    match (status.connection_state, status.playback_status) {
        (SpotifyConnectionState::Connected, PlaybackStatus::Playing) => Duration::from_millis(1000),
        (SpotifyConnectionState::Connected, _) => Duration::from_millis(1500),
        (SpotifyConnectionState::Unavailable, _) => Duration::from_millis(1500),
        _ => Duration::from_millis(2000),
    }
}

fn log_spotify_status(stage: &str, status: &SpotifyStatus) {
    diagnostics::log_event(
        "media",
        stage,
        format!(
            "conn={:?} source_app={:?} playback={:?} title={:?} artist={:?} album={:?} pos_ms={:?} dur_ms={:?} art_bytes={:?} error={:?}",
            status.connection_state,
            status.source_app_id,
            status.playback_status,
            status.title,
            status.artist,
            status.album,
            status.position_ms,
            status.duration_ms,
            status.artwork.as_ref().map(|a| a.byte_len),
            status.error
        ),
    );
}

pub fn format_raw_signature(current: Option<&str>, sessions: &[RawSessionDiagnostic]) -> String {
    let parts: Vec<String> = sessions
        .iter()
        .map(|s| {
            format!(
                "#{}|{}|{:?}|{:?}|{:?}|{:?}|match={}",
                s.index,
                s.source_app_id,
                s.playback_status,
                s.title,
                s.artist,
                s.album,
                s.matched_spotify
            )
        })
        .collect();
    format!("cur={:?}|{}", current, parts.join(";"))
}

pub fn summarize_raw_sessions(sessions: &[RawSessionDiagnostic]) -> String {
    if sessions.is_empty() {
        return "none".to_string();
    }

    sessions
        .iter()
        .map(|s| {
            format!(
                "#{}(aumid='{}' status={:?} title={:?} artist={:?} album={:?} spotify={} err={:?})",
                s.index,
                s.source_app_id,
                s.playback_status,
                s.title,
                s.artist,
                s.album,
                s.matched_spotify,
                s.read_error
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_gsmtc_poll_returns_structured_status_without_panicking() {
        let _winrt_guard = WinRtMtaGuard::init();
        let mut detector = SpotifyDetector::new();
        let status = detector.poll_status();
        let report = detector.poll_with_raw(None, "unit_test");

        assert!(matches!(
            status.connection_state,
            SpotifyConnectionState::Connected
                | SpotifyConnectionState::NotDetected
                | SpotifyConnectionState::Unavailable
        ));
        assert!(matches!(
            report.status.connection_state,
            SpotifyConnectionState::Connected
                | SpotifyConnectionState::NotDetected
                | SpotifyConnectionState::Unavailable
        ));

        if report.status.connection_state == SpotifyConnectionState::NotDetected {
            assert!(report.status.title.is_none());
            assert!(report.status.artist.is_none());
            assert!(report.status.album.is_none());
            assert!(report.status.artwork.is_none());
        }
    }

    #[test]
    fn raw_session_summary_captures_unfiltered_fields() {
        let sessions = vec![
            RawSessionDiagnostic {
                index: 0,
                source_app_id: "chrome.exe".to_string(),
                playback_status: PlaybackStatus::Paused,
                title: Some("Video".to_string()),
                artist: Some("Channel".to_string()),
                album: None,
                matched_spotify: false,
                read_error: None,
            },
            RawSessionDiagnostic {
                index: 1,
                source_app_id: "Spotify.exe".to_string(),
                playback_status: PlaybackStatus::Playing,
                title: Some("Track".to_string()),
                artist: Some("Artist".to_string()),
                album: Some("Album".to_string()),
                matched_spotify: true,
                read_error: None,
            },
        ];

        let summary = summarize_raw_sessions(&sessions);
        assert!(summary.contains("chrome.exe"));
        assert!(summary.contains("spotify=false"));
        assert!(summary.contains("Spotify.exe"));
        assert!(summary.contains("spotify=true"));
    }
}
