// Platform-neutral parts of the WASAPI loopback capture (speaker/windows.rs), kept
// apart so they are unit-tested on every host, not only on a Windows runner.

use std::time::{Duration, Instant};

/// Bytes in one 32-bit float mono frame, the format the loopback client requests.
pub const BYTES_PER_FRAME: usize = 4;

/// How long the capture thread waits for a packet event before treating the endpoint
/// as idle. It also bounds how long a stop request waits for the thread.
pub const IDLE_WAIT_MS: u32 = 100;

/// Longest gap filled in one step. A longer gap (a stalled thread, or the machine
/// waking from sleep) is skipped instead of allocating hours of zeros.
pub const MAX_FILL: Duration = Duration::from_secs(1);

/// Appends the samples of one shared-mode packet of `frames` 32-bit float mono frames.
/// A packet flagged AUDCLNT_BUFFERFLAGS_SILENT is silence whatever its buffer holds.
pub fn append_f32_mono(bytes: &[u8], frames: usize, silent: bool, out: &mut Vec<f32>) {
    let frames = frames.min(bytes.len() / BYTES_PER_FRAME);
    if silent {
        out.resize(out.len() + frames, 0.0);
        return;
    }
    out.extend(
        bytes[..frames * BYTES_PER_FRAME]
            .chunks_exact(BYTES_PER_FRAME)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
    );
}

/// Reads queued packets until none is left or a read fails. `read_packet` appends one
/// packet's samples to `out` and returns false when no packet was queued. Samples read
/// before a failure stay in `out`, so the caller pushes them before it stops and
/// reports the failure. Returns whether any packet was read, and the failure.
pub fn drain_packets<E>(
    mut read_packet: impl FnMut(&mut Vec<f32>) -> Result<bool, E>,
    out: &mut Vec<f32>,
) -> (bool, Option<E>) {
    let mut got_packets = false;
    loop {
        match read_packet(out) {
            Ok(true) => got_packets = true,
            Ok(false) => return (got_packets, None),
            Err(e) => return (got_packets, Some(e)),
        }
    }
}

/// WASAPI loopback delivers no packets while nothing renders to the endpoint, but the
/// DSP keepalives (silence_suppression.rs) and the stuck-capture watchdog in main.ts
/// expect the continuous stream a macOS tap gives. While the endpoint is idle this
/// clock says how many zero samples stand in for the elapsed time.
pub struct SilenceClock {
    rate: u32,
    covered_until: Instant,
}

impl SilenceClock {
    pub fn new(rate: u32, now: Instant) -> Self {
        Self { rate, covered_until: now }
    }

    /// Real packets arrived; they cover the time up to `now`.
    pub fn on_packets(&mut self, now: Instant) {
        self.covered_until = now;
    }

    /// The endpoint stayed idle until `now`. Returns the number of zero samples that
    /// cover the time since the last packet or fill.
    pub fn idle_fill(&mut self, now: Instant) -> usize {
        let gap = now.saturating_duration_since(self.covered_until);
        if gap > MAX_FILL {
            self.covered_until = now;
            return (MAX_FILL.as_secs_f64() * self.rate as f64) as usize;
        }
        let samples = (gap.as_secs_f64() * self.rate as f64) as usize;
        // Advance only by the time the samples represent, so the remainder carries over.
        self.covered_until += Duration::from_secs_f64(samples as f64 / self.rate as f64);
        samples
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(samples: &[f32]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    #[test]
    fn decodes_little_endian_float_frames() {
        let mut out = vec![0.25];
        append_f32_mono(&packet(&[0.5, -1.0, 0.125]), 3, false, &mut out);
        assert_eq!(out, vec![0.25, 0.5, -1.0, 0.125]);
    }

    #[test]
    fn silent_packet_is_zeros_whatever_the_buffer_holds() {
        let mut out: Vec<f32> = Vec::with_capacity(4);
        append_f32_mono(&packet(&[0.9, 0.9]), 2, true, &mut out);
        assert_eq!(out, vec![0.0, 0.0]);
    }

    #[test]
    fn frame_count_never_reads_past_the_buffer() {
        let mut out: Vec<f32> = Vec::with_capacity(4);
        let mut bytes = packet(&[0.5, 0.75]);
        bytes.push(0xff); // a trailing partial frame is ignored
        append_f32_mono(&bytes, 9, false, &mut out);
        assert_eq!(out, vec![0.5, 0.75]);
        append_f32_mono(&bytes, 9, true, &mut out);
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn drain_reads_every_queued_packet() {
        let mut queue = vec![vec![0.1, 0.2], vec![0.3]].into_iter();
        let mut out: Vec<f32> = Vec::with_capacity(4);
        let (got, failure) = drain_packets(
            |o: &mut Vec<f32>| -> Result<bool, String> {
                Ok(queue.next().map(|p| o.extend(p)).is_some())
            },
            &mut out,
        );
        assert!(got);
        assert!(failure.is_none());
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn samples_read_before_a_failed_read_are_kept_for_delivery() {
        let mut calls = 0;
        let mut out: Vec<f32> = Vec::with_capacity(4);
        let (got, failure) = drain_packets(
            |o: &mut Vec<f32>| {
                calls += 1;
                match calls {
                    1 => { o.extend([0.5, 0.25]); Ok(true) }
                    _ => Err("AUDCLNT_E_DEVICE_INVALIDATED"),
                }
            },
            &mut out,
        );
        assert!(got);
        assert_eq!(failure, Some("AUDCLNT_E_DEVICE_INVALIDATED"));
        assert_eq!(out, vec![0.5, 0.25], "packets read before the failure must still be pushed");
    }

    #[test]
    fn no_packet_reports_nothing_read() {
        let mut out: Vec<f32> = Vec::with_capacity(4);
        let (got, failure) = drain_packets(|_: &mut Vec<f32>| Ok::<_, ()>(false), &mut out);
        assert!(!got);
        assert!(failure.is_none());
        assert_eq!(out.len(), 0, "an empty queue reads nothing");
    }

    #[test]
    fn idle_fill_covers_elapsed_time_once() {
        let t0 = Instant::now();
        let mut clock = SilenceClock::new(48_000, t0);
        assert_eq!(clock.idle_fill(t0 + Duration::from_millis(100)), 4_800);
        // The same instant again adds nothing: no duplicated time.
        assert_eq!(clock.idle_fill(t0 + Duration::from_millis(100)), 0);
        assert_eq!(clock.idle_fill(t0 + Duration::from_millis(150)), 2_400);
    }

    #[test]
    fn packets_reset_the_idle_clock() {
        let t0 = Instant::now();
        let mut clock = SilenceClock::new(48_000, t0);
        clock.on_packets(t0 + Duration::from_millis(500));
        assert_eq!(clock.idle_fill(t0 + Duration::from_millis(600)), 4_800);
    }

    #[test]
    fn fractional_samples_carry_over_without_drift() {
        let t0 = Instant::now();
        let mut clock = SilenceClock::new(44_100, t0);
        let mut total = 0;
        for i in 1..=100 {
            total += clock.idle_fill(t0 + Duration::from_micros(i * 10_001));
        }
        let expected = (1.0001 * 44_100.0) as usize;
        assert!(total.abs_diff(expected) <= 1, "total {total}, expected {expected}");
    }

    #[test]
    fn long_gaps_are_capped() {
        let t0 = Instant::now();
        let mut clock = SilenceClock::new(48_000, t0);
        assert_eq!(clock.idle_fill(t0 + Duration::from_secs(3_600)), 48_000);
        assert_eq!(clock.idle_fill(t0 + Duration::from_secs(3_600)), 0);
    }
}
