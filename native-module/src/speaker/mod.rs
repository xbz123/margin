// removed unused anyhow::Result

#[cfg(target_os = "macos")]
mod core_audio;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
mod sck;
#[cfg(target_os = "macos")]
pub use macos::list_output_devices;
#[cfg(target_os = "macos")]
pub use macos::SpeakerInput;
#[cfg(target_os = "macos")]
pub use macos::SpeakerStream;
#[cfg(target_os = "macos")]
pub use sck::default_output_device_uid;

// Built for tests on every host; only the WASAPI backend uses it outside tests.
#[cfg(any(target_os = "windows", test))]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod loopback;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use windows::list_output_devices;
#[cfg(target_os = "windows")]
pub use windows::SpeakerInput;
#[cfg(target_os = "windows")]
pub use windows::SpeakerStream;
#[cfg(target_os = "windows")]
pub use windows::default_output_device_uid;

/// The failure a platform capture thread published after it stopped and dropped its
/// ring producer (WASAPI loopback only); see capture_tail.rs. Other backends report
/// errors through their own paths.
#[cfg(target_os = "windows")]
pub fn take_producer_error(stream: &SpeakerStream) -> Option<String> {
    stream.take_error()
}
#[cfg(not(target_os = "windows"))]
pub fn take_producer_error(_stream: &SpeakerStream) -> Option<String> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub mod fallback {
    // Stub implementation for Linux (and any other unsupported platform).
    // The system-audio capture pipeline is macOS/Windows only — `new()` always
    // returns an error, so `stream()` / `pause()` etc. are never reached at
    // runtime. These stubs exist only so the rest of the crate (lib.rs) still
    // type-checks on Linux instead of failing with E0599 on `.stream()` calls.
    // See issue #219.
    use anyhow::Result;
    use ringbuf::HeapCons;
    pub struct SpeakerInput;
    pub struct SpeakerStream;
    impl SpeakerInput {
        pub fn new(_device_id: Option<String>) -> Result<Self> {
            Err(anyhow::anyhow!("Unsupported platform: system audio capture is implemented for macOS and Windows only"))
        }
        pub fn stream(self) -> Result<SpeakerStream> {
            Err(anyhow::anyhow!("Unsupported platform"))
        }
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
        pub fn pause(&mut self) -> Result<()> {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
        pub fn resume(&mut self) -> Result<()> {
            unreachable!("SpeakerInput::new() always errors on this platform")
        }
    }
    impl SpeakerStream {
        pub fn sample_rate(&self) -> u32 {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn take_consumer(&mut self) -> Option<HeapCons<f32>> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn pause(&mut self) {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
        pub fn resume(&mut self) -> Result<()> {
            unreachable!("SpeakerStream is never constructed on this platform")
        }
    }

    pub fn list_output_devices() -> Result<Vec<(String, String)>> {
        Ok(Vec::new())
    }

    pub fn default_output_device_uid() -> String {
        String::new()
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::list_output_devices;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerInput;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::SpeakerStream;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use fallback::default_output_device_uid;
