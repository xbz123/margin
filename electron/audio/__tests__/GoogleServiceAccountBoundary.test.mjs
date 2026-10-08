import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { Duplex } from 'node:stream';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const quiet = { log() {}, warn() {}, error() {} };
const read = file => fs.readFileSync(`${REPO}/${file}`, 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const account = { type: 'service_account', project_id: 'synthetic-project', client_email: 'synthetic@synthetic-project.iam.gserviceaccount.com', private_key: privateKey,
  private_key_id: 'synthetic', auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs', client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/synthetic%40synthetic-project.iam.gserviceaccount.com', universe_domain: 'googleapis.com' };

function subject(initial = account, SpeechClient) {
  const files = new Map([['/synthetic/account.json', JSON.stringify(initial)]]);
  const env = { GOOGLE_APPLICATION_CREDENTIALS: '/synthetic/account.json' };
  const constructed = [];
  const load = file => {
    const module = { exports: {} };
    vm.runInNewContext(compile(read(file)), { module, exports: module.exports, console: quiet, Buffer, URL, process: { env },
      setTimeout, clearTimeout, setInterval, clearInterval,
      require(id) {
        if (id === 'fs') return { readFileSync: path => { if (!files.has(path)) throw Error('synthetic unreadable'); return files.get(path); } };
        if (id === '../services/googleServiceAccount') return load('electron/services/googleServiceAccount.ts');
        if (id === './outbound' || id === '../services/outbound') return require('../../../dist-electron/electron/services/outbound.js');
        if (id === '@google-cloud/speech') return { SpeechClient: SpeechClient ?? class { constructor(options) { constructed.push(options); } } };
        if (id === '../config/languages') return { RECOGNITION_LANGUAGES: {} };
        return require(id);
      },
    });
    return module.exports;
  };
  return { Class: load('electron/audio/GoogleSTT.ts').GoogleSTT, helper: () => load('electron/services/googleServiceAccount.ts'), files, env, constructed };
}

function mainSubject(methods, loaded, extra = {}) {
  const source = read('electron/main.ts');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const selected = methods.map(name => klass.members.find(node => node.name?.getText(ast) === name).getText(ast));
  const module = { exports: {} };
  vm.runInNewContext(compile(`class Subject { ${selected.join('\n')} } exports.Subject = Subject;`), {
    exports: module.exports, console: quiet, process: { env: loaded.env }, GoogleSTT: loaded.Class, ...loaded.helper(), ...extra,
  });
  return new module.exports.Subject();
}

test('AppState validates before modifying environment or either running Google client', () => {
  const loaded = subject(), state = mainSubject(['updateGoogleCredentials'], loaded);
  state.googleSTT = new loaded.Class(); state.googleSTT_User = new loaded.Class();
  const old = [state.googleSTT.client, state.googleSTT_User.client];
  loaded.files.set('/synthetic/bad.json', JSON.stringify({ ...account, type: 'authorized_user' }));
  assert.throws(() => state.updateGoogleCredentials('/synthetic/bad.json'), /Invalid Google service account/);
  assert.equal(state.googleSTT.client, old[0]); assert.equal(state.googleSTT_User.client, old[1]);
  assert.equal(loaded.env.GOOGLE_APPLICATION_CREDENTIALS, '/synthetic/account.json');
  loaded.files.set('/synthetic/new.json', JSON.stringify(account));
  state.updateGoogleCredentials('/synthetic/new.json');
  assert.notEqual(state.googleSTT.client, old[0]); assert.notEqual(state.googleSTT_User.client, old[1]);
  assert.equal(loaded.env.GOOGLE_APPLICATION_CREDENTIALS, '/synthetic/new.json');
});

test('invalid stored/environment paths do not abort startup and Google factory emits a safe UI failure', () => {
  const loaded = subject({ ...account, type: 'external_account' });
  const manager = { getGoogleServiceAccountPath: () => loaded.env.GOOGLE_APPLICATION_CREDENTIALS, getSttProvider: () => 'google', getSttLanguage: () => 'english-us',
    setGoogleServiceAccountPath() { throw Error('invalid input must not be saved'); } };
  const state = mainSubject(['createSTTProvider'], loaded, { require: () => ({ CredentialsManager: { getInstance: () => manager } }) });
  const statuses = [], configs = [];
  state.sendSttStatus = payload => statuses.push(payload); state.broadcast = (channel, payload) => configs.push({ channel, payload });
  assert.equal(state.createSTTProvider('user'), null);
  assert.equal(statuses[0].state, 'failed');
  assert.match(statuses[0].error, /valid service_account JSON file in Settings/);
  assert.equal(configs[0].payload.configured, false);
  assert.equal(loaded.constructed.length, 0);
  const source = read('electron/main.ts'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const init = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'initializeApp');
  const statements = init.body.statements;
  const index = statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'storedServiceAccountPath'));
  let applied = 0, continued = false;
  const context = { console: quiet, process: { env: loaded.env }, CredentialsManager: { getInstance: () => manager }, ...loaded.helper(),
    appState: { updateGoogleCredentials() { applied++; } }, continueStartup() { continued = true; } };
  vm.runInNewContext(compile(`${statements[index].getText(ast)}\n${statements[index + 1].getText(ast)}\ncontinueStartup();`), context);
  assert.equal(applied, 0); assert.equal(continued, true);
  manager.getGoogleServiceAccountPath = () => undefined;
  vm.runInNewContext(compile(`${statements[index].getText(ast)}\n${statements[index + 1].getText(ast)}\ncontinueStartup();`), { ...context });
  assert.equal(applied, 0, 'invalid environment fallback is also nonfatal');
  loaded.files.set('/synthetic/fallback.json', JSON.stringify(account));
  loaded.env.GOOGLE_APPLICATION_CREDENTIALS = '/synthetic/fallback.json';
  manager.getGoogleServiceAccountPath = () => '/synthetic/account.json';
  assert.equal(state.createSTTProvider('user'), null, 'an invalid saved path does not fall through to a different valid environment account');
  assert.equal(loaded.constructed.length, 0);
});

