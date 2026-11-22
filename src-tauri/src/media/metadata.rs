use std::time::Duration;

use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

use super::gsmtc::wait_async_op;

const TICKS_PER_MILLISECOND: i64 = 10_000;
const WINDOWS_TO_UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
    Opened,
    Changing,
    Closed,
    Unknown,
}

impl From<GlobalSystemMediaTransportControlsSessionPlaybackStatus> for PlaybackStatus {
    fn from(value: GlobalSystemMediaTransportControlsSessionPlaybackStatus) -> Self {
        match value {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => Self::Playing,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => Self::Paused,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => Self::Stopped,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened => Self::Opened,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => Self::Changing,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed => Self::Closed,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineInfo {
    pub start_ms: u64,
    pub end_ms: u64,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub last_updated_unix_ms: Option<u64>,
}

pub struct ExtractedMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub media_properties: Option<GlobalSystemMediaTransportControlsSessionMediaProperties>,
    pub timeline: Option<TimelineInfo>,
    pub playback_status: PlaybackStatus,
}

pub fn normalize_optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn ticks_to_ms(ticks: i64) -> Option<u64> {
    if ticks < 0 {
        None
    } else {
        Some((ticks / TICKS_PER_MILLISECOND) as u64)
    }
}

pub fn filetime_ticks_to_unix_ms(universal_time: i64) -> Option<u64> {
    if universal_time <= WINDOWS_TO_UNIX_EPOCH_TICKS {
        None
    } else {
        Some(((universal_time - WINDOWS_TO_UNIX_EPOCH_TICKS) / TICKS_PER_MILLISECOND) as u64)
    }
}

pub fn current_windows_universal_ticks() -> i64 {
    let unix_ticks = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_nanos() / 100) as i64)
        .unwrap_or(0);
    WINDOWS_TO_UNIX_EPOCH_TICKS.saturating_add(unix_ticks)
}

pub fn compute_timeline(
    start_ticks: i64,
    end_ticks: i64,
    position_ticks: i64,
    last_updated_ticks: i64,
    now_universal_ticks: i64,
    playback_status: PlaybackStatus,
    playback_rate: Option<f64>,
) -> Option<TimelineInfo> {
    if start_ticks <= 0 && end_ticks <= 0 && position_ticks <= 0 {
        return None;
    }

    let start_ms = ticks_to_ms(start_ticks).unwrap_or(0);
    let end_ms = ticks_to_ms(end_ticks).unwrap_or(0);
    let duration_ms = if end_ms > start_ms {
        Some(end_ms - start_ms)
    } else {
        None
    };

    let raw_pos_ms = ticks_to_ms(position_ticks).unwrap_or(0);
    let mut relative_pos_ms = raw_pos_ms.saturating_sub(start_ms);

    if playback_status == PlaybackStatus::Playing
        && last_updated_ticks > WINDOWS_TO_UNIX_EPOCH_TICKS
        && now_universal_ticks > last_updated_ticks
    {
        let rate = playback_rate
            .filter(|r| *r > 0.0 && *r <= 4.0)
            .unwrap_or(1.0);
        let elapsed_ms =
            (((now_universal_ticks - last_updated_ticks) / TICKS_PER_MILLISECOND) as f64) * rate;
        if elapsed_ms.is_finite() && elapsed_ms > 0.0 {
            let extrapolated = relative_pos_ms.saturating_add(elapsed_ms as u64);
            relative_pos_ms = match duration_ms {
                Some(duration) => extrapolated.min(duration),
                None => relative_pos_ms,
            };
        }
    } else if let Some(duration) = duration_ms {
        relative_pos_ms = relative_pos_ms.min(duration);
    }

    Some(TimelineInfo {
        start_ms,
        end_ms,
        position_ms: relative_pos_ms,
        duration_ms,
        last_updated_unix_ms: filetime_ticks_to_unix_ms(last_updated_ticks),
    })
}

