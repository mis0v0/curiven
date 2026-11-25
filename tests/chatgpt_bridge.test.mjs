// Run: node --test tests/chatgpt_bridge.test.mjs
// Unit tests for CURIVEN's ChatGPT bridge and Keychain encryption adapter. They use an in-memory
// stand-in for /usr/bin/security and synthetic credentials: they never touch the real Keychain,
// never sign in, and are NOT evidence that the real ChatGPT integration works.
import './netguard.js';   // loopback only: the SDK code here can never reach OpenAI
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { keychainEncryption, SERVICE } from '../chatgpt/keychain.mjs';
import { createHandler, safeError, serve } from '../chatgpt/bridge.mjs';

function fakeKeychain() {
  const items = new Map(), calls = [];
  const run = async (args, stdin) => {
    calls.push({ args: [...args], stdin });
    if (args[0] === 'find-generic-password') {
      const k = args[2];
      return items.has(k) ? { code: 0, stdout: items.get(k) + '\n' } : { code: 44, stdout: '' };
    }
    if (args[0] === '-i') {
      const m = /^add-generic-password -s (\S+) -a (\S+) -w ([0-9a-f]+)\n$/.exec(stdin);
      if (!m) return { code: 1, stdout: '' };
      items.set(m[1], m[3]); return { code: 0, stdout: '' };
    }
    return { code: 1, stdout: '' };
  };
  return { run, items, calls };
}

test('keychain adapter: key created lazily on first encrypt, never via argv, round-trips', async () => {
  const kc = fakeKeychain();
  const enc = keychainEncryption({ run: kc.run, platform: 'darwin' });
  assert.equal(await enc.isAvailable(), true);
  assert.equal(kc.items.size, 0, 'checking availability does not create a key');
  const sealed = await enc.encrypt('{"accessToken":"tok-SECRET"}');
  assert.equal(kc.items.size, 1);
  assert.ok(kc.items.has(SERVICE));
  const key = kc.items.get(SERVICE);
  assert.match(key, /^[0-9a-f]{64}$/, '256-bit random key');
  for (const c of kc.calls) assert.ok(!c.args.join(' ').includes(key), 'key never appears in process arguments');
  assert.ok(!Buffer.from(sealed).toString('latin1').includes('tok-SECRET'));
  assert.equal(await enc.decrypt(sealed), '{"accessToken":"tok-SECRET"}');
  const fresh = keychainEncryption({ run: kc.run, platform: 'darwin' });  // new process, same Keychain item
  assert.equal(await fresh.decrypt(sealed), '{"accessToken":"tok-SECRET"}');
});

test('keychain adapter: tampering, wrong key and non-macOS are rejected', async () => {
  const kc = fakeKeychain();
  const enc = keychainEncryption({ run: kc.run, platform: 'darwin' });
  const sealed = Buffer.from(await enc.encrypt('hello'));
  const flipped = Buffer.from(sealed); flipped[flipped.length - 1] ^= 1;
  await assert.rejects(enc.decrypt(flipped));
  const other = keychainEncryption({ run: fakeKeychain().run, platform: 'darwin' });
  await assert.rejects(other.decrypt(sealed), 'no key in another Keychain → cannot decrypt (and does not create one)');
  assert.equal(await keychainEncryption({ run: kc.run, platform: 'linux' }).isAvailable(), false);
  const locked = keychainEncryption({ run: async () => ({ code: 51, stdout: '' }), platform: 'darwin' });
  assert.equal(await locked.isAvailable(), false, 'locked/denied Keychain reports unavailable');
});

