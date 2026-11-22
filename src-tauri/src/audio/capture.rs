use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use windows::core::{Result as WinResult, GUID};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};

use super::dsp::DspProcessor;
use super::types::{BeatGlowFrame, BeatGlowPrefs};

pub const WAVE_FORMAT_PCM: u16 = 1;
pub const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
pub const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

pub const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
pub const KSDATAFORMAT_SUBTYPE_PCM: GUID =
    GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioSampleFormat {
    Float32,
    Int16,
    Int24,
    Int32,
    Unsupported,
}

pub struct WasapiLoopbackWorker {
    running: Arc<AtomicBool>,
    #[allow(dead_code)]
    prefs: Arc<Mutex<BeatGlowPrefs>>,
    #[allow(dead_code)]
    latest_frame: Arc<Mutex<BeatGlowFrame>>,
    worker_handle: Option<JoinHandle<()>>,
}

impl WasapiLoopbackWorker {
    pub fn new(
        app_handle: AppHandle,
        prefs: Arc<Mutex<BeatGlowPrefs>>,
        latest_frame: Arc<Mutex<BeatGlowFrame>>,
    ) -> Self {
        let running = Arc::new(AtomicBool::new(true));

        let running_clone = Arc::clone(&running);
        let prefs_clone = Arc::clone(&prefs);
        let latest_frame_clone = Arc::clone(&latest_frame);

        let worker_handle = thread::Builder::new()
            .name("needle-wasapi-loopback".to_string())
            .spawn(move || {
                run_capture_loop(
                    app_handle,
                    running_clone,
                    prefs_clone,
                    latest_frame_clone,
                );
            })
            .ok();

        Self {
            running,
            prefs,
            latest_frame,
            worker_handle,
        }
    }

    #[allow(dead_code)]
    pub fn get_latest_frame(&self) -> BeatGlowFrame {
        if let Ok(guard) = self.latest_frame.lock() {
            guard.clone()
        } else {
            let enabled = self.prefs.lock().map(|p| p.enabled).unwrap_or(true);
            BeatGlowFrame::idle(enabled, true)
        }
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for WasapiLoopbackWorker {
    fn drop(&mut self) {
        self.stop();
    }
}

fn get_now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn run_capture_loop(
    app_handle: AppHandle,
    running: Arc<AtomicBool>,
    prefs: Arc<Mutex<BeatGlowPrefs>>,
    latest_frame: Arc<Mutex<BeatGlowFrame>>,
) {
    // Initialize COM on this background worker thread
    let coinit_res = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let should_uninit_com = coinit_res.is_ok();

    let mut dsp_processor = DspProcessor::new(48000.0);
    let mut ring_buffer: Vec<f32> = Vec::with_capacity(4096);
    let mut last_emit_time = Instant::now();
    let emit_interval = Duration::from_millis(26); // ~38.5 FPS

    while running.load(Ordering::Relaxed) {
        let is_enabled = prefs.lock().map(|p| p.enabled).unwrap_or(true);

        if !is_enabled {
            // Disabled in preferences: settle DSP to zero, emit idle frame, and sleep
            dsp_processor.reset();
            let idle = BeatGlowFrame::idle(false, true);
            if let Ok(mut lock) = latest_frame.lock() {
                *lock = idle.clone();
            }
            let _ = app_handle.emit("beat-glow-data", &idle);
            thread::sleep(Duration::from_millis(150));
            continue;
        }

        // Attempt to initialize WASAPI loopback device
        match init_and_run_wasapi(
            &app_handle,
            &running,
            &prefs,
            &latest_frame,
            &mut dsp_processor,
            &mut ring_buffer,
            &mut last_emit_time,
            emit_interval,
        ) {
            Ok(()) => {
                // Loop ended cleanly or was paused
            }
            Err(err) => {
                // Device invalidated or failed to open; record device_available = false
                eprintln!("[BeatGlow] WASAPI loopback capture error: {:?}. Retrying in 1s...", err);
                dsp_processor.reset();
                let idle = BeatGlowFrame::idle(false, false);
                if let Ok(mut lock) = latest_frame.lock() {
                    *lock = idle.clone();
                }
                let _ = app_handle.emit("beat-glow-data", &idle);
                thread::sleep(Duration::from_millis(1000));
            }
        }
    }

    if should_uninit_com {
        unsafe { CoUninitialize() };
    }
}

fn init_and_run_wasapi(
    app_handle: &AppHandle,
    running: &Arc<AtomicBool>,
    prefs_lock: &Arc<Mutex<BeatGlowPrefs>>,
    latest_frame: &Arc<Mutex<BeatGlowFrame>>,
    dsp_processor: &mut DspProcessor,
    ring_buffer: &mut Vec<f32>,
    last_emit_time: &mut Instant,
    emit_interval: Duration,
) -> WinResult<()> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device: IMMDevice = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let audio_client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;

        let pwfx: *mut WAVEFORMATEX = audio_client.GetMixFormat()?;
        if pwfx.is_null() {
            return Err(windows::core::Error::new(E_FAIL, "Failed to get mix format"));
        }

        let channels = (*pwfx).nChannels as usize;
        let sample_rate = (*pwfx).nSamplesPerSec as f32;
        let bits_per_sample = (*pwfx).wBitsPerSample;
        let format_tag = (*pwfx).wFormatTag;

        let sample_format = match format_tag {
            WAVE_FORMAT_IEEE_FLOAT if bits_per_sample == 32 => AudioSampleFormat::Float32,
            WAVE_FORMAT_PCM if bits_per_sample == 16 => AudioSampleFormat::Int16,
            WAVE_FORMAT_PCM if bits_per_sample == 24 => AudioSampleFormat::Int24,
            WAVE_FORMAT_PCM if bits_per_sample == 32 => AudioSampleFormat::Int32,
            WAVE_FORMAT_EXTENSIBLE => {
                let p_ext = pwfx as *const WAVEFORMATEXTENSIBLE;
                let sub_format = (*p_ext).SubFormat;
                if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && bits_per_sample == 32 {
                    AudioSampleFormat::Float32
                } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                    match bits_per_sample {
                        16 => AudioSampleFormat::Int16,
                        24 => AudioSampleFormat::Int24,
                        32 => AudioSampleFormat::Int32,
                        _ => AudioSampleFormat::Unsupported,
                    }
                } else {
                    AudioSampleFormat::Unsupported
                }
            }
            _ => AudioSampleFormat::Unsupported,
        };

