use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

use super::gsmtc::EnumeratedSession;

pub fn is_spotify_source_app_id(app_id: &str) -> bool {
    let normalized = app_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    normalized == "spotify.exe"
        || normalized == "spotify"
        || normalized.starts_with("spotifyab.spotifymusic")
        || normalized.ends_with("!spotify")
        || normalized.ends_with("\\spotify.exe")
        || normalized.ends_with("/spotify.exe")
}

pub fn session_priority(status: GlobalSystemMediaTransportControlsSessionPlaybackStatus) -> u8 {
    match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => 5,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => 4,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => 3,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened => 2,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => 1,
        _ => 0,
    }
}

pub struct IdentifiedSession {
    pub session: GlobalSystemMediaTransportControlsSession,
    pub source_app_id: String,
    pub raw_playback_status: GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    pub media_properties: Option<GlobalSystemMediaTransportControlsSessionMediaProperties>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

pub fn select_spotify_session(sessions: Vec<EnumeratedSession>) -> Option<IdentifiedSession> {
    let mut best: Option<(u8, IdentifiedSession)> = None;

    for entry in sessions {
        if !entry.matched_spotify || !is_spotify_source_app_id(&entry.source_app_id) {
            continue;
        }

        if entry.raw_playback_status
            == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed
        {
            continue;
        }

        let priority = session_priority(entry.raw_playback_status);
        let replace = match &best {
            Some((best_priority, _)) => priority > *best_priority,
            None => true,
        };

        if replace {
            best = Some((
                priority,
                IdentifiedSession {
                    session: entry.session,
                    source_app_id: entry.source_app_id,
                    raw_playback_status: entry.raw_playback_status,
                    media_properties: entry.media_properties,
                    title: entry.title,
                    artist: entry.artist,
                    album: entry.album,
                },
            ));
        }
    }

    best.map(|(_, identified)| identified)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_win32_and_msix_spotify_app_ids() {
        assert!(is_spotify_source_app_id("Spotify.exe"));
        assert!(is_spotify_source_app_id("spotify.exe"));
        assert!(is_spotify_source_app_id("  Spotify.exe  "));
        assert!(is_spotify_source_app_id("Spotify"));
        assert!(is_spotify_source_app_id(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"
        ));
        assert!(is_spotify_source_app_id(
            r"C:\Users\Username\AppData\Roaming\Spotify\Spotify.exe"
        ));
    }

    #[test]
    fn rejects_browsers_and_other_media_players() {
        assert!(!is_spotify_source_app_id(""));
        assert!(!is_spotify_source_app_id("chrome.exe"));
        assert!(!is_spotify_source_app_id("msedge.exe"));
        assert!(!is_spotify_source_app_id("firefox.exe"));
        assert!(!is_spotify_source_app_id("vlc.exe"));
        assert!(!is_spotify_source_app_id(
            "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
        ));
        assert!(!is_spotify_source_app_id("SpotifyWebHelperFake.exe"));
    }

    #[test]
    fn prioritizes_playing_over_paused_and_stopped() {
        assert!(
            session_priority(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                > session_priority(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused)
        );
        assert!(
            session_priority(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused)
                > session_priority(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped)
        );
        assert_eq!(
            session_priority(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed),
            0
        );
    }
}
