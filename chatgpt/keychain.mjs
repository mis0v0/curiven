/* CURIVEN credential encryption for the official Sign in with ChatGPT SDK (@siwc/local).

   The SDK refuses to store credentials without an application-supplied, OS-backed encryption provider
   (docs/security.md: "Other local runtimes must provide their own OS-backed implementation"). The
   official example uses Electron safeStorage, which CURIVEN does not have. This adapter is the
   equivalent for a plain Node process on macOS:

   - A random 256-bit key lives in the login Keychain (generic password, service below). It is created
     lazily on the first *write* (i.e. the first successful sign-in), never by merely checking status.
   - The key is written through `security -i` on stdin, so it never appears in process arguments.
   - Credentials are sealed with AES-256-GCM from node:crypto (random 96-bit IV, 128-bit tag, fixed AAD).
     No custom cryptography: only the standard primitive with an authenticated mode.

   Limits (documented in README): Keychain protects the key at rest and keeps the encrypted file useless
   on its own (backups, sync, accidental copies). It does not protect against other programs running as
   the same macOS user, which can ask `security` for the same item. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export const SERVICE = 'curiven.chatgpt-credential-key';
export const ACCOUNT = 'curiven';
export const PROVIDER_ID = 'curiven-macos-keychain-aes256gcm-v1';
const FORMAT = 1, IV = 12, TAG = 16;
const AAD = Buffer.from('curiven/chatgpt-credentials/v1');
const NOT_FOUND = 44; // errSecItemNotFound exit status of /usr/bin/security

/** Runs /usr/bin/security without a shell. Output is consumed here and never logged. */
export function runSecurity(args, stdin) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.once('error', () => resolve({ code: -1, stdout: '' }));
    child.once('close', (code) => resolve({ code: code ?? -1, stdout }));
    child.stdin.end(stdin ?? '');
  });
}

/** In automated tests (CURIVEN_TEST=1 or node --test) the real Keychain is never asked: an injected `run` is required. */
const refused = async () => ({ code: -1, stdout: '' });
const inTests = () => process.env.CURIVEN_TEST === '1' || !!process.env.NODE_TEST_CONTEXT;
export function keychainEncryption({ run = inTests() ? refused : runSecurity, platform = process.platform } = {}) {
  let key; // Buffer, cached for the life of the bridge process only
  async function lookup() {
    if (key) return key;
    const r = await run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
    if (r.code === NOT_FOUND) return null;
    const hex = r.stdout.trim();
    if (r.code !== 0 || !/^[0-9a-f]{64}$/.test(hex)) throw new Error('keychain unavailable');
    key = Buffer.from(hex, 'hex');
    return key;
  }
  async function requireKey(create) {
    const found = await lookup();
    if (found) return found;
    if (!create) throw new Error('no credential key');
    const hex = randomBytes(32).toString('hex');
    const w = await run(['-i'], `add-generic-password -s ${SERVICE} -a ${ACCOUNT} -w ${hex}\n`);
    if (w.code !== 0) throw new Error('keychain write failed');
    const stored = await lookup();
    if (!stored || stored.toString('hex') !== hex) throw new Error('keychain verification failed');
    return stored;
  }
  return {
    id: PROVIDER_ID,
    async isAvailable() {
      if (platform !== 'darwin') return false;
      try { await lookup(); return true; } catch { return false; }
    },
    async encrypt(plaintext) {
      const k = await requireKey(true);
      const iv = randomBytes(IV);
      const c = createCipheriv('aes-256-gcm', k, iv, { authTagLength: TAG });
      c.setAAD(AAD);
      const body = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
      return new Uint8Array(Buffer.concat([Buffer.from([FORMAT]), iv, c.getAuthTag(), body]));
    },
    async decrypt(ciphertext) {
      const k = await requireKey(false);
      const buf = Buffer.from(ciphertext);
      if (buf.length < 1 + IV + TAG + 1 || buf[0] !== FORMAT) throw new Error('unsupported ciphertext');
      const d = createDecipheriv('aes-256-gcm', k, buf.subarray(1, 1 + IV), { authTagLength: TAG });
      d.setAAD(AAD);
      d.setAuthTag(buf.subarray(1 + IV, 1 + IV + TAG));
      return Buffer.concat([d.update(buf.subarray(1 + IV + TAG)), d.final()]).toString('utf8');
    },
  };
}
