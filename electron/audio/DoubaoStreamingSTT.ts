import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DomesticStreamingSTT } from './DomesticStreamingSTT';

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

export class DoubaoStreamingSTT extends DomesticStreamingSTT {
  private sequence = 1;
  private request = '';
  private readonly finalUtterances = new Set<string>();
  constructor(private readonly key: string, private readonly options: DoubaoSttOptions = {}) { super(); }
  protected connection() {
    const resource = this.options.resourceId ?? 'volc.seedasr.sauc.duration';
    if (!this.key.trim() || !['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent'].includes(resource)) {
      throw Error('Doubao STT credentials are incomplete');
    }
    this.sequence = 1;
    this.request = randomUUID();
    this.finalUtterances.clear();
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
    const utterances = Array.isArray(result?.utterances) && result.utterances.length
      ? result.utterances : [{ text: result?.text, definite: response.final }];
    for (const utterance of utterances) {
      if (typeof utterance?.text !== 'string' || !utterance.text) continue;
      const identity = String(utterance.start_time ?? 'sentence');
      const signature = identity + ':' + utterance.text;
      const final = utterance.definite === true;
      if (final && this.finalUtterances.has(signature)) continue;
      this.emit('transcript', { text: utterance.text, isFinal: final, segmentId: this.request + ':' + identity });
      if (final) { this.finalUtterances.add(signature); this.emit('endpoint', { type: 'utterance_end' }); }
    }
    if (response.final) this.completed();
  }
}
