/* CURIVEN ↔ official Sign in with ChatGPT SDK bridge.

   server.py starts this as a private child process and talks to it over stdin/stdout, one JSON object
   per line. There is no network listener here except the SDK's own short-lived OAuth callback on
   127.0.0.1 during sign-in. OAuth (PKCE, state, nonce), ID-token verification, scope checks, refresh,
   revocation, model discovery and Responses streaming are all done by @siwc/local; this file only
   exposes the SDK's credential-free methods. Access/refresh/ID tokens never leave this process:
   the SDK's public return types (SessionState, ChatGPTModel, {text}, SessionError) carry none.

   Request : {"id":1,"op":"session"|"signIn"|"cancelSignIn"|"disconnect"|"models"|"respond", ...args}
   Response: {"id":1,"ok":true,"result":...} | {"id":1,"ok":false,"error":{code,message,retryable,...}} */
import { createInterface } from 'node:readline';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { keychainEncryption } from './keychain.mjs';
import { testMode, guardNetwork } from './netguard.mjs';

const LIMITS = { model: 200, instructions: 20_000, input: 40_000 };
const GENERIC = { code: 'internal', message: 'ChatGPT 연결 처리 중 오류가 발생했어요.', retryable: false };
const refuse = (code, message) => Promise.reject({ name: 'ChatGPTError', code, toJSON: () => ({ code, message, retryable: false }) });

/** Only the SDK's sanitized ChatGPTError survives; anything else may embed request text and is replaced. */
export function safeError(error) {
  if (error && typeof error.code === 'string' && typeof error.toJSON === 'function' && error.name === 'ChatGPTError') {
    const e = error.toJSON();
    return Object.fromEntries(Object.entries(e).filter(([k]) => ['code', 'message', 'retryable', 'status', 'requestId', 'param'].includes(k)));
  }
  return GENERIC;
}

export function createHandler(client) {
  return async function handle(msg) {
    switch (msg.op) {
      case 'session': return client.getSession();
      case 'signIn':
        // Opens the system browser; the user completes consent there. The outcome (connected or a
        // sanitized error) is published into the SDK session state, which server.py polls.
        client.signIn({}).catch(() => {});
        return { started: true };
      case 'cancelSignIn': client.cancelSignIn(); return {};
      case 'disconnect':
        try { await client.disconnect(); return { revoked: true }; }
        catch (e) { if (e?.code === 'revocation_failed') return { revoked: false, error: safeError(e) }; throw e; }
      case 'models': return client.listModels();
      case 'respond': {
        const { model, instructions, input } = msg;
        if (typeof model !== 'string' || !model.trim() || model.length > LIMITS.model ||
            typeof instructions !== 'string' || instructions.length > LIMITS.instructions ||
            typeof input !== 'string' || !input.trim() || input.length > LIMITS.input) {
          return refuse('invalid_request', '요청 형식이 올바르지 않아요.');
        }
        const started = Date.now();
        let firstDelta = null;
        const { text } = await client.streamResponse({
          model, instructions, input: [{ role: 'user', content: input }],
          onDelta: () => { if (firstDelta === null) firstDelta = Date.now() - started; },
        });
        return { text, ms: Date.now() - started, firstDeltaMs: firstDelta };
      }
      default:
        return refuse('unknown_op', '지원하지 않는 요청이에요.');
    }
  };
}

/** Line protocol over the given streams. Exported for tests. */
export function serve(handle, input, output) {
  const write = (obj) => output.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== 'object' || !Number.isInteger(msg.id)) return;
    Promise.resolve().then(() => handle(msg))
      .then((result) => write({ id: msg.id, ok: true, result }))
      .catch((error) => write({ id: msg.id, ok: false, error: safeError(error) }));
  });
  return rl;
}

async function main() {
  if (testMode()) guardNetwork();   // started by a test: loopback only, and keychain.mjs refuses the real Keychain
  const sdkDir = process.env.CURIVEN_SIWC_DIR, storageDir = process.env.CURIVEN_CHATGPT_DIR;
  if (!sdkDir || !isAbsolute(sdkDir) || !storageDir || !isAbsolute(storageDir)) {
    process.stdout.write(JSON.stringify({ id: 0, ok: false, error: { code: 'bridge_config', message: 'ChatGPT 브리지 설정이 올바르지 않아요.', retryable: false } }) + '\n');
    process.exit(2);
  }
  const { createChatGPT } = await import(pathToFileURL(join(sdkDir, 'packages', 'local', 'dist', 'index.js')).href);
  const client = createChatGPT({
    appName: 'CURIVEN',
    appId: 'curiven',
    redirectPort: 0,            // any free 127.0.0.1 port; only the port may vary (/auth/callback is fixed by the SDK)
    storageDir,
    credentialEncryption: keychainEncryption(),
    sendHostId: true,           // the cookbook's configuration; the sign-in guide calls ext_agent_host_id required
  });
  serve(createHandler(client), process.stdin, process.stdout);
  process.stdin.on('end', () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => process.exit(1));
