// Ported logic
use super::loopback::{append_f32_mono, drain_packets, SilenceClock, BYTES_PER_FRAME, IDLE_WAIT_MS};
use crate::audio_config::RING_BUFFER_SAMPLES;
use anyhow::Result;
use ringbuf::{
    traits::{Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tracing::error;
use wasapi::{get_default_device, DeviceCollection, Direction, SampleType, ShareMode, WaveFormat};

struct WakerState {
    shutdown: bool,
}

/// COM must be initialized on every thread that touches MMDevice/WASAPI objects; the
/// wasapi crate does not do it. RPC_E_CHANGED_MODE means the thread is already a
/// single-threaded apartment (Electron's main thread, or cpal's STA setup), which
/// WASAPI accepts, so that apartment stays in use. A successful call, S_FALSE
/// included, is balanced on drop. Declare it before any COM object so it drops last.
struct ComScope {
    owned: bool,
}

impl ComScope {
    fn enter() -> Self {
        Self { owned: wasapi::initialize_mta().is_ok() }
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        if self.owned {
            wasapi::deinitialize();
        }
    }
}

pub struct SpeakerInput {
    device_id: Option<String>,
}

pub struct SpeakerStream {
    consumer: Option<HeapCons<f32>>,
    waker_state: Arc<Mutex<WakerState>>,
    capture_thread: Option<thread::JoinHandle<()>>,
    actual_sample_rate: u32,
    data_ready: Arc<(Mutex<bool>, Condvar)>,
    /// Set by the capture thread when the running stream fails (endpoint unplugged,
    /// disabled or reconfigured). The thread has stopped; the DSP loop reports it.
    error: Arc<Mutex<Option<String>>>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.actual_sample_rate
    }

    pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
        self.consumer.take()
    }

    pub fn data_ready_signal(&self) -> Arc<(Mutex<bool>, Condvar)> {
        self.data_ready.clone()
    }

    pub fn take_error(&self) -> Option<String> {
        self.error.lock().ok().and_then(|mut slot| slot.take())
    }
}

// LIMITATION: We currently only capture from the eMultimedia/eConsole default
// render device (or a user-specified id). Many VoIP apps (Zoom, Teams, Discord,
// Meet) route audio to the eCommunications default — which the user can configure
// independently in Sound Settings. Loopback on the multimedia-default captures
// nothing while the meeting plays through the comms-default device. Adding
// eCommunications support requires raw windows-rs IMMDeviceEnumerator since
// wasapi 0.13 has no Role API. Tracked for follow-up.
// Callers hold a ComScope.
fn find_device_by_id(direction: &Direction, device_id: &str) -> Option<wasapi::Device> {
    let collection = DeviceCollection::new(direction).ok()?;
    let count = collection.get_nbr_devices().ok()?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            if let Ok(id) = device.get_id() {
                if id == device_id {
                    return Some(device);
                }
            }
        }
    }
    None
}

pub fn list_output_devices() -> Result<Vec<(String, String)>> {
    let _com = ComScope::enter();
    let collection =
        DeviceCollection::new(&Direction::Render).map_err(|e| anyhow::anyhow!("{}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    let mut list = Vec::new();

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let id = device.get_id().unwrap_or_default();
            let name = device.get_friendlyname().unwrap_or_default();
            if !id.is_empty() {
                list.push((id, name));
            }
        }
    }
    Ok(list)
}

/// Returns the WASAPI device id of the current default render device on the
/// eMultimedia/eConsole role, or empty string on failure. JS polls this so the
/// SystemAudioCapture follows the user's output route when they switch
/// devices mid-meeting. Note: this still doesn't track the eCommunications
/// role separately (a known limitation tracked in find_device_by_id).
pub fn default_output_device_uid() -> String {
    let _com = ComScope::enter();
    match get_default_device(&Direction::Render) {
        Ok(dev) => dev.get_id().unwrap_or_default(),
        Err(_) => String::new(),
    }
}

impl SpeakerInput {
    pub fn new(device_id: Option<String>) -> Result<Self> {
        let device_id = device_id.filter(|id| !id.is_empty() && id != "default");
        Ok(Self { device_id })
    }