pub fn extract_session_metadata(
    session: &GlobalSystemMediaTransportControlsSession,
    raw_playback_status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    pre_fetched_props: Option<GlobalSystemMediaTransportControlsSessionMediaProperties>,
    pre_title: Option<String>,
    pre_artist: Option<String>,
    pre_album: Option<String>,
) -> ExtractedMetadata {
    let playback_status = PlaybackStatus::from(raw_playback_status);

    let playback_rate = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackRate().ok())
        .and_then(|r| r.Value().ok());

    let (media_properties, title, artist, album) = if pre_fetched_props.is_some() {
        (pre_fetched_props, pre_title, pre_artist, pre_album)
    } else {
        let props = session.TryGetMediaPropertiesAsync().ok().and_then(|op| {
            wait_async_op(&op, Duration::from_millis(900), "GSMTC::MetadataRetry").ok()
        });
        let (title, artist, album) = match &props {
            Some(p) => {
                let title = p
                    .Title()
                    .ok()
                    .and_then(|s| normalize_optional_text(&s.to_string_lossy()));
                let artist = p
                    .Artist()
                    .ok()
                    .and_then(|s| normalize_optional_text(&s.to_string_lossy()))
                    .or_else(|| {
                        p.AlbumArtist()
                            .ok()
                            .and_then(|s| normalize_optional_text(&s.to_string_lossy()))
                    });
                let album = p
                    .AlbumTitle()
                    .ok()
                    .and_then(|s| normalize_optional_text(&s.to_string_lossy()));
                (title, artist, album)
            }
            None => (None, None, None),
        };
        (props, title, artist, album)
    };

    let timeline = session.GetTimelineProperties().ok().and_then(|tl| {
        let start = tl.StartTime().ok()?.Duration;
        let end = tl.EndTime().ok()?.Duration;
        let pos = tl.Position().ok()?.Duration;
        let last_updated = tl
            .LastUpdatedTime()
            .map(|dt| dt.UniversalTime)
            .unwrap_or(0);

        compute_timeline(
            start,
            end,
            pos,
            last_updated,
            current_windows_universal_ticks(),
            playback_status,
            playback_rate,
        )
    });

    ExtractedMetadata {
        title,
        artist,
        album,
        media_properties,
        timeline,
        playback_status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_empty_and_whitespace_text() {
        assert_eq!(normalize_optional_text(""), None);
        assert_eq!(normalize_optional_text("   \t\n "), None);
        assert_eq!(
            normalize_optional_text("  Runaway  "),
            Some("Runaway".to_string())
        );
    }

    #[test]
    fn converts_ticks_and_extrapolates_playing_timeline() {
        let start = 0;
        let end = 248_826 * TICKS_PER_MILLISECOND;
        let pos = 47_075 * TICKS_PER_MILLISECOND;
        let updated = WINDOWS_TO_UNIX_EPOCH_TICKS + 1_000_000 * TICKS_PER_MILLISECOND;
        let now = updated + 5_000 * TICKS_PER_MILLISECOND;

        let playing = compute_timeline(
            start,
            end,
            pos,
            updated,
            now,
            PlaybackStatus::Playing,
            Some(1.0),
        )
        .expect("timeline should exist");
        assert_eq!(playing.duration_ms, Some(248_826));
        assert_eq!(playing.position_ms, 52_075);

        let paused = compute_timeline(
            start,
            end,
            pos,
            updated,
            now,
            PlaybackStatus::Paused,
            Some(1.0),
        )
        .expect("timeline should exist");
        assert_eq!(paused.position_ms, 47_075);
    }

    #[test]
    fn clamps_extrapolated_position_to_duration_and_handles_empty_timeline() {
        let start = 0;
        let end = 10_000 * TICKS_PER_MILLISECOND;
        let pos = 8_000 * TICKS_PER_MILLISECOND;
        let updated = WINDOWS_TO_UNIX_EPOCH_TICKS + 1_000_000 * TICKS_PER_MILLISECOND;
        let now = updated + 15_000 * TICKS_PER_MILLISECOND;

        let playing = compute_timeline(
            start,
            end,
            pos,
            updated,
            now,
            PlaybackStatus::Playing,
            None,
        )
        .expect("timeline should exist");
        assert_eq!(playing.position_ms, 10_000);

        assert!(
            compute_timeline(0, 0, 0, 0, now, PlaybackStatus::Paused, None).is_none()
        );
    }
}
