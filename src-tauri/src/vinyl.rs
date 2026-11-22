use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Position,
    Rect, Size, WebviewWindow,
};

use crate::diagnostics;

pub const VINYL_WINDOW_LABEL: &str = "vinyl";
pub const VINYL_STATE_EVENT: &str = "vinyl-state-changed";

pub const DEFAULT_COMPACT_WIDTH: f64 = 310.0;
pub const DEFAULT_COMPACT_HEIGHT: f64 = 360.0;
pub const COMPACT_MIN_WIDTH: f64 = 260.0;
pub const COMPACT_MAX_WIDTH: f64 = 480.0;
pub const COMPACT_MIN_HEIGHT: f64 = 290.0;
pub const COMPACT_MAX_HEIGHT: f64 = 520.0;

pub const DEFAULT_EXPANDED_WIDTH: f64 = 540.0;
pub const DEFAULT_EXPANDED_HEIGHT: f64 = 340.0;
pub const EXPANDED_MIN_WIDTH: f64 = 430.0;
pub const EXPANDED_MAX_WIDTH: f64 = 780.0;
pub const EXPANDED_MIN_HEIGHT: f64 = 290.0;
pub const EXPANDED_MAX_HEIGHT: f64 = 520.0;

pub const DEFAULT_EDGE_MARGIN_LOGICAL: f64 = 28.0;
const MAIN_THREAD_TIMEOUT_MS: u64 = 2500;
const SAVE_DEBOUNCE_MS: u64 = 350;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VinylUiState {
    pub visible: bool,
    pub expanded: bool,
    pub always_on_top: bool,
    pub logical_width: f64,
    pub logical_height: f64,
    pub position_x: Option<i32>,
    pub position_y: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VinylPersistedPrefs {
    pub visible: bool,
    pub expanded: bool,
    pub always_on_top: bool,
    pub position_x: Option<i32>,
    pub position_y: Option<i32>,
    pub compact_width_logical: f64,
    pub compact_height_logical: f64,
    pub expanded_width_logical: f64,
    pub expanded_height_logical: f64,
}

impl Default for VinylPersistedPrefs {
    fn default() -> Self {
        Self {
            visible: true,
            expanded: true,
            always_on_top: false,
            position_x: None,
            position_y: None,
            compact_width_logical: DEFAULT_COMPACT_WIDTH,
            compact_height_logical: DEFAULT_COMPACT_HEIGHT,
            expanded_width_logical: DEFAULT_EXPANDED_WIDTH,
            expanded_height_logical: DEFAULT_EXPANDED_HEIGHT,
        }
    }
}

#[derive(Debug, Default)]
struct VinylInner {
    prefs: VinylPersistedPrefs,
    prefs_loaded: bool,
    prefs_path: Option<PathBuf>,
    save_gen: u64,
    webview_loaded: bool,
    last_error: Option<String>,
}

#[derive(Clone, Default)]
pub struct VinylController {
    inner: Arc<Mutex<VinylInner>>,
    applying_geometry: Arc<AtomicBool>,
}

impl VinylController {
    pub fn new() -> Self {
        Self::default()
    }

    fn log(&self, stage: &str, message: impl Into<String>) {
        diagnostics::log_event("vinyl", stage, message);
    }

    pub fn get_state(&self) -> VinylUiState {
        let guard = self.inner.lock().expect("vinyl state mutex poisoned");
        snapshot_from(&guard.prefs)
    }

    pub fn ensure_prefs_loaded(&self, app: &AppHandle) -> VinylUiState {
        {
            let guard = self.inner.lock().expect("vinyl state mutex poisoned");
            if guard.prefs_loaded {
                return snapshot_from(&guard.prefs);
            }
        }

        let prefs_path = app
            .path()
            .app_local_data_dir()
            .ok()
            .map(|dir| dir.join("vinyl-state.json"));

        let loaded_prefs = prefs_path
            .as_ref()
            .and_then(|p| load_prefs_from_disk(p))
            .unwrap_or_default();

        let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
        if !guard.prefs_loaded {
            guard.prefs = sanitize_prefs(loaded_prefs);
            guard.prefs_path = prefs_path;
            guard.prefs_loaded = true;
        }
        snapshot_from(&guard.prefs)
    }

    pub fn initialize(&self, app: &AppHandle) {
        let initial_state = self.ensure_prefs_loaded(app);

        let Some(vinyl_win) = app.get_webview_window(VINYL_WINDOW_LABEL) else {
            self.log(
                "startup_error",
                "Vinyl window ('vinyl') not found at startup; check tauri.conf.json",
            );
            return;
        };

        let prefs = {
            let guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.clone()
        };

        self.log(
            "startup_init",
            format!(
                "Vinyl initialized (visible={}, expanded={}, always_on_top={}, saved_pos=({:?},{:?}))",
                prefs.visible,
                prefs.expanded,
                prefs.always_on_top,
                prefs.position_x,
                prefs.position_y
            ),
        );

        self.emit_state(app, &initial_state);

        let app_handle = app.clone();
        let controller = self.clone();
        if let Err(err) = app.run_on_main_thread(move || {
            let _ = controller.apply_geometry_and_styles(&vinyl_win, &app_handle, false);
            if prefs.visible {
                if let Err(err) = controller.show_window_sync(&app_handle, false) {
                    controller.log("startup_show_error", err);
                }
            } else {
                let _ = vinyl_win.hide();
            }
        }) {
            self.log(
                "main_thread_error",
                format!("Failed to initialize vinyl window on main thread: {err}"),
            );
        }
    }

    pub fn on_webview_ready(&self, app: &AppHandle, source: &str) {
        let should_show = {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.webview_loaded = true;
            guard.prefs.visible
        };

        self.log(
            "webview_ready",
            format!("Vinyl WebView ready via '{source}' (visible={should_show})"),
        );

        if should_show {
            let app_handle = app.clone();
            let controller = self.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(err) = controller.show_window_sync(&app_handle, false) {
                    controller.log("webview_ready_show_error", err);
                }
            });
        }
    }

    pub async fn show_vinyl_async(&self, app: &AppHandle) -> Result<VinylUiState, String> {
        {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.visible = true;
            guard.last_error = None;
        }
        self.save_prefs_now();

        let app_handle = app.clone();
        let controller = self.clone();
        run_on_main_thread_blocking(app, move || controller.show_window_sync(&app_handle, true))
            .await?;

        let ui_state = self.get_state();
        self.emit_state(app, &ui_state);
        Ok(ui_state)
    }

    pub fn hide_vinyl(&self, app: &AppHandle) -> Result<VinylUiState, String> {
        let Some(vinyl_win) = app.get_webview_window(VINYL_WINDOW_LABEL) else {
            return Err("Vinyl window ('vinyl') not found".to_string());
        };

        {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.visible = false;
            guard.last_error = None;
        }
        self.save_prefs_now();

        let controller = self.clone();
        let _ = app.run_on_main_thread(move || {
            #[cfg(target_os = "windows")]
            hide_win32_window(&vinyl_win);
            if let Err(err) = vinyl_win.hide() {
                controller.log("hide_error", format!("vinyl.hide() failed: {err}"));
            } else {
                controller.log("hide_complete", "Vinyl window hidden cleanly");
            }
        });

        let ui_state = self.get_state();
        self.emit_state(app, &ui_state);
        Ok(ui_state)
    }

    pub async fn set_expanded_async(
        &self,
        app: &AppHandle,
        expanded: bool,
    ) -> Result<VinylUiState, String> {
        {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.expanded = expanded;
        }
        self.save_prefs_now();

        self.log(
            "set_expanded",
            format!(
                "Vinyl layout -> {}",
                if expanded { "expanded" } else { "compact" }
            ),
        );

        let app_handle = app.clone();
        let controller = self.clone();
        run_on_main_thread_blocking(app, move || {
            let Some(vinyl_win) = app_handle.get_webview_window(VINYL_WINDOW_LABEL) else {
                return Err("Vinyl window ('vinyl') missing".to_string());
            };
            controller.apply_geometry_and_styles(&vinyl_win, &app_handle, false)?;
            Ok(())
        })
        .await?;

        let ui_state = self.get_state();
        self.emit_state(app, &ui_state);
        Ok(ui_state)
    }

    pub async fn set_always_on_top_async(
        &self,
        app: &AppHandle,
        always_on_top: bool,
    ) -> Result<VinylUiState, String> {
        {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.always_on_top = always_on_top;
        }
        self.save_prefs_now();

        self.log(
            "set_always_on_top",
            format!("Vinyl always_on_top -> {always_on_top}"),
        );

        let app_handle = app.clone();
        let controller = self.clone();
        run_on_main_thread_blocking(app, move || {
            let Some(vinyl_win) = app_handle.get_webview_window(VINYL_WINDOW_LABEL) else {
                return Err("Vinyl window ('vinyl') missing".to_string());
            };
            vinyl_win
                .set_always_on_top(always_on_top)
                .map_err(|err| format!("vinyl.set_always_on_top({always_on_top}) failed: {err}"))?;
            #[cfg(target_os = "windows")]
            enforce_win32_widget_styles(&vinyl_win, always_on_top, &|s, m| controller.log(s, m));
            Ok(())
        })
        .await?;

        let ui_state = self.get_state();
        self.emit_state(app, &ui_state);
        Ok(ui_state)
    }

    pub async fn reset_position_async(&self, app: &AppHandle) -> Result<VinylUiState, String> {
        {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.position_x = None;
            guard.prefs.position_y = None;
            guard.prefs.compact_width_logical = DEFAULT_COMPACT_WIDTH;
            guard.prefs.compact_height_logical = DEFAULT_COMPACT_HEIGHT;
            guard.prefs.expanded_width_logical = DEFAULT_EXPANDED_WIDTH;
            guard.prefs.expanded_height_logical = DEFAULT_EXPANDED_HEIGHT;
        }

        self.log(
            "reset_position",
            "Resetting vinyl widget position & size to primary work-area default",
        );

        let app_handle = app.clone();
        let controller = self.clone();
        run_on_main_thread_blocking(app, move || {
            let Some(vinyl_win) = app_handle.get_webview_window(VINYL_WINDOW_LABEL) else {
                return Err("Vinyl window ('vinyl') missing".to_string());
            };
            controller.apply_geometry_and_styles(&vinyl_win, &app_handle, true)?;
            Ok(())
        })
        .await?;

        self.save_prefs_now();
        let ui_state = self.get_state();
        self.emit_state(app, &ui_state);
        Ok(ui_state)
    }

    pub fn on_window_moved(&self, _app: &AppHandle, x: i32, y: i32) {
        if self.applying_geometry.load(Ordering::SeqCst) {
            return;
        }

        // Ignore minimized sentinel positions on Windows (-32000).
        if x <= -30_000 || y <= -30_000 {
            return;
        }

        let changed = {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            if !guard.prefs_loaded || !guard.prefs.visible {
                false
            } else if guard.prefs.position_x != Some(x) || guard.prefs.position_y != Some(y) {
                guard.prefs.position_x = Some(x);
                guard.prefs.position_y = Some(y);
                true
            } else {
                false
            }
        };

        if changed {
            self.schedule_debounced_save();
        }
    }

    pub fn on_window_resized(&self, app: &AppHandle, width_px: u32, height_px: u32) {
        if self.applying_geometry.load(Ordering::SeqCst) || width_px == 0 || height_px == 0 {
            return;
        }

        let Some(vinyl_win) = app.get_webview_window(VINYL_WINDOW_LABEL) else {
            return;
        };

        let scale = sanitize_scale(vinyl_win.scale_factor().unwrap_or(1.0));
        let logical_w = (width_px as f64 / scale).round();
        let logical_h = (height_px as f64 / scale).round();

        let (changed, ui_state) = {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            if !guard.prefs_loaded || !guard.prefs.visible {
                (false, None)
            } else {
                let expanded = guard.prefs.expanded;
                let (cw, ch) = clamp_logical_size(logical_w, logical_h, expanded);
                let prev = active_logical_size(&guard.prefs);
                if (prev.0 - cw).abs() > 0.5 || (prev.1 - ch).abs() > 0.5 {
                    if expanded {
                        guard.prefs.expanded_width_logical = cw;
                        guard.prefs.expanded_height_logical = ch;
                    } else {
                        guard.prefs.compact_width_logical = cw;
                        guard.prefs.compact_height_logical = ch;
                    }
                    (true, Some(snapshot_from(&guard.prefs)))
                } else {
                    (false, None)
                }
            }
        };

        if changed {
            let webview: &tauri::Webview = vinyl_win.as_ref();
            let _ = webview.set_bounds(Rect {
                position: Position::Physical(PhysicalPosition::new(0, 0)),
                size: Size::Physical(PhysicalSize::new(width_px, height_px)),
            });
            if let Some(state) = ui_state {
                self.emit_state(app, &state);
            }
            self.schedule_debounced_save();
        }
    }

    pub fn on_scale_factor_changed(&self, app: &AppHandle) {
        let controller = self.clone();
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(vinyl_win) = app_handle.get_webview_window(VINYL_WINDOW_LABEL) {
                let _ = controller.apply_geometry_and_styles(&vinyl_win, &app_handle, false);
            }
        });
    }

    pub fn save_prefs_now(&self) {
        let (path_opt, prefs) = {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.save_gen = guard.save_gen.wrapping_add(1);
            (guard.prefs_path.clone(), guard.prefs.clone())
        };

        if let Some(path) = path_opt {
            if let Err(err) = write_prefs_to_disk(&path, &prefs) {
                self.log("prefs_write_error", format!("Failed to save vinyl prefs: {err}"));
            }
        }
    }

    fn schedule_debounced_save(&self) {
        let (gen, path_opt) = {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.save_gen = guard.save_gen.wrapping_add(1);
            (guard.save_gen, guard.prefs_path.clone())
        };

        let Some(path) = path_opt else {
            return;
        };

        let controller = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(Duration::from_millis(SAVE_DEBOUNCE_MS));
            let prefs_to_save = {
                let guard = controller.inner.lock().expect("vinyl state mutex poisoned");
                if guard.save_gen == gen {
                    Some(guard.prefs.clone())
                } else {
                    None
                }
            };
            if let Some(prefs) = prefs_to_save {
                if let Err(err) = write_prefs_to_disk(&path, &prefs) {
                    controller.log("prefs_write_error", format!("Failed to save vinyl prefs: {err}"));
                } else {
                    controller.log(
                        "prefs_saved",
                        format!(
                            "Saved vinyl prefs pos=({:?},{:?}) expanded={} compact=({}x{}) expandedSize=({}x{})",
                            prefs.position_x,
                            prefs.position_y,
                            prefs.expanded,
                            prefs.compact_width_logical,
                            prefs.compact_height_logical,
                            prefs.expanded_width_logical,
                            prefs.expanded_height_logical
                        ),
                    );
                }
            }
        });
    }

    fn emit_state(&self, app: &AppHandle, state: &VinylUiState) {
        if let Err(err) = app.emit(VINYL_STATE_EVENT, state) {
            self.log(
                "emit_error",
                format!("Failed to emit '{VINYL_STATE_EVENT}': {err}"),
            );
        }
    }

    fn show_window_sync(&self, app: &AppHandle, focus_window: bool) -> Result<(), String> {
        let Some(vinyl_win) = app.get_webview_window(VINYL_WINDOW_LABEL) else {
            return Err("Vinyl window ('vinyl') does not exist".into());
        };

        if let Ok(true) = vinyl_win.is_minimized() {
            let _ = vinyl_win.unminimize();
        }

        self.apply_geometry_and_styles(&vinyl_win, app, false)?;

        let always_on_top = {
            let guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.always_on_top
        };

        let _ = vinyl_win.set_skip_taskbar(true);
        vinyl_win
            .set_always_on_top(always_on_top)
            .map_err(|err| format!("vinyl.set_always_on_top({always_on_top}) failed: {err}"))?;

        if focus_window {
            vinyl_win
                .show()
                .map_err(|err| format!("vinyl.show() failed: {err}"))?;
            let _ = vinyl_win.set_focus();
        } else {
            #[cfg(target_os = "windows")]
            show_win32_noactivate(&vinyl_win, always_on_top, &|s, m| self.log(s, m))?;
            #[cfg(not(target_os = "windows"))]
            vinyl_win
                .show()
                .map_err(|err| format!("vinyl.show() failed: {err}"))?;
        }

        let _ = vinyl_win.set_skip_taskbar(true);
        let webview: &tauri::Webview = vinyl_win.as_ref();
        let _ = webview.show();

        #[cfg(target_os = "windows")]
        enforce_win32_widget_styles(&vinyl_win, always_on_top, &|s, m| self.log(s, m));

        Ok(())
    }

    fn apply_geometry_and_styles(
        &self,
        vinyl_win: &WebviewWindow,
        app: &AppHandle,
        force_default_pos: bool,
    ) -> Result<(i32, i32, u32, u32), String> {
        self.applying_geometry.store(true, Ordering::SeqCst);
        let res = self.apply_geometry_inner(vinyl_win, app, force_default_pos);
        self.applying_geometry.store(false, Ordering::SeqCst);
        res
    }

    fn apply_geometry_inner(
        &self,
        vinyl_win: &WebviewWindow,
        app: &AppHandle,
        force_default_pos: bool,
    ) -> Result<(i32, i32, u32, u32), String> {
        let prefs = {
            let guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.clone()
        };

        let (logical_w, logical_h) = active_logical_size(&prefs);
        let (min_w, max_w, min_h, max_h) = mode_size_bounds(prefs.expanded);

        let _ = vinyl_win.set_min_size(Some(Size::Logical(LogicalSize::new(min_w, min_h))));
        let _ = vinyl_win.set_max_size(Some(Size::Logical(LogicalSize::new(max_w, max_h))));

        let monitors = app.available_monitors().unwrap_or_default();
        let primary = app.primary_monitor().ok().flatten();

        let saved_pos = if force_default_pos {
            None
        } else {
            prefs.position_x.zip(prefs.position_y)
        };

        let rect = compute_target_rect(
            &monitors,
            primary.as_ref(),
            saved_pos,
            logical_w,
            logical_h,
        );

        let (x, y, phys_w, phys_h) = rect;
        let target_pos = PhysicalPosition::new(x, y);
        let target_size = PhysicalSize::new(phys_w, phys_h);

        let _ = vinyl_win.set_size(Size::Physical(target_size));
        let _ = vinyl_win.set_position(Position::Physical(target_pos));

        let webview: &tauri::Webview = vinyl_win.as_ref();
        let _ = webview.set_bounds(Rect {
            position: Position::Physical(PhysicalPosition::new(0, 0)),
            size: Size::Physical(target_size),
        });

        {
            let mut guard = self.inner.lock().expect("vinyl state mutex poisoned");
            guard.prefs.position_x = Some(x);
            guard.prefs.position_y = Some(y);
        }

        self.log(
            "geometry",
            format!(
                "expanded={} logical=({logical_w}x{logical_h}) -> physical=({x},{y},{phys_w}x{phys_h})",
                prefs.expanded
            ),
        );

        Ok(rect)
    }
}

