mod audio;
mod diagnostics;
mod island;
mod lyrics;
mod media;
mod player;
mod vinyl;

use audio::{
    get_album_palette, get_beat_glow_data, get_beat_glow_prefs, set_album_palette,
    set_beat_glow_prefs, BeatGlowController,
};
use diagnostics::RuntimeLogEntry;
use island::{
    DisplayInfo, IslandController, IslandDiagnosticsSnapshot, IslandUiState, ISLAND_WINDOW_LABEL,
};
use lyrics::{
    LyricsController, LyricsLookupRequest, LyricsResultPayload, LyricsSharedSnapshot,
    LyricsUiPrefs, LyricsUiPrefsPatch, RequestLyricsResponse,
};
use media::{MediaControlAction, MediaDiagnosticsSnapshot, SpotifyMonitorHandle, SpotifyStatus};
use player::{
    get_lyrics_player_displays, hide_lyrics_player, is_lyrics_player_fullscreen,
    show_lyrics_player, toggle_lyrics_player_fullscreen, LYRICS_PLAYER_WINDOW_LABEL,
};
use serde::Serialize;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WindowEvent};
use vinyl::{VinylController, VinylUiState, VINYL_WINDOW_LABEL};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    platform: &'static str,
    arch: &'static str,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnosticsSnapshot {
    pub log_file_path: Option<String>,
    pub island: IslandDiagnosticsSnapshot,
    pub media: MediaDiagnosticsSnapshot,
    pub recent_logs: Vec<RuntimeLogEntry>,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "VYNORA",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        status: "Application initialized",
    }
}

#[tauri::command]
async fn get_spotify_status(monitor: tauri::State<'_, SpotifyMonitorHandle>) -> Result<SpotifyStatus, ()> {
    Ok(monitor.query_async().await)
}

#[tauri::command]
async fn control_spotify_playback(
    monitor: tauri::State<'_, SpotifyMonitorHandle>,
    action: MediaControlAction,
) -> Result<SpotifyStatus, String> {
    monitor.send_control_async(action).await
}

#[tauri::command]
fn get_vinyl_state(app: AppHandle, vinyl: tauri::State<'_, VinylController>) -> VinylUiState {
    vinyl.ensure_prefs_loaded(&app)
}

#[tauri::command]
async fn show_vinyl(
    app: AppHandle,
    vinyl: tauri::State<'_, VinylController>,
) -> Result<VinylUiState, String> {
    vinyl.show_vinyl_async(&app).await
}

#[tauri::command]
fn hide_vinyl(
    app: AppHandle,
    vinyl: tauri::State<'_, VinylController>,
) -> Result<VinylUiState, String> {
    vinyl.hide_vinyl(&app)
}

#[tauri::command]
async fn set_vinyl_expanded(
    app: AppHandle,
    vinyl: tauri::State<'_, VinylController>,
    expanded: bool,
) -> Result<VinylUiState, String> {
    vinyl.set_expanded_async(&app, expanded).await
}

#[tauri::command]
async fn set_vinyl_always_on_top(
    app: AppHandle,
    vinyl: tauri::State<'_, VinylController>,
    always_on_top: bool,
) -> Result<VinylUiState, String> {
    vinyl.set_always_on_top_async(&app, always_on_top).await
}

#[tauri::command]
async fn reset_vinyl_position(
    app: AppHandle,
    vinyl: tauri::State<'_, VinylController>,
) -> Result<VinylUiState, String> {
    vinyl.reset_position_async(&app).await
}

#[tauri::command]
fn notify_vinyl_ready(app: AppHandle, vinyl: tauri::State<'_, VinylController>) {
    vinyl.on_webview_ready(&app, "frontend_mount");
}

#[tauri::command]
fn open_main_window(app: AppHandle) -> Result<(), String> {
    let Some(main_win) = app.get_webview_window("main") else {
        return Err("Main window ('main') not found".to_string());
    };
    let _ = main_win.unminimize();
    main_win
        .show()
        .map_err(|err| format!("Failed to show main window: {err}"))?;
    let _ = main_win.set_focus();
    Ok(())
}

#[tauri::command]
fn get_lyrics_state(lyrics: tauri::State<'_, LyricsController>) -> LyricsSharedSnapshot {
    lyrics.get_state()
}

#[tauri::command]
fn request_lyrics_lookup(
    app: AppHandle,
    lyrics: tauri::State<'_, LyricsController>,
    request: LyricsLookupRequest,
) -> RequestLyricsResponse {
    lyrics.request_lookup(&app, request)
}

