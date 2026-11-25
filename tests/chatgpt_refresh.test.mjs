// Run: node --test tests/chatgpt_refresh.test.mjs
// Token refresh, expiry and quota recovery through CURIVEN's bridge handler + Keychain adapter with the
// REAL official SDK (@siwc/local) and a MOCKED network (synthetic signed tokens, no OpenAI contact,
// no real Keychain). Evidence for CURIVEN's wiring of the SDK's refresh path — not a live refresh.
import './netguard.js';   // loopback only: the SDK code here can never reach OpenAI
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { keychainEncryption } from '../chatgpt/keychain.mjs';
import { createHandler, safeError } from '../chatgpt/bridge.mjs';

const SDK = process.env.CURIVEN_SIWC_DIR || join(homedir(), '.local/opt/siwc-devkit-0a36fef');
let sdk, jose, ConnectionStore;
try {
  sdk = await import(pathToFileURL(join(SDK, 'packages/local/dist/index.js')).href);
  const storage = await import(pathToFileURL(join(SDK, 'packages/local/dist/storage.js')).href);
  ConnectionStore = storage.ConnectionStore;
  jose = await import(pathToFileURL(createRequire(join(SDK, 'packages/local/package.json')).resolve('jose')).href);
} catch { /* skipped below */ }

const ORIGIN = 'https://auth.openai.com', API = 'https://api.openai.com/v1';
const WHO = { clientId: 'curiven_test_client', subject: 'curiven-test-subject' };
const SCOPES = 'openid offline_access resource.invoke chatgpt.tokens.use.direct';

function fakeKeychain() {
  const items = new Map();
  return async (args, stdin) => {
    if (args[0] === 'find-generic-password') return items.has(args[2]) ? { code: 0, stdout: items.get(args[2]) } : { code: 44, stdout: '' };
    const m = /add-generic-password -s (\S+) -a \S+ -w ([0-9a-f]+)/.exec(stdin || ''); if (m) { items.set(m[1], m[2]); return { code: 0, stdout: '' }; }
    return { code: 1, stdout: '' };
  };
}

/** What the SDK keeps on disk for one signed-in account, with synthetic tokens that expire after `ms`. */
function savedConnection(ms) {
  const tokens = { expiresAt: Date.now() + ms, refreshToken: 'old-refresh', accessToken: 'old-access' };
  const account = { ...WHO, id: 'p', label: 'x', version: 1, credentials: tokens, scopes: SCOPES.split(' '), savedAt: new Date(0).toISOString(), status: 'connected' };
  return { profiles: [account], pendingRegistrations: [], activeProfileId: account.id, version: 2 };
}

async function fixture(t, { expiresIn = 30_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'curiven-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const credentialEncryption = keychainEncryption({ run: fakeKeychain(), platform: 'darwin' });
  const store = new ConnectionStore(dir, credentialEncryption), saved = savedConnection(expiresIn);
  await store.withLock(async () => { await store.write(saved); });
  const openBrowser = () => { throw new assert.AssertionError({ message: 'a refresh never starts a sign-in by itself' }); };
  const client = sdk.createChatGPT({ storageDir: dir, credentialEncryption, openBrowser, appId: 'curiven', appName: 'CURIVEN', redirectPort: 0, sendHostId: true });
  return { dir, store, client, handle: createHandler(client) };
}

/** A signing key of this test's own; stands in for the identity provider. */
async function signer() {
  const pair = await jose.generateKeyPair('RS256'), head = { kid: 'k', alg: 'RS256' };
  const publicPart = Object.assign(await jose.exportJWK(pair.publicKey), head, { use: 'sig' });
  const sign = () => new jose.SignJWT().setIssuer(ORIGIN).setAudience(WHO.clientId).setSubject(WHO.subject).setIssuedAt().setExpirationTime('1h').setProtectedHeader(head).sign(pair.privateKey);
  return { publicPart, sign };
}

async function network(t, { token, responses }) {
  const key = await signer(), calls = { token: 0, models: 0, responses: 0, bearer: [] };
  const paths = { authorization_endpoint: '/authorize', token_endpoint: '/oauth/token', jwks_uri: '/jwks', revocation_endpoint: '/revoke' };
  const discovery = { issuer: ORIGIN };
  for (const [name, path] of Object.entries(paths)) discovery[name] = ORIGIN + path;
  const api = (name, answer) => (init) => { calls[name] += 1; calls.bearer.push(new Headers(init.headers).get('authorization')); return answer(); };
  const routes = new Map([
    [ORIGIN + '/.well-known/openid-configuration', () => Response.json(discovery)],
    [discovery.jwks_uri, () => Response.json({ keys: [key.publicPart] })],
    [discovery.token_endpoint, async ({ body }) => { calls.token += 1; assert.deepEqual(body.getAll('grant_type'), ['refresh_token']); return token(await key.sign()); }],
    [API + '/models', api('models', () => Response.json({ models: [{ visibility: 'list', display_name: 'M1', slug: 'm1' }] }))],
    [API + '/responses', api('responses', () => responses())],
  ]);
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const route = routes.get(String(target));
    assert.ok(route, 'unexpected request ' + target);
    return route(init);
  });
  return calls;
}

