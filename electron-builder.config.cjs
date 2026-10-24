const { selectIdentity } = require('./scripts/margin/app-identity.cjs');
const identity = selectIdentity();

module.exports = {
  ...require('./package.json').build,
  appId: identity.appId,
  productName: identity.name,
  // AG-73: on Windows the NSIS uninstaller's --delete-app-data also removes
  // %APPDATA%\<package name>, and the installer caches itself under
  // %LOCALAPPDATA%\<package name>-updater. The repository name "natively" is the old
  // Natively directory there, so a Windows package carries the identity's own name.
  ...(process.platform === 'win32' ? { extraMetadata: { name: identity.name } } : {}),
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
