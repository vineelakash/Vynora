use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const MAX_LOG_ENTRIES: usize = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogEntry {
    pub timestamp_ms: u64,
    pub subsystem: String,
    pub stage: String,
    pub message: String,
}

#[derive(Default)]
struct LoggerState {
    entries: VecDeque<RuntimeLogEntry>,
    log_path: Option<PathBuf>,
    file: Option<File>,
}

static LOGGER: OnceLock<Mutex<LoggerState>> = OnceLock::new();

fn state() -> &'static Mutex<LoggerState> {
    LOGGER.get_or_init(|| Mutex::new(LoggerState::default()))
}

pub fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn init_log_file(path: PathBuf) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .ok();

    if let Ok(mut guard) = state().lock() {
        guard.log_path = Some(path.clone());
        guard.file = file;
    }

    log_event(
        "app",
        "log_init",
        format!("Runtime diagnostic log initialized at {}", path.display()),
    );
}

pub fn log_event(subsystem: &str, stage: &str, message: impl Into<String>) {
    let msg = message.into();
    let timestamp_ms = now_unix_ms();
    let line = format!("[{timestamp_ms}] [needle::{subsystem}] [{stage}] {msg}");

    eprintln!("{line}");

    if let Ok(mut guard) = state().lock() {
        if guard.entries.len() >= MAX_LOG_ENTRIES {
            guard.entries.pop_front();
        }
        guard.entries.push_back(RuntimeLogEntry {
            timestamp_ms,
            subsystem: subsystem.to_string(),
            stage: stage.to_string(),
            message: msg,
        });

        if let Some(file) = guard.file.as_mut() {
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
    }
}

pub fn recent_entries(subsystem_filter: Option<&str>) -> Vec<RuntimeLogEntry> {
    let Ok(guard) = state().lock() else {
        return Vec::new();
    };

    match subsystem_filter {
        Some(filter) => guard
            .entries
            .iter()
            .filter(|entry| entry.subsystem == filter)
            .cloned()
            .collect(),
        None => guard.entries.iter().cloned().collect(),
    }
}

pub fn log_file_path() -> Option<String> {
    state()
        .lock()
        .ok()
        .and_then(|g| g.log_path.as_ref().map(|p| p.display().to_string()))
}
