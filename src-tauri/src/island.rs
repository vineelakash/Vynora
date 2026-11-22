use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Position,
    Rect, Size, WebviewWindow,
};

use crate::diagnostics::{self, RuntimeLogEntry};
use crate::media::metadata::PlaybackStatus;
use crate::media::{SpotifyConnectionState, SpotifyStatus};

pub const ISLAND_WINDOW_LABEL: &str = "island";
pub const ISLAND_STATE_EVENT: &str = "island-state-changed";
pub const DISPLAYS_CHANGED_EVENT: &str = "displays-changed";

pub const COMPACT_WINDOW_WIDTH: f64 = 324.0;
pub const COMPACT_WINDOW_HEIGHT: f64 = 74.0;
pub const EXPANDED_WINDOW_WIDTH: f64 = 424.0;
pub const EXPANDED_WINDOW_HEIGHT: f64 = 244.0;
pub const TOP_MARGIN_LOGICAL: f64 = 10.0;
const HIDE_ANIMATION_DELAY_MS: u64 = 300;
const MAIN_THREAD_TIMEOUT_MS: u64 = 2500;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub index: usize,
    pub name: String,
    pub position_x: i32,
    pub position_y: i32,
    pub width_px: u32,
    pub height_px: u32,
    pub work_area_x: i32,
    pub work_area_y: i32,
    pub work_area_width: u32,
    pub work_area_height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IslandUiState {
    pub visible: bool,
    pub expanded: bool,
    pub user_hidden: bool,
    pub follow_primary: bool,
    pub selected_display_index: usize,
    pub spotify_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWindowDiagnostics {
    pub label: String,
    pub exists: bool,
    pub hwnd_hex: Option<String>,
    pub win32_is_window: Option<bool>,
    pub tauri_visible: Option<bool>,
    pub win32_visible: Option<bool>,
    pub win32_minimized: Option<bool>,
    pub dwm_cloaked: Option<u32>,
    pub outer_x: Option<i32>,
    pub outer_y: Option<i32>,
    pub inner_width: Option<u32>,
    pub inner_height: Option<u32>,
    pub win32_rect_left: Option<i32>,
    pub win32_rect_top: Option<i32>,
    pub win32_rect_right: Option<i32>,
    pub win32_rect_bottom: Option<i32>,
    pub win32_rect_width: Option<i32>,
    pub win32_rect_height: Option<i32>,
    pub foreground_hwnd_hex: Option<String>,
    pub is_foreground: Option<bool>,
    pub scale_factor: Option<f64>,
    pub current_monitor_name: Option<String>,
    pub style_hex: Option<String>,
    pub ex_style_hex: Option<String>,
    pub is_topmost: Option<bool>,
    pub is_tool_window: Option<bool>,
    pub is_app_window: Option<bool>,
    pub is_no_redirection_bitmap: Option<bool>,
    pub is_no_activate: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandDiagnosticsSnapshot {
    pub state: IslandUiState,
    pub webview_loaded: bool,
    pub webview_load_source: Option<String>,
    pub last_error: Option<String>,
    pub displays: Vec<DisplayInfo>,
    pub native_window: NativeWindowDiagnostics,
    pub logs: Vec<RuntimeLogEntry>,
}

#[derive(Debug)]
struct IslandInner {
    visible: bool,
    expanded: bool,
    user_hidden: bool,
    follow_primary: bool,
    selected_display_index: usize,
    pinned_monitor_name: Option<String>,
    last_monitor_signature: String,
    spotify_active: bool,
    transition_gen: u64,
    expected_rect: Option<(i32, i32, u32, u32)>,
    webview_loaded: bool,
    webview_load_source: Option<String>,
    last_error: Option<String>,
}

impl Default for IslandInner {
    fn default() -> Self {
        Self {
            visible: false,
            expanded: false,
            user_hidden: false,
            follow_primary: true,
            selected_display_index: 0,
            pinned_monitor_name: None,
            last_monitor_signature: String::new(),
            spotify_active: false,
            transition_gen: 0,
            expected_rect: None,
            webview_loaded: false,
            webview_load_source: None,
            last_error: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct IslandController {
    inner: Arc<Mutex<IslandInner>>,
    applying_geometry: Arc<AtomicBool>,
}

impl IslandController {
    pub fn new() -> Self {
        Self::default()
    }

    fn log(&self, stage: &str, message: impl Into<String>) {
        diagnostics::log_event("island", stage, message);
    }

    fn record_error(&self, stage: &str, err: String) -> String {
        if let Ok(mut guard) = self.inner.lock() {
            guard.last_error = Some(err.clone());
        }
        self.log(stage, err.clone());
        err
    }

    pub fn get_state(&self) -> IslandUiState {
        let guard = self.inner.lock().expect("island state mutex poisoned");
        snapshot_from(&guard)
    }

    pub fn get_diagnostics(&self, app: &AppHandle) -> IslandDiagnosticsSnapshot {
        let displays = self.get_available_displays(app);
        let (state, webview_loaded, webview_load_source, last_error) = {
            let guard = self.inner.lock().expect("island state mutex poisoned");
            (
                snapshot_from(&guard),
                guard.webview_loaded,
                guard.webview_load_source.clone(),
                guard.last_error.clone(),
            )
        };
        let native_window = inspect_native_window(app);
        let logs = diagnostics::recent_entries(Some("island"));

        IslandDiagnosticsSnapshot {
            state,
            webview_loaded,
            webview_load_source,
            last_error,
            displays,
            native_window,
            logs,
        }
    }

    pub fn initialize_selection(&self, app: &AppHandle) {
        let monitors = app.available_monitors().unwrap_or_default();
        let primary = app.primary_monitor().ok().flatten();
        let displays = build_display_infos(&monitors, primary.as_ref());
        let signature = build_monitor_signature(&displays);
        let primary_index = resolve_primary_index(&monitors, primary.as_ref());

        {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.follow_primary = true;
            guard.pinned_monitor_name = None;
            guard.selected_display_index = primary_index;
            guard.last_monitor_signature = signature;
        }

        let Some(island_win) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
            self.record_error(
                "startup_error",
                "Island window ('island') was NOT created at startup; check tauri.conf.json"
                    .to_string(),
            );
            return;
        };

        self.log(
            "startup_init",
            format!(
                "Island window created (label='{}'); detected {} monitor(s), primary_index={primary_index}, displays={}",
                island_win.label(),
                displays.len(),
                summarize_displays(&displays)
            ),
        );

        let initial_diag = inspect_native_window_ref(&island_win);
        self.log(
            "startup_hwnd",
            format!(
                "label='{}' HWND={:?} is_window={:?} tauri_vis={:?} win32_vis={:?} iconic={:?} topmost={:?} no_redir_bmp={:?} cloaked={:?} win32_rect=({:?},{:?},{:?}x{:?}) fg_hwnd={:?} dpi_scale={:?} style={:?} ex={:?}",
                initial_diag.label,
                initial_diag.hwnd_hex,
                initial_diag.win32_is_window,
                initial_diag.tauri_visible,
                initial_diag.win32_visible,
                initial_diag.win32_minimized,
                initial_diag.is_topmost,
                initial_diag.is_no_redirection_bitmap,
                initial_diag.dwm_cloaked,
                initial_diag.win32_rect_left,
                initial_diag.win32_rect_top,
                initial_diag.win32_rect_width,
                initial_diag.win32_rect_height,
                initial_diag.foreground_hwnd_hex,
                initial_diag.scale_factor,
                initial_diag.style_hex,
                initial_diag.ex_style_hex
            ),
        );

        self.schedule_apply_geometry(app, false, primary_index, true);
    }

    pub fn get_available_displays(&self, app: &AppHandle) -> Vec<DisplayInfo> {
        let monitors = app.available_monitors().unwrap_or_default();
        let primary = app.primary_monitor().ok().flatten();
        build_display_infos(&monitors, primary.as_ref())
    }

    pub fn sync_display_topology(&self, app: &AppHandle) -> bool {
        let monitors = app.available_monitors().unwrap_or_default();
        let primary = app.primary_monitor().ok().flatten();
        let displays = build_display_infos(&monitors, primary.as_ref());
        let signature = build_monitor_signature(&displays);
        let primary_index = resolve_primary_index(&monitors, primary.as_ref());

        let changed = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            if guard.last_monitor_signature == signature {
                None
            } else {
                let prev_sig = guard.last_monitor_signature.clone();
                let next_selection = resolve_next_selection(
                    &displays,
                    guard.follow_primary,
                    guard.selected_display_index,
                    guard.pinned_monitor_name.as_deref(),
                    primary_index,
                );
                guard.last_monitor_signature = signature.clone();
                guard.follow_primary = next_selection.follow_primary;
                guard.selected_display_index = next_selection.selected_display_index;
                guard.pinned_monitor_name = next_selection.pinned_monitor_name;
                Some((
                    prev_sig,
                    snapshot_from(&guard),
                    guard.expanded,
                    guard.visible,
                ))
            }
        };

        let Some((prev_sig, ui_state, expanded, visible)) = changed else {
            return false;
        };

        self.log(
            "display_topology_changed",
            format!(
                "Monitors changed ('{prev_sig}' -> '{signature}'); resolved display_index={} follow_primary={}",
                ui_state.selected_display_index, ui_state.follow_primary
            ),
        );

        self.emit_event(app, DISPLAYS_CHANGED_EVENT, &displays);
        self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);

        if visible {
            self.schedule_show_window(app, expanded, ui_state.selected_display_index, true);
        } else {
            self.schedule_apply_geometry(app, false, ui_state.selected_display_index, true);
        }

        true
    }

    pub fn on_spotify_status(&self, app: &AppHandle, status: &SpotifyStatus) {
        self.sync_display_topology(app);

        let active = is_spotify_session_active(status);

        enum Action {
            CheckHealth {
                visible: bool,
                expanded: bool,
                display_index: usize,
                user_hidden: bool,
            },
            Show {
                ui_state: IslandUiState,
                display_index: usize,
            },
            Hide {
                ui_state: IslandUiState,
                gen: u64,
                display_index: usize,
            },
            EmitOnly(IslandUiState),
        }

        let action = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            if guard.spotify_active == active {
                Action::CheckHealth {
                    visible: guard.visible,
                    expanded: guard.expanded,
                    display_index: guard.selected_display_index,
                    user_hidden: guard.user_hidden,
                }
            } else if active {
                guard.spotify_active = true;
                guard.user_hidden = false;
                guard.expanded = false;
                guard.visible = true;
                guard.transition_gen = guard.transition_gen.wrapping_add(1);
                Action::Show {
                    ui_state: snapshot_from(&guard),
                    display_index: guard.selected_display_index,
                }
            } else {
                guard.spotify_active = false;
                guard.user_hidden = false;
                guard.expanded = false;
                let was_visible = guard.visible;
                guard.visible = false;
                guard.transition_gen = guard.transition_gen.wrapping_add(1);
                let ui_state = snapshot_from(&guard);
                if was_visible {
                    Action::Hide {
                        ui_state,
                        gen: guard.transition_gen,
                        display_index: guard.selected_display_index,
                    }
                } else {
                    Action::EmitOnly(ui_state)
                }
            }
        };

        match action {
            Action::CheckHealth {
                visible,
                expanded,
                display_index,
                user_hidden,
            } => {
                if visible && !user_hidden {
                    if let Some(island) = app.get_webview_window(ISLAND_WINDOW_LABEL) {
                        let native = inspect_native_window_ref(&island);
                        let is_missing_native = native.win32_visible == Some(false)
                            || native.tauri_visible == Some(false)
                            || native.win32_minimized == Some(true);
                        if is_missing_native {
                            self.log(
                                "self_heal",
                                format!(
                                    "Logical state is visible=true but native HWND drifted (tauri_vis={:?}, win32_vis={:?}, iconic={:?}); restoring",
                                    native.tauri_visible, native.win32_visible, native.win32_minimized
                                ),
                            );
                            self.schedule_show_window(app, expanded, display_index, false);
                        }
                    }
                }
            }
            Action::EmitOnly(ui_state) => {
                self.log(
                    "spotify_status",
                    format!(
                        "Spotify inactive (conn={:?}, playback={:?}, title={:?}); island visible={}",
                        status.connection_state, status.playback_status, status.title, ui_state.visible
                    ),
                );
                self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
            }
            Action::Show {
                ui_state,
                display_index,
            } => {
                self.log(
                    "spotify_status",
                    format!(
                        "Spotify active (conn={:?}, playback={:?}, title={:?}) -> showing island on display_index={display_index}",
                        status.connection_state, status.playback_status, status.title
                    ),
                );
                self.schedule_show_window(app, false, display_index, false);
                self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
            }
            Action::Hide {
                ui_state,
                gen,
                display_index,
            } => {
                self.log(
                    "spotify_status",
                    format!(
                        "Spotify session ended (conn={:?}, playback={:?}) -> hiding island gracefully",
                        status.connection_state, status.playback_status
                    ),
                );
                self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
                self.schedule_delayed_hide(app.clone(), gen, display_index);
            }
        }
    }

    pub async fn show_island_async(&self, app: &AppHandle) -> Result<IslandUiState, String> {
        self.sync_display_topology(app);

        let (display_index, expanded, spotify_active, webview_loaded) = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.user_hidden = false;
            guard.visible = true;
            guard.transition_gen = guard.transition_gen.wrapping_add(1);
            guard.last_error = None;
            (
                guard.selected_display_index,
                guard.expanded,
                guard.spotify_active,
                guard.webview_loaded,
            )
        };

        self.log(
            "show_island_cmd",
            format!(
                "Command show_island invoked: display_index={display_index}, expanded={expanded}, spotify_active={spotify_active}, webview_loaded={webview_loaded}"
            ),
        );

        let app_handle = app.clone();
        let controller = self.clone();
        let show_result = run_on_main_thread_blocking(app, move || {
            controller.show_window_sync(&app_handle, expanded, display_index)
        })
        .await;

        match show_result {
            Ok(diag) => {
                let ui_state = self.get_state();
                self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
                self.log(
                    "show_island_ok",
                    format!(
                        "show_island succeeded: HWND={:?} win32_vis={:?} rect=({:?},{:?},{:?}x{:?}) topmost={:?}",
                        diag.hwnd_hex,
                        diag.win32_visible,
                        diag.win32_rect_left,
                        diag.win32_rect_top,
                        diag.win32_rect_width,
                        diag.win32_rect_height,
                        diag.is_topmost
                    ),
                );
                Ok(ui_state)
            }
            Err(err) => {
                {
                    let mut guard = self.inner.lock().expect("island state mutex poisoned");
                    guard.visible = false;
                    guard.last_error = Some(err.clone());
                }
                let ui_state = self.get_state();
                self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
                self.log("show_island_err", format!("show_island failed: {err}"));
                Err(err)
            }
        }
    }

    pub fn hide_island(&self, app: &AppHandle) -> Result<IslandUiState, String> {
        let Some(_) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
            return Err(self.record_error(
                "hide_error",
                "Cannot hide island: 'island' window not found".to_string(),
            ));
        };

        let (ui_state, gen, display_index, was_visible) = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.user_hidden = true;
            let was_visible = guard.visible;
            guard.visible = false;
            guard.expanded = false;
            guard.transition_gen = guard.transition_gen.wrapping_add(1);
            guard.last_error = None;
            (
                snapshot_from(&guard),
                guard.transition_gen,
                guard.selected_display_index,
                was_visible,
            )
        };

        self.log(
            "hide_island",
            format!("Manual hide requested (was_visible={was_visible}, display_index={display_index})"),
        );

        self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
        if was_visible {
            self.schedule_delayed_hide(app.clone(), gen, display_index);
        }
        Ok(ui_state)
    }

    pub async fn set_expanded_async(
        &self,
        app: &AppHandle,
        expanded: bool,
    ) -> Result<IslandUiState, String> {
        let (ui_state, display_index, visible) = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.expanded = expanded;
            (
                snapshot_from(&guard),
                guard.selected_display_index,
                guard.visible,
            )
        };

        self.log(
            "set_expanded",
            format!(
                "Island mode -> {} (visible={visible}, display_index={display_index})",
                if expanded { "expanded" } else { "compact" }
            ),
        );

        if visible {
            let app_handle = app.clone();
            let controller = self.clone();
            run_on_main_thread_blocking(app, move || {
                let Some(island) = app_handle.get_webview_window(ISLAND_WINDOW_LABEL) else {
                    return Err("Cannot resize island: 'island' window missing".to_string());
                };
                controller.apply_geometry_sync(&island, &app_handle, expanded, display_index);
                Ok(())
            })
            .await?;
        }

        self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
        Ok(ui_state)
    }

    pub async fn set_display_index_async(
        &self,
        app: &AppHandle,
        display_index: usize,
    ) -> Result<IslandUiState, String> {
        let monitors = app.available_monitors().unwrap_or_default();
        let primary = app.primary_monitor().ok().flatten();
        let displays = build_display_infos(&monitors, primary.as_ref());
        let count = displays.len().max(1);
        let clamped_index = display_index.min(count.saturating_sub(1));
        let pinned_name = displays.get(clamped_index).map(|d| d.name.clone());

        let (ui_state, expanded, visible) = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.follow_primary = false;
            guard.selected_display_index = clamped_index;
            guard.pinned_monitor_name = pinned_name.clone();
            guard.last_error = None;
            (snapshot_from(&guard), guard.expanded, guard.visible)
        };

        self.log(
            "set_display",
            format!("User selected explicit display_index={clamped_index} ({pinned_name:?})"),
        );

        let app_handle = app.clone();
        let controller = self.clone();
        run_on_main_thread_blocking(app, move || {
            if visible {
                controller
                    .show_window_sync(&app_handle, expanded, clamped_index)
                    .map(|_| ())
            } else if let Some(island) = app_handle.get_webview_window(ISLAND_WINDOW_LABEL) {
                controller.apply_geometry_sync(&island, &app_handle, expanded, clamped_index);
                Ok(())
            } else {
                Err("Island window ('island') missing".to_string())
            }
        })
        .await?;

        self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
        Ok(ui_state)
    }

    pub async fn set_follow_primary_async(&self, app: &AppHandle) -> Result<IslandUiState, String> {
        let monitors = app.available_monitors().unwrap_or_default();
        let primary = app.primary_monitor().ok().flatten();
        let displays = build_display_infos(&monitors, primary.as_ref());
        let primary_index = resolve_primary_index(&monitors, primary.as_ref());

        let (ui_state, expanded, visible) = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.follow_primary = true;
            guard.pinned_monitor_name = None;
            guard.selected_display_index = primary_index;
            guard.last_monitor_signature = build_monitor_signature(&displays);
            guard.last_error = None;
            (snapshot_from(&guard), guard.expanded, guard.visible)
        };

        self.log(
            "set_follow_primary",
            format!("Display mode set to Primary (Auto) -> resolved index={primary_index}"),
        );

        let app_handle = app.clone();
        let controller = self.clone();
        run_on_main_thread_blocking(app, move || {
            if visible {
                controller
                    .show_window_sync(&app_handle, expanded, primary_index)
                    .map(|_| ())
            } else if let Some(island) = app_handle.get_webview_window(ISLAND_WINDOW_LABEL) {
                controller.apply_geometry_sync(&island, &app_handle, expanded, primary_index);
                Ok(())
            } else {
                Err("Island window ('island') missing".to_string())
            }
        })
        .await?;

        self.emit_event(app, ISLAND_STATE_EVENT, &ui_state);
        Ok(ui_state)
    }

    pub fn on_webview_ready(&self, app: &AppHandle, source: &str) {
        let (visible, expanded, display_index) = {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.webview_loaded = true;
            guard.webview_load_source = Some(source.to_string());
            (guard.visible, guard.expanded, guard.selected_display_index)
        };

        self.log(
            "webview_ready",
            format!(
                "Island WebView ready via '{source}' (visible={visible}, expanded={expanded}, display_index={display_index})"
            ),
        );

        if visible {
            self.schedule_show_window(app, expanded, display_index, false);
        }
    }

    pub fn on_window_moved(&self, app: &AppHandle, actual_x: i32, actual_y: i32) {
        if self.applying_geometry.load(Ordering::SeqCst) {
            return;
        }

        let (visible, expanded, display_index, expected_rect) = {
            let guard = self.inner.lock().expect("island state mutex poisoned");
            (
                guard.visible,
                guard.expanded,
                guard.selected_display_index,
                guard.expected_rect,
            )
        };

        if !visible {
            return;
        }

        if let Some((exp_x, exp_y, _, _)) = expected_rect {
            if (actual_x - exp_x).abs() > 4 || (actual_y - exp_y).abs() > 4 {
                self.log(
                    "window_moved_drift",
                    format!(
                        "Detected unexpected HWND move to ({actual_x},{actual_y}); expected ({exp_x},{exp_y}); resyncing"
                    ),
                );
                self.schedule_apply_geometry(app, expanded, display_index, false);
            }
        }
    }

    pub fn reposition(&self, app: &AppHandle, reason: &str) {
        self.sync_display_topology(app);

        let (visible, expanded, display_index) = {
            let guard = self.inner.lock().expect("island state mutex poisoned");
            (guard.visible, guard.expanded, guard.selected_display_index)
        };

        self.log(
            "reposition",
            format!(
                "Repositioning island (reason={reason}, visible={visible}, expanded={expanded}, display_index={display_index})"
            ),
        );

        self.schedule_apply_geometry(app, expanded, display_index, !visible);
    }

    fn emit_event<S: Serialize + ?Sized>(&self, app: &AppHandle, event: &str, payload: &S) {
        if let Err(err) = app.emit(event, payload) {
            self.log("emit_error", format!("Failed to emit '{event}': {err}"));
        }
    }

    fn schedule_apply_geometry(
        &self,
        app: &AppHandle,
        expanded: bool,
        display_index: usize,
        allow_when_hidden: bool,
    ) {
        let app_handle = app.clone();
        let controller = self.clone();
        if let Err(err) = app.run_on_main_thread(move || {
            let still_matches = {
                let guard = controller.inner.lock().expect("island state mutex poisoned");
                guard.visible || allow_when_hidden
            };
            if !still_matches {
                return;
            }
            if let Some(island) = app_handle.get_webview_window(ISLAND_WINDOW_LABEL) {
                controller.apply_geometry_sync(&island, &app_handle, expanded, display_index);
            } else {
                controller.log(
                    "window_missing",
                    "Cannot apply geometry: 'island' WebviewWindow not found",
                );
            }
        }) {
            self.log(
                "main_thread_error",
                format!("Failed to queue apply_geometry onto main thread: {err}"),
            );
        }
    }

    fn schedule_show_window(
        &self,
        app: &AppHandle,
        expanded: bool,
        display_index: usize,
        sync_styles_only_if_visible: bool,
    ) {
        let app_handle = app.clone();
        let controller = self.clone();
        let gen = {
            let guard = self.inner.lock().expect("island state mutex poisoned");
            guard.transition_gen
        };

        if let Err(err) = app.run_on_main_thread(move || {
            let (is_visible, current_expanded, current_display, current_gen) = {
                let guard = controller.inner.lock().expect("island state mutex poisoned");
                (
                    guard.visible,
                    guard.expanded,
                    guard.selected_display_index,
                    guard.transition_gen,
                )
            };

            if !is_visible || (!sync_styles_only_if_visible && current_gen != gen) {
                return;
            }

            let eff_expanded = if current_gen == gen {
                expanded
            } else {
                current_expanded
            };
            let eff_display = if current_gen == gen {
                display_index
            } else {
                current_display
            };

            if let Err(err) = controller.show_window_sync(&app_handle, eff_expanded, eff_display) {
                controller.record_error("show_error", err);
            }
        }) {
            self.log(
                "main_thread_error",
                format!("Failed to queue show_window onto main thread: {err}"),
            );
        }
    }

    fn show_window_sync(
        &self,
        app: &AppHandle,
        expanded: bool,
        display_index: usize,
    ) -> Result<NativeWindowDiagnostics, String> {
        let Some(island) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
            return Err("Native window lookup failed: 'island' WebviewWindow does not exist".into());
        };

        let pre = inspect_native_window_ref(&island);
        if pre.win32_is_window == Some(false) {
            return Err(format!(
                "Island HWND {:?} is not a valid Win32 window (IsWindow=false)",
                pre.hwnd_hex
            ));
        }

        if let Ok(true) = island.is_minimized() {
            self.log("show_window", "Island was minimized; calling unminimize()");
            island
                .unminimize()
                .map_err(|err| format!("island.unminimize() failed: {err}"))?;
        }

        let rect = self.apply_geometry_sync(&island, app, expanded, display_index);

        island
            .set_always_on_top(true)
            .map_err(|err| format!("island.set_always_on_top(true) failed: {err}"))?;
        if let Err(err) = island.set_skip_taskbar(true) {
            self.log(
                "show_warn",
                format!("island.set_skip_taskbar(true) warning: {err}"),
            );
        }

        island
            .show()
            .map_err(|err| format!("island.show() failed: {err}"))?;

        if let Err(err) = island.set_skip_taskbar(true) {
            self.log(
                "show_warn",
                format!("post-show island.set_skip_taskbar(true) warning: {err}"),
            );
        }

        let webview: &tauri::Webview = island.as_ref();
        webview
            .show()
            .map_err(|err| format!("webview.show() failed: {err}"))?;

        if let Some((_, _, w, h)) = rect {
            webview
                .set_bounds(Rect {
                    position: Position::Physical(PhysicalPosition::new(0, 0)),
                    size: Size::Physical(PhysicalSize::new(w, h)),
                })
                .map_err(|err| format!("webview.set_bounds({w}x{h}) failed: {err}"))?;
        }

        #[cfg(target_os = "windows")]
        enforce_win32_overlay_after_show(&island, rect, &|stage, msg| self.log(stage, msg))?;

        let post = inspect_native_window_ref(&island);
        self.log(
            "show_complete",
            format!(
                "label='{}' HWND={:?} is_window={:?} tauri_vis={:?} win32_vis={:?} iconic={:?} topmost={:?} toolwin={:?} appwin={:?} no_redir_bmp={:?} cloaked={:?} win32_rect=({:?},{:?},{:?}x{:?}) fg_hwnd={:?} dpi_scale={:?} monitor={:?}",
                post.label,
                post.hwnd_hex,
                post.win32_is_window,
                post.tauri_visible,
                post.win32_visible,
                post.win32_minimized,
                post.is_topmost,
                post.is_tool_window,
                post.is_app_window,
                post.is_no_redirection_bitmap,
                post.dwm_cloaked,
                post.win32_rect_left,
                post.win32_rect_top,
                post.win32_rect_width,
                post.win32_rect_height,
                post.foreground_hwnd_hex,
                post.scale_factor,
                post.current_monitor_name
            ),
        );

        if post.win32_visible != Some(true) {
            return Err(format!(
                "Win32 IsWindowVisible returned {:?} after show (HWND={:?}, cloaked={:?}, rect={:?}x{:?})",
                post.win32_visible,
                post.hwnd_hex,
                post.dwm_cloaked,
                post.win32_rect_width,
                post.win32_rect_height
            ));
        }

        if post.win32_rect_width.unwrap_or(0) <= 0 || post.win32_rect_height.unwrap_or(0) <= 0 {
            return Err(format!(
                "Island HWND {:?} has invalid Win32 rect size {:?}x{:?}",
                post.hwnd_hex, post.win32_rect_width, post.win32_rect_height
            ));
        }

        Ok(post)
    }

    fn apply_geometry_sync(
        &self,
        island: &WebviewWindow,
        app: &AppHandle,
        expanded: bool,
        display_index: usize,
    ) -> Option<(i32, i32, u32, u32)> {
        self.applying_geometry.store(true, Ordering::SeqCst);
        let result = self.apply_geometry_sync_inner(island, app, expanded, display_index);
        self.applying_geometry.store(false, Ordering::SeqCst);
        result
    }

    fn apply_geometry_sync_inner(
        &self,
        island: &WebviewWindow,
        app: &AppHandle,
        expanded: bool,
        display_index: usize,
    ) -> Option<(i32, i32, u32, u32)> {
        let (logical_w, logical_h) = window_dimensions_for(expanded);
        let follow_primary = {
            let guard = self.inner.lock().expect("island state mutex poisoned");
            guard.follow_primary
        };

        let Some(monitor) = resolve_target_monitor(app, display_index, follow_primary) else {
            self.log(
                "geometry_warn",
                "No target monitor available; falling back to logical set_size",
            );
            if let Err(err) = island.set_size(Size::Logical(LogicalSize::new(logical_w, logical_h)))
            {
                self.log(
                    "geometry_error",
                    format!("Fallback set_size failed: {err}"),
                );
            }
            return None;
        };

        let scale = sanitize_scale(monitor.scale_factor());
        let work_area = monitor.work_area();
        let (x, y, phys_w, phys_h) = compute_top_center_physical_rect(
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
            scale,
            logical_w,
            logical_h,
            TOP_MARGIN_LOGICAL,
        );

        let target_pos = PhysicalPosition::new(x, y);
        let target_size = PhysicalSize::new(phys_w, phys_h);

        {
            let mut guard = self.inner.lock().expect("island state mutex poisoned");
            guard.expected_rect = Some((x, y, phys_w, phys_h));
        }

        if island.outer_position().ok() != Some(target_pos) {
            if let Err(err) = island.set_position(Position::Physical(target_pos)) {
                self.log(
                    "geometry_error",
                    format!("Initial set_position({x},{y}) failed: {err}"),
                );
            }
        }

        if island.inner_size().ok() != Some(target_size) {
            if let Err(err) = island.set_size(Size::Physical(target_size)) {
                self.log(
                    "geometry_error",
                    format!("set_size({phys_w}x{phys_h}) failed: {err}"),
                );
            }
        }

        if island.outer_position().ok() != Some(target_pos) {
            if let Err(err) = island.set_position(Position::Physical(target_pos)) {
                self.log(
                    "geometry_error",
                    format!("Final set_position({x},{y}) failed: {err}"),
                );
            }
        }

        #[cfg(target_os = "windows")]
        enforce_win32_geometry_sync(island, x, y, phys_w, phys_h, &|stage, msg| {
            self.log(stage, msg)
        });

        let webview: &tauri::Webview = island.as_ref();
        if let Err(err) = webview.set_bounds(Rect {
            position: Position::Physical(PhysicalPosition::new(0, 0)),
            size: Size::Physical(target_size),
        }) {
            self.log(
                "geometry_error",
                format!("webview.set_bounds({phys_w}x{phys_h}) failed: {err}"),
            );
        }

        let actual_pos = island.outer_position().ok();
        let actual_size = island.inner_size().ok();
        let actual_scale = island.scale_factor().ok();
        let monitor_name = monitor.name().cloned().unwrap_or_else(|| "Unknown".into());

        self.log(
            "geometry",
            format!(
                "target_mon='{monitor_name}'(idx={display_index},follow_primary={follow_primary}) work_area=({},{},{}x{}) scale={scale:.2} -> target=({x},{y},{phys_w}x{phys_h}) actual_pos={actual_pos:?} actual_size={actual_size:?} hwnd_scale={actual_scale:?}",
                work_area.position.x, work_area.position.y, work_area.size.width, work_area.size.height
            ),
        );

        Some((x, y, phys_w, phys_h))
    }

    fn schedule_delayed_hide(&self, app: AppHandle, gen: u64, display_index: usize) {
        let controller = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(Duration::from_millis(HIDE_ANIMATION_DELAY_MS));

            let should_hide = {
                let guard = controller.inner.lock().expect("island state mutex poisoned");
                guard.transition_gen == gen && !guard.visible
            };

            if should_hide {
                let app_for_main = app.clone();
                let controller_for_main = controller.clone();
                if let Err(err) = app.run_on_main_thread(move || {
                    let still_hidden = {
                        let guard = controller_for_main
                            .inner
                            .lock()
                            .expect("island state mutex poisoned");
                        guard.transition_gen == gen && !guard.visible
                    };
                    if !still_hidden {
                        return;
                    }
                    if let Some(island) = app_for_main.get_webview_window(ISLAND_WINDOW_LABEL) {
                        if let Err(err) = island.hide() {
                            controller_for_main
                                .log("hide_error", format!("island.hide() failed: {err}"));
                        } else {
                            controller_for_main
                                .log("hide_complete", "Island native window hidden after exit animation");
                        }
                        controller_for_main.apply_geometry_sync(
                            &island,
                            &app_for_main,
                            false,
                            display_index,
                        );
                    }
                }) {
                    controller.log(
                        "main_thread_error",
                        format!("Failed to queue delayed hide onto main thread: {err}"),
                    );
                }
            }
        });
    }
}

