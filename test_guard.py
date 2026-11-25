"""Fail-closed isolation for automated tests.

Test mode is on under CURIVEN_TEST=1, `node --test` (NODE_TEST_CONTEXT, inherited by every child it starts),
`python -m unittest`, or a script inside a tests/ folder. In test mode:
  - real configuration under ~/.config/curiven (Notion mapping, ChatGPT credentials, model choice) is never used;
  - this process can only open network connections to loopback addresses (127.0.0.1 / ::1 / localhost) — name
    lookups and connects to anything else fail before any packet is sent;
  - server.py refuses to start if its environment points at real configuration (exit 78).
Ordinary runs (`python3 server.py`, manual evaluation scripts) are unaffected."""
import ipaddress, os, socket, sys
from pathlib import Path

REAL_CONFIG = (Path.home() / '.config' / 'curiven').resolve()


def test_mode():
    if os.environ.get('CURIVEN_TEST') == '1' or os.environ.get('NODE_TEST_CONTEXT'): return True
    main = sys.modules.get('__main__')
    if getattr(getattr(main, '__spec__', None), 'name', '') == 'unittest.__main__': return True
    f = getattr(main, '__file__', None)
    return bool(f) and Path(f).resolve().parent.name == 'tests'


def related(path, root):
    """True when `path` is `root`, inside it, or one of its parents (pointing at a parent exposes the root)."""
    p, r = Path(path).expanduser().resolve(), Path(root).expanduser().resolve()
    return p == r or r in p.parents or p in r.parents


def _loopback_host(host):
    if isinstance(host, bytes): host = host.decode('idna', 'replace')
    if host is None: return True                    # getaddrinfo(None, port) = local wildcard
    h = str(host).strip('[]').rstrip('.').lower()
    if h in ('localhost', ''): return True
    try: return ipaddress.ip_address(h.split('%')[0]).is_loopback
    except ValueError: return False


class Blocked(OSError):
    pass


_real_getaddrinfo, _real_connect, _real_connect_ex = socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex
def guard_network():
    """Test mode: only loopback connections from this process (idempotent)."""
    if getattr(socket.getaddrinfo, '_curiven_guard', False): return
    def getaddrinfo(host, *a, **k):
        if not _loopback_host(host): raise Blocked(f'CURIVEN test mode: network access to {host!r} is blocked')
        return _real_getaddrinfo(host, *a, **k)
    def check(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not _loopback_host(address[0]):
            raise Blocked(f'CURIVEN test mode: connection to {address[0]!r} is blocked')
    def connect(self, address): check(self, address); return _real_connect(self, address)
    def connect_ex(self, address): check(self, address); return _real_connect_ex(self, address)
    getaddrinfo._curiven_guard = True
    socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex = getaddrinfo, connect, connect_ex


if test_mode(): guard_network()   # importing any CURIVEN module under test installs the guard