test('official SDK storage + adapter: credential file is owner-only and contains no plaintext token', async (t) => {
  const sdk = process.env.CURIVEN_SIWC_DIR || join(homedir(), '.local/opt/siwc-devkit-0a36fef');
  let ConnectionStore;
  try { ({ ConnectionStore } = await import(pathToFileURL(join(sdk, 'packages/local/dist/storage.js')).href)); }
  catch { t.skip('official SDK not installed'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'curiven-store-'));
  const store = new ConnectionStore(join(dir, 'chatgpt'), keychainEncryption({ run: fakeKeychain().run, platform: 'darwin' }));
  const secrets = { accessToken: 'tok-ACCESS-SECRET', refreshToken: 'tok-REFRESH-SECRET', expiresAt: Date.now() + 1e6 };
  const account = { credentials: secrets, savedAt: new Date(0).toISOString(), scopes: ['chatgpt.tokens.use.direct'], clientId: 'oaiapp_test', status: 'connected', label: 'x', version: 1, id: 'p' };
  const state = { profiles: [account], pendingRegistrations: [], activeProfileId: account.id, version: 2 };
  await store.withLock(() => store.write(state));
  const files = await readdir(join(dir, 'chatgpt'));
  assert.ok(files.includes('chatgpt-auth.json'));
  const raw = await readFile(join(dir, 'chatgpt', 'chatgpt-auth.json'), 'utf8');
  assert.ok(!raw.includes('SECRET'), 'tokens are encrypted at rest');
  assert.equal(JSON.parse(raw).provider, 'curiven-macos-keychain-aes256gcm-v1');
  assert.equal((await stat(join(dir, 'chatgpt', 'chatgpt-auth.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'chatgpt'))).mode & 0o777, 0o700);
  const back = await store.withLock(() => store.read());
  assert.equal(back.profiles[0].credentials.accessToken, 'tok-ACCESS-SECRET');
});

test('bridge: only sanitized SDK errors cross the process boundary', () => {
  const leaky = new Error('POST body: 학습자의 실제 설명 ... Bearer tok-SECRET');
  assert.deepEqual(safeError(leaky), { code: 'internal', message: 'ChatGPT 연결 처리 중 오류가 발생했어요.', retryable: false });
  const sdkErr = { name: 'ChatGPTError', code: 'subscription_sharing_usage_limit_exceeded', toJSON: () => ({ code: 'subscription_sharing_usage_limit_exceeded', message: 'limit', retryable: false, status: 429, requestId: 'req_1', responseShape: 'x', extra: 'tok-SECRET' }) };
  assert.deepEqual(safeError(sdkErr), { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit', retryable: false, status: 429, requestId: 'req_1' });
});

test('bridge: respond sends only model, instructions and one user message (preview-compatible)', async () => {
  const seen = [];
  const client = { streamResponse: async (o) => { seen.push(o); o.onDelta('{'); return { text: '{"a":1}' }; } };
  const handle = createHandler(client);
  const r = await handle({ op: 'respond', model: 'm', instructions: 'SYS', input: 'USER' });
  assert.equal(r.text, '{"a":1}');
  assert.deepEqual(Object.keys(seen[0]).sort(), ['input', 'instructions', 'model', 'onDelta']);
  assert.deepEqual(seen[0].input, [{ role: 'user', content: 'USER' }]);
  for (const bad of [{ model: '', instructions: 'S', input: 'U' }, { model: 'm', instructions: 'S', input: '' }, { model: 'm', instructions: 'S', input: 'x'.repeat(40_001) }, { model: 'm', instructions: 1, input: 'U' }]) {
    await assert.rejects(handle({ op: 'respond', ...bad }), (e) => safeError(e).code === 'invalid_request');
  }
  await assert.rejects(handle({ op: 'eval' }), (e) => safeError(e).code === 'unknown_op');
});

test('bridge: line protocol answers by id and ignores garbage', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const client = { getSession: async () => ({ status: 'disconnected', sharing: false }), listModels: async () => { throw new Error('secret detail'); } };
  serve(createHandler(client), input, output);
  const lines = [];
  output.on('data', (d) => lines.push(...d.toString().trim().split('\n').map((l) => JSON.parse(l))));
  input.write('not json\n{"op":"session"}\n{"id":2,"op":"models"}\n{"id":1,"op":"session"}\n');
  await new Promise((r) => setTimeout(r, 50));
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.deepEqual(Object.keys(byId).sort(), ['1', '2']);
  assert.deepEqual(byId[1], { id: 1, ok: true, result: { status: 'disconnected', sharing: false } });
  assert.equal(byId[2].ok, false); assert.equal(byId[2].error.code, 'internal');
  assert.ok(!JSON.stringify(lines).includes('secret detail'));
});