pub fn active_logical_size(prefs: &VinylPersistedPrefs) -> (f64, f64) {
    if prefs.expanded {
        clamp_logical_size(
            prefs.expanded_width_logical,
            prefs.expanded_height_logical,
            true,
        )
    } else {
        clamp_logical_size(
            prefs.compact_width_logical,
            prefs.compact_height_logical,
            false,
        )
    }
}

pub fn mode_size_bounds(expanded: bool) -> (f64, f64, f64, f64) {
    if expanded {
        (
            EXPANDED_MIN_WIDTH,
            EXPANDED_MAX_WIDTH,
            EXPANDED_MIN_HEIGHT,
            EXPANDED_MAX_HEIGHT,
        )
    } else {
        (
            COMPACT_MIN_WIDTH,
            COMPACT_MAX_WIDTH,
            COMPACT_MIN_HEIGHT,
            COMPACT_MAX_HEIGHT,
        )
    }
}

pub fn clamp_logical_size(width: f64, height: f64, expanded: bool) -> (f64, f64) {
    let (min_w, max_w, min_h, max_h) = mode_size_bounds(expanded);
    let safe_w = if width.is_finite() {
        width.clamp(min_w, max_w)
    } else if expanded {
        DEFAULT_EXPANDED_WIDTH
    } else {
        DEFAULT_COMPACT_WIDTH
    };
    let safe_h = if height.is_finite() {
        height.clamp(min_h, max_h)
    } else if expanded {
        DEFAULT_EXPANDED_HEIGHT
    } else {
        DEFAULT_COMPACT_HEIGHT
    };
    (safe_w, safe_h)
}

