import { randomUUID } from 'node:crypto';
import { DomesticStreamingSTT } from './DomesticStreamingSTT';

export class AliyunStreamingSTT extends DomesticStreamingSTT {
  private task = '';
  private lastFinal = '';
  constructor(private readonly key: string, private readonly options: { workspaceId: string }) { super(); }
  protected connection() {
    const workspace = this.options.workspaceId;
    if (!this.key.trim() || typeof workspace !== 'string' || (workspace !== '' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(workspace))) {
      throw Error('Alibaba Cloud STT credentials are incomplete');
    }
    this.task = randomUUID();
    this.lastFinal = '';
    // Without a workspace the Beijing general endpoint; with one, its dedicated Beijing domain.
    return { url: workspace ? `wss://${workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`
      : 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      headers: { Authorization: `Bearer ${this.key}` } };
  }
  protected opened(): void {
    this.send(JSON.stringify({ header: { action: 'run-task', task_id: this.task, streaming: 'duplex' },
      payload: { task_group: 'audio', task: 'asr', function: 'recognition', model: 'qwen-audio-3.1-asr-flash-streaming',
        parameters: { format: 'pcm', sample_rate: 16000 }, input: {} } }));
  }
  protected audio(data: Buffer): void { this.send(data); }
  protected finish(): void {
    this.send(JSON.stringify({ header: { action: 'finish-task', task_id: this.task, streaming: 'duplex' }, payload: { input: {} } }));
  }
  protected received(data: Buffer): void {
    const message = JSON.parse(data.toString());
    const header = message?.header;
    if (header?.task_id && header.task_id !== this.task) return;
    if (header?.error_code || header?.event === 'task-failed') {
      this.failed(/401|403|auth|api.?key|forbidden|permission/i.test(String(header.error_code) + ' ' + String(header.error_message)));
      return;
    }
    if (header?.event === 'task-started') { this.healthy(); this.acceptAudio(); return; }
    if (header?.event !== 'result-generated' && header?.event !== 'task-finished') return;
    const sentence = message.payload?.output?.sentence;
    if (typeof sentence?.text === 'string' && sentence.text) {
      const final = sentence.sentence_end === true || header.event === 'task-finished';
      const identity = String(sentence.id ?? sentence.begin_time ?? 'sentence');
      const signature = identity + ':' + sentence.text;
      if (!final || signature !== this.lastFinal) {
        this.emit('transcript', { text: sentence.text, isFinal: final, segmentId: this.task + ':' + identity });
        if (final) { this.lastFinal = signature; this.emit('endpoint', { type: 'utterance_end' }); }
      }
    }
    if (header.event === 'task-finished') this.completed();
  }
}
