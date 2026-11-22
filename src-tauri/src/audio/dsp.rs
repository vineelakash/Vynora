use std::f32::consts::PI;
use super::types::{BeatGlowFrame, BeatGlowPrefs, DEFAULT_SPECTRUM_SIZE};

pub const FFT_SIZE: usize = 512;
pub const BASS_MIN_HZ: f32 = 20.0;
pub const BASS_MAX_HZ: f32 = 250.0;
pub const MID_MIN_HZ: f32 = 250.0;
pub const MID_MAX_HZ: f32 = 4000.0;
pub const TREBLE_MIN_HZ: f32 = 4000.0;
pub const TREBLE_MAX_HZ: f32 = 20000.0;

#[derive(Debug, Clone, Copy)]
pub struct Complex {
    pub re: f32,
    pub im: f32,
}

impl Complex {
    #[inline]
    pub fn new(re: f32, im: f32) -> Self {
        Self { re, im }
    }

    #[inline]
    pub fn zero() -> Self {
        Self { re: 0.0, im: 0.0 }
    }

    #[inline]
    pub fn add(self, other: Self) -> Self {
        Self {
            re: self.re + other.re,
            im: self.im + other.im,
        }
    }

    #[inline]
    pub fn sub(self, other: Self) -> Self {
        Self {
            re: self.re - other.re,
            im: self.im - other.im,
        }
    }

    #[inline]
    pub fn mul(self, other: Self) -> Self {
        Self {
            re: self.re * other.re - self.im * other.im,
            im: self.re * other.im + self.im * other.re,
        }
    }

    #[inline]
    pub fn norm(self) -> f32 {
        (self.re * self.re + self.im * self.im).sqrt()
    }
}

/// In-place Cooley-Tukey Radix-2 Decimation-In-Time FFT.
/// Requires buffer length to be a power of two.
pub fn radix2_fft(buffer: &mut [Complex]) {
    let n = buffer.len();
    if n <= 1 {
        return;
    }
    assert!(n.is_power_of_two(), "FFT size must be a power of two");

    // Bit-reversal permutation
    let mut j = 0;
    for i in 0..n {
        if i < j {
            buffer.swap(i, j);
        }
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
    }

    // Cooley-Tukey butterflies
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        let angle = -2.0 * PI / (len as f32);
        let w_step = Complex::new(angle.cos(), angle.sin());

        let mut i = 0;
        while i < n {
            let mut w = Complex::new(1.0, 0.0);
            for k in 0..half {
                let u = buffer[i + k];
                let v = buffer[i + k + half].mul(w);
                buffer[i + k] = u.add(v);
                buffer[i + k + half] = u.sub(v);
                w = w.mul(w_step);
            }
            i += len;
        }
        len <<= 1;
    }
}

/// Applies periodic Hann window to raw time-domain audio samples.
pub fn apply_hann_window(input: &[f32], output: &mut [Complex]) {
    let n = input.len().min(output.len());
    let denom = (n - 1).max(1) as f32;
    for i in 0..n {
        let sample = if input[i].is_finite() { input[i] } else { 0.0 };
        let multiplier = 0.5 * (1.0 - (2.0 * PI * (i as f32) / denom).cos());
        output[i] = Complex::new(sample * multiplier, 0.0);
    }
    for i in n..output.len() {
        output[i] = Complex::zero();
    }
}