async fn run_on_main_thread_blocking<F, R>(app: &AppHandle, f: F) -> Result<R, String>
where
    F: FnOnce() -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let (tx, rx) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|err| format!("Failed to dispatch onto main UI thread: {err}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_millis(MAIN_THREAD_TIMEOUT_MS))
            .map_err(|err| format!("Timed out waiting for main UI thread operation: {err}"))?
    })
    .await
    .map_err(|err| format!("Async wait task failed: {err}"))?
}

struct NextDisplaySelection {
    follow_primary: bool,
    selected_display_index: usize,
    pinned_monitor_name: Option<String>,
}

fn resolve_next_selection(
    displays: &[DisplayInfo],
    follow_primary: bool,
    current_index: usize,
    pinned_name: Option<&str>,
    primary_index: usize,
) -> NextDisplaySelection {
    if displays.is_empty() {
        return NextDisplaySelection {
            follow_primary: true,
            selected_display_index: 0,
            pinned_monitor_name: None,
        };
    }

    if follow_primary {
        return NextDisplaySelection {
            follow_primary: true,
            selected_display_index: primary_index.min(displays.len().saturating_sub(1)),
            pinned_monitor_name: None,
        };
    }

    if let Some(name) = pinned_name {
        if let Some(found) = displays.iter().find(|d| d.name == name) {
            return NextDisplaySelection {
                follow_primary: false,
                selected_display_index: found.index,
                pinned_monitor_name: Some(found.name.clone()),
            };
        }
        return NextDisplaySelection {
            follow_primary: true,
            selected_display_index: primary_index.min(displays.len().saturating_sub(1)),
            pinned_monitor_name: None,
        };
    }

    if current_index < displays.len() {
        NextDisplaySelection {
            follow_primary: false,
            selected_display_index: current_index,
            pinned_monitor_name: displays.get(current_index).map(|d| d.name.clone()),
        }
    } else {
        NextDisplaySelection {
            follow_primary: true,
            selected_display_index: primary_index.min(displays.len().saturating_sub(1)),
            pinned_monitor_name: None,
        }
    }
}