test('unsupported Google credential types are rejected before constructing a client', () => {
  const { SpeechClient } = require('@google-cloud/speech');
  for (const type of ['authorized_user', 'external_account', 'external_account_authorized_user', 'impersonated_service_account', undefined]) {
    let constructors = 0;
    const loaded = subject({ ...account, type }, class extends SpeechClient { constructor(options) { constructors++; super(options); } });
    assert.throws(() => new loaded.Class(), /Invalid Google service account/);
    assert.equal(constructors, 0, 'unsupported JSON cannot reach installed SDK auth or metadata code');
  }
});

test('normal service-account metadata is accepted but only minimal public options reach SpeechClient', () => {
  const loaded = subject();
  new loaded.Class();
  const options = loaded.constructed[0];
  assert.deepEqual(Object.keys(options).sort(), ['credentials', 'projectId', 'universeDomain']);
  assert.deepEqual(Object.keys(options.credentials).sort(), ['client_email', 'private_key']);
  assert.equal(options.projectId, account.project_id);
  assert.equal(options.credentials.client_email, account.client_email);
  assert.equal(options.universeDomain, 'googleapis.com');
});

test('invalid replacements keep the old client and environment; actual construction reloads file contents', () => {
  const loaded = subject(), stt = new loaded.Class();
  const old = stt.client;
  loaded.files.set('/synthetic/new.json', JSON.stringify({ ...account, type: 'external_account' }));
  assert.throws(() => stt.setCredentials('/synthetic/new.json'), /Invalid Google service account/);
  assert.equal(stt.client, old);
  assert.equal(loaded.env.GOOGLE_APPLICATION_CREDENTIALS, '/synthetic/account.json');
  loaded.files.set('/synthetic/account.json', '{');
  assert.throws(() => new loaded.Class(), /Invalid Google service account/);
  assert.equal(loaded.constructed.length, 1);
});

test('service-account fields, alternative auth inputs and metadata URLs fail closed', () => {
  const loaded = subject(), { validateGoogleServiceAccount, loadGoogleServiceAccount } = loaded.helper();
  for (const invalid of [null, [], {}, { ...account, project_id: undefined }, { ...account, project_id: 'wrong/project' },
    { ...account, client_email: 'person@example.com' }, { ...account, private_key: 'not-a-key' },
    { ...account, token_uri: 'https://unconfigured.invalid/token' }, { ...account, auth_uri: 'http://accounts.google.com/o/oauth2/auth' },
    { ...account, client_x509_cert_url: 'https://unconfigured.invalid/cert' }, { ...account, universe_domain: 'bad/path' },
    ...['credential_source', 'source_credentials', 'subject', 'scopes', 'token_url', 'refresh_token', 'service_account_impersonation_url'].map(key => ({ ...account, [key]: 'synthetic' }))]) {
    assert.throws(() => validateGoogleServiceAccount(invalid), /Invalid Google service account/);
  }
  assert.throws(() => loadGoogleServiceAccount('/synthetic/unreadable.json'), /Invalid Google service account/);
  assert.doesNotThrow(() => validateGoogleServiceAccount({ ...account, client_id: '123456789' }));
  loaded.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = 'configured.example';
  new loaded.Class();
  assert.equal(loaded.constructed[0].universeDomain, 'configured.example');
  loaded.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = 'bad/path';
  assert.throws(() => new loaded.Class(), /Invalid Google universe domain/);
  assert.equal(loaded.constructed.length, 1);
});

