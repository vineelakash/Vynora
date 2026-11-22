use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use windows::core::RuntimeType;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus, SessionsChangedEventArgs,
};
use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, S_FALSE};
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
use windows_future::{AsyncOperationCompletedHandler, AsyncStatus, IAsyncOperation};

use super::metadata::{normalize_optional_text, PlaybackStatus};
use super::spotify::is_spotify_source_app_id;
use crate::diagnostics;

pub const DEFAULT_WINRT_TIMEOUT: Duration = Duration::from_millis(1200);

pub struct WinRtMtaGuard {
    should_uninitialize: bool,
    pub status_label: String,
}

impl WinRtMtaGuard {
    pub fn init() -> Self {
        let result = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let (should_uninitialize, status_label) = match result {
            Ok(()) => (true, "0x00000000 S_OK (MTA initialized)".to_string()),
            Err(err) => {
                let code = err.code();
                if code == S_FALSE {
                    (true, "0x00000001 S_FALSE (MTA already initialized)".to_string())
                } else if code == RPC_E_CHANGED_MODE {
                    (
                        false,
                        "0x80010106 RPC_E_CHANGED_MODE (thread already initialized as STA)".to_string(),
                    )
                } else {
                    (false, format!("Error 0x{:08X}: {err}", code.0 as u32))
                }
            }
        };

        diagnostics::log_event(
            "media",
            "ro_init",
            format!("RoInitialize(RO_INIT_MULTITHREADED) -> {status_label}"),
        );

        Self {
            should_uninitialize,
            status_label,
        }
    }
}

impl Drop for WinRtMtaGuard {
    fn drop(&mut self) {
        if self.should_uninitialize {
            unsafe {
                RoUninitialize();
            }
        }
    }
}

pub fn wait_async_op<T: RuntimeType>(
    op: &IAsyncOperation<T>,
    timeout: Duration,
    label: &str,
) -> Result<T, String> {
    let status = op
        .Status()
        .map_err(|err| format!("{label}: failed to query AsyncStatus: {err}"))?;

    if status == AsyncStatus::Started {
        let pair = Arc::new((Mutex::new(false), Condvar::new()));
        let pair_cb = Arc::clone(&pair);

        let handler = AsyncOperationCompletedHandler::<T>::new(move |_, _| {
            let (lock, cvar) = &*pair_cb;
            if let Ok(mut completed) = lock.lock() {
                *completed = true;
                cvar.notify_all();
            }
            Ok(())
        });

        op.SetCompleted(&handler)
            .map_err(|err| format!("{label}: failed to attach completion handler: {err}"))?;

        let (lock, cvar) = &*pair;
        let guard = lock
            .lock()
            .map_err(|_| format!("{label}: completion mutex poisoned"))?;
        let (guard, wait_res) = cvar
            .wait_timeout_while(guard, timeout, |completed| !*completed)
            .map_err(|_| format!("{label}: completion wait poisoned"))?;

        if !*guard && wait_res.timed_out() {
            return Err(format!("{label} timed out after {}ms", timeout.as_millis()));
        }
    }

    op.GetResults()
        .map_err(|err| format!("{label} failed: {err}"))
}

pub struct EnumeratedSession {
    pub index: usize,
    pub session: GlobalSystemMediaTransportControlsSession,
    pub source_app_id: String,
    pub raw_playback_status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    pub playback_status: PlaybackStatus,
    pub media_properties: Option<GlobalSystemMediaTransportControlsSessionMediaProperties>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub matched_spotify: bool,
    pub read_error: Option<String>,
}

pub struct EnumeratedSnapshot {
    pub current_session_app_id: Option<String>,
    pub sessions: Vec<EnumeratedSession>,
}

#[derive(Default)]
pub struct GsmtcClient {
    manager: Option<GlobalSystemMediaTransportControlsSessionManager>,
    sessions_changed_token: Option<i64>,
    current_changed_token: Option<i64>,
}

impl GsmtcClient {
    pub fn invalidate(&mut self) {
        if let Some(manager) = &self.manager {
            if let Some(token) = self.sessions_changed_token.take() {
                let _ = manager.RemoveSessionsChanged(token);
            }
            if let Some(token) = self.current_changed_token.take() {
                let _ = manager.RemoveCurrentSessionChanged(token);
            }
        }
        self.manager = None;
    }

    fn ensure_manager(
        &mut self,
    ) -> Result<&GlobalSystemMediaTransportControlsSessionManager, String> {
        if self.manager.is_none() {
            diagnostics::log_event(
                "media",
                "gsmtc_request_manager",
                "Calling GlobalSystemMediaTransportControlsSessionManager::RequestAsync()",
            );
            let operation = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|err| format!("Failed to request Windows GSMTC session manager: {err}"))?;
            let manager = wait_async_op(&operation, Duration::from_millis(2000), "GSMTC::RequestAsync")?;

            diagnostics::log_event(
                "media",
                "gsmtc_manager_ready",
                "Acquired Windows GSMTC session manager",
            );

            self.manager = Some(manager);
        }