fn snapshot_from(guard: &IslandInner) -> IslandUiState {
    IslandUiState {
        visible: guard.visible,
        expanded: guard.expanded,
        user_hidden: guard.user_hidden,
        follow_primary: guard.follow_primary,
        selected_display_index: guard.selected_display_index,
        spotify_active: guard.spotify_active,
    }
}

pub fn is_spotify_session_active(status: &SpotifyStatus) -> bool {
    if status.connection_state != SpotifyConnectionState::Connected {
        return false;
    }

    match status.playback_status {
        PlaybackStatus::Playing | PlaybackStatus::Paused => true,
        PlaybackStatus::Closed | PlaybackStatus::Unknown => false,
        _ => status.title.is_some() || status.artist.is_some(),
    }
}

pub fn window_dimensions_for(expanded: bool) -> (f64, f64) {
    if expanded {
        (EXPANDED_WINDOW_WIDTH, EXPANDED_WINDOW_HEIGHT)
    } else {
        (COMPACT_WINDOW_WIDTH, COMPACT_WINDOW_HEIGHT)
    }
}

pub fn sanitize_scale(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

pub fn compute_top_center_physical_rect(
    work_area_x: i32,
    work_area_y: i32,
    work_area_width: u32,
    work_area_height: u32,
    scale_factor: f64,
    logical_window_width: f64,
    logical_window_height: f64,
    logical_top_margin: f64,
) -> (i32, i32, u32, u32) {
    let scale = sanitize_scale(scale_factor);
    let phys_window_width = (logical_window_width * scale).round().max(1.0) as u32;
    let phys_window_height = (logical_window_height * scale).round().max(1.0) as u32;
    let phys_top_margin = (logical_top_margin * scale).round().max(0.0) as i32;

    let raw_x = work_area_x + ((work_area_width as i32 - phys_window_width as i32) / 2);
    let raw_y = work_area_y + phys_top_margin;

    let max_x = work_area_x + (work_area_width as i32 - phys_window_width as i32).max(0);
    let max_y = work_area_y + (work_area_height as i32 - phys_window_height as i32).max(0);

    let clamped_x = raw_x.clamp(work_area_x, max_x);
    let clamped_y = raw_y.clamp(work_area_y, max_y);

    (clamped_x, clamped_y, phys_window_width, phys_window_height)
}

#[cfg(test)]
pub fn compute_top_center_physical_position(
    work_area_x: i32,
    work_area_y: i32,
    work_area_width: u32,
    scale_factor: f64,
    logical_window_width: f64,
    logical_top_margin: f64,
) -> (i32, i32) {
    let (x, y, _, _) = compute_top_center_physical_rect(
        work_area_x,
        work_area_y,
        work_area_width,
        1080,
        scale_factor,
        logical_window_width,
        COMPACT_WINDOW_HEIGHT,
        logical_top_margin,
    );
    (x, y)
}

fn clean_monitor_name(monitor: &Monitor, index: usize) -> String {
    let raw_name = monitor
        .name()
        .cloned()
        .unwrap_or_else(|| format!("Display {}", index + 1));
    let clean_name = raw_name.trim_start_matches("\\\\.\\").to_string();
    if clean_name.is_empty() {
        format!("Display {}", index + 1)
    } else {
        clean_name
    }
}

fn monitors_match(a: &Monitor, b: &Monitor) -> bool {
    let same_geom = a.position() == b.position() && a.size() == b.size();
    if !same_geom {
        return false;
    }
    match (a.name(), b.name()) {
        (Some(na), Some(nb)) => na == nb,
        _ => true,
    }
}

fn resolve_primary_index(monitors: &[Monitor], primary: Option<&Monitor>) -> usize {
    if let Some(p) = primary {
        if let Some(idx) = monitors.iter().position(|m| monitors_match(m, p)) {
            return idx;
        }
        if let Some(idx) = monitors
            .iter()
            .position(|m| m.position() == p.position() && m.size() == p.size())
        {
            return idx;
        }
    }

    monitors
        .iter()
        .position(|m| m.position().x == 0 && m.position().y == 0)
        .unwrap_or(0)
}

fn build_display_infos(monitors: &[Monitor], primary: Option<&Monitor>) -> Vec<DisplayInfo> {
    let primary_index = resolve_primary_index(monitors, primary);

    monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let pos = monitor.position();
            let size = monitor.size();
            let wa = monitor.work_area();

            DisplayInfo {
                index,
                name: clean_monitor_name(monitor, index),
                position_x: pos.x,
                position_y: pos.y,
                width_px: size.width,
                height_px: size.height,
                work_area_x: wa.position.x,
                work_area_y: wa.position.y,
                work_area_width: wa.size.width,
                work_area_height: wa.size.height,
                scale_factor: monitor.scale_factor(),
                is_primary: index == primary_index,
            }
        })
        .collect()
}

