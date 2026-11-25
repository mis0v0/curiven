/* Test mode only: this Node process may open network connections to loopback addresses and local sockets, nothing
   else. Covers http/https/tls/fetch, which all connect through net.Socket. Idempotent. */
import net from 'node:net';
export const testMode = () => process.env.CURIVEN_TEST === '1' || !!process.env.NODE_TEST_CONTEXT;
const loop = (h) => { if (h == null) return true; h = String(h).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return h === '' || h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h) || /^::ffff:127\./.test(h); };
export function guardNetwork() {
  if (net.Socket.prototype.connect.__curivenGuard) return;
  const real = net.Socket.prototype.connect;
  const guarded = function (...args) {
    const o = args[0], opts = Array.isArray(o) ? o[0] : o;
    const host = typeof opts === 'object' && opts ? (opts.path ? null : (opts.host ?? 'localhost')) : (typeof opts === 'number' || /^\d+$/.test(String(opts)) ? (typeof args[1] === 'string' ? args[1] : 'localhost') : null);
    if (!loop(host)) { const e = new Error(`CURIVEN test mode: network access to ${host} is blocked`); e.code = 'CURIVEN_BLOCKED'; process.nextTick(() => this.destroy(e)); return this; }
    return real.apply(this, args);
  };
  guarded.__curivenGuard = true;
  net.Socket.prototype.connect = guarded;
}