    /// Spawn the WASAPI capture thread and wait for it to report its real
    /// sample rate. Returns Err if init fails or times out, so callers can
    /// surface the failure to JS instead of silently degrading to a fake
    /// stream that produces zero samples.
    pub fn stream(self) -> Result<SpeakerStream> {
        let rb = HeapRb::<f32>::new(RING_BUFFER_SAMPLES);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState { shutdown: false }));
        let data_ready = Arc::new((Mutex::new(false), Condvar::new()));
        let error_slot = Arc::new(Mutex::new(None));
        let (init_tx, init_rx) = mpsc::channel();

        let waker_clone = waker_state.clone();
        let data_ready_clone = data_ready.clone();
        let error_clone = error_slot.clone();
        let device_id = self.device_id;

        let capture_thread = thread::spawn(move || {
            let _com = ComScope::enter();
            if let Err(e) = Self::capture_audio_loop(
                producer,
                waker_clone,
                data_ready_clone,
                init_tx,
                device_id,
            ) {
                error!("Audio capture loop failed");
                if let Ok(mut slot) = error_clone.lock() {
                    *slot = Some(format!("{}", e));
                }
            }
        });

        let actual_sample_rate = match init_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                // Init failed. Tear down the thread we just spawned (it'll exit
                // on its own since capture_audio_loop already returned), then
                // bubble the error up to lib.rs which calls tsfn.call(Err(...)).
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!("WASAPI init failed: {}", e));
            }
            Err(_) => {
                if let Ok(mut state) = waker_state.lock() {
                    state.shutdown = true;
                }
                let _ = capture_thread.join();
                return Err(anyhow::anyhow!(
                    "WASAPI init timed out after 5s (no default render device, or device busy in exclusive mode)"
                ));
            }
        };

        Ok(SpeakerStream {
            consumer: Some(consumer),
            waker_state,
            capture_thread: Some(capture_thread),
            actual_sample_rate,
            data_ready,
            error: error_slot,
        })
    }

    fn capture_audio_loop(
        mut producer: HeapProd<f32>,
        waker_state: Arc<Mutex<WakerState>>,
        data_ready: Arc<(Mutex<bool>, Condvar)>,
        init_tx: mpsc::Sender<Result<u32>>,
        device_id: Option<String>,
    ) -> Result<()> {
        let init_result = (|| -> Result<_> {
            // Resolve target render device. If the saved device_id is stale
            // (unplugged, renamed, fresh install with leftover settings) we
            // must NOT panic — fall through to the default. If even that
            // errors, propagate via ? so init_tx surfaces the failure to JS
            // instead of letting the thread die silently and leaving callers
            // with a fake 44100Hz stream that never produces samples.
            let device = match device_id.as_deref() {
                Some(id) if !id.is_empty() => match find_device_by_id(&Direction::Render, id) {
                    Some(d) => d,
                    None => get_default_device(&Direction::Render)
                        .map_err(|e| anyhow::anyhow!("device '{}' not found and default lookup failed: {}", id, e))?,
                },
                _ => get_default_device(&Direction::Render)
                    .map_err(|e| anyhow::anyhow!("default render device unavailable: {}", e))?,
            };

            let mut audio_client = device
                .get_iaudioclient()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let device_format = audio_client
                .get_mixformat()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let actual_rate = device_format.get_samplespersec();
            let desired_format =
                WaveFormat::new(32, 32, &SampleType::Float, actual_rate as usize, 1, None);

            let (_def_time, min_time) = audio_client
                .get_periods()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            // For WASAPI loopback: device=Render, but initialize with Direction::Capture
            // This triggers AUDCLNT_STREAMFLAGS_LOOPBACK flag in wasapi
            audio_client
                .initialize_client(
                    &desired_format,
                    min_time,
                    &Direction::Capture,
                    &ShareMode::Shared,
                    true,
                )
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let h_event = audio_client
                .set_get_eventhandle()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            let capture_client = audio_client
                .get_audiocaptureclient()
                .map_err(|e| anyhow::anyhow!("{}", e))?;
            audio_client
                .start_stream()
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            Ok((h_event, capture_client, actual_rate, audio_client))
        })();

        match init_result {
            Ok((h_event, capture_client, sample_rate, audio_client)) => {
                let _ = init_tx.send(Ok(sample_rate));
                let mut packet = Vec::new();
                let mut samples: Vec<f32> = Vec::new();
                let mut clock = SilenceClock::new(sample_rate, Instant::now());
                loop {
                    let shutdown = waker_state.lock().map(|s| s.shutdown).unwrap_or(true);
                    if shutdown {
                        let _ = audio_client.stop_stream();
                        break;
                    }

                    // A timeout is normal: loopback signals no events while nothing
                    // renders. The short wait also bounds how long stop() waits here.
                    let signalled = h_event.wait_for_event(IDLE_WAIT_MS).is_ok();

                    // One event can cover several queued packets; drain them all so
                    // the capture buffer does not fall behind. A failed read means the
                    // stream is gone (AUDCLNT_E_DEVICE_INVALIDATED and the like): push
                    // what was read before it, then end the thread and let the DSP loop
                    // report it, rather than retrying or filling silence over a dead
                    // endpoint.
                    let (got_packets, failure) = drain_packets(
                        |out: &mut Vec<f32>| -> Result<bool> {
                            let frames = capture_client
                                .get_next_nbr_frames()
                                .map_err(|e| anyhow::anyhow!("WASAPI loopback stopped: {}", e))?
                                .unwrap_or(0) as usize;
                            if frames == 0 {
                                return Ok(false);
                            }
                            packet.resize(frames * BYTES_PER_FRAME, 0);
                            let (read, flags) = capture_client
                                .read_from_device(BYTES_PER_FRAME, &mut packet)
                                .map_err(|e| anyhow::anyhow!("WASAPI loopback stopped: {}", e))?;
                            append_f32_mono(&packet, read as usize, flags.silent, out);
                            Ok(true)
                        },
                        &mut samples,
                    );

                    let now = Instant::now();
                    if got_packets {
                        clock.on_packets(now);
                    } else if !signalled && failure.is_none() {
                        let zeros = clock.idle_fill(now);
                        samples.resize(samples.len() + zeros, 0.0);
                    }

                    if !samples.is_empty() {
                        let _ = producer.push_slice(&samples);
                        samples.clear();

                        // Signal data ready
                        let (lock, cvar) = &*data_ready;
                        if let Ok(mut ready) = lock.lock() {
                            *ready = true;
                            cvar.notify_all();
                        }
                    }

                    // Every sample read is pushed; returning drops the producer before
                    // the thread publishes the error (capture_tail.rs relies on this).
                    if let Some(read_error) = failure {
                        let _ = audio_client.stop_stream();
                        return Err(read_error);
                    }
                }
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
            }
        }
        Ok(())
    }
}

// Implement Drop to stop the thread
impl Drop for SpeakerStream {
    fn drop(&mut self) {
        if let Ok(mut state) = self.waker_state.lock() {
            state.shutdown = true;
        }
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }
}
