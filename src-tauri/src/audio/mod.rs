pub mod capture;
pub mod dsp;
pub mod types;

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};

use self::capture::WasapiLoopbackWorker;
use self::types::{AlbumPalette, BeatGlowFrame, BeatGlowPrefs, BeatGlowPrefsPatch};

#[allow(dead_code)]
pub const BEAT_GLOW_DATA_EVENT: &str = "beat-glow-data";
pub const BEAT_GLOW_PREFS_EVENT: &str = "beat-glow-prefs-changed";
pub const ALBUM_PALETTE_EVENT: &str = "album-palette-changed";

pub struct BeatGlowController {
    prefs: Arc<Mutex<BeatGlowPrefs>>,
    latest_frame: Arc<Mutex<BeatGlowFrame>>,
    active_palette: Arc<Mutex<Option<AlbumPalette>>>,
    worker: Mutex<Option<WasapiLoopbackWorker>>,
    prefs_path: Mutex<Option<PathBuf>>,
}

impl Default for BeatGlowController {
    fn default() -> Self {
        Self::new()
    }
}

impl BeatGlowController {
    pub fn new() -> Self {
        let prefs = Arc::new(Mutex::new(BeatGlowPrefs::default()));
        let latest_frame = Arc::new(Mutex::new(BeatGlowFrame::idle(false, false)));
        let active_palette = Arc::new(Mutex::new(None));

        Self {
            prefs,
            latest_frame,
            active_palette,
            worker: Mutex::new(None),
            prefs_path: Mutex::new(None),
        }
    }

    pub fn init(&self, app: &AppHandle) {
        let prefs = self.ensure_prefs_loaded(app);

        // Start WASAPI worker thread
        let mut worker_guard = self.worker.lock().expect("worker lock poisoned");
        if worker_guard.is_none() {
            let worker = WasapiLoopbackWorker::new(
                app.clone(),
                Arc::clone(&self.prefs),
                Arc::clone(&self.latest_frame),
            );
            *worker_guard = Some(worker);
        }

        // Emit initial prefs
        let _ = app.emit(BEAT_GLOW_PREFS_EVENT, &prefs);
    }

    pub fn ensure_prefs_loaded(&self, app: &AppHandle) -> BeatGlowPrefs {
        let mut path_guard = self.prefs_path.lock().expect("prefs_path lock poisoned");
        if path_guard.is_none() {
            let path = app
                .path()
                .app_local_data_dir()
                .ok()
                .map(|dir| dir.join("beat-glow-prefs.json"));
            *path_guard = path;
        }

        let loaded = path_guard
            .as_ref()
            .and_then(|p| load_prefs_from_disk(p))
            .unwrap_or_default();

        let mut prefs_guard = self.prefs.lock().expect("prefs lock poisoned");
        *prefs_guard = loaded.clone();
        loaded
    }

    pub fn get_prefs(&self, app: &AppHandle) -> BeatGlowPrefs {
        self.ensure_prefs_loaded(app)
    }

    pub fn set_prefs(&self, app: &AppHandle, patch: BeatGlowPrefsPatch) -> BeatGlowPrefs {
        self.ensure_prefs_loaded(app);

        let (updated, path) = {
            let mut prefs_guard = self.prefs.lock().expect("prefs lock poisoned");
            prefs_guard.apply_patch(patch);
            let updated = prefs_guard.clone();
            let path_guard = self.prefs_path.lock().expect("prefs_path lock poisoned");
            (updated, path_guard.clone())
        };

        if let Some(path) = path {
            if let Err(err) = save_prefs_to_disk(&path, &updated) {
                eprintln!("[BeatGlow] Failed to save prefs to disk: {}", err);
            }
        }

        let _ = app.emit(BEAT_GLOW_PREFS_EVENT, &updated);
        updated
    }

    pub fn get_latest_frame(&self) -> BeatGlowFrame {
        if let Ok(guard) = self.latest_frame.lock() {
            guard.clone()
        } else {
            BeatGlowFrame::idle(false, false)
        }
    }

    pub fn get_palette(&self) -> Option<AlbumPalette> {
        self.active_palette
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    }

    pub fn set_palette(&self, app: &AppHandle, palette: AlbumPalette) -> Result<(), String> {
        {
            let mut guard = self
                .active_palette
                .lock()
                .map_err(|e| format!("Palette mutex poisoned: {e}"))?;
            *guard = Some(palette.clone());
        }

        let _ = app.emit(ALBUM_PALETTE_EVENT, &palette);
        Ok(())
    }

    #[allow(dead_code)]
    pub fn clear_palette(&self, app: &AppHandle) {
        if let Ok(mut guard) = self.active_palette.lock() {
            *guard = None;
        }
        let _ = app.emit(ALBUM_PALETTE_EVENT, Option::<AlbumPalette>::None);
    }

    pub fn stop(&self) {
        let mut worker_guard = self.worker.lock().expect("worker lock poisoned");
        if let Some(mut worker) = worker_guard.take() {
            worker.stop();
        }
    }
}

fn load_prefs_from_disk(path: &PathBuf) -> Option<BeatGlowPrefs> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<BeatGlowPrefs>(&raw).ok()
}

fn save_prefs_to_disk(path: &PathBuf, prefs: &BeatGlowPrefs) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed creating beat glow prefs directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(prefs)
        .map_err(|err| format!("Failed serializing beat glow prefs: {err}"))?;
    fs::write(path, json).map_err(|err| format!("Failed writing beat glow prefs file: {err}"))?;
    Ok(())
}

// Tauri Command Handlers

#[tauri::command]
pub fn get_beat_glow_data(controller: tauri::State<'_, BeatGlowController>) -> BeatGlowFrame {
    controller.get_latest_frame()
}

#[tauri::command]
pub fn get_beat_glow_prefs(
    app: AppHandle,
    controller: tauri::State<'_, BeatGlowController>,
) -> BeatGlowPrefs {
    controller.get_prefs(&app)
}

#[tauri::command]
pub fn set_beat_glow_prefs(
    app: AppHandle,
    controller: tauri::State<'_, BeatGlowController>,
    patch: BeatGlowPrefsPatch,
) -> BeatGlowPrefs {
    controller.set_prefs(&app, patch)
}

#[tauri::command]
pub fn get_album_palette(controller: tauri::State<'_, BeatGlowController>) -> Option<AlbumPalette> {
    controller.get_palette()
}

#[tauri::command]
pub fn set_album_palette(
    app: AppHandle,
    controller: tauri::State<'_, BeatGlowController>,
    palette: AlbumPalette,
) -> Result<(), String> {
    controller.set_palette(&app, palette)
}
