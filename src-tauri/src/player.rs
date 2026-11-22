/**
 * Dedicated Fullscreen Lyrics Player Controller for Needle Windows.
 *
 * Manages:
 * - Dedicated Tauri window ("lyrics-player").
 * - Multi-monitor detection and positioning.
 * - True borderless fullscreen presentation.
 * - Windowed vs fullscreen toggles and clean restoration.
 */

use crate::island::DisplayInfo;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

pub const LYRICS_PLAYER_WINDOW_LABEL: &str = "lyrics-player";

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPlayerStatus {
    pub is_open: bool,
    pub is_fullscreen: bool,
    pub monitor_name: Option<String>,
}

#[tauri::command]
pub fn get_lyrics_player_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to query monitors: {e}"))?;

    let primary_monitor = app.primary_monitor().ok().flatten();

    let mut displays = Vec::new();
    for (idx, mon) in monitors.into_iter().enumerate() {
        let name = mon.name().map(|n| n.to_string()).unwrap_or_else(|| format!("Display {}", idx + 1));
        let pos = mon.position();
        let size = mon.size();
        let scale = mon.scale_factor();
        let is_primary = primary_monitor
            .as_ref()
            .and_then(|p| p.name())
            .map(|pn| pn == &name)
            .unwrap_or(idx == 0);

        displays.push(DisplayInfo {
            index: idx,
            name,
            position_x: pos.x,
            position_y: pos.y,
            width_px: size.width,
            height_px: size.height,
            work_area_x: pos.x,
            work_area_y: pos.y,
            work_area_width: size.width,
            work_area_height: size.height,
            scale_factor: scale,
            is_primary,
        });
    }

    Ok(displays)
}

#[tauri::command]
pub fn show_lyrics_player(
    app: AppHandle,
    monitor_id: Option<String>,
    fullscreen: Option<bool>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(LYRICS_PLAYER_WINDOW_LABEL)
        .ok_or_else(|| format!("Window '{LYRICS_PLAYER_WINDOW_LABEL}' not found in Tauri config"))?;

    // Handle target monitor positioning if requested
    if let Some(target_id) = monitor_id {
        if let Ok(monitors) = app.available_monitors() {
            for (idx, mon) in monitors.into_iter().enumerate() {
                let id = format!("{idx}");
                let name = mon.name().map(|n| n.to_string()).unwrap_or_default();
                if id == target_id || name == target_id {
                    let pos = mon.position();
                    let size = mon.size();
                    let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
                    let _ = window.set_size(PhysicalSize::new(size.width, size.height));
                    break;
                }
            }
        }
    }

    let should_fs = fullscreen.unwrap_or(true);
    let _ = window.set_fullscreen(should_fs);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    // Broadcast immediate snapshot hydration so the fullscreen window does not wait or suffer from hidden-webview event loss
    if let Some(lyrics_ctrl) = app.try_state::<crate::lyrics::LyricsController>() {
        let snapshot = lyrics_ctrl.get_state();
        let _ = app.emit(crate::lyrics::LYRICS_PLAYER_OPENED_EVENT, &snapshot);
        let _ = app.emit(crate::lyrics::LYRICS_STATE_EVENT, &snapshot);
    }

    Ok(())
}

#[tauri::command]
pub fn hide_lyrics_player(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LYRICS_PLAYER_WINDOW_LABEL) {
        let _ = window.set_fullscreen(false);
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_lyrics_player_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window(LYRICS_PLAYER_WINDOW_LABEL)
        .ok_or_else(|| format!("Window '{LYRICS_PLAYER_WINDOW_LABEL}' not found"))?;

    let is_fs = window.is_fullscreen().unwrap_or(false);
    let new_fs = !is_fs;
    window
        .set_fullscreen(new_fs)
        .map_err(|e| format!("Failed to set fullscreen: {e}"))?;

    Ok(new_fs)
}

#[tauri::command]
pub fn is_lyrics_player_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window(LYRICS_PLAYER_WINDOW_LABEL)
        .ok_or_else(|| format!("Window '{LYRICS_PLAYER_WINDOW_LABEL}' not found"))?;

    Ok(window.is_fullscreen().unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_constants_and_status() {
        assert_eq!(LYRICS_PLAYER_WINDOW_LABEL, "lyrics-player");
        let status = LyricsPlayerStatus {
            is_open: true,
            is_fullscreen: true,
            monitor_name: Some("Display 1".to_string()),
        };
        assert!(status.is_fullscreen);
        assert!(status.is_open);
    }
}