test('legacy project IDs, Compute/AppEngine accounts and file universe remain supported', () => {
  for (const email of ['123456789-compute@developer.gserviceaccount.com', 'synthetic-project@appspot.gserviceaccount.com', account.client_email]) {
    const loaded = subject({ ...account, project_id: 'example.com:legacy-project', client_email: email,
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(email)}`,
      token_uri: 'https://accounts.google.com/o/oauth2/token', universe_domain: 'file.example' });
    new loaded.Class();
    assert.equal(loaded.constructed[0].credentials.client_email, email);
    assert.equal(loaded.constructed[0].projectId, 'example.com:legacy-project');
    assert.equal(loaded.constructed[0].universeDomain, 'file.example');
    loaded.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = 'env.example';
    new loaded.Class();
    assert.equal(loaded.constructed[1].universeDomain, 'env.example', 'explicit environment universe takes precedence');
  }
});

test('installed SpeechClient signs a valid local JWT without ADC, gcloud, metadata or auth HTTP', async () => {
  const { SpeechClient } = require('@google-cloud/speech');
  for (const universe of ['googleapis.com', 'configured.example']) {
    const loaded = subject(account, SpeechClient);
    loaded.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = universe;
    const stt = new loaded.Class(), auth = stt.client.auth;
    let discovery = 0, requests = 0;
    for (const name of ['getApplicationDefault', '_getApplicationCredentialsFromEnvironmentVariable', '_getApplicationCredentialsFromWellKnownFile', 'getDefaultServiceProjectId', 'getGCEProjectId', 'getUniverseDomainFromMetadataServer', '_checkIsGCE']) {
      auth[name] = async () => { discovery++; throw Error('unexpected synthetic discovery'); };
    }
    const jwt = await auth.getClient();
    assert.equal(stt.client.apiEndpoint, `speech.${universe}`);
    assert.equal(jwt.universeDomain, universe, 'auth and Speech endpoint universes agree');
    jwt.transporter.request = async () => { requests++; throw Error('unexpected synthetic auth HTTP'); };
    assert.equal(await auth.getProjectId(), account.project_id);
    const headers = await jwt.getRequestHeaders(`https://speech.${universe}/`);
    const bearer = headers.get('authorization');
    assert.equal(typeof bearer, 'string');
    const token = bearer.slice('Bearer '.length), parts = token.split('.');
    assert.equal(parts.length, 3);
    assert.equal(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), createPublicKey(privateKey), Buffer.from(parts[2], 'base64url')), true, 'synthetic JWT has a valid signature');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    assert.equal(claims.iss, account.client_email);
    assert.equal(discovery, 0);
    assert.equal(requests, 0, 'self-signed JWT does not exchange an OAuth token');
  }
});

test('an injected credential token URI pointing at a 307 server reaches neither hop', async () => {
  let requests = 0, targetRequests = 0;
  const target = http.createServer((req, res) => { targetRequests++; res.end('{}'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const redirect = http.createServer((req, res) => { requests++; res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/target` }); res.end(); });
  redirect.listen(0, '127.0.0.1'); await once(redirect, 'listening');
  try {
    const { SpeechClient } = require('@google-cloud/speech');
    let constructors = 0;
    const loaded = subject({ ...account, token_uri: `http://127.0.0.1:${redirect.address().port}/token` }, class extends SpeechClient {
      constructor(options) { constructors++; super(options); }
    });
    assert.throws(() => new loaded.Class(), /Invalid Google service account/);
    assert.equal(constructors, 0);
    assert.equal(requests, 0);
    assert.equal(targetRequests, 0);
  } finally {
    await Promise.all([new Promise(resolve => redirect.close(resolve)), new Promise(resolve => target.close(resolve))]);
  }
});

test('installed streaming helper sends synthetic audio when allowed, but not after connection-wait revocation', async () => {
  const { SpeechClient } = require('@google-cloud/speech');
  for (const revoke of [false, true]) {
    const frames = [], transports = [];
    class SyntheticSpeechClient extends SpeechClient {
      _streamingRecognize() {
        const transport = new Duplex({ objectMode: true, read() {}, write(frame, encoding, done) { frames.push(frame); done(); } });
        transports.push(transport);
        return transport;
      }
    }
    const loaded = subject(account, SyntheticSpeechClient), stt = new loaded.Class();
    stt.start();
    const stream = stt.stream;
    try {
      stt.isConnecting = true; stt.isStreaming = false;
      stt.write(Buffer.alloc(1024, 1));
      assert.equal(frames.length, 0, 'audio is queued while connection is pending');
      if (revoke) stt.stop(false);
      stt.isConnecting = false;
      stt.flushBuffer();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(frames.some(frame => Buffer.isBuffer(frame.audioContent)), !revoke);
    } finally {
      stt.stop(false);
      await new Promise(resolve => setImmediate(resolve));
      for (const transport of transports) transport.destroy();
    }
    assert.equal(stream.destroyed, true);
  }
});