function sse(list) {
  let body = '';
  for (const e of list) body += ['event: ' + e.type, 'data: ' + JSON.stringify(e), '', ''].join('\n');
  return new Response(body, { headers: [['content-type', 'text/event-stream']] });
}
const step = (name, rest) => ({ type: 'response.' + name, ...rest });
const completed = (text) => sse([step('output_text.delta', { delta: text }), step('completed', { response: { status: 'completed' } })]);

test('expiring access token is refreshed automatically before the request; rotated tokens are stored encrypted', { skip: !sdk && 'official SDK not installed' }, async (t) => {
  const { handle, dir } = await fixture(t);
  const calls = await network(t, { token: (id) => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: id, token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' }), responses: () => completed('{"ok":true}') });
  const r = await handle({ op: 'respond', model: 'm1', instructions: 'S', input: 'U' });
  assert.equal(r.text, '{"ok":true}');
  assert.equal(calls.token, 1, 'refreshed once');
  assert.deepEqual(calls.bearer, ['Bearer new-access'], 'request used the successor token');
  await handle({ op: 'models' });
  assert.equal(calls.token, 1, 'no second refresh while the new token is valid');
  const raw = await readFile(join(dir, 'chatgpt-auth.json'), 'utf8');
  assert.ok(!/old-|new-/.test(raw), 'neither old nor rotated tokens appear in plaintext');
  const s = await handle({ op: 'session' });
  assert.deepEqual([s.status, s.sharing, JSON.stringify(s).includes('new-')], ['connected', true, false]);
});

test('a rejected refresh (expired/revoked) ends in reauth_required with a sanitized error; no browser opens', { skip: !sdk && 'official SDK not installed' }, async (t) => {
  const { handle } = await fixture(t, { expiresIn: -1000 });
  const calls = await network(t, { token: () => Response.json({ error: 'invalid_grant', error_description: 'refresh token secret-detail expired' }, { status: 400 }), responses: () => completed('x') });
  const err = await handle({ op: 'respond', model: 'm1', instructions: 'S', input: 'U' }).catch((e) => safeError(e));
  assert.equal(err.code, 'invalid_grant');
  assert.ok(!JSON.stringify(err).includes('secret-detail'));
  assert.equal(calls.responses, 0, 'no inference with an unusable token');
  const s = await handle({ op: 'session' });
  assert.equal(s.status, 'reauth_required');
  const again = await handle({ op: 'respond', model: 'm1', instructions: 'S', input: 'U' }).catch((e) => safeError(e));
  assert.equal(again.code, 'sign_in_required', 'stays signed out until the user reconnects interactively');
  assert.equal(calls.token, 1, 'the dead refresh token is not retried');
});

test('quota exhaustion mid-session is reported, keeps the connection, and the next request can succeed', { skip: !sdk && 'official SDK not installed' }, async (t) => {
  const { handle } = await fixture(t, { expiresIn: 3600_000 });
  let quota = true;
  await network(t, { token: () => assert.fail('no refresh needed'), responses: () => quota
    ? Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit for private text', type: 'usage' } }, { status: 429 })
    : completed('{"ok":1}') });
  const err = await handle({ op: 'respond', model: 'm1', instructions: 'S', input: 'U' }).catch((e) => safeError(e));
  assert.equal(err.code, 'subscription_sharing_usage_limit_exceeded'); assert.equal(err.retryable, false);
  assert.ok(!JSON.stringify(err).includes('private text'));
  assert.equal((await handle({ op: 'session' })).status, 'connected', 'quota does not sign the user out');
  quota = false;
  assert.equal((await handle({ op: 'respond', model: 'm1', instructions: 'S', input: 'U' })).text, '{"ok":1}');
});