        if sample_format == AudioSampleFormat::Unsupported || channels == 0 {
            CoTaskMemFree(Some(pwfx.cast()));
            return Err(windows::core::Error::new(
                E_FAIL,
                format!("Unsupported WASAPI loopback audio format: tag={}, bits={}, channels={}", format_tag, bits_per_sample, channels),
            ));
        }

        // Re-initialize DSP processor if sample rate changed
        *dsp_processor = DspProcessor::new(sample_rate);
        ring_buffer.clear();

        // 100ms buffer = 1,000,000 in 100-nanosecond units
        let buffer_duration_100ns: i64 = 1_000_000;
        let init_res = audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            buffer_duration_100ns,
            0,
            pwfx,
            None,
        );

        CoTaskMemFree(Some(pwfx.cast()));
        init_res?;

        let capture_client: IAudioCaptureClient = audio_client.GetService()?;
        audio_client.Start()?;

        // Capture loop
        let mut mono_scratch: Vec<f32> = Vec::with_capacity(2048);

        while running.load(Ordering::Relaxed) {
            let (is_enabled, current_prefs) = {
                if let Ok(guard) = prefs_lock.lock() {
                    (guard.enabled, guard.clone())
                } else {
                    (true, BeatGlowPrefs::default())
                }
            };

            if !is_enabled {
                break;
            }

            let mut packet_size = capture_client.GetNextPacketSize()?;

            while packet_size > 0 {
                let mut p_data: *mut u8 = std::ptr::null_mut();
                let mut num_frames_read: u32 = 0;
                let mut flags: u32 = 0;

                let get_buf_res = capture_client.GetBuffer(
                    &mut p_data,
                    &mut num_frames_read,
                    &mut flags,
                    None,
                    None,
                );

                if let Err(e) = get_buf_res {
                    let _ = audio_client.Stop();
                    return Err(e);
                }

                if num_frames_read > 0 && !p_data.is_null() {
                    let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                    mono_scratch.clear();

                    if is_silent {
                        mono_scratch.resize(num_frames_read as usize, 0.0);
                    } else {
                        match sample_format {
                            AudioSampleFormat::Float32 => {
                                let total_samples = (num_frames_read as usize) * channels;
                                let slice = std::slice::from_raw_parts(
                                    p_data as *const f32,
                                    total_samples,
                                );
                                for frame_idx in 0..(num_frames_read as usize) {
                                    let mut sum = 0.0f32;
                                    let base = frame_idx * channels;
                                    for c in 0..channels {
                                        sum += slice[base + c];
                                    }
                                    mono_scratch.push(sum / channels as f32);
                                }
                            }
                            AudioSampleFormat::Int16 => {
                                let total_samples = (num_frames_read as usize) * channels;
                                let slice = std::slice::from_raw_parts(
                                    p_data as *const i16,
                                    total_samples,
                                );
                                for frame_idx in 0..(num_frames_read as usize) {
                                    let mut sum = 0.0f32;
                                    let base = frame_idx * channels;
                                    for c in 0..channels {
                                        sum += (slice[base + c] as f32) / 32768.0;
                                    }
                                    mono_scratch.push(sum / channels as f32);
                                }
                            }
                            AudioSampleFormat::Int24 => {
                                let total_samples = (num_frames_read as usize) * channels;
                                let byte_slice = std::slice::from_raw_parts(
                                    p_data,
                                    total_samples * 3,
                                );
                                for frame_idx in 0..(num_frames_read as usize) {
                                    let mut sum = 0.0f32;
                                    let base = frame_idx * channels;
                                    for c in 0..channels {
                                        let sample_idx = (base + c) * 3;
                                        let b0 = byte_slice[sample_idx] as i32;
                                        let b1 = byte_slice[sample_idx + 1] as i32;
                                        let b2 = (byte_slice[sample_idx + 2] as i8) as i32; // sign extend
                                        let val = (b2 << 16) | (b1 << 8) | b0;
                                        sum += (val as f32) / 8388608.0;
                                    }
                                    mono_scratch.push(sum / channels as f32);
                                }
                            }
                            AudioSampleFormat::Int32 => {
                                let total_samples = (num_frames_read as usize) * channels;
                                let slice = std::slice::from_raw_parts(
                                    p_data as *const i32,
                                    total_samples,
                                );
                                for frame_idx in 0..(num_frames_read as usize) {
                                    let mut sum = 0.0f32;
                                    let base = frame_idx * channels;
                                    for c in 0..channels {
                                        sum += (slice[base + c] as f32) / 2147483648.0;
                                    }
                                    mono_scratch.push(sum / channels as f32);
                                }
                            }
                            AudioSampleFormat::Unsupported => {}
                        }
                    }

                    ring_buffer.extend_from_slice(&mono_scratch);

                    // Maintain at most 2048 samples in ring buffer
                    if ring_buffer.len() > 2048 {
                        let drain_count = ring_buffer.len() - 2048;
                        ring_buffer.drain(0..drain_count);
                    }
                }

                capture_client.ReleaseBuffer(num_frames_read)?;
                packet_size = capture_client.GetNextPacketSize()?;
            }

            // Check if it's time to process and emit a visualizer frame (~38-40 FPS)
            if last_emit_time.elapsed() >= emit_interval {
                *last_emit_time = Instant::now();
                let now_ms = get_now_unix_ms();

                let frame = if ring_buffer.len() >= 256 {
                    let window_len = 512.min(ring_buffer.len());
                    let start = ring_buffer.len() - window_len;
                    dsp_processor.process_frame(
                        &ring_buffer[start..],
                        &current_prefs,
                        true,
                        true,
                        now_ms,
                    )
                } else {
                    dsp_processor.process_frame(
                        &[],
                        &current_prefs,
                        true,
                        true,
                        now_ms,
                    )
                };

                if let Ok(mut lock) = latest_frame.lock() {
                    *lock = frame.clone();
                }

                let _ = app_handle.emit("beat-glow-data", &frame);
            }

            // Sleep slightly to yield CPU (10ms is ~100Hz polling rate)
            thread::sleep(Duration::from_millis(10));
        }

        let _ = audio_client.Stop();
        Ok(())
    }
}
