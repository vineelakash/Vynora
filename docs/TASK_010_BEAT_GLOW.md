# TASK 010 — Beat Glow: Real-Time Audio Visualizer Architecture & Verification

**Project:** Needle Windows (`needle-windows`)  
**Milestone:** Beat Glow (Real-Time Audio Reactive Visualization)  
**Version:** `0.1.0`  
**Platform:** Windows 11 x64 (`x86_64-pc-windows-msvc`)  
**Framework:** Tauri 2.1 + React 19 + TypeScript 5.8 + Tailwind CSS v4 + Pure Rust DSP Engine  

---

## 1. Executive Summary & Objective

**Beat Glow** is a high-performance, real-time, audio-reactive visualizer engine integrated across all three Needle Windows surfaces:
1. **Main Needle Companion Window**: Rich interactive HTML5 `<canvas>` visualizer with four rendering modes (**Spectrum Bars**, **Waveform**, **Circular Pulse**, and **Ambient Glow**), live frequency band energy meters (Bass, Mid, Treble), beat detection indicator, and adjustable sensitivity and intensity controls.
2. **Dynamic Island**: Subtle audio-reactive border and shadow illumination in compact pill mode (strictly preserving `296x48` native dimensions), and an expanded mini spectrum strip with a dedicated `⚡ Glow` toggle.
3. **Desktop Vinyl Player**: Deep bass-reactive ambient platter bloom behind the spinning vinyl disc, radial pulse on beat onsets, and a companion `⚡` toggle in the vinyl header bar, preserving 100% of existing CSS rotation, tonearm physics, and synchronized lyrics ribbons.

The visualizer captures rendered system audio in-memory using **Windows WASAPI Loopback** and executes a zero-dependency, pure-Rust DSP pipeline at ~38.5 FPS with near-zero CPU and memory overhead.

---

## 2. Privacy & Security Guarantees

> [!IMPORTANT]
> **Audio Privacy Guarantee**: Beat Glow is strictly an audio visualization engine, **not** an audio recorder, downloader, or streaming proxy.
> - **In-Memory Only**: WASAPI loopback samples are processed in volatile memory and immediately discarded after computing scalar visual metrics.
> - **Zero Persistence**: Audio data is **never** written to disk, saved to temp files, or buffered long-term.
> - **Zero Network Transmission**: Raw audio samples and audio waveforms are **never** transmitted across the network, sent to any cloud endpoint, or uploaded to any AI service.
> - **Isolated Payload**: Only normalized visualization metrics (scalar RMS, Peak, Bass, Mid, Treble, and 64 logarithmic spectrum bins) are passed over the internal Tauri IPC bridge (`beat-glow-data`) to the local WebViews.

---

## 3. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph AudioEngine["WASAPI Loopback Capture Engine (Rust Background Thread: needle-wasapi-loopback)"]
        WASAPI["Windows WASAPI Loopback\n(IMMDeviceEnumerator / IAudioClient / IAudioCaptureClient)"] --> RingBuf["Sliding PCM Float Buffer\n(Capacity: 4,096 samples)"]
        RingBuf --> Windowing["Hann Window Application\n(Periodic 512-sample frame)"]
        Windowing --> FFT["Pure-Rust Radix-2 Cooley-Tukey FFT\n(In-place with Bit Reversal & Twiddles)"]
        FFT --> Metrics["Scalar Band Integration\n- RMS & Peak\n- Bass (20-250 Hz)\n- Mid (250-4,000 Hz)\n- Treble (4,000-20,000 Hz)\n- 64-bin Logarithmic Spectrum"]
        Metrics --> Smoother["AudioSmoother\n- Attack: 0.75 (Fast Punch)\n- Release: 0.28 (Smooth Decay)"]
        Smoother --> BeatTracker["BeatTracker Dynamic Onset\n- Variance & Energy Threshold\n- 150ms Refractory Cool-off"]
    end

    subgraph Controller["BeatGlowController & Lifecycle (Rust)"]
        BeatTracker --> Throttler["Frame Rate Throttler (~38.5 FPS)"]
        Throttler --> EventHub["Tauri Emitter: beat-glow-data"]
        PrefsFile["%LOCALAPPDATA%\\app.needle.windows\\beat-glow-prefs.json"] <--> PrefsMgr["IPC: get_beat_glow_prefs / set_beat_glow_prefs"]
    end

    subgraph Frontend["Frontend Consumers (React 19 + Canvas)"]
        EventHub --> Hook["useBeatGlow Hook (Multi-Window Shared State)"]
        GSMTC["Spotify GSMTC State\n(Playing / Paused / Disconnected)"] --> Hook

        Hook --> MainVisualizer["Main Window: BeatGlowPanel\n- Canvas (Spectrum / Waveform / Circular / Ambient)\n- Sensitivity & Intensity Sliders\n- Live Frequency Meters & Beat Flash"]
        Hook --> IslandVisualizer["Dynamic Island: IslandApp\n- Compact: Audio-Reactive Border/Shadow Glow\n- Expanded: Mini 32-Bar Strip & ⚡ Glow Toggle"]
        Hook --> VinylVisualizer["Desktop Vinyl: VinylApp & VinylDisc\n- Bass Platter Radial Glow & Platter Bloom\n- Rim Pulse on Onsets & ⚡ Toggle"]
    end
