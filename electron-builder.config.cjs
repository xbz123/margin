const { selectIdentity } = require('./scripts/margin/app-identity.cjs');
const identity = selectIdentity();

module.exports = {
  ...require('./package.json').build,
  appId: identity.appId,
  productName: identity.name,
  mac: {
    ...require('./package.json').build.mac,
    extendInfo: {
      CFBundleName: identity.name,
      CFBundleDisplayName: identity.name,
      NSScreenCaptureUsageDescription: `${identity.name} needs Screen Recording permission to capture system audio for meeting transcription.`,
      NSMicrophoneUsageDescription: `${identity.name} needs microphone access to transcribe your voice during meetings.`,
      NSAudioCaptureUsageDescription: `${identity.name} needs system audio access to transcribe meeting audio.`,
    },
  },
};
