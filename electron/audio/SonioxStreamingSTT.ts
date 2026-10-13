/**
 * SonioxStreamingSTT - WebSocket-based streaming Speech-to-Text using Soniox
 *
 * Implements the same EventEmitter interface as STT providers:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 *
 * Connects to wss://stt-rt.soniox.com/transcribe-websocket
 * Sends raw PCM (linear16, 16-bit LE) over WebSocket.
 * Receives token-based transcription results with is_final flags.
 *
 * Key features:
 *   - 60+ language auto-detection
 *   - Language hints for multilingual accuracy
 *   - Endpoint detection for auto-finalization on speech pauses
 *   - Up to 8000-token structured context for domain-specific terms
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { streamingStttWsOptions } from './dnsHelpers';
import type { SttSeal } from './MeetingSttSession';

const SONIOX_WEBSOCKET_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
// Cap reconnect attempts so a flapping network can't drive an indefinite WS
// open-loop against Soniox (storm risk + per-key rate-limit risk). After the
// cap, emit 'error' so the orchestrator can surface a UI prompt; a
// user-triggered restart via stop()/start() resets the counter to 0.
const RECONNECT_MAX_ATTEMPTS = 10;
const KEEPALIVE_INTERVAL_MS = 5000;

export class SonioxStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;
    private configSent = false;

    private sampleRate = 16000;
    private numChannels = 1;

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    // 250ms debounced restart driven by setSampleRate / setRecognitionLanguage.
    // Previously these methods called `stop(); start();` synchronously, which
    // produced two WebSocket handshakes in flight whenever the methods fired
    // back-to-back (common pattern: device route change emits both new sample
    // rate AND new language in the same tick). The second WS handshake races
    // the first; one of them loses with code 1006 and triggers a reconnect
    // storm (250ms reconnect debounce).
    private pendingRestartTimer: NodeJS.Timeout | null = null;

    private buffer: Buffer[] = [];
    private isConnecting = false;

    // One utterance per connection epoch runs until <end> or <fin>; its final tokens accumulate
    // so a new utterance never merges into an old one.
    private epoch = 0;
    private utterance = 0;
    // Any token (final or not) belongs to the open utterance, so its ID is never reused after a marker.
    private heard = false;
    private finalText = '';
    private media: { startMs?: number; endMs?: number } = {};
    // finalize requests in send order; each <fin> answers the oldest one on the same connection.
    private fins: Array<{ settle?: (outcome: 'complete' | 'unknown') => void }> = [];

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    // =========================================================================
    // Configuration (match STT Provider interface)
    // =========================================================================

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[SonioxStreaming] Sample rate set to ${rate}`);

        if (this.isActive) {
            console.log('[SonioxStreaming] Sample rate changed while active. Scheduling debounced restart...');
            this.scheduleRestart();
        }
    }

    public setAudioChannelCount(count: number): void {
        this.numChannels = count;
        console.log(`[SonioxStreaming] Channel count set to ${count}`);
    }

    private languageCode?: string;

    /** Set recognition language hint using ISO-639-1 code */
    public setRecognitionLanguage(key: string): void {
        const config = RECOGNITION_LANGUAGES[key];
        if (config) {
            this.languageCode = config.iso639;
            console.log(`[SonioxStreaming] Language hint set to ${this.languageCode}`);

            if (this.isActive) {
                console.log('[SonioxStreaming] Language changed while active. Scheduling debounced restart...');
                this.scheduleRestart();
            }
        } else if (key === 'auto') {
            this.languageCode = undefined;
            console.log(`[SonioxStreaming] Language hint set to auto`);
        }
    }

    /**
     * Debounced restart: collapses rapid setSampleRate / setRecognitionLanguage
     * calls into a single stop()+start() sequence ~250ms later. Without this,
     * the previous sync stop()+start() pattern allowed two WebSocket
     * handshakes to be in flight simultaneously (device route changes can
     * emit both new sample rate AND new language in the same JS tick), and
     * one would lose with code 1006 → reconnect storm.
     *
     * Buffer preservation: chunks that arrive between the synchronous stop()
     * (which sets isActive=false and clears the buffer) and the start() are
     * silently dropped by write()'s `if (!this.isActive) return`. We capture
     * the live buffer BEFORE stop() and re-prepend it on start so trailing
     * audio survives the restart.
     */
    private scheduleRestart(): void {
        if (this.pendingRestartTimer) {
            clearTimeout(this.pendingRestartTimer);
        }
        this.pendingRestartTimer = setTimeout(() => {
            this.pendingRestartTimer = null;
            if (!this.isActive) return;  // a real stop() ran in the window — abort the restart
            const savedBuffer = [...this.buffer];
            this.stop();
            this.start();
            if (savedBuffer.length > 0) {
                this.buffer = [...savedBuffer, ...this.buffer];
            }
        }, 250);
    }

    /** No-op for Soniox */
    public setCredentials(_path: string): void { }

    /**
     * No-op for keywords — Soniox uses structured context instead.
     * Context is set via the initial config message.
     */
    public setKeywords(_keywords: string[]): void { }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public start(): void {
        if (this.isActive) return;
        // Cancel any leftover debounced restart from a prior session — it
        // would otherwise fire ~250ms into the new session and trigger a
        // gratuitous stop+start cycle. stop() also clears this via
        // clearTimers(), but the user can call start() without a prior
        // stop() in edge cases (recovery flow), so be defensive here too.
        if (this.pendingRestartTimer) {
            clearTimeout(this.pendingRestartTimer);
            this.pendingRestartTimer = null;
        }
        this.isActive = true;        // Set immediately so write() buffers audio during WS handshake
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(graceful = true): void {
        this.isActive = false;
        this.shouldReconnect = false;
        this.clearTimers();
        this.endEpoch();

        if (this.ws) {
            try {
                // Send empty string to signal end-of-audio
                if (graceful && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('');
                }
            } catch {
                // Ignore send errors during shutdown
            }
            this.ws.close();
            this.ws = null;
        }

        this.isConnecting = false;
        this.configSent = false;
        this.buffer = [];
        console.log('[SonioxStreaming] Stopped');
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.configSent) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[SonioxStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        this.ws.send(chunk);
    }

    public finalize(): void {
        if (!this.isActive || !this.ws || !this.configSent || this.fins.length >= 8) return;

        if (this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type: 'finalize' }));
                this.fins.push({});
                console.log('[SonioxStreaming] Sent manual finalize message');
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send finalize:', err);
            }
        }
    }

    /**
     * Non-terminating flush for a manual action: finalize covers the audio sent before it and the
     * connection continues. The receipt covers earlier audio, but cannot attribute arbitrary
     * result text to the click; the session accepts only already known utterance identities.
     */
    public seal(_cutoffAt: number): SttSeal | undefined {
        if (!this.isActive || !this.ws || !this.configSent || this.ws.readyState !== WebSocket.OPEN || this.buffer.length || this.fins.length) return undefined;
        let settle!: (outcome: 'complete' | 'unknown') => void;
        const done = new Promise<'complete' | 'unknown'>(resolve => { settle = resolve; });
        try {
            this.ws.send(JSON.stringify({ type: 'finalize' }));
        } catch {
            return undefined;
        }
        this.fins.push({ settle });
        return { scopes: [], pending: true, done };
    }

    private emitUtterance(text: string, isFinal: boolean): void {
        this.emit('transcript', {
            text, isFinal, confidence: 1.0, segmentId: `u${this.utterance}`, epoch: String(this.epoch),
            media: { basis: 'soniox-stream-audio', ...this.media },
        });
    }

    private closeUtterance(): void {
        if (this.finalText) this.emitUtterance(this.finalText, true);
        if (this.heard) this.utterance++;
        this.heard = false;
        this.finalText = '';
        this.media = {};
    }

    // A connection ends its utterance and its pending finalize requests, which stay unproven.
    private endEpoch(): void {
        this.closeUtterance();
        for (const fin of this.fins.splice(0)) fin.settle?.('unknown');
    }

    // =========================================================================
    // WebSocket Connection
    // =========================================================================

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;
        
        console.log(`[SonioxStreaming] Connecting (rate=${this.sampleRate}, ch=${this.numChannels})...`);

        this.configSent = false;
        this.endEpoch();
        const epoch = ++this.epoch;
        this.utterance = 0;
        // streamingStttWsOptions: forces IPv4-only DNS lookup (sidesteps Node's
        // macOS dual-stack ENOTFOUND on IPv4-only CNAME chains) and caps the
        // TLS+upgrade handshake at 15s. See dnsHelpers.ts.
        const socket = new WebSocket(SONIOX_WEBSOCKET_URL, streamingStttWsOptions() as any);
        this.ws = socket;

        this.ws.on('open', () => {
            if (this.ws !== socket || this.epoch !== epoch) return;
            // Guard: stop() may have been called while the WS handshake was in flight.
            // shouldReconnect is set to false by stop() before ws is nulled, so it's a
            // reliable signal that we should abort here without crashing.
            if (!this.shouldReconnect || !this.isActive) {
                this.ws?.close();
                this.ws = null;
                this.isConnecting = false;
                return;
            }

            this.reconnectAttempts = 0;
            console.log('[SonioxStreaming] Connected, sending config...');

            // Send initial configuration as first message
            const config: any = {
                api_key: this.apiKey,
                model: 'stt-rt-v4',
                audio_format: 'pcm_s16le',
                sample_rate: this.sampleRate,
                num_channels: this.numChannels,
                enable_language_identification: true,
                enable_endpoint_detection: true,
            };

            if (this.languageCode) {
                config.language_hints = [this.languageCode];
            }

            try {
                // Use ?. (not !) — stop() could theoretically null this.ws between the
                // guard above and this send, though the event loop makes it unlikely.
                this.ws?.send(JSON.stringify(config));
                this.configSent = true;
                this.isConnecting = false;
                console.log('[SonioxStreaming] Config sent');

                // Flush buffer after config is sent
                while (this.buffer.length > 0) {
                    const chunk = this.buffer.shift();
                    if (chunk && this.ws?.readyState === WebSocket.OPEN) {
                        this.ws.send(chunk);
                    }
                }
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send config:', err);
                this.isConnecting = false;
            }

            // Start keep-alive pings
            this.startKeepAlive();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            if (this.ws !== socket || this.epoch !== epoch) return;
            try {
                const msg = JSON.parse(data.toString());

                // Error from server
                if (msg.error_code) {
                    console.error(`[SonioxStreaming] Server error: ${msg.error_code} - ${msg.error_message}`);
                    this.emit('error', new Error(`Soniox: ${msg.error_code} - ${msg.error_message}`));
                    return;
                }

                // Parse tokens from response
                const tokens = msg.tokens;
                let nonFinalText = '';
                let changed = false;

                for (const token of Array.isArray(tokens) ? tokens : []) {
                    if (!token.text) continue;

                    if (token.text === '<fin>' || token.text === '<end>') {
                        // Both markers end the utterance; <fin> also answers the oldest finalize.
                        this.closeUtterance();
                        nonFinalText = '';
                        changed = false;
                        if (token.text === '<fin>') this.fins.shift()?.settle?.('complete');
                        continue;
                    }

                    this.heard = true;
                    if (Number.isFinite(token.start_ms)) this.media.startMs ??= token.start_ms;
                    if (Number.isFinite(token.end_ms)) this.media.endMs = token.end_ms;
                    if (token.is_final) {
                        this.finalText += token.text;
                        changed = true;
                    } else {
                        nonFinalText += token.text;
                    }
                }

                // The open utterance as heard so far (live preview); its final arrives with its marker.
                if (changed || nonFinalText) this.emitUtterance(this.finalText + nonFinalText, false);

                // Session finished
                if (msg.finished) {
                    console.log('[SonioxStreaming] Session finished');
                    this.endEpoch();
                    // We don't stop entirely, just clear WS so it can lazily reconnect on next audio
                    if (this.ws) {
                        this.ws.close();
                        this.ws = null;
                        this.configSent = false;
                    }
                }
            } catch (err) {
                console.error('[SonioxStreaming] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            if (this.ws !== socket || this.epoch !== epoch) return;
            console.error('[SonioxStreaming] WebSocket error:', err.message);
            this.emit('error', err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            if (this.ws !== socket || this.epoch !== epoch) return;
            if (this.ws === socket) this.endEpoch();
            // Null out the ws reference immediately to prevent stale reuse
            this.ws = null;
            this.isConnecting = false;
            this.configSent = false;
            this.clearKeepAlive();
            console.log(`[SonioxStreaming] Closed (code=${code}, reason=${reason.toString()})`);

            // Auto-reconnect on unexpected close
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            } else {
                // If not reconnecting, mark session as truly inactive
                this.isActive = false;
            }
        });
    }

    // =========================================================================
    // Reconnection
    // =========================================================================

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[SonioxStreaming] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached — giving up`);
            // Latch off the reconnect path so write()'s lazy-connect (line 159)
            // cannot resurrect the storm on the next audio chunk. start() resets
            // shouldReconnect=true so a user-triggered restart still works.
            this.shouldReconnect = false;
            this.emit('error', new Error('SonioxStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[SonioxStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    // =========================================================================
    // Keep-alive
    // =========================================================================

    private startKeepAlive(): void {
        this.clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    this.ws.ping();
                } catch {
                    // Ignore errors
                }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // pendingRestartTimer must also be cleared here so a Stop / fatal
        // error / clearTimers-triggering path cannot leave a queued restart
        // that fires into the next session and triggers a wasteful
        // stop()+start() cycle.
        if (this.pendingRestartTimer) {
            clearTimeout(this.pendingRestartTimer);
            this.pendingRestartTimer = null;
        }
    }
}