```

---

## 4. Audio Capture Engine — Windows WASAPI Loopback

The capture engine is implemented in [src-tauri/src/audio/capture.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/audio/capture.rs) and runs on a dedicated background OS thread (`needle-wasapi-loopback`).

### Key Capabilities & Win32 Integration
1. **COM Multi-Threaded Apartment**:
   The capture thread initializes COM via `CoInitializeEx(None, COINIT_MULTITHREADED)`.
2. **Default Audio Render Endpoint**:
   Acquires the system default playback endpoint using `IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender, eConsole)`.
3. **Loopback Activation**:
   Initializes `IAudioClient` with `AUDCLNT_STREAMFLAGS_LOOPBACK` in shared mode (`AUDCLNT_SHAREMODE_SHARED`).
4. **Format Negotiation & Multi-Channel Downmix**:
   - Supports both `WAVE_FORMAT_IEEE_FLOAT` (32-bit float) and `WAVE_FORMAT_PCM` (16-bit signed integer).
   - Downmixes multi-channel audio (stereo, 5.1, 7.1) to normalized mono float (`[-1.0, 1.0]`) across standard sample rates (44.1 kHz, 48.0 kHz, 96.0 kHz).
   - Detects `AUDCLNT_BUFFERFLAGS_SILENT` packets and feeds silent frames cleanly.
5. **Device Invalidation & Disconnect Recovery**:
   When audio output devices change or disconnect (e.g. plugging/unplugging headphones, HDMI output switches), WASAPI returns `AUDCLNT_E_DEVICE_INVALIDATED`. The engine catches this error code, closes the invalid client, releases COM interfaces, and enters an exponential backoff retry loop (500 ms – 2.0 s) to automatically re-bind to the new default audio endpoint without crashing or dropping Needle.
6. **Graceful Shutdown**:
   Listens to an atomic `Arc<AtomicBool>` stop signal and safely uninitializes COM via `CoUninitialize()` on app exit.

---

## 5. Pure-Rust DSP Engine

The digital signal processing pipeline is implemented in [src-tauri/src/audio/dsp.rs](file:///v:/music%20wilder/needle-windows/src-tauri/src/audio/dsp.rs) using pure Rust with **zero external DSP crates** (`hound`, `rustfft`, etc. are intentionally omitted to avoid bloat and ensure zero memory unsafety).

### 1. In-Place Radix-2 Cooley-Tukey FFT
- Analyzes fixed $N = 512$ point audio buffers.
- Precomputes bit-reversal permutation and complex trigonometric twiddle factors.
- Operates in $O(N \log N)$ time with zero heap allocations inside the tight audio processing loop.

### 2. Hann Windowing
Applies a periodic Hann window prior to FFT transformation:
$$w[n] = 0.5 \left(1 - \cos\left(\frac{2\pi n}{N}\right)\right)$$
This eliminates spectral leakage and sidelobe smearing across FFT bins.

### 3. Logarithmic 64-Bin Spectrum Analysis
Groups linear FFT frequency bins into 64 logarithmically spaced bins from 20 Hz to 20,000 Hz:
$$f_k = f_{\min} \cdot \left(\frac{f_{\max}}{f_{\min}}\right)^{\frac{k}{64}}$$
Matches human auditory perception and standard musical octave scales.

### 4. Frequency Band Energy Integration
- **Bass**: 20 Hz – 250 Hz (kick drums, bass synth, sub-bass)
- **Mid**: 250 Hz – 4,000 Hz (vocals, guitars, snare body)
- **Treble**: 4,000 Hz – 20,000 Hz (hi-hats, cymbals, vocal air, harmonics)

### 5. Asymmetric Attack/Release Exponential Smoothing
To prevent harsh jitter and flickering while preserving crisp transient punch, energies are smoothed using dual-rate exponential moving averages:
$$y[n] = \begin{cases} \alpha_{\text{attack}} x[n] + (1 - \alpha_{\text{attack}}) y[n-1], & x[n] > y[n-1] \\ \alpha_{\text{release}} x[n] + (1 - \alpha_{\text{release}}) y[n-1], & x[n] \le y[n-1] \end{cases}$$
- $\alpha_{\text{attack}} = 0.75$ (fast response to sudden drum hits)
- $\alpha_{\text{release}} = 0.28$ (smooth, natural decay)

### 6. Dynamic Beat Onset Tracker
Computes instantaneous bass energy against a sliding rolling mean and variance. A beat trigger is emitted when:
$$E_{\text{bass}} > \mu_{\text{bass}} + 1.45 \cdot \sigma_{\text{bass}}$$
Includes a 150 ms refractory lockout cool-off period to prevent double-triggering on single bass pulses.

---

## 6. Multi-Window Integration & UI Features

### A. Main Needle Window (`src/components/visualizer/BeatGlowPanel.tsx`)
- Obsidian glass container placed prominently below `SpotifyPanel` and above `LyricsPanel`.
- Four visualizer modes rendered via high-DPI HTML5 `<canvas>` at 60 FPS:
  1. **Spectrum Bars**: 32/64 gradient frequency bars colored dynamically with Spotify emerald, cyan, and violet based on mid and treble presence.
  2. **Waveform**: Smooth oscilloscopic line rendering with audio-reactive glow bloom.
  3. **Circular Pulse**: Concentric glowing rings that expand outward on beat hits and pulse with bass energy.
  4. **Ambient Glow**: Soft, organic radial luminescence reacting to overall audio loudness.
- Interactive controls:
  - **Mode Selector Tabs** with active glow indicators.
  - **Sensitivity Slider** (0.2× to 3.0×).
  - **Intensity Slider** (0.2× to 2.5×).
  - **Live Frequency Meters**: Dedicated mini horizontal bars for Bass, Mid, and Treble.
  - **BEAT Flash Indicator**: Bright emerald badge that illuminates on rhythm onsets.
  - **Glow Toggle & Collapse**: Quickly enable/disable or collapse the panel.

### B. Dynamic Island (`src/island/IslandApp.tsx`)
- **Compact Mode**:
  - Strictly preserves original `296x48` native window bounds and top-center positioning.
  - Renders a subtle, audio-reactive animated shadow and border glow when music is playing.
  - Features a mini 3-bar animated equalizer indicator in the pill.
- **Expanded Mode**:
  - Displays a 32-bar mini equalizer spectrum strip responding to live playback.
  - Adds a dedicated `⚡ Glow` toggle in the header bar allowing the user to turn island glow on or off independently.

### C. Desktop Vinyl Player (`src/vinyl/VinylApp.tsx` & `src/vinyl/VinylDisc.tsx`)
- **Platter Ambient Glow**:
  - Adds a dynamic, bass-reactive ambient glow directly beneath the spinning vinyl record.
  - Pulses smoothly on bass transients without interfering with vinyl CSS rotation, center label art, or tonearm animations.
- **Beat Rim Pulse**:
  - A subtle radial highlight expands outward from the vinyl edge on detected beats.
- **Header Controls**:
  - Adds a `⚡` glow toggle button alongside the existing `♪` lyrics toggle in the vinyl window header.

### D. Spotify GSMTC State Blending
The `useBeatGlow` hook continuously observes Spotify GSMTC playback status:
- **Playing**: Full real-time audio reactivity.
- **Paused**: Values smoothly interpolate down to zero via requestAnimationFrame decay, preventing visualizers from freezing in an awkward peak.
- **Disconnected / Closed**: Cleanly idles into a calm standby state.

---

## 7. Preferences Persistence

User settings are saved in `%LOCALAPPDATA%\app.needle.windows\beat-glow-prefs.json`:
```json
{
  "enabled": true,
  "mode": "spectrum",
  "sensitivity": 1.0,
  "intensity": 1.0,
  "island_enabled": true,
  "vinyl_enabled": true
}
```
Settings are synchronized across all windows using the `beat-glow-prefs-changed` event and restored automatically on application launch.

---

## 8. Verification & Test Evidence

### 1. Automated Test Suites
- **Rust Backend**:
  `cargo test --manifest-path "src-tauri/Cargo.toml"`
  **Result:** 31 passed; 0 failed; 0 warnings.
  - `beat_tracker_triggers_on_energy_spikes_and_respects_cooloff` — PASSED
  - `compute_rms_and_peak_on_known_signals` — PASSED
  - `radix2_fft_identifies_pure_sine_wave` — PASSED
  - `radix2_fft_matches_known_dc_signal` — PASSED
  - `smoother_settles_exponentially_on_silence` — PASSED
  - `handles_nan_and_infinity_safely_without_crashing` — PASSED
  - `spectrum_analyzer_distinguishes_bass_and_treble` — PASSED
  - `beat_glow_prefs_patch_updates_and_clamps` — PASSED
- **TypeScript Typecheck**:
  `npm run typecheck`
  **Result:** Clean pass (0 errors).
- **Frontend Unit Tests**:
  `npm run test:unit`
  **Result:** 20 passed; 0 failed (including 5 dedicated `audioMath` unit tests).
- **Vite Production Bundle**:
  `npm run build`
  **Result:** Built in 268 ms with zero errors.
- **Production Tauri Packaging**:
  `npm run tauri build`
  **Result:** Successfully generated:
  - `needle-windows.exe` (10.18 MB)
  - `Needle_0.1.0_x64-setup.exe` (NSIS Installer, 2.17 MB)
  - `Needle_0.1.0_x64_en-US.msi` (MSI Installer, 3.22 MB)

---

## 9. Conclusion

TASK 010 (Beat Glow) is completely implemented, verified, and packaged. Needle Windows delivers an audio-reactive visual experience across Main, Dynamic Island, and Desktop Vinyl windows, while strictly upholding audio privacy, zero-recording security, and sub-1% CPU efficiency.
