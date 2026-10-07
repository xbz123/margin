#!/usr/bin/env node
// Launches Electron under the isolation guard, observes it for a fixed time, stops it
// with SIGTERM (SIGKILL after a grace period) and prints a JSON summary.
//
//   node scripts/margin/isolation/run-electron.mjs [--observe 20] [--ready <regex>]
//        [--electron <binary>] [--app <dir or script>] [--keep] [--allow-blocked]
//        [-- extra electron args]
//
// Defaults: the repository root as the app, the installed Electron binary, 20 s.
// Exit 0 only if the process started, stayed up until stopped (or exited 0 by itself),
// the ready pattern (if given) appeared, and nothing was blocked.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox, isolatedEnv, readBlocked, CHROMIUM_SWITCHES, REPO, snapshotRealPaths, changedRealPaths } from './env.mjs';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const own = dash >= 0 ? argv.slice(0, dash) : argv;
const extra = dash >= 0 ? argv.slice(dash + 1) : [];
const val = (n, d) => { const i = own.indexOf(n); return i >= 0 ? own[i + 1] : d; };

const observeMs = Number(val('--observe', 20)) * 1000;
const ready = val('--ready') ? new RegExp(val('--ready')) : null;
// The real binary, not node_modules/.bin/electron: that wrapper is a Node script that
// spawns the binary, which the guard (inherited through NODE_OPTIONS) would block.
const defaultElectron = () => path.join(REPO, 'node_modules/electron/dist',
  fs.readFileSync(path.join(REPO, 'node_modules/electron/path.txt'), 'utf8').trim());
const electronBin = val('--electron') ? path.resolve(REPO, val('--electron')) : defaultElectron();
const app = path.resolve(REPO, val('--app', '.'));

const sandbox = makeSandbox('electron');
const out = fs.openSync(path.join(sandbox.root, 'stdout.log'), 'w');
const err = fs.openSync(path.join(sandbox.root, 'stderr.log'), 'w');
const args = [app, ...CHROMIUM_SWITCHES, ...extra];
const realBefore = snapshotRealPaths();
const started = Date.now();
const child = spawn(electronBin, args, {
  cwd: sandbox.work,
  env: isolatedEnv(sandbox, { NODE_ENV: process.env.MARGIN_SMOKE_NODE_ENV || 'production' }),
  stdio: ['ignore', out, err],
});

let readyAt = null;
const poll = setInterval(() => {
  if (!ready || readyAt) return;
  const text = fs.readFileSync(path.join(sandbox.root, 'stdout.log'), 'utf8')
    + fs.readFileSync(path.join(sandbox.root, 'stderr.log'), 'utf8');
  if (ready.test(text)) readyAt = Date.now() - started;
}, 250);

let stoppedByUs = false;
const timer = setTimeout(() => {
  stoppedByUs = true;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
}, observeMs);

child.on('exit', (code, signal) => {
  clearInterval(poll);
  clearTimeout(timer);
  const stderr = fs.readFileSync(path.join(sandbox.root, 'stderr.log'), 'utf8');
  const stdout = fs.readFileSync(path.join(sandbox.root, 'stdout.log'), 'utf8');
  if (ready && !readyAt && ready.test(stdout + stderr)) readyAt = Date.now() - started;
  const blocked = readBlocked(sandbox);
  const uncaught = (stdout + stderr).split('\n')
    .filter((l) => /Uncaught|UnhandledPromiseRejection|unhandledRejection|uncaughtException|A JavaScript error occurred/i.test(l));
  const realChanged = changedRealPaths(realBefore, snapshotRealPaths());
  const summary = {
    app, electron: electronBin, sandbox: sandbox.root, realPathsChanged: realChanged,
    observedMs: Date.now() - started, stoppedByUs, exitCode: code, signal,
    readyPattern: ready ? ready.source : null, readyAtMs: readyAt,
    blocked: blocked.length, blockedKinds: [...new Set(blocked.map((b) => `${b.kind} ${b.detail}`))].slice(0, 50),
    uncaughtLines: uncaught.slice(0, 20),
  };
  console.log(JSON.stringify(summary, null, 2));
  const exitedCleanly = stoppedByUs ? signal === 'SIGTERM' || code === 0 : code === 0;
  const blockedOk = own.includes('--allow-blocked') || blocked.length === 0;
  const ok = exitedCleanly && (!ready || readyAt !== null) && blockedOk && uncaught.length === 0 && realChanged.length === 0;
  if (!own.includes('--keep') && ok) fs.rmSync(sandbox.root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});
