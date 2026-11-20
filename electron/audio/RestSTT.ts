/**
 * RestSTT - REST-based Speech-to-Text for Groq and OpenAI Whisper
 *
 * Implements the standard STT EventEmitter interface:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk: Buffer)
 *
 * Buffers raw PCM chunks, prepends a WAV header, and uploads via REST every ~3 seconds.
 * Supports Multipart FormData (Groq, OpenAI).
 */

import { EventEmitter } from 'events';
import { outboundAxios as axios } from '../services/outbound';
import FormData from 'form-data';
import { transcriptionLanguage } from '../config/languages';
import type { SttSeal } from './MeetingSttSession';
import { RestBatches, type RestBatch } from './restBatches';

export type RestSttProvider = 'groq' | 'openai';

interface RestSttProviderConfig {
    endpoint: string;
    model: string;
    authHeader: Record<string, string>;
    extraFormFields?: Record<string, string>;
    /** Extract transcript text from the API response */
    extractTranscript: (data: any) => string;
}

type ProviderConfigFactory = (apiKey: string, region?: string, languageKey?: string) => RestSttProviderConfig;

const PROVIDER_CONFIGS: Record<RestSttProvider, ProviderConfigFactory> = {
    groq: (apiKey, region, languageKey) => {
        const lang = transcriptionLanguage(languageKey);
        return {
            endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
            model: 'whisper-large-v3-turbo',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            extraFormFields: {
                temperature: '0',
                response_format: 'json',
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    openai: (apiKey, region, languageKey) => {
        const lang = transcriptionLanguage(languageKey);
        return {
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            extraFormFields: {
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
};

// Minimum buffer size before sending (avoid sending tiny fragments)
// 16kHz * 2 bytes/sample * 1 channel * 0.125 seconds = 4000 bytes
// Lowered from 16000 to allow short command utterances ("Yes", "Stop") to flush instantly.
const MIN_BUFFER_BYTES = 4000;

// Safety-net upload interval (ms). Primary flush is triggered by speech_ended events.
// This fires as a backstop if someone talks continuously for >10s without any pause,
// preventing unbounded buffer growth and Whisper API timeouts.
const SAFETY_NET_INTERVAL_MS = 10000;

// Silence threshold - if RMS is below this, skip the upload
const SILENCE_RMS_THRESHOLD = 50;

export class RestSTT extends EventEmitter {
    private provider: RestSttProvider;
    private apiKey: string;
    private region?: string;
    private config: RestSttProviderConfig;
    /** The saved model; every config rebuild (key or language change) keeps it. */
    private readonly modelOverride?: string;
    private languageKey?: string;

    private chunks: Buffer[] = [];
    private totalBufferedBytes = 0;
    private safetyNetTimer: NodeJS.Timeout | null = null;
    private isActive = false;
    private isUploading = false;
    private flushPending = false;  // Bug #2 fix: queue flush when upload in progress
    private readonly batches = new RestBatches('rest');
    private termPrompt = '';
    private uploadEpoch = 0;
    /** Resolves when the current upload has emitted its result (or failed); see finalize(). */
    private uploadSettled: Promise<void> = Promise.resolve();
    /** Uploads of the current epoch that failed; finalize() compares it to report a failed tail. */
    private failedUploads = 0;

    // Audio config (must match SystemAudioCapture output)
    private sampleRate = 16000;
    private numChannels = 1;
    private bitsPerSample = 16;

    constructor(provider: RestSttProvider, apiKey: string, modelOverride?: string, region?: string) {
        super();
        this.provider = provider;
        this.apiKey = apiKey;
        this.region = region;
        this.modelOverride = modelOverride?.trim() || undefined;
        this.config = this.buildConfig();
        console.log(`[RestSTT] Initialized for provider: ${provider}, model: ${this.config.model || '(default)'}`);
    }

    /**
     * Update API key (e.g., when user saves a new key)
     */
    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.config = this.buildConfig(this.languageKey);
        console.log(`[RestSTT] API key updated for ${this.provider}`);
    }

    /**
     * Update sample rate to match the audio source
     */
    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        console.log(`[RestSTT] Updating sample rate to ${rate}Hz`);
        this.sampleRate = rate;
    }

    /**
     * Update channel count
     */
    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        console.log(`[RestSTT] Updating channel count to ${count}`);
        this.numChannels = count;
    }

    /**
     * Update recognition language
     */
    public setRecognitionLanguage(key: string): void {
        console.log(`[RestSTT] Updating recognition language to: ${key}`);
        this.languageKey = key;
        this.config = this.buildConfig(key);
    }

    /** The model sent with each upload: the saved one, else the provider default. */
    public getModel(): string {
        return this.config.model;
    }

    private buildConfig(languageKey?: string): RestSttProviderConfig {
        const config = PROVIDER_CONFIGS[this.provider](this.apiKey, this.region, languageKey);
        if (this.modelOverride) config.model = this.modelOverride;
        return config;
    }

    /**
     * Technical terms sent as the Whisper `prompt` so they are spelled as written
     * instead of as similar-sounding everyday words. Empty sends no prompt.
     */
    public setTermPrompt(prompt: string): void {
        this.termPrompt = prompt.trim();
    }

    /**
     * No-op for RestSTT
     */
    public setCredentials(_keyFilePath: string): void {
        console.log(`[RestSTT] setCredentials called (no-op for REST provider)`);
    }

    /**
     * Start the upload timer
     */
    public start(): void {
        if (this.isActive) return;

        console.log(`[RestSTT] Starting (${this.provider})...`);
        this.isActive = true;
        this.uploadEpoch++;
        this.isUploading = false;
        this.flushPending = false;
        this.chunks = [];
        this.totalBufferedBytes = 0;

        // Safety-net timer: flush even during continuous speech to prevent
        // unbounded buffer growth and Whisper API file-size/timeout errors.
        // Primary flush is driven by Rust speech_ended events.
        this.safetyNetTimer = setInterval(() => {
            this.flushAndUpload();
        }, SAFETY_NET_INTERVAL_MS);
    }

    /**
     * Stop the upload timer and discard audio not yet sent
     */
    public stop(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Stopping (${this.provider})...`);
        this.isActive = false;
        this.uploadEpoch++;

        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = null;
        }

        this.chunks = [];
        this.totalBufferedBytes = 0;
        this.flushPending = false;
        this.batches.clear();
    }

    /**
     * Write raw PCM audio data to the internal buffer
     */
    public write(audioData: Buffer): void {
        if (!this.isActive || !audioData.length) return;
        try { this.chunks.push(this.batches.capture(audioData)); }
        catch (error) { this.emit('error', error); return; }
        this.totalBufferedBytes += audioData.length;
    }

    /**
     * Called when the native SilenceSuppressor detects speech has ended.
     * The internal Rust engine already applies a 150-200ms VAD hangover to avoid
     * word-breaks, so we flush immediately without adding redundant TS debouncing.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Speech ended detected by native VAD — flushing buffer immediately`);
        this.flushAndUpload();
    }

    /**
     * Flushes the tail and settles once every upload it depends on — one already in flight and the
     * tail queued behind it — has emitted its transcript or failed. A meeting drain awaits this
     * before stop(), which would otherwise discard the last sentence's late result. Rejects when any
     * of those uploads failed, so the drain reports this channel incomplete; transcripts already
     * emitted (earlier batches, other channels) are kept.
     */
    public async finalize(): Promise<void> {
        if (!this.isActive) return;
        console.log(`[RestSTT] Finalize — flushing buffer immediately`);
        const epoch = this.uploadEpoch;
        // An upload already in flight is one this drain waits for; one that failed earlier was reported live.
        const failedBefore = this.failedUploads;
        await this.flushAndUpload();
        // A chained re-entry starts its upload synchronously in the previous upload's finally,
        // so isUploading is already true again when this loop resumes.
        while (this.isActive && this.uploadEpoch === epoch && this.isUploading) await this.uploadSettled;
        if (this.uploadEpoch === epoch && this.failedUploads > failedBefore) {
            throw new Error('REST STT tail upload failed');
        }
    }

    /** Seals audio received so far into its own upload batch; recording continues. */
    public seal(cutoffAt: number): SttSeal | undefined {
        if (!this.isActive) return undefined;
        let seal: SttSeal;
        try { seal = this.batches.seal(this.chunks, cutoffAt); }
        catch (error) { this.emit('error', error); throw error; }
        this.totalBufferedBytes = this.chunks.reduce((bytes, chunk) => bytes + chunk.length, 0);
        void this.flushAndUpload();
        return seal;
    }

    /**
     * Concatenate buffered chunks, add WAV header, and upload to REST API
     */
    private async flushAndUpload(): Promise<void> {
        // Gate every flush on isActive. Without this, the
        // finally-re-entrancy at line ~334 (`if (this.flushPending) this.flushAndUpload()`)
        // can fire AFTER stop() has set isActive=false, and the body below
        // would happily upload trailing audio to the REST provider for the
        // rest of the process lifetime. The re-arm block below would also
        // resurrect a fresh setInterval if safetyNetTimer happened to be
        // non-null in some race window. Bailing here closes both holes.
        if (!this.isActive) return;

        // Skip if no data
        if (!this.batches.waiting && (this.chunks.length === 0 || this.totalBufferedBytes < MIN_BUFFER_BYTES)) return;

        // Bug #2 fix: if currently uploading, queue a flush for when it completes
        if (this.isUploading) {
            this.flushPending = true;
            return;
        }

        // Reset safety-net timer to prevent double-flush. The outer
        // `if (!this.isActive) return` above guarantees we never re-arm
        // after stop() — but keep the timer guard here too as belt-and-braces
        // in case a future caller invokes flushAndUpload from a path that
        // skips the isActive check.
        if (this.safetyNetTimer && this.isActive) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = setInterval(() => {
                this.flushAndUpload();
            }, SAFETY_NET_INTERVAL_MS);
        }

        // Sealed batches go first; otherwise grab current buffer and reset
        let batch: RestBatch | undefined = this.batches.next();
        if (batch && batch.bytes < MIN_BUFFER_BYTES) {
            // Too short to send alone: not empty, so its result stays unknown and the audio waits.
            this.chunks = [...batch.chunks, ...this.chunks];
            this.totalBufferedBytes += batch.bytes;
            this.batches.finish(batch, 'unknown', false);
            return this.flushAndUpload();
        }
        if (!batch) {
            batch = this.batches.create(this.chunks, this.totalBufferedBytes);
            this.chunks = [];
            this.totalBufferedBytes = 0;
        }

        // Concatenate all chunks
        const rawPcm = Buffer.concat(batch.chunks);

        // Check for silence (skip upload if audio is too quiet)
        if (this.isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`[RestSTT] Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            this.batches.finish(batch, 'no-pending');
            if (this.batches.waiting) return this.flushAndUpload();
            return;
        }

        // Resample to 16kHz mono before upload. At 48kHz stereo this produces a
        // 6x smaller WAV file, reducing upload latency and keeping file sizes well
        // under the Groq/OpenAI 25MB limit even for 10-second safety-net flushes.
        const TARGET_RATE = 16_000;
        const pcm16k = this.sampleRate === TARGET_RATE && this.numChannels === 1
            ? rawPcm
            : this.resampleTo16kHz(rawPcm);

        // Add WAV header — stamp with actual rate/channel after resampling (always 16kHz mono)
        const wavBuffer = this.addWavHeader(pcm16k, TARGET_RATE);

        this.isUploading = true;
        let settled!: () => void;
        this.uploadSettled = new Promise<void>(resolve => { settled = resolve; });
        const epoch = this.uploadEpoch;
        this.batches.start(batch);
        let outcome: 'complete' | 'failed' = 'complete';

        try {
            const transcript = await this.uploadAudio(wavBuffer);
            if (!this.isActive || this.uploadEpoch !== epoch) return;

            // Whisper sometimes returns its prompt verbatim for near-silent audio.
            if (transcript && transcript.trim().length > 0 && !this.echoesTermPrompt(transcript)) {
                console.log(`[RestSTT] Transcript received`, { length: transcript.trim().length });
                this.emit('transcript', {
                    text: transcript.trim(),
                    isFinal: true,
                    confidence: 1.0,
                    segmentId: batch.scope,
                    scope: batch.scope,
                });
            }
        } catch (err) {
            outcome = 'failed';
            if (!this.isActive || this.uploadEpoch !== epoch) return;
            this.failedUploads++;
            console.error(`[RestSTT] Upload error:`, err);
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } finally {
            settled();
            if (!this.isActive || this.uploadEpoch !== epoch) { this.batches.finish(batch, 'unknown'); return; }
            this.isUploading = false;
            this.batches.finish(batch, outcome);

            // Bug #2 fix: if a flush was requested while we were uploading, process it now
            if (this.flushPending || this.batches.waiting) {
                this.flushPending = false;
                this.flushAndUpload();
            }
        }
    }

    /**
     * Upload WAV audio to the REST endpoint via multipart FormData (Groq, OpenAI)
     */
    private async uploadAudio(wavBuffer: Buffer): Promise<string> {
        const form = new FormData();

        form.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        form.append('model', this.config.model);

        if (this.termPrompt) form.append('prompt', this.termPrompt);

        if (this.config.extraFormFields) {
            for (const [key, value] of Object.entries(this.config.extraFormFields)) {
                form.append(key, value);
            }
        }

        const response = await axios.post(this.config.endpoint, form, {
            headers: {
                ...this.config.authHeader,
                ...form.getHeaders(),
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    private echoesTermPrompt(transcript: string): boolean {
        if (!this.termPrompt) return false;
        const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}]+/gu, '');
        return normalize(transcript) === normalize(this.termPrompt);
    }

    /**
     * Resample Int16LE PCM from inputRate/numChannels → 16kHz mono.
     * Uses integer decimation (same approach as Rust DSP and OpenAIStreamingSTT).
     * Returns a new Buffer containing the resampled 16-bit mono PCM.
     */
    private resampleTo16kHz(raw: Buffer): Buffer {
        const TARGET_RATE = 16_000;

        // Build Int16Array from the raw buffer using safe byte-by-byte reads
        // to avoid alignment issues with unaligned ArrayBuffer slices.
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }

        // Already at target rate and mono — return as-is
        if (this.sampleRate === TARGET_RATE && this.numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix down multi-channel to mono
        let monoS16: Int16Array;
        if (this.numChannels > 1) {
            const monoLen = Math.floor(inputS16.length / this.numChannels);
            monoS16 = new Int16Array(monoLen);
            for (let i = 0; i < monoLen; i++) {
                let sum = 0;
                for (let c = 0; c < this.numChannels; c++) {
                    sum += inputS16[i * this.numChannels + c];
                }
                monoS16[i] = Math.round(sum / this.numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        // Decimate to target rate
        if (this.sampleRate === TARGET_RATE) {
            return Buffer.from(monoS16.buffer);
        }

        const factor = this.sampleRate / TARGET_RATE;
        const outLen = Math.floor(monoS16.length / factor);
        const outS16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
            outS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outS16.buffer);
    }

    /**
     * Check if audio buffer is essentially silence
     */
    private isSilent(pcmBuffer: Buffer): boolean {
        let sum = 0;
        const step = 20; // Sample every 20th sample for speed
        let count = 0;

        for (let i = 0; i < pcmBuffer.length - 1; i += 2 * step) {
            const sample = pcmBuffer.readInt16LE(i);
            sum += sample * sample;
            count++;
        }

        if (count === 0) return true;
        const rms = Math.sqrt(sum / count);
        return rms < SILENCE_RMS_THRESHOLD;
    }

    /**
     * Add a WAV RIFF header to raw PCM data.
     * channels defaults to 1 (mono) because callers always resample to mono first.
     * Critical: Most REST STT APIs require a valid WAV file, NOT raw PCM.
     */
    private addWavHeader(samples: Buffer, sampleRate: number = 16_000, channels: number = 1): Buffer {
        const buffer = Buffer.alloc(44 + samples.length);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (this.bitsPerSample / 8), 28); // ByteRate
        buffer.writeUInt16LE(channels * (this.bitsPerSample / 8), 32);              // BlockAlign
        buffer.writeUInt16LE(this.bitsPerSample, 34);
        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        // Copy raw PCM data
        samples.copy(buffer, 44);

        return buffer;
    }
}
