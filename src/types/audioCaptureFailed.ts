// Payload of the 'audio-capture-failed' event (electron/main.ts sendAudioCaptureFailed).
// A capture failure during a meeting names its channel ('system' or 'mic'); the notice sent
// when a meeting ends with part of its transcript tail missing has channel 'audio' and
// kind 'transcript-tail-incomplete'.
export type AudioCaptureFailedPayload = {
  channel: 'system' | 'mic' | 'audio';
  message: string;
  attempt?: number;
  maxAttempts?: number;
  terminal?: boolean;
  stuck?: boolean;
  kind?: 'transcript-tail-incomplete';
  /** STT lanes whose tail was not completed (transcript-tail-incomplete only). */
  failedChannels?: ('user' | 'interviewer')[];
  /** The drain ran out of its time budget (transcript-tail-incomplete only). */
  timedOut?: boolean;
};
