// Exports a sample Chinese meeting to PDF through the app's own export code (src/utils/pdfGenerator.ts,
// bundled with esbuild exactly as written, including the lazily imported export font). Only the
// browser download step (jsPDF's save) is replaced: it writes the PDF bytes to a file instead.
//
//   node scripts/margin/pdf-export/export-sample-meeting.mjs <out-dir>
//
// Writes <out-dir>/meeting-zh.pdf and <out-dir>/meeting-zh.expected.json (the body sentences and
// follow-up questions verify-meeting-pdf.py checks for in the rendered PDF).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { BASE64_QUERY, base64AssetModule } from '../base64-asset.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.resolve(process.argv[2] ?? '.');
fs.mkdirSync(outDir, { recursive: true });
const pdfFile = path.join(outDir, 'meeting-zh.pdf');

// --- The app's export code, bundled for node -------------------------------------------------
const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pdf-export-'));
const bundleFile = path.join(bundleDir, 'export.mjs');
await build({
  stdin: {
    contents: "export { generateMeetingPDF, buildMeetingPDF } from './src/utils/pdfGenerator.ts';\nexport { chinese } from './src/i18n.zh.ts';\n"
      // The jsPDF the export code uses, so its save step can be replaced.
      + "export { jsPDF } from 'jspdf';\n",
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: bundleFile, logLevel: 'warning',
  plugins: [{
    // "?base64" imports, loaded by the same function as the app's Vite plugin.
    name: 'margin-base64-asset',
    setup(b) {
      b.onResolve({ filter: /\?base64$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -BASE64_QUERY.length)), namespace: 'base64' }));
      b.onLoad({ filter: /.*/, namespace: 'base64' }, args => ({ contents: base64AssetModule(args.path), loader: 'js' }));
    },
  }],
});
const app = await import(pathToFileURL(bundleFile).href);

// --- Browser-only save step -> file ---------------------------------------------------------
let saved;
// jsPDF copies its API (save included) onto each document when it is created.
app.jsPDF.API.save = function save(name) {
  fs.writeFileSync(pdfFile, Buffer.from(this.output('arraybuffer')));
  saved = { name, pages: this.getNumberOfPages() };
  return this;
};

// --- The meeting ---------------------------------------------------------------------------
const topics = [
  '缓存层先读本地副本，未命中时再访问共享存储，并把结果写回本地',
  '消息队列按用户分区，保证同一用户的事件按顺序处理且不会重复消费',
  '数据库连接池的上限要结合实例数量计算，避免高峰期把主库连接占满',
  '灰度发布先覆盖百分之五的流量，观察错误率和延迟后再逐步扩大范围',
  '限流策略在网关层和服务层各做一次，网关挡住突发流量，服务层保护下游',
  '日志里只记录请求编号和耗时，不写入用户的原始输入或任何凭据',
  '跨机房复制采用异步方式，切换时以最后确认的位点为准并人工复核',
  '监控告警分为三级，只有影响用户的故障才在夜间电话通知值班同学',
];
const sentence = (n) => `第${String(n).padStart(3, '0')}句：${topics[n % topics.length]}，这一点在面试中需要结合实际项目说明清楚。`;
const assistSentences = Array.from({ length: 130 }, (_, i) => sentence(i + 1));
// Paragraphs of five sentences, as a model answer arrives.
const assistAnswer = Array.from({ length: assistSentences.length / 5 }, (_, p) => assistSentences.slice(p * 5, p * 5 + 5).join('')).join('\n');
const followupSentences = Array.from({ length: 12 }, (_, i) => `展开第${String(i + 1).padStart(2, '0')}点：${topics[(i + 3) % topics.length]}。`);
const followupAnswer = followupSentences.join('');
const questions = [
  '你们的缓存失效策略是怎样设计的？',
  '如果消息被重复投递，系统如何保证幂等？',
  '连接池的上限是根据什么指标确定的？',
  '灰度发布过程中发现错误率上升，你会如何回滚并定位原因？请结合一次真实的线上事故，具体说明当时的监控指标、决策过程以及事后的改进措施。',
  '网关限流和服务限流的阈值如何协同配置？',
  '跨机房切换时如何避免数据丢失？',
];
const start = Date.UTC(2026, 10, 20, 2, 0, 0);
const meeting = {
  id: 'sample-zh-meeting',
  title: '系统设计面试复盘',
  date: '2026-11-20',
  duration: '42:10',
  transcript: [
    { speaker: 'interviewer', text: '请介绍一下你最近负责的系统，以及你在其中做的关键设计决策。', timestamp: start + 60_000 },
    { speaker: 'user', text: '我负责订单服务的重构，重点是缓存、消息队列和灰度发布三个部分。', timestamp: start + 90_000 },
    // Common characters outside GB2312 (in the general-standard table) and a check mark.
    { speaker: 'interviewer', text: '不用啰嗦，直接说结论 ✓ 王喆和李堃负责的模块也讲一下。', timestamp: start + 100_000 },
  ],
  usage: [
    { type: 'assist', timestamp: start + 120_000, answer: assistAnswer },
    { type: 'followup', timestamp: start + 300_000, question: 'Follow-up', answer: followupAnswer },
    // As the engine records it and SQLite returns it: the streamed list as the answer text.
    { type: 'followup_questions', timestamp: start + 400_000, question: 'Generate Follow-up Questions', answer: questions.map((q, i) => `${i + 1}. ${q}`).join('\n') },
  ],
};

const t = key => app.chinese[key] ?? key;
await app.generateMeetingPDF(meeting, t);
if (!saved) throw new Error('generateMeetingPDF did not save a PDF');

const expected = {
  pdf: pdfFile,
  savedName: saved.name,
  pages: saved.pages,
  headings: [meeting.title, t('Transcript'), t('AI Usage & Interactions'), `${t('Assist')}:`, `${t('Expanded answer')}:`, `${t('Follow-Up Questions')}:`],
  speakerLabels: [t('Them'), t('Me')],
  transcript: meeting.transcript.map(row => row.text),
  assistSentences,
  followupSentences,
  questions,
};
fs.writeFileSync(path.join(outDir, 'meeting-zh.expected.json'), JSON.stringify(expected, null, 2));
fs.rmSync(bundleDir, { recursive: true, force: true });
console.log(JSON.stringify({ pdf: pdfFile, savedName: saved.name, pages: saved.pages, bytes: fs.statSync(pdfFile).size }));
