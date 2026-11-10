'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// AG-20's known application directories only; this is not a general filesystem sandbox.
function installStorageGuard(identity, sandboxHome, blockedError) {
  const names = ['Natively', 'natively', 'natively-local', 'Natively Local', 'ai assistant', 'Margin', 'margin', 'temp'];
  const roots = [];
  const homes = [os.userInfo().homedir, sandboxHome].flatMap((home) => [home, fs.realpathSync(home)]);
  for (const home of new Set(homes)) {
    const synthetic = home === sandboxHome || home === fs.realpathSync(sandboxHome);
    for (const name of names) {
      if (synthetic && name.toLowerCase() === identity.name.toLowerCase()) continue;
      roots.push(path.join(home, 'Library/Application Support', name), path.join(home, 'Library/Logs', name));
      // Electron's Windows appData/userData. Not AppData\Local: its Temp holds the
      // sandbox itself, and "temp" is one of the protected legacy names.
      if (process.platform === 'win32') roots.push(path.join(home, 'AppData', 'Roaming', name));
    }
    for (const id of ['io.github.xbz123.margin', 'io.github.xbz123.temp', 'local.natively.desktop', 'com.electron.meeting-notes']) {
      if (synthetic && id === identity.appId) continue;
      roots.push(path.join(home, 'Library/Preferences', `${id}.plist`));
    }
  }
  const originalLstat = fs.lstatSync;
  const originalReadlink = fs.readlinkSync;
  const protectedPath = (p) => roots.some((root) => p.toLowerCase() === root.toLowerCase() || p.toLowerCase().startsWith(root.toLowerCase() + path.sep));
  function check(value, descendants = false) {
    if (typeof value === 'number' || value == null) return; // descriptors were checked at open
    let file = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
    if (typeof file !== 'string') return;
    file = path.resolve(file);
    const denied = (p) => protectedPath(p) || (descendants && roots.some((root) => root.toLowerCase().startsWith((p.endsWith(path.sep) ? p : p + path.sep).toLowerCase())));
    // Check every symlink target before following it, so the check itself cannot
    // stat/read a protected directory. Missing tails are valid for creation APIs.
    if (denied(file)) throw blockedError('storage', file);
    let pending = file.slice(path.parse(file).root.length).split(path.sep);
    let current = path.parse(file).root;
    let links = 0;
    while (pending.length) {
      current = path.join(current, pending.shift());
      if (protectedPath(current)) throw blockedError('storage', file);
      try {
        if (originalLstat(current).isSymbolicLink()) {
          if (++links > 40) throw new Error('Too many filesystem symlinks');
          const target = path.resolve(path.dirname(current), originalReadlink(current));
          if (protectedPath(target) || denied(path.join(target, ...pending))) throw blockedError('storage', file);
          pending = [...target.slice(path.parse(target).root.length).split(path.sep), ...pending];
          current = path.parse(target).root;
        }
      } catch (e) {
        if (e.code === 'EMARGINISOLATION') throw e;
        if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e;
        if (denied(path.join(current, ...pending))) throw blockedError('storage', file);
        break;
      }
    }
  }
  const onePath = ['access', 'appendFile', 'chmod', 'chown', 'exists', 'glob', 'lchmod', 'lchown', 'lstat', 'lutimes', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readFile', 'readdir', 'readlink', 'realpath', 'rm', 'rmdir', 'stat', 'truncate', 'unlink', 'utimes', 'watch', 'watchFile', 'writeFile', 'createReadStream', 'createWriteStream'];
  const twoPaths = ['copyFile', 'cp', 'link', 'rename', 'symlink'];
  function wrap(target, name, count, promise = false) {
    if (typeof target[name] !== 'function') return;
    const original = target[name];
    const operation = name.replace(/Sync$/, '');
    function validate(args) {
      // Native enumerators follow buried symlinks without re-entering patched fs.
      // Tests use ordinary per-directory calls; native recursive enumeration and
      // glob are refused rather than scanning arbitrary trees before every call.
      if (operation === 'glob' || (['readdir', 'opendir', 'watch'].includes(operation) && args[count]?.recursive === true)) {
        throw blockedError('storage', `native enumeration ${operation} ${String(args[0])}`);
      }
      // Native cp can follow links buried inside an otherwise allowed source tree.
      if (operation === 'cp' && args[count]?.dereference === true) {
        throw blockedError('storage', `cp dereference:true ${String(args[0])}`);
      }
      // Native recursion/moves do not call the patched fs APIs for descendants.
      const descendants = ['cp', 'rm', 'rmdir', 'rename'].includes(operation);
      for (let i = 0; i < count; i++) {
        check(name.startsWith('symlink') && i === 0 && typeof args[i] === 'string'
          ? path.resolve(path.dirname(String(args[1])), args[i]) : args[i], descendants);
      }
    }
    if (promise && ['glob', 'watch'].includes(operation)) {
      target[name] = async function* (...args) { validate(args); yield* original.apply(this, args); };
      return;
    }
    const guarded = function (...args) {
      try { validate(args); }
      catch (e) { if (promise) return Promise.reject(e); throw e; }
      return original.apply(this, args);
    };
    if (original.native) guarded.native = function (...args) { check(args[0]); return original.native.apply(this, args); };
    target[name] = guarded;
  }
  for (const [namesToWrap, count] of [[onePath, 1], [twoPaths, 2]]) {
    for (const name of namesToWrap) {
      wrap(fs, name, count);
      wrap(fs, name + 'Sync', count);
      wrap(fs.promises, name, count, true);
    }
  }
}

module.exports = { installStorageGuard };
