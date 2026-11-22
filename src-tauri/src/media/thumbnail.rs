use std::time::Duration;

use serde::Serialize;
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

use super::gsmtc::wait_async_op;
use crate::diagnostics;

const MAX_THUMBNAIL_BYTES: usize = 5 * 1024 * 1024;
const READ_CHUNK_BYTES: u32 = 65_536;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyArtwork {
    pub mime_type: String,
    pub data_url: String,
    pub byte_len: usize,
}

pub fn detect_image_mime(bytes: &[u8], stream_content_type: Option<&str>) -> Option<&'static str> {
    if bytes.is_empty() {
        return None;
    }

    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }

    match stream_content_type
        .map(|ct| ct.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("image/png") => Some("image/png"),
        Some("image/jpeg") | Some("image/jpg") => Some("image/jpeg"),
        Some("image/webp") => Some("image/webp"),
        Some("image/gif") => Some("image/gif"),
        Some("image/bmp") => Some("image/bmp"),
        _ => None,
    }
}

pub fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    let mut chunks = input.chunks_exact(3);

    for chunk in &mut chunks {
        let n = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push(TABLE[(n & 0x3F) as usize] as char);
    }

    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
            out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
            out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
            out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
            out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
            out.push('=');
        }
        _ => {}
    }

    out
}

pub fn build_artwork(bytes: &[u8], stream_content_type: Option<&str>) -> Option<SpotifyArtwork> {
    if bytes.is_empty() || bytes.len() > MAX_THUMBNAIL_BYTES {
        return None;
    }

    let mime_type = detect_image_mime(bytes, stream_content_type)?;
    let encoded = encode_base64(bytes);

    Some(SpotifyArtwork {
        mime_type: mime_type.to_string(),
        data_url: format!("data:{mime_type};base64,{encoded}"),
        byte_len: bytes.len(),
    })
}

pub fn read_thumbnail_stream(
    thumbnail_ref: &IRandomAccessStreamReference,
) -> Option<SpotifyArtwork> {
    let open_op = match thumbnail_ref.OpenReadAsync() {
        Ok(op) => op,
        Err(err) => {
            diagnostics::log_event(
                "media",
                "thumbnail_warn",
                format!("Thumbnail OpenReadAsync call failed: {err}"),
            );
            return None;
        }
    };

    let stream = match wait_async_op(&open_op, Duration::from_millis(1200), "Thumbnail::OpenReadAsync") {
        Ok(s) => s,
        Err(err) => {
            diagnostics::log_event("media", "thumbnail_warn", err);
            return None;
        }
    };

    let content_type = stream
        .ContentType()
        .ok()
        .map(|s| s.to_string_lossy())
        .filter(|s| !s.is_empty());

    let reported_size = stream.Size().unwrap_or(0);
    if reported_size > MAX_THUMBNAIL_BYTES as u64 {
        let _ = stream.Close();
        return None;
    }

    let input_stream = match stream.GetInputStreamAt(0) {
        Ok(s) => s,
        Err(_) => {
            let _ = stream.Close();
            return None;
        }
    };

    let reader = match DataReader::CreateDataReader(&input_stream) {
        Ok(r) => r,
        Err(_) => {
            let _ = stream.Close();
            return None;
        }
    };

    let mut bytes = Vec::with_capacity((reported_size as usize).min(MAX_THUMBNAIL_BYTES));
    loop {
        let Ok(op) = reader.LoadAsync(READ_CHUNK_BYTES) else {
            break;
        };
        let loaded = match wait_async_op(&op, Duration::from_millis(1000), "Thumbnail::LoadAsync") {
            Ok(n) => n,
            Err(err) => {
                diagnostics::log_event("media", "thumbnail_warn", err);
                break;
            }
        };
        if loaded == 0 {
            break;
        }

        if bytes.len().saturating_add(loaded as usize) > MAX_THUMBNAIL_BYTES {
            bytes.clear();
            break;
        }

        let mut chunk = vec![0u8; loaded as usize];
        if reader.ReadBytes(&mut chunk).is_err() {
            bytes.clear();
            break;
        }
        bytes.extend_from_slice(&chunk);
    }

    let _ = reader.Close();
    let _ = stream.Close();

    build_artwork(&bytes, content_type.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_rfc4648_base64_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn detects_image_magic_bytes_and_rejects_invalid_payloads() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
        let art = build_artwork(&png, Some("application/octet-stream")).expect("png artwork");
        assert_eq!(art.mime_type, "image/png");
        assert!(art.data_url.starts_with("data:image/png;base64,"));

        let jpg = [0xFF, 0xD8, 0xFF, 0xE0];
        assert_eq!(detect_image_mime(&jpg, None), Some("image/jpeg"));

        assert_eq!(
            detect_image_mime(b"<svg>not allowed</svg>", Some("image/svg+xml")),
            None
        );
        assert_eq!(build_artwork(&[], Some("image/png")), None);
    }
}