fn sanitize_prefs(mut prefs: VinylPersistedPrefs) -> VinylPersistedPrefs {
    let (cw, ch) = clamp_logical_size(
        prefs.compact_width_logical,
        prefs.compact_height_logical,
        false,
    );
    let (ew, eh) = clamp_logical_size(
        prefs.expanded_width_logical,
        prefs.expanded_height_logical,
        true,
    );
    prefs.compact_width_logical = cw;
    prefs.compact_height_logical = ch;
    prefs.expanded_width_logical = ew;
    prefs.expanded_height_logical = eh;
    prefs
}

fn snapshot_from(prefs: &VinylPersistedPrefs) -> VinylUiState {
    let (logical_width, logical_height) = active_logical_size(prefs);
    VinylUiState {
        visible: prefs.visible,
        expanded: prefs.expanded,
        always_on_top: prefs.always_on_top,
        logical_width,
        logical_height,
        position_x: prefs.position_x,
        position_y: prefs.position_y,
    }
}

pub fn sanitize_scale(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorkAreaSpec {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

pub fn compute_bottom_right_physical_rect(
    wa: WorkAreaSpec,
    logical_width: f64,
    logical_height: f64,
    logical_margin: f64,
) -> (i32, i32, u32, u32) {
    let scale = sanitize_scale(wa.scale_factor);
    let phys_w = (logical_width * scale).round().max(1.0) as u32;
    let phys_h = (logical_height * scale).round().max(1.0) as u32;
    let margin = (logical_margin * scale).round().max(0.0) as i32;

    let raw_x = wa.x + wa.width as i32 - phys_w as i32 - margin;
    let raw_y = wa.y + wa.height as i32 - phys_h as i32 - margin;

    let max_x = wa.x + (wa.width as i32 - phys_w as i32).max(0);
    let max_y = wa.y + (wa.height as i32 - phys_h as i32).max(0);

    (
        raw_x.clamp(wa.x, max_x),
        raw_y.clamp(wa.y, max_y),
        phys_w,
        phys_h,
    )
}

pub fn resolve_work_area_rect(
    work_areas: &[WorkAreaSpec],
    primary_index: usize,
    saved_pos: Option<(i32, i32)>,
    logical_width: f64,
    logical_height: f64,
) -> (i32, i32, u32, u32) {
    if work_areas.is_empty() {
        let phys_w = logical_width.round().max(1.0) as u32;
        let phys_h = logical_height.round().max(1.0) as u32;
        return (48, 48, phys_w, phys_h);
    }

    if let Some((sx, sy)) = saved_pos {
        // Match monitor containing the saved window center (using ~1.0 estimated rect then refined by monitor DPI).
        let matched = work_areas.iter().find(|wa| {
            let scale = sanitize_scale(wa.scale_factor);
            let approx_cx = sx + ((logical_width * scale).round() as i32 / 2);
            let approx_cy = sy + ((logical_height * scale).round() as i32 / 2);
            approx_cx >= wa.x
                && approx_cx < wa.x + wa.width as i32
                && approx_cy >= wa.y
                && approx_cy < wa.y + wa.height as i32
        });

        if let Some(wa) = matched {
            let scale = sanitize_scale(wa.scale_factor);
            let phys_w = (logical_width * scale).round().max(1.0) as u32;
            let phys_h = (logical_height * scale).round().max(1.0) as u32;
            let max_x = wa.x + (wa.width as i32 - phys_w as i32).max(0);
            let max_y = wa.y + (wa.height as i32 - phys_h as i32).max(0);
            return (sx.clamp(wa.x, max_x), sy.clamp(wa.y, max_y), phys_w, phys_h);
        }
    }

    let fallback_wa = work_areas
        .get(primary_index)
        .copied()
        .unwrap_or(work_areas[0]);
    compute_bottom_right_physical_rect(
        fallback_wa,
        logical_width,
        logical_height,
        DEFAULT_EDGE_MARGIN_LOGICAL,
    )
}

fn compute_target_rect(
    monitors: &[Monitor],
    primary: Option<&Monitor>,
    saved_pos: Option<(i32, i32)>,
    logical_width: f64,
    logical_height: f64,
) -> (i32, i32, u32, u32) {
    let mut primary_index = 0usize;
    let work_areas: Vec<WorkAreaSpec> = monitors
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            if let Some(p) = primary {
                if m.position() == p.position() && m.size() == p.size() {
                    primary_index = idx;
                }
            }
            let wa = m.work_area();
            WorkAreaSpec {
                x: wa.position.x,
                y: wa.position.y,
                width: wa.size.width,
                height: wa.size.height,
                scale_factor: m.scale_factor(),
            }
        })
        .collect();

    resolve_work_area_rect(
        &work_areas,
        primary_index,
        saved_pos,
        logical_width,
        logical_height,
    )
}

