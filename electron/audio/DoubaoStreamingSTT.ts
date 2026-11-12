import { gzipSync, gunzipSync } from 'node:zlib';
import { DomesticStreamingSTT } from './DomesticStreamingSTT';
import { comparableText as comparable } from './MeetingSttSession';

export interface DoubaoSttOptions { appId?: string; resourceId?: string }

export function encodeDoubaoFrame(type: number, sequence: number, payload: Buffer): Buffer {
  const zipped = gzipSync(payload);
  const prefix = Buffer.alloc(12);
  prefix.set([0x11, (type << 4) | (sequence < 0 ? 3 : 1), type === 1 ? 0x11 : 0x01, 0]);
  prefix.writeInt32BE(sequence, 4);
  prefix.writeUInt32BE(zipped.length, 8);
  return Buffer.concat([prefix, zipped]);
}

export function decodeDoubaoResponse(bytes: Buffer) {
  const invalid = () => { throw Error('Invalid Doubao response frame'); };
  if (bytes.length < 8 || bytes[0] >> 4 !== 1 || (bytes[0] & 15) === 0) return invalid();
  const type = bytes[1] >> 4, flags = bytes[1] & 15;
  let offset = (bytes[0] & 15) * 4;
  const word = () => {
    if (offset + 4 > bytes.length) return invalid();
    const value = bytes.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  if (flags & 1) word();
  if (flags & 4) word();
  if (type !== 9 && type !== 15) return invalid();
  const code = type === 15 ? word() : 0;
  const size = word();
  if (size !== bytes.length - offset || ![0, 1].includes(bytes[2] & 15)) return invalid();
  let payload = bytes.subarray(offset);
  if ((bytes[2] & 15) === 1) payload = gunzipSync(payload, { maxOutputLength: 1024 * 1024 });
  if (bytes[2] >> 4 !== 1) return invalid();
  const body = JSON.parse(payload.toString());
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  return { code, final: !!(flags & 2), body };
}

/** A definite whose start_time is at most this much before the open sentence's interims is that sentence. */
const SAME_SENTENCE_START_MS = 1000;

export class DoubaoStreamingSTT extends DomesticStreamingSTT {
  private sequence = 1;
  private request = '';
  // Sentences of this request in order: the open one takes interim text, a definite closes it.
  private sentence = 0;
  // The open sentence: the earliest start_time its interims reported, and its latest interim text.
  private openStart: number | undefined;
  private openText: string | undefined;
  // Definite utterances already emitted, by start_time (else text), so a repeated one is not a new sentence.
  private readonly finals = new Map<string, { id: string; text: string }>();
  constructor(private readonly key: string, private readonly options: DoubaoSttOptions = {}) { super(); }
  protected connection(id: string) {
    const resource = this.options.resourceId === undefined ? 'volc.seedasr.sauc.duration' : this.options.resourceId;
    if (!this.key.trim() || !['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent'].includes(resource)) {
      throw Error('Doubao STT credentials are incomplete');
    }
    this.sequence = 1;
    this.request = id;
    this.sentence = 0;
    this.openStart = this.openText = undefined;
    this.finals.clear();
    const headers: Record<string, string> = { 'X-Api-Resource-Id': resource, 'X-Api-Request-Id': this.request,
      'X-Api-Connect-Id': this.request };
    if (this.options.appId) {
      headers['X-Api-App-Key'] = this.options.appId;
      headers['X-Api-Access-Key'] = this.key;
    } else headers['X-Api-Key'] = this.key;
    return { url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', headers };
  }
  protected opened(): void {
    const request = { user: { uid: 'margin' },
      audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
      request: { model_name: 'bigmodel', show_utterances: true, result_type: 'single', enable_itn: true, enable_punc: true } };
    this.send(encodeDoubaoFrame(1, this.sequence++, Buffer.from(JSON.stringify(request))));
    // This protocol waits for audio before replying; only Aliyun requires an ACK first.
    this.acceptAudio();
  }
  protected audio(data: Buffer): void { this.send(encodeDoubaoFrame(2, this.sequence++, data)); }
  protected finish(): void { this.send(encodeDoubaoFrame(2, -this.sequence++, Buffer.alloc(0))); }
  protected received(data: Buffer): void {
    const response = decodeDoubaoResponse(data);
    if (response.code) {
      if (response.code === 45000001) this.failed(true, 'configuration');
      else if (response.code === 45000002) this.failed(false, 'empty-audio');
      else this.failed(false);
      return;
    }
    this.healthy();
    const result = response.body.result;
    if (Array.isArray(result?.utterances) && result.utterances.length) {
      for (const utterance of result.utterances) this.utterance(utterance);
    } else if (typeof result?.text === 'string' && result.text) this.fallback(result.text, response.final);
    if (response.final) this.completed();
  }
  private transcript(id: string, text: string, final: boolean, startMs?: number, endMs?: number): void {
    // start_time/end_time are milliseconds of this request's audio.
    const media = { basis: 'doubao-request-audio', ...(startMs !== undefined ? { startMs } : {}), ...(endMs !== undefined ? { endMs } : {}) };
    this.emit('transcript', { text, isFinal: final, segmentId: id, epoch: this.request, scope: this.request, media, identityReliable: true });
  }
  private closeSentence(key: string, id: string, text: string): void {
    this.finals.set(key, { id, text });
    this.emit('endpoint', { type: 'utterance_end' });
  }
  /**
   * The sentence index is the identity, not start_time: the first response of a request reports a
   * start time later ones do not, and the next sentence is appended to the open one until its
   * predecessor's definite result arrives together with the newcomer's first interim. A definite
   * is known by its start_time (else its text): a repeat is skipped, a changed text corrects its
   * own sentence, and one that starts more than SAME_SENTENCE_START_MS before the open sentence keeps
   * an identity of its own unless its text repeats a definite already emitted in this request or is
   * the open sentence's own text.
   */
  private utterance(utterance: { text?: unknown; start_time?: unknown; end_time?: unknown; definite?: unknown } | null): void {
    if (typeof utterance?.text !== 'string' || !utterance.text) return;
    const text = utterance.text;
    const startMs = Number.isFinite(utterance.start_time) ? utterance.start_time as number : undefined;
    const endMs = Number.isFinite(utterance.end_time) ? utterance.end_time as number : undefined;
    if (utterance.definite !== true) {
      if (startMs !== undefined) this.openStart = Math.min(this.openStart ?? startMs, startMs);
      this.openText = text;
      this.transcript(String(this.sentence), text, false, startMs, endMs);
      return;
    }
    const key = startMs !== undefined ? 'start:' + startMs : 'text:' + comparable(text);
    const known = this.finals.get(key);
    if (known) {
      if (known.text !== text) { known.text = text; this.transcript(known.id, text, true, startMs, endMs); }
      return;
    }
    // A definite starting well before the open sentence is an earlier one; a few hundred ms earlier
    // is the open sentence itself (its interims reported a slightly later start).
    if (startMs !== undefined && this.openStart !== undefined && this.openStart - startMs > SAME_SENTENCE_START_MS) {
      // A definite already emitted, re-sent with a start time that moved, is a repeat.
      const value = comparable(text);
      if ([...this.finals.values()].some(item => comparable(item.text) === value)) return;
      // Text that is the open sentence (equal, extending it, or the part of it Doubao split off) is
      // that sentence, whatever start time its interims reported: close it in order.
      const open = this.openText === undefined ? '' : comparable(this.openText);
      if (open && value && (open.startsWith(value) || value.startsWith(open))) return this.close(key, text, startMs, endMs);
      const id = 'at' + startMs;
      this.transcript(id, text, true, startMs, endMs);
      this.closeSentence(key, id, text);
      return;
    }
    this.close(key, text, startMs, endMs);
  }
  // The definite of the open sentence: emitted under the current index, which then advances.
  private close(key: string, text: string, startMs?: number, endMs?: number): void {
    const id = String(this.sentence++);
    this.openStart = this.openText = undefined;
    this.transcript(id, text, true, startMs, endMs);
    this.closeSentence(key, id, text);
  }
  /**
   * A response without utterances carries only the request text. One that repeats a definite
   * already emitted (or the run of the latest ones) is skipped. A definite one closes the open
   * sentence only when it is that sentence's text or extends it, so it never overwrites newer
   * words with an older sentence; with no sentence open it starts a new one. A definite one first
   * drops the text of the definites already emitted (the whole request text of a last result).
   */
  private fallback(text: string, final: boolean): void {
    let value = comparable(text);
    if (value === '') return;
    const emitted = [...this.finals.values()].map(item => comparable(item.text));
    let run = '';
    for (let index = emitted.length - 1; index >= 0; index--) {
      run = emitted[index] + run;
      if (emitted[index] === value || run === value) return;
    }
    if (!final) {
      this.openText = text;
      this.transcript(String(this.sentence), text, false);
      return;
    }
    const before = emitted.join('');
    if (before && value.startsWith(before)) {
      value = value.slice(before.length);
      // The longest tail of the original text that compares equal to the rest (a numeral run stays
      // whole), without the punctuation that ended the sentences before it.
      for (let start = 0; start < text.length; start++) {
        if (comparable(text.slice(start)) === value) { text = text.slice(start).replace(/^[\p{P}\p{S}\p{Z}\s]+/u, ''); break; }
      }
    }
    if (this.openText !== undefined && !value.startsWith(comparable(this.openText))) return;
    this.close('text:' + value, text);
  }
}