#[tauri::command]
fn publish_lyrics_result(
    app: AppHandle,
    lyrics: tauri::State<'_, LyricsController>,
    result: LyricsResultPayload,
) -> LyricsSharedSnapshot {
    lyrics.publish_result(&app, result)
}

#[tauri::command]
fn clear_lyrics_state(
    app: AppHandle,
    lyrics: tauri::State<'_, LyricsController>,
) -> LyricsSharedSnapshot {
    lyrics.clear(&app)
}

#[tauri::command]
fn get_lyrics_prefs(
    app: AppHandle,
    lyrics: tauri::State<'_, LyricsController>,
) -> LyricsUiPrefs {
    lyrics.ensure_prefs_loaded(&app)
}

#[tauri::command]
fn set_lyrics_prefs(
    app: AppHandle,
    lyrics: tauri::State<'_, LyricsController>,
    patch: LyricsUiPrefsPatch,
) -> LyricsUiPrefs {
    lyrics.set_prefs(&app, patch)
}

#[tauri::command]
fn log_lyrics_diagnostic(subsystem: Option<String>, stage: String, message: String) {
    let sub = subsystem.unwrap_or_else(|| "lyrics".to_string());
    diagnostics::log_event(&sub, &stage, message);
}

#[tauri::command]
fn get_island_state(island: tauri::State<'_, IslandController>) -> IslandUiState {
    island.get_state()
}

#[tauri::command]
async fn show_island(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
) -> Result<IslandUiState, String> {
    island.show_island_async(&app).await
}

#[tauri::command]
fn hide_island(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
) -> Result<IslandUiState, String> {
    island.hide_island(&app)
}

#[tauri::command]
async fn set_island_expanded(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
    expanded: bool,
) -> Result<IslandUiState, String> {
    island.set_expanded_async(&app, expanded).await
}

#[tauri::command]
fn get_available_displays(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
) -> Vec<DisplayInfo> {
    island.get_available_displays(&app)
}

#[tauri::command]
async fn set_island_display(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
    display_index: usize,
) -> Result<IslandUiState, String> {
    island.set_display_index_async(&app, display_index).await
}

#[tauri::command]
async fn set_island_follow_primary(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
) -> Result<IslandUiState, String> {
    island.set_follow_primary_async(&app).await
}

#[tauri::command]
fn notify_island_ready(app: AppHandle, island: tauri::State<'_, IslandController>) {
    island.on_webview_ready(&app, "frontend_mount");
}

#[tauri::command]
fn get_island_diagnostics(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
) -> IslandDiagnosticsSnapshot {
    island.get_diagnostics(&app)
}