        self.manager
            .as_ref()
            .ok_or_else(|| "Windows GSMTC session manager unavailable".to_string())
    }

    pub fn ensure_manager_with_wake(
        &mut self,
        wake: Arc<dyn Fn() + Send + Sync>,
    ) -> Result<(), String> {
        let had_manager = self.manager.is_some();
        let _ = self.ensure_manager()?;

        if !had_manager || self.sessions_changed_token.is_none() {
            if let Some(manager) = &self.manager {
                let wake_sessions = Arc::clone(&wake);
                let sessions_handler = TypedEventHandler::<
                    GlobalSystemMediaTransportControlsSessionManager,
                    SessionsChangedEventArgs,
                >::new(move |_, _| {
                    wake_sessions();
                    Ok(())
                });
                match manager.SessionsChanged(&sessions_handler) {
                    Ok(token) => self.sessions_changed_token = Some(token),
                    Err(err) => diagnostics::log_event(
                        "media",
                        "gsmtc_event_warn",
                        format!("Failed to subscribe SessionsChanged: {err}"),
                    ),
                }

                let wake_current = Arc::clone(&wake);
                let current_handler = TypedEventHandler::<
                    GlobalSystemMediaTransportControlsSessionManager,
                    CurrentSessionChangedEventArgs,
                >::new(move |_, _| {
                    wake_current();
                    Ok(())
                });
                match manager.CurrentSessionChanged(&current_handler) {
                    Ok(token) => self.current_changed_token = Some(token),
                    Err(err) => diagnostics::log_event(
                        "media",
                        "gsmtc_event_warn",
                        format!("Failed to subscribe CurrentSessionChanged: {err}"),
                    ),
                }
            }
        }

        Ok(())
    }

    pub fn enumerate_snapshot(
        &mut self,
        wake: Option<Arc<dyn Fn() + Send + Sync>>,
    ) -> Result<EnumeratedSnapshot, String> {
        match self.try_enumerate_snapshot(wake.clone()) {
            Ok(snapshot) => Ok(snapshot),
            Err(first_err) => {
                diagnostics::log_event(
                    "media",
                    "gsmtc_retry",
                    format!("GSMTC enumeration error ('{first_err}'); invalidating manager and retrying once"),
                );
                self.invalidate();
                self.try_enumerate_snapshot(wake)
            }
        }
    }

    fn try_enumerate_snapshot(
        &mut self,
        wake: Option<Arc<dyn Fn() + Send + Sync>>,
    ) -> Result<EnumeratedSnapshot, String> {
        if let Some(w) = wake {
            self.ensure_manager_with_wake(w)?;
        } else {
            let _ = self.ensure_manager()?;
        }

        let manager = self
            .manager
            .as_ref()
            .ok_or_else(|| "Windows GSMTC session manager unavailable".to_string())?;

        let current_session_app_id = manager
            .GetCurrentSession()
            .ok()
            .and_then(|s| s.SourceAppUserModelId().ok())
            .map(|h| h.to_string_lossy());

        let vector = manager
            .GetSessions()
            .map_err(|err| format!("Failed to enumerate GSMTC sessions: {err}"))?;
        let count = vector
            .Size()
            .map_err(|err| format!("Failed to read GSMTC session count: {err}"))?;

        let mut sessions = Vec::with_capacity(count as usize);
        for index in 0..count {
            let Ok(session) = vector.GetAt(index) else {
                continue;
            };

            let source_app_id = match session.SourceAppUserModelId() {
                Ok(h) => h.to_string_lossy(),
                Err(err) => {
                    sessions.push(EnumeratedSession {
                        index: index as usize,
                        session,
                        source_app_id: "<unavailable>".to_string(),
                        raw_playback_status:
                            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed,
                        playback_status: PlaybackStatus::Unknown,
                        media_properties: None,
                        title: None,
                        artist: None,
                        album: None,
                        matched_spotify: false,
                        read_error: Some(format!("SourceAppUserModelId failed: {err}")),
                    });
                    continue;
                }
            };

            let matched_spotify = is_spotify_source_app_id(&source_app_id);

            let (raw_playback_status, pb_err) = match session.GetPlaybackInfo() {
                Ok(info) => match info.PlaybackStatus() {
                    Ok(st) => (st, None),
                    Err(err) => (
                        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened,
                        Some(format!("PlaybackStatus failed: {err}")),
                    ),
                },
                Err(err) => (
                    GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed,
                    Some(format!("GetPlaybackInfo failed: {err}")),
                ),
            };

            let playback_status = PlaybackStatus::from(raw_playback_status);

            let (media_properties, props_err) = match session.TryGetMediaPropertiesAsync() {
                Ok(op) => match wait_async_op(
                    &op,
                    DEFAULT_WINRT_TIMEOUT,
                    "GSMTC::TryGetMediaPropertiesAsync",
                ) {
                    Ok(props) => (Some(props), None),
                    Err(err) => (None, Some(err)),
                },
                Err(err) => (None, Some(format!("TryGetMediaPropertiesAsync failed: {err}"))),
            };

            let (title, artist, album) = match &media_properties {
                Some(props) => {
                    let title = props
                        .Title()
                        .ok()
                        .and_then(|s| normalize_optional_text(&s.to_string_lossy()));
                    let artist = props
                        .Artist()
                        .ok()
                        .and_then(|s| normalize_optional_text(&s.to_string_lossy()))
                        .or_else(|| {
                            props
                                .AlbumArtist()
                                .ok()
                                .and_then(|s| normalize_optional_text(&s.to_string_lossy()))
                        });
                    let album = props
                        .AlbumTitle()
                        .ok()
                        .and_then(|s| normalize_optional_text(&s.to_string_lossy()));
                    (title, artist, album)
                }
                None => (None, None, None),
            };

            let read_error = match (pb_err, props_err) {
                (Some(a), Some(b)) => Some(format!("{a}; {b}")),
                (Some(a), None) | (None, Some(a)) => Some(a),
                (None, None) => None,
            };

            sessions.push(EnumeratedSession {
                index: index as usize,
                session,
                source_app_id,
                raw_playback_status,
                playback_status,
                media_properties,
                title,
                artist,
                album,
                matched_spotify,
                read_error,
            });
        }

        Ok(EnumeratedSnapshot {
            current_session_app_id,
            sessions,
        })
    }
}

impl Drop for GsmtcClient {
    fn drop(&mut self) {
        self.invalidate();
    }
}
