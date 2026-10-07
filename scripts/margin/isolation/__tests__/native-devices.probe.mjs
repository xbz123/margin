// Diagnostic probe (not part of the test suite): does CoreAudio device enumeration
// through the native module return in this environment? Runs the call in a worker so
// a hang can be reported instead of blocking forever.
//   node scripts/margin/isolation/run-node.mjs scripts/margin/isolation/__tests__/native-devices.probe.mjs

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nativePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../native-module');
const worker = new Worker(
  `const n = require(${JSON.stringify(nativePath)}); const t = Date.now();
   const inputs = n.getInputDevices(); const outputs = n.getOutputDevices();
   require('node:worker_threads').parentPort.postMessage({ ms: Date.now() - t, inputs: inputs.length, outputs: outputs.length });`,
  { eval: true },
);
const timer = setTimeout(() => {
  console.log(JSON.stringify({ hung: true, afterMs: 15000, home: process.env.HOME }));
  process.exit(2);
}, 15000);
worker.on('message', (m) => { clearTimeout(timer); console.log(JSON.stringify({ hung: false, ...m, home: process.env.HOME })); process.exit(0); });
worker.on('error', (e) => { clearTimeout(timer); console.log(JSON.stringify({ error: e.message })); process.exit(1); });