#[tauri::command]
fn get_runtime_diagnostics(
    app: AppHandle,
    island: tauri::State<'_, IslandController>,
    monitor: tauri::State<'_, SpotifyMonitorHandle>,
) -> RuntimeDiagnosticsSnapshot {
    RuntimeDiagnosticsSnapshot {
        log_file_path: diagnostics::log_file_path(),
        island: island.get_diagnostics(&app),
        media: monitor.diagnostics_snapshot(),
        recent_logs: diagnostics::recent_entries(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            diagnostics::log_event(
                "app",
                "single_instance",
                "Second launch detected; focusing existing main window",
            );
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.unminimize();
                let _ = main_win.show();
                let _ = main_win.set_focus();
            }
        }))
        .manage(IslandController::new())
        .manage(VinylController::new())
        .manage(LyricsController::new())
        .manage(BeatGlowController::new())
        .setup(|app| {
            if let Ok(local_dir) = app.path().app_local_data_dir() {
                diagnostics::init_log_file(local_dir.join("needle-runtime.log"));
            }

            diagnostics::log_event(
                "app",
                "setup_start",
                format!("Starting VYNORA v{} on {}", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH),
            );

            let island = app.state::<IslandController>();
            island.initialize_selection(app.handle());

            let vinyl = app.state::<VinylController>();
            vinyl.initialize(app.handle());

            let lyrics = app.state::<LyricsController>();
            let _ = lyrics.ensure_prefs_loaded(app.handle());

            let beat_glow = app.state::<BeatGlowController>();
            beat_glow.init(app.handle());

            let handle = SpotifyMonitorHandle::start(app.handle().clone());
            app.manage(handle);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            let phase = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            diagnostics::log_event(
                "webview",
                "page_load",
                format!(
                    "window='{}' phase={phase} url={}",
                    webview.label(),
                    payload.url()
                ),
            );

            if webview.label() == ISLAND_WINDOW_LABEL
                && payload.event() == PageLoadEvent::Finished
            {
                if let Some(island) = webview.app_handle().try_state::<IslandController>() {
                    island.on_webview_ready(webview.app_handle(), "on_page_load");
                }
            } else if webview.label() == VINYL_WINDOW_LABEL
                && payload.event() == PageLoadEvent::Finished
            {
                if let Some(vinyl) = webview.app_handle().try_state::<VinylController>() {
                    vinyl.on_webview_ready(webview.app_handle(), "on_page_load");
                }
            }
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { .. }) => {
                if let Some(vinyl) = window.app_handle().try_state::<VinylController>() {
                    vinyl.save_prefs_now();
                }
                if let Some(beat_glow) = window.app_handle().try_state::<BeatGlowController>() {
                    beat_glow.stop();
                }
                diagnostics::log_event("app", "exit", "Main window close requested");
                window.app_handle().exit(0);
            }
            ("main", WindowEvent::Focused(true)) => {
                if let Some(island) = window.app_handle().try_state::<IslandController>() {
                    island.sync_display_topology(window.app_handle());
                }
            }
            (ISLAND_WINDOW_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                if let Some(island) = window.app_handle().try_state::<IslandController>() {
                    let _ = island.hide_island(window.app_handle());
                }
            }
            (ISLAND_WINDOW_LABEL, WindowEvent::ScaleFactorChanged { .. }) => {
                if let Some(island) = window.app_handle().try_state::<IslandController>() {
                    island.reposition(window.app_handle(), "scale_factor_changed");
                }
            }
            (ISLAND_WINDOW_LABEL, WindowEvent::Moved(pos)) => {
                if let Some(island) = window.app_handle().try_state::<IslandController>() {
                    island.on_window_moved(window.app_handle(), pos.x, pos.y);
                }
            }
            (VINYL_WINDOW_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                if let Some(vinyl) = window.app_handle().try_state::<VinylController>() {
                    let _ = vinyl.hide_vinyl(window.app_handle());
                }
            }
            (VINYL_WINDOW_LABEL, WindowEvent::Moved(pos)) => {
                if let Some(vinyl) = window.app_handle().try_state::<VinylController>() {
                    vinyl.on_window_moved(window.app_handle(), pos.x, pos.y);
                }
            }
            (VINYL_WINDOW_LABEL, WindowEvent::Resized(size)) => {
                if let Some(vinyl) = window.app_handle().try_state::<VinylController>() {
                    vinyl.on_window_resized(window.app_handle(), size.width, size.height);
                }
            }
            (VINYL_WINDOW_LABEL, WindowEvent::ScaleFactorChanged { .. }) => {
                if let Some(vinyl) = window.app_handle().try_state::<VinylController>() {
                    vinyl.on_scale_factor_changed(window.app_handle());
                }
            }
            (LYRICS_PLAYER_WINDOW_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = hide_lyrics_player(window.app_handle().clone());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_spotify_status,
            control_spotify_playback,
            get_island_state,
            show_island,
            hide_island,
            set_island_expanded,
            get_available_displays,
            set_island_display,
            set_island_follow_primary,
            notify_island_ready,
            get_island_diagnostics,
            get_runtime_diagnostics,
            get_vinyl_state,
            show_vinyl,
            hide_vinyl,
            set_vinyl_expanded,
            set_vinyl_always_on_top,
            reset_vinyl_position,
            notify_vinyl_ready,
            open_main_window,
            get_lyrics_state,
            request_lyrics_lookup,
            publish_lyrics_result,
            clear_lyrics_state,
            get_lyrics_prefs,
            set_lyrics_prefs,
            log_lyrics_diagnostic,
            get_beat_glow_data,
            get_beat_glow_prefs,
            set_beat_glow_prefs,
            get_album_palette,
            set_album_palette,
            get_lyrics_player_displays,
            show_lyrics_player,
            hide_lyrics_player,
            toggle_lyrics_player_fullscreen,
            is_lyrics_player_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running VYNORA application");
}

#[cfg(test)]
mod tests {
    use super::get_app_info;

    #[test]
    fn app_info_reports_initialized_windows_x64() {
        let info = get_app_info();
        assert_eq!(info.name, "VYNORA");
        assert_eq!(info.status, "Application initialized");
        assert_eq!(info.platform, "windows");
        assert_eq!(info.arch, "x86_64");
        assert!(!info.version.is_empty());
    }
}