fn load_prefs_from_disk(path: &PathBuf) -> Option<VinylPersistedPrefs> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<VinylPersistedPrefs>(&raw).ok()
}

fn write_prefs_to_disk(path: &PathBuf, prefs: &VinylPersistedPrefs) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir_all failed: {e}"))?;
    }
    let json =
        serde_json::to_string_pretty(prefs).map_err(|e| format!("serialize failed: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write failed: {e}"))
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

#[cfg(target_os = "windows")]
fn show_win32_noactivate(
    vinyl_win: &WebviewWindow,
    always_on_top: bool,
    log: &dyn Fn(&str, String),
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    };

    let raw_hwnd = vinyl_win
        .hwnd()
        .map_err(|err| format!("vinyl.hwnd() failed: {err}"))?;
    let hwnd = HWND(raw_hwnd.0 as _);

    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let insert_after = if always_on_top {
            HWND_TOPMOST
        } else {
            HWND_NOTOPMOST
        };
        if let Err(err) = SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
        ) {
            let msg = format!("SetWindowPos vinyl show failed: {err}");
            log("win32_error", msg.clone());
            return Err(msg);
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn hide_win32_window(vinyl_win: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    if let Ok(raw_hwnd) = vinyl_win.hwnd() {
        unsafe {
            let _ = ShowWindow(HWND(raw_hwnd.0 as _), SW_HIDE);
        }
    }
}

#[cfg(target_os = "windows")]
fn enforce_win32_widget_styles(
    vinyl_win: &WebviewWindow,
    always_on_top: bool,
    log: &dyn Fn(&str, String),
) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_NOTOPMOST,
        HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    };

    let Ok(raw_hwnd) = vinyl_win.hwnd() else {
        return;
    };
    let hwnd = HWND(raw_hwnd.0 as _);

    unsafe {
        let cur_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut desired_ex = (cur_ex & !WS_EX_APPWINDOW.0) | WS_EX_TOOLWINDOW.0;
        if always_on_top {
            desired_ex |= WS_EX_TOPMOST.0;
        } else {
            desired_ex &= !WS_EX_TOPMOST.0;
        }

        if cur_ex != desired_ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired_ex as isize);
        }

        let insert_after = if always_on_top {
            HWND_TOPMOST
        } else {
            HWND_NOTOPMOST
        };
        if let Err(err) = SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
        ) {
            log(
                "win32_error",
                format!("SetWindowPos widget style sync failed: {err}"),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_default_vinyl_at_bottom_right_not_center() {
        let primary = WorkAreaSpec {
            x: 0,
            y: 0,
            width: 1920,
            height: 1020,
            scale_factor: 1.25,
        };
        let (x, y, w, h) = compute_bottom_right_physical_rect(
            primary,
            DEFAULT_EXPANDED_WIDTH,
            DEFAULT_EXPANDED_HEIGHT,
            DEFAULT_EDGE_MARGIN_LOGICAL,
        );

        assert_eq!((w, h), (675, 425));
        assert_eq!(x, 1920 - 675 - 35);
        assert_eq!(y, 1020 - 425 - 35);
        // Must not sit at center of screen.
        assert_ne!(x, (1920 - 675) / 2);
        assert_ne!(y, (1020 - 425) / 2);
    }

    #[test]
    fn restores_valid_multi_monitor_position_and_recovers_when_unplugged() {
        let monitors = vec![
            WorkAreaSpec {
                x: 0,
                y: 0,
                width: 1920,
                height: 1020,
                scale_factor: 1.25,
            },
            WorkAreaSpec {
                x: -2560,
                y: 0,
                width: 2560,
                height: 1400,
                scale_factor: 1.0,
            },
        ];

        // Saved coordinate on secondary left monitor restores onto that monitor cleanly.
        let restored = resolve_work_area_rect(&monitors, 0, Some((-2200, 300)), 540.0, 340.0);
        assert_eq!(restored, (-2200, 300, 540, 340));

        // If secondary monitor unplugs, saved (-2200, 300) falls back to primary bottom-right.
        let primary_only = vec![monitors[0]];
        let recovered = resolve_work_area_rect(&primary_only, 0, Some((-2200, 300)), 540.0, 340.0);
        assert_eq!(recovered, (1920 - 675 - 35, 1020 - 425 - 35, 675, 425));
    }

    #[test]
    fn clamps_restored_position_and_logical_dimensions() {
        let monitors = vec![WorkAreaSpec {
            x: 0,
            y: 0,
            width: 1920,
            height: 1020,
            scale_factor: 1.5,
        }];

        // Expanding near bottom-right corner pulls origin inward cleanly instead of clipping off screen.
        let clamped = resolve_work_area_rect(&monitors, 0, Some((1400, 700)), 540.0, 340.0);
        assert_eq!(clamped, (1920 - 810, 1020 - 510, 810, 510));

        assert_eq!(
            clamp_logical_size(100.0, 999.0, false),
            (COMPACT_MIN_WIDTH, COMPACT_MAX_HEIGHT)
        );
        assert_eq!(
            clamp_logical_size(900.0, 100.0, true),
            (EXPANDED_MAX_WIDTH, EXPANDED_MIN_HEIGHT)
        );
    }

    #[test]
    fn parses_preferences_with_defaults_and_sanitizes_values() {
        let partial = r#"{"visible":false,"expanded":false,"compactWidthLogical":9999}"#;
        let parsed: VinylPersistedPrefs = serde_json::from_str(partial).unwrap();
        let sanitized = sanitize_prefs(parsed);
        assert!(!sanitized.visible);
        assert!(!sanitized.expanded);
        assert!(!sanitized.always_on_top);
        assert_eq!(sanitized.compact_width_logical, COMPACT_MAX_WIDTH);
        assert_eq!(sanitized.expanded_width_logical, DEFAULT_EXPANDED_WIDTH);
    }
}