fn build_monitor_signature(displays: &[DisplayInfo]) -> String {
    displays
        .iter()
        .map(|d| {
            format!(
                "{}:{}:{},{}@{}x{}:wa({},{},{}x{}):s{:.3}:p{}",
                d.index,
                d.name,
                d.position_x,
                d.position_y,
                d.width_px,
                d.height_px,
                d.work_area_x,
                d.work_area_y,
                d.work_area_width,
                d.work_area_height,
                d.scale_factor,
                u8::from(d.is_primary)
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn summarize_displays(displays: &[DisplayInfo]) -> String {
    displays
        .iter()
        .map(|d| {
            format!(
                "[#{} '{}' {}x{}@({},{}) wa=({},{},{}x{}) {}% primary={}]",
                d.index,
                d.name,
                d.width_px,
                d.height_px,
                d.position_x,
                d.position_y,
                d.work_area_x,
                d.work_area_y,
                d.work_area_width,
                d.work_area_height,
                (d.scale_factor * 100.0).round() as u32,
                d.is_primary
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn resolve_target_monitor(
    app: &AppHandle,
    display_index: usize,
    follow_primary: bool,
) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if follow_primary {
        return app
            .primary_monitor()
            .ok()
            .flatten()
            .or_else(|| {
                let idx = resolve_primary_index(&monitors, None);
                monitors.get(idx).cloned()
            })
            .or_else(|| monitors.into_iter().next());
    }

    monitors
        .get(display_index)
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next())
}

fn inspect_native_window(app: &AppHandle) -> NativeWindowDiagnostics {
    let Some(island) = app.get_webview_window(ISLAND_WINDOW_LABEL) else {
        return NativeWindowDiagnostics {
            label: ISLAND_WINDOW_LABEL.to_string(),
            exists: false,
            hwnd_hex: None,
            win32_is_window: Some(false),
            tauri_visible: None,
            win32_visible: None,
            win32_minimized: None,
            dwm_cloaked: None,
            outer_x: None,
            outer_y: None,
            inner_width: None,
            inner_height: None,
            win32_rect_left: None,
            win32_rect_top: None,
            win32_rect_right: None,
            win32_rect_bottom: None,
            win32_rect_width: None,
            win32_rect_height: None,
            foreground_hwnd_hex: None,
            is_foreground: None,
            scale_factor: None,
            current_monitor_name: None,
            style_hex: None,
            ex_style_hex: None,
            is_topmost: None,
            is_tool_window: None,
            is_app_window: None,
            is_no_redirection_bitmap: None,
            is_no_activate: None,
        };
    };

    inspect_native_window_ref(&island)
}

fn inspect_native_window_ref(island: &WebviewWindow) -> NativeWindowDiagnostics {
    let tauri_visible = island.is_visible().ok();
    let outer_pos = island.outer_position().ok();
    let inner_size = island.inner_size().ok();
    let scale_factor = island.scale_factor().ok();
    let current_monitor_name = island
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());

    #[cfg(target_os = "windows")]
    let (
        hwnd_hex,
        win32_is_window,
        win32_visible,
        win32_minimized,
        dwm_cloaked,
        win32_rect_left,
        win32_rect_top,
        win32_rect_right,
        win32_rect_bottom,
        win32_rect_width,
        win32_rect_height,
        foreground_hwnd_hex,
        is_foreground,
        style_hex,
        ex_style_hex,
        is_topmost,
        is_tool_window,
        is_app_window,
        is_no_redirection_bitmap,
        is_no_activate,
    ) = {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindow,
            IsWindowVisible, GWL_EXSTYLE, GWL_STYLE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
            WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        };

        if let Ok(raw_hwnd) = island.hwnd() {
            let hwnd = HWND(raw_hwnd.0 as _);
            unsafe {
                let valid = IsWindow(Some(hwnd)).as_bool();
                let visible = IsWindowVisible(hwnd).as_bool();
                let minimized = IsIconic(hwnd).as_bool();

                let mut cloaked: u32 = 0;
                let dwm_cloaked = DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_CLOAKED,
                    &mut cloaked as *mut _ as *mut _,
                    std::mem::size_of::<u32>() as u32,
                )
                .ok()
                .map(|_| cloaked);

                let mut rc = RECT::default();
                let rect_ok = GetWindowRect(hwnd, &mut rc).is_ok();

                let fg = GetForegroundWindow();
                let fg_hex = if fg.0.is_null() {
                    None
                } else {
                    Some(format!("0x{:X}", fg.0 as usize))
                };
                let is_fg = fg == hwnd;

                let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;

                (
                    Some(format!("0x{:X}", raw_hwnd.0 as usize)),
                    Some(valid),
                    Some(visible),
                    Some(minimized),
                    dwm_cloaked,
                    rect_ok.then_some(rc.left),
                    rect_ok.then_some(rc.top),
                    rect_ok.then_some(rc.right),
                    rect_ok.then_some(rc.bottom),
                    rect_ok.then_some(rc.right - rc.left),
                    rect_ok.then_some(rc.bottom - rc.top),
                    fg_hex,
                    Some(is_fg),
                    Some(format!("0x{style:08X}")),
                    Some(format!("0x{ex_style:08X}")),
                    Some((ex_style & WS_EX_TOPMOST.0) != 0),
                    Some((ex_style & WS_EX_TOOLWINDOW.0) != 0),
                    Some((ex_style & WS_EX_APPWINDOW.0) != 0),
                    Some((ex_style & WS_EX_NOREDIRECTIONBITMAP.0) != 0),
                    Some((ex_style & WS_EX_NOACTIVATE.0) != 0),
                )
            }
        } else {
            (
                None, None, None, None, None, None, None, None, None, None, None, None, None, None,
                None, None, None, None, None, None,
            )
        }
    };

    #[cfg(not(target_os = "windows"))]
    let (
        hwnd_hex,
        win32_is_window,
        win32_visible,
        win32_minimized,
        dwm_cloaked,
        win32_rect_left,
        win32_rect_top,
        win32_rect_right,
        win32_rect_bottom,
        win32_rect_width,
        win32_rect_height,
        foreground_hwnd_hex,
        is_foreground,
        style_hex,
        ex_style_hex,
        is_topmost,
        is_tool_window,
        is_app_window,
        is_no_redirection_bitmap,
        is_no_activate,
    ) = (
        None, None, None, None, None, None, None, None, None, None, None, None, None, None, None,
        None, None, None, None, None,
    );

    NativeWindowDiagnostics {
        label: island.label().to_string(),
        exists: true,
        hwnd_hex,
        win32_is_window,
        tauri_visible,
        win32_visible,
        win32_minimized,
        dwm_cloaked,
        outer_x: outer_pos.map(|p| p.x),
        outer_y: outer_pos.map(|p| p.y),
        inner_width: inner_size.map(|s| s.width),
        inner_height: inner_size.map(|s| s.height),
        win32_rect_left,
        win32_rect_top,
        win32_rect_right,
        win32_rect_bottom,
        win32_rect_width,
        win32_rect_height,
        foreground_hwnd_hex,
        is_foreground,
        scale_factor,
        current_monitor_name,
        style_hex,
        ex_style_hex,
        is_topmost,
        is_tool_window,
        is_app_window,
        is_no_redirection_bitmap,
        is_no_activate,
    }
}

#[cfg(target_os = "windows")]
fn enforce_win32_geometry_sync(
    island: &WebviewWindow,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    log: &dyn Fn(&str, String),
) {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
    };

    let Ok(raw_hwnd) = island.hwnd() else {
        log("win32_error", "island.hwnd() failed during geometry sync".into());
        return;
    };
    let hwnd = HWND(raw_hwnd.0 as _);

    unsafe {
        let mut rc = RECT::default();
        let needs_sync = if GetWindowRect(hwnd, &mut rc).is_ok() {
            rc.left != x
                || rc.top != y
                || (rc.right - rc.left) != w as i32
                || (rc.bottom - rc.top) != h as i32
        } else {
            true
        };

        if needs_sync {
            if let Err(err) = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                x,
                y,
                w as i32,
                h as i32,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            ) {
                log(
                    "win32_error",
                    format!("SetWindowPos sync geometry({x},{y},{w}x{h}) failed: {err}"),
                );
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn enforce_win32_overlay_after_show(
    island: &WebviewWindow,
    rect: Option<(i32, i32, u32, u32)>,
    log: &dyn Fn(&str, String),
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST,
    };

    let raw_hwnd = island
        .hwnd()
        .map_err(|err| format!("island.hwnd() failed after show: {err}"))?;
    let hwnd = HWND(raw_hwnd.0 as _);

    unsafe {
        let cur_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let desired_ex = (cur_ex & !WS_EX_APPWINDOW.0)
            | WS_EX_TOOLWINDOW.0
            | WS_EX_NOACTIVATE.0
            | WS_EX_TOPMOST.0;

        if cur_ex != desired_ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired_ex as isize);
        }

        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);

        let (flags, x, y, w, h) = match rect {
            Some((rx, ry, rw, rh)) => (
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
                rx,
                ry,
                rw as i32,
                rh as i32,
            ),
            None => (
                SWP_NOMOVE
                    | SWP_NOSIZE
                    | SWP_NOACTIVATE
                    | SWP_NOOWNERZORDER
                    | SWP_SHOWWINDOW
                    | SWP_FRAMECHANGED,
                0,
                0,
                0,
                0,
            ),
        };

        if let Err(err) = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, flags) {
            let msg = format!("SetWindowPos overlay show+topmost failed: {err}");
            log("win32_error", msg.clone());
            return Err(msg);
        }

        let _ = RedrawWindow(
            Some(hwnd),
            None,
            None,
            RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN,
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_display(
        index: usize,
        name: &str,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        scale: f64,
        is_primary: bool,
    ) -> DisplayInfo {
        DisplayInfo {
            index,
            name: name.to_string(),
            position_x: x,
            position_y: y,
            width_px: w,
            height_px: h,
            work_area_x: x,
            work_area_y: y,
            work_area_width: w,
            work_area_height: h.saturating_sub(48),
            scale_factor: scale,
            is_primary,
        }
    }

    #[test]
    fn computes_top_center_across_dpi_scales_and_multi_monitor_offsets() {
        let (x1, y1) = compute_top_center_physical_position(0, 0, 1920, 1.0, 324.0, 10.0);
        assert_eq!((x1, y1), (798, 10));

        let (x2, y2) = compute_top_center_physical_position(0, 0, 1920, 1.25, 324.0, 10.0);
        assert_eq!((x2, y2), (757, 13));

        let (x3, y3) = compute_top_center_physical_position(-2560, 40, 2560, 1.5, 424.0, 10.0);
        assert_eq!((x3, y3), (-1598, 55));
    }

    #[test]
    fn clamps_coordinates_inside_narrow_or_external_work_areas() {
        let (x_ext, y_ext, w_ext, h_ext) =
            compute_top_center_physical_rect(-2560, 0, 2560, 1392, 1.0, 324.0, 74.0, 10.0);
        assert_eq!((x_ext, y_ext, w_ext, h_ext), (-1442, 10, 324, 74));

        let (x_narrow, y_narrow, w_narrow, _) =
            compute_top_center_physical_rect(1920, 0, 200, 180, 1.0, 324.0, 74.0, 10.0);
        assert_eq!(x_narrow, 1920);
        assert_eq!(y_narrow, 10);
        assert_eq!(w_narrow, 324);
    }

    #[test]
    fn follows_primary_when_external_monitor_becomes_primary_or_unplugs() {
        let displays = vec![
            sample_display(0, "DISPLAY1", 1920, 0, 1920, 1200, 1.5, false),
            sample_display(1, "DISPLAY2", 0, 0, 2560, 1440, 1.0, true),
        ];

        let sel = resolve_next_selection(&displays, true, 0, None, 1);
        assert!(sel.follow_primary);
        assert_eq!(sel.selected_display_index, 1);

        let remaining = vec![sample_display(0, "DISPLAY1", 0, 0, 1920, 1200, 1.5, true)];
        let sel_reordered = resolve_next_selection(&remaining, false, 1, Some("DISPLAY1"), 0);
        assert!(!sel_reordered.follow_primary);
        assert_eq!(sel_reordered.selected_display_index, 0);

        let sel_unplugged = resolve_next_selection(&remaining, false, 1, Some("DISPLAY2"), 0);
        assert!(sel_unplugged.follow_primary);
        assert_eq!(sel_unplugged.selected_display_index, 0);
        assert!(sel_unplugged.pinned_monitor_name.is_none());
    }

    #[test]
    fn evaluates_spotify_active_visibility_rules() {
        let mut status = SpotifyStatus::not_detected();
        assert!(!is_spotify_session_active(&status));

        status.connection_state = SpotifyConnectionState::Connected;
        status.playback_status = PlaybackStatus::Playing;
        assert!(is_spotify_session_active(&status));

        status.playback_status = PlaybackStatus::Paused;
        assert!(is_spotify_session_active(&status));

        status.playback_status = PlaybackStatus::Closed;
        assert!(!is_spotify_session_active(&status));

        status.playback_status = PlaybackStatus::Stopped;
        status.title = Some("Track".to_string());
        assert!(is_spotify_session_active(&status));
    }
}