/// Computes RMS amplitude of a time-domain frame, clamped to [0.0, 1.0].
pub fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sum_sq = 0.0f32;
    let mut count = 0;
    for &s in samples {
        if s.is_finite() {
            sum_sq += s * s;
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    (sum_sq / count as f32).sqrt().clamp(0.0, 1.0)
}

/// Computes Peak amplitude of a time-domain frame, clamped to [0.0, 1.0].
pub fn compute_peak(samples: &[f32]) -> f32 {
    let mut peak = 0.0f32;
    for &s in samples {
        if s.is_finite() {
            let abs_s = s.abs();
            if abs_s > peak {
                peak = abs_s;
            }
        }
    }
    peak.clamp(0.0, 1.0)
}

/// Downsamples time-domain audio to a fixed number of display points.
pub fn downsample_waveform(samples: &[f32], target_len: usize) -> Vec<f32> {
    if samples.is_empty() || target_len == 0 {
        return vec![0.0; target_len];
    }
    let mut result = Vec::with_capacity(target_len);
    let step = samples.len() as f32 / target_len as f32;
    for i in 0..target_len {
        let idx = ((i as f32 * step).round() as usize).min(samples.len() - 1);
        let sample = if samples[idx].is_finite() { samples[idx] } else { 0.0 };
        result.push(sample.clamp(-1.0, 1.0));
    }
    result
}

/// Computes logarithmic spectrum bins (default 64) and frequency band energies.
pub struct SpectrumAnalyzer {
    _sample_rate: f32,
    num_bins: usize,
    bin_ranges: Vec<(usize, usize)>,
    bass_range: (usize, usize),
    mid_range: (usize, usize),
    treble_range: (usize, usize),
}

impl SpectrumAnalyzer {
    pub fn new(sample_rate: f32, fft_size: usize, num_bins: usize) -> Self {
        let sr = if sample_rate > 8000.0 { sample_rate } else { 48000.0 };
        let nyquist = sr * 0.5;
        let bin_hz = sr / (fft_size as f32);

        let hz_to_fft_idx = |hz: f32| -> usize {
            let idx = (hz / bin_hz).round() as usize;
            idx.clamp(0, (fft_size / 2).saturating_sub(1))
        };

        let bass_range = (hz_to_fft_idx(BASS_MIN_HZ), hz_to_fft_idx(BASS_MAX_HZ).max(hz_to_fft_idx(BASS_MIN_HZ) + 1));
        let mid_range = (hz_to_fft_idx(MID_MIN_HZ), hz_to_fft_idx(MID_MAX_HZ).max(hz_to_fft_idx(MID_MIN_HZ) + 1));
        let treble_range = (hz_to_fft_idx(TREBLE_MIN_HZ), hz_to_fft_idx(TREBLE_MAX_HZ.min(nyquist)).max(hz_to_fft_idx(TREBLE_MIN_HZ) + 1));

        let f_min = 20.0f32;
        let f_max = (20000.0f32).min(nyquist);
        let mut bin_ranges = Vec::with_capacity(num_bins);

        for i in 0..num_bins {
            let t0 = i as f32 / num_bins as f32;
            let t1 = (i + 1) as f32 / num_bins as f32;
            let hz0 = f_min * (f_max / f_min).powf(t0);
            let hz1 = f_min * (f_max / f_min).powf(t1);

            let start_idx = hz_to_fft_idx(hz0);
            let mut end_idx = hz_to_fft_idx(hz1);
            if end_idx <= start_idx {
                end_idx = (start_idx + 1).min(fft_size / 2);
            }
            bin_ranges.push((start_idx, end_idx));
        }

        Self {
            _sample_rate: sr,
            num_bins,
            bin_ranges,
            bass_range,
            mid_range,
            treble_range,
        }
    }

    /// Extracts raw 64-bin spectrum, bass, mid, and treble from half-spectrum magnitudes.
    pub fn analyze_magnitudes(
        &self,
        magnitudes: &[f32],
        sensitivity: f32,
    ) -> (Vec<f32>, f32, f32, f32) {
        let half_n = magnitudes.len();
        let sens = sensitivity.clamp(0.2, 3.0);

        let mut spectrum = vec![0.0f32; self.num_bins];
        for (i, &(start, end)) in self.bin_ranges.iter().enumerate() {
            let s = start.min(half_n);
            let e = end.min(half_n);
            if s >= e {
                continue;
            }
            let mut sum = 0.0f32;
            let count = (e - s) as f32;
            for k in s..e {
                sum += magnitudes[k];
            }
            let avg = sum / count;
            // Scale and map perceptually to [0.0, 1.0]
            let scaled = (avg * sens * 2.5).sqrt();
            spectrum[i] = scaled.clamp(0.0, 1.0);
        }

        let calc_band = |(s, e): (usize, usize)| -> f32 {
            let start = s.min(half_n);
            let end = e.min(half_n);
            if start >= end {
                return 0.0;
            }
            let mut sum = 0.0f32;
            for k in start..end {
                sum += magnitudes[k];
            }
            let avg = sum / (end - start) as f32;
            (avg * sens * 3.0).sqrt().clamp(0.0, 1.0)
        };

        let bass = calc_band(self.bass_range);
        let mid = calc_band(self.mid_range);
        let treble = calc_band(self.treble_range);

        (spectrum, bass, mid, treble)
    }
}

/// Attack/Release smoother to eliminate visual jitter while preserving snappy transients.
pub struct AudioSmoother {
    pub rms: f32,
    pub peak: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub spectrum: Vec<f32>,
    pub attack: f32,
    pub release: f32,
}

impl AudioSmoother {
    pub fn new(num_bins: usize) -> Self {
        Self {
            rms: 0.0,
            peak: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            spectrum: vec![0.0; num_bins],
            attack: 0.72,
            release: 0.28,
        }
    }

    #[inline]
    fn smooth_val(current: f32, target: f32, attack: f32, release: f32) -> f32 {
        if target > current {
            current + attack * (target - current)
        } else {
            current - release * (current - target)
        }
    }

    pub fn update(
        &mut self,
        target_rms: f32,
        target_peak: f32,
        target_bass: f32,
        target_mid: f32,
        target_treble: f32,
        target_spectrum: &[f32],
    ) {
        self.rms = Self::smooth_val(self.rms, target_rms, self.attack, self.release);
        self.peak = Self::smooth_val(self.peak, target_peak, self.attack, self.release);
        self.bass = Self::smooth_val(self.bass, target_bass, self.attack, self.release);
        self.mid = Self::smooth_val(self.mid, target_mid, self.attack, self.release);
        self.treble = Self::smooth_val(self.treble, target_treble, self.attack, self.release);

        for (curr, &targ) in self.spectrum.iter_mut().zip(target_spectrum.iter()) {
            *curr = Self::smooth_val(*curr, targ, self.attack, self.release);
        }
    }

    pub fn settle(&mut self) {
        let decay = 0.82;
        self.rms *= decay;
        self.peak *= decay;
        self.bass *= decay;
        self.mid *= decay;
        self.treble *= decay;
        for s in &mut self.spectrum {
            *s *= decay;
        }
    }

    pub fn reset(&mut self) {
        self.rms = 0.0;
        self.peak = 0.0;
        self.bass = 0.0;
        self.mid = 0.0;
        self.treble = 0.0;
        self.spectrum.fill(0.0);
    }
}

/// Dynamic energy threshold beat onset detector.
pub struct BeatTracker {
    history: Vec<f32>,
    history_idx: usize,
    cooloff_frames: usize,
    cooloff_remaining: usize,
    threshold_multiplier: f32,
}

impl BeatTracker {
    pub fn new() -> Self {
        Self {
            history: vec![0.0; 24],
            history_idx: 0,
            cooloff_frames: 6, // ~150ms at 40 FPS
            cooloff_remaining: 0,
            threshold_multiplier: 1.35,
        }
    }

    pub fn track(&mut self, bass_energy: f32) -> bool {
        let n = self.history.len();
        let avg: f32 = self.history.iter().sum::<f32>() / (n as f32);

        let mut variance = 0.0f32;
        for &val in &self.history {
            let diff = val - avg;
            variance += diff * diff;
        }
        variance /= n as f32;

        self.history[self.history_idx] = bass_energy;
        self.history_idx = (self.history_idx + 1) % n;

        if self.cooloff_remaining > 0 {
            self.cooloff_remaining -= 1;
            return false;
        }

        // Bass energy must be substantial and exceed dynamic variance threshold
        let dynamic_threshold = avg + self.threshold_multiplier * variance.sqrt();
        let is_beat = bass_energy > 0.12 && bass_energy > dynamic_threshold;

        if is_beat {
            self.cooloff_remaining = self.cooloff_frames;
        }
        is_beat
    }

    pub fn reset(&mut self) {
        self.history.fill(0.0);
        self.cooloff_remaining = 0;
    }
}

/// High-level audio frame processor integrating windowing, FFT, metrics, smoothing, and beat tracking.
pub struct DspProcessor {
    _sample_rate: f32,
    analyzer: SpectrumAnalyzer,
    smoother: AudioSmoother,
    beat_tracker: BeatTracker,
    fft_buffer: Vec<Complex>,
    magnitudes: Vec<f32>,
}

impl DspProcessor {
    pub fn new(sample_rate: f32) -> Self {
        let sr = if sample_rate > 8000.0 { sample_rate } else { 48000.0 };
        Self {
            _sample_rate: sr,
            analyzer: SpectrumAnalyzer::new(sr, FFT_SIZE, DEFAULT_SPECTRUM_SIZE),
            smoother: AudioSmoother::new(DEFAULT_SPECTRUM_SIZE),
            beat_tracker: BeatTracker::new(),
            fft_buffer: vec![Complex::zero(); FFT_SIZE],
            magnitudes: vec![0.0; FFT_SIZE / 2],
        }
    }

    pub fn process_frame(
        &mut self,
        samples: &[f32],
        prefs: &BeatGlowPrefs,
        is_capturing: bool,
        device_available: bool,
        timestamp_unix_ms: u64,
    ) -> BeatGlowFrame {
        if !prefs.enabled || !is_capturing || samples.is_empty() {
            self.smoother.settle();
            return BeatGlowFrame {
                rms: self.smoother.rms,
                peak: self.smoother.peak,
                bass: self.smoother.bass,
                mid: self.smoother.mid,
                treble: self.smoother.treble,
                beat: false,
                spectrum: self.smoother.spectrum.clone(),
                waveform: vec![0.0; DEFAULT_SPECTRUM_SIZE],
                is_capturing,
                device_available,
                timestamp_unix_ms,
            };
        }

        let raw_rms = compute_rms(samples);
        let raw_peak = compute_peak(samples);
        let waveform = downsample_waveform(samples, DEFAULT_SPECTRUM_SIZE);

        // Apply Hann window and run FFT
        apply_hann_window(samples, &mut self.fft_buffer);
        radix2_fft(&mut self.fft_buffer);

        // Calculate half-spectrum magnitudes normalized by FFT size
        let half_n = FFT_SIZE / 2;
        let norm_factor = 2.0 / (FFT_SIZE as f32);
        for i in 0..half_n {
            self.magnitudes[i] = self.fft_buffer[i].norm() * norm_factor;
        }

        // Analyze frequency spectrum and bands
        let (raw_spectrum, raw_bass, raw_mid, raw_treble) =
            self.analyzer.analyze_magnitudes(&self.magnitudes, prefs.sensitivity);

        // Update attack/release smoother
        self.smoother.update(
            (raw_rms * prefs.sensitivity).clamp(0.0, 1.0),
            (raw_peak * prefs.sensitivity).clamp(0.0, 1.0),
            raw_bass,
            raw_mid,
            raw_treble,
            &raw_spectrum,
        );

        let is_beat = self.beat_tracker.track(self.smoother.bass);

        // Apply intensity multiplier to smoothed output
        let intensity = prefs.intensity.clamp(0.2, 3.0);
        let final_spectrum: Vec<f32> = self.smoother.spectrum.iter().map(|&s| (s * intensity).clamp(0.0, 1.0)).collect();

        BeatGlowFrame {
            rms: (self.smoother.rms * intensity).clamp(0.0, 1.0),
            peak: (self.smoother.peak * intensity).clamp(0.0, 1.0),
            bass: (self.smoother.bass * intensity).clamp(0.0, 1.0),
            mid: (self.smoother.mid * intensity).clamp(0.0, 1.0),
            treble: (self.smoother.treble * intensity).clamp(0.0, 1.0),
            beat: is_beat,
            spectrum: final_spectrum,
            waveform,
            is_capturing: true,
            device_available,
            timestamp_unix_ms,
        }
    }

    pub fn reset(&mut self) {
        self.smoother.reset();
        self.beat_tracker.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radix2_fft_matches_known_dc_signal() {
        let mut buffer = vec![Complex::new(1.0, 0.0); 8];
        radix2_fft(&mut buffer);
        // DC component should be 8.0, all other bins 0.0
        assert!((buffer[0].re - 8.0).abs() < 1e-4);
        assert!(buffer[0].im.abs() < 1e-4);
        for i in 1..8 {
            assert!(buffer[i].norm() < 1e-4, "bin {} expected 0, got {}", i, buffer[i].norm());
        }
    }

    #[test]
    fn radix2_fft_identifies_pure_sine_wave() {
        let n = 64;
        let mut buffer = vec![Complex::zero(); n];
        let freq_bin = 4;
        for i in 0..n {
            let angle = 2.0 * PI * (freq_bin as f32) * (i as f32) / (n as f32);
            buffer[i] = Complex::new(angle.cos(), 0.0);
        }
        radix2_fft(&mut buffer);

        // Peak should be at bin 4 and bin (64 - 4 = 60)
        let mag4 = buffer[freq_bin].norm();
        assert!(mag4 > 25.0, "Expected peak at bin 4, got {}", mag4);
        for i in 0..n {
            if i != freq_bin && i != n - freq_bin {
                assert!(buffer[i].norm() < 1e-3, "Unexpected magnitude at bin {}", i);
            }
        }
    }

    #[test]
    fn compute_rms_and_peak_on_known_signals() {
        let silence = vec![0.0f32; 100];
        assert_eq!(compute_rms(&silence), 0.0);
        assert_eq!(compute_peak(&silence), 0.0);

        let mut sine = vec![0.0f32; 1000];
        for (i, val) in sine.iter_mut().enumerate() {
            *val = (2.0 * PI * 10.0 * (i as f32) / 1000.0).sin();
        }
        let rms = compute_rms(&sine);
        let peak = compute_peak(&sine);
        // RMS of pure sine wave is 1 / sqrt(2) ~= 0.7071
        assert!((rms - 0.7071).abs() < 0.02);
        assert!((peak - 1.0).abs() < 0.01);
    }

    #[test]
    fn handles_nan_and_infinity_safely_without_crashing() {
        let bad_samples = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0.5];
        let rms = compute_rms(&bad_samples);
        let peak = compute_peak(&bad_samples);
        assert!(rms.is_finite());
        assert!(peak.is_finite());

        let mut complex_buf = vec![Complex::zero(); 16];
        apply_hann_window(&bad_samples, &mut complex_buf);
        radix2_fft(&mut complex_buf);
        for c in complex_buf {
            assert!(c.re.is_finite());
            assert!(c.im.is_finite());
        }
    }

    #[test]
    fn spectrum_analyzer_distinguishes_bass_and_treble() {
        let mut dsp = DspProcessor::new(48000.0);
        let prefs = BeatGlowPrefs::default();

        // 1. Generate 80 Hz bass sine wave
        let mut bass_samples = vec![0.0f32; FFT_SIZE];
        for (i, val) in bass_samples.iter_mut().enumerate() {
            *val = (2.0 * PI * 80.0 * (i as f32) / 48000.0).sin();
        }
        let bass_frame = dsp.process_frame(&bass_samples, &prefs, true, true, 100);
        assert!(bass_frame.bass > bass_frame.treble, "Bass frame should have bass > treble");

        dsp.reset();

        // 2. Generate 10 kHz treble sine wave
        let mut treble_samples = vec![0.0f32; FFT_SIZE];
        for (i, val) in treble_samples.iter_mut().enumerate() {
            *val = (2.0 * PI * 10000.0 * (i as f32) / 48000.0).sin();
        }
        let treble_frame = dsp.process_frame(&treble_samples, &prefs, true, true, 200);
        assert!(treble_frame.treble > treble_frame.bass, "Treble frame should have treble > bass");
    }

    #[test]
    fn smoother_settles_exponentially_on_silence() {
        let mut smoother = AudioSmoother::new(64);
        smoother.rms = 1.0;
        smoother.peak = 1.0;
        smoother.bass = 1.0;

        smoother.settle();
        assert!(smoother.rms < 1.0);
        assert!(smoother.peak < 1.0);
        assert!(smoother.bass < 1.0);

        for _ in 0..20 {
            smoother.settle();
        }
        assert!(smoother.rms < 0.05);
        assert!(smoother.peak < 0.05);
        assert!(smoother.bass < 0.05);
    }

    #[test]
    fn beat_tracker_triggers_on_energy_spikes_and_respects_cooloff() {
        let mut tracker = BeatTracker::new();
        // Prime with low baseline
        for _ in 0..20 {
            assert!(!tracker.track(0.05));
        }
        // Sudden kick drum spike
        assert!(tracker.track(0.85), "Expected beat onset on strong spike");
        // Immediate subsequent frame must not double-trigger due to cooloff
        assert!(!tracker.track(0.90), "Expected cooloff to suppress double-trigger");
    }
}
