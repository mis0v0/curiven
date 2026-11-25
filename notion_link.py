"""Personal Notion save for CURIVEN: one internal-integration token, one destination page, one page per exploration.

Checked against the official docs on 2026-11-22 (developers.notion.com):
- Auth: `Authorization: Bearer <token>`, `Notion-Version` header required; latest documented version 2026-03-11.
- Create: POST /v1/pages {parent:{page_id}, properties:{title}, markdown}  (markdown is mutually exclusive with children)
- (Not used since 2026-11-24) Replace content: PATCH /v1/pages/{id}/markdown {type:'replace_content'}; title: PATCH
  /v1/pages/{id}. Trashed pages report `in_trash`.
- Capabilities needed on the shared page: Read content (check the page), Insert content (create).
- Read content: GET /v1/pages/{id}/markdown → page_markdown {markdown, truncated, unknown_block_ids}; the PATCH above
  returns the same object for the page after the update.
- CURIVEN PUBLISHES pages; it does not sync (2026-11-24 reviews). The API has no conditional write (no If-Match/ETag/
  version on page or markdown updates), so any replacement of an existing page can destroy an edit made in Notion after
  CURIVEN's last read. Writing into an existing page is therefore off at this boundary (update and overwrite are refused
  before any request); a later version is published as a NEW page only when the learner confirms it.
- Creation identity (see _create): a pending record is stored before the POST; only a well-formed page answer under
  the destination with a new id is mapped (at once, baseline 'unknown'); a post-create read is a 'verified' baseline only
  if it equals what was sent. 5xx, timeouts, dropped/undecodable/odd answers leave the create unresolved: never retried,
  searched or adopted automatically — the learner decides (confirmed new page).
- 429 → Retry-After seconds (a rate-limited request was not processed).

Credential handling (local, single user):
- The token is stored only in the macOS login Keychain (generic password, service below), written through
  `security -i` on stdin so it never appears in process arguments. It is read on demand by this server process and
  is never returned by any API, written to the browser, the learning records, backups, notes, Git or logs.
- Settings (destination page id/title/url, auto-save) and the exploration→page mapping live in a separate local
  directory (default ~/.config/curiven/notion, 0700/0600) — never inside the learning data model, so a future
  multi-user CURIVEN does not inherit anyone's workspace through shared records or backups.
- Limits: like any Keychain item readable by `security`, other programs running as the same macOS user can ask for
  it. Disconnecting deletes the Keychain item; revoking the integration itself is done in Notion.
"""
import errno, fcntl, hashlib, http.client, json, os, re, socket, subprocess, sys, tempfile, threading, time, uuid
from contextlib import contextmanager
import test_guard
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

NOTION_VERSION = '2026-03-11'
SERVICE, ACCOUNT = 'curiven.notion-token', 'curiven'
TOKEN_RE = re.compile(r'^[A-Za-z0-9_\-]{20,256}$')    # also keeps the `security -i` command line unambiguous
EXPLORATION_RE = re.compile(r'^[A-Za-z0-9_\-]{1,80}$')
MAX_MARKDOWN = 150_000
NOT_FOUND = 44  # errSecItemNotFound exit status of /usr/bin/security


# ---- test isolation (fail-closed) -------------------------------------------------------------------------
# In test mode, real storage, Keychain and external API access are blocked.
#   - storage: a fresh temporary folder (never inside the real one); token: process memory only;
#   - network: only a fake API on 127.0.0.1; every other base is refused before any request, and the process cannot
#     connect anywhere but loopback (test_guard.guard_network);
#   - a server started in test mode with anything less exits before serving (server.py, check_isolation()).
REAL_DIR = (Path.home() / '.config' / 'curiven' / 'notion').resolve()


test_mode = test_guard.test_mode   # shared with chatgpt_bridge.py and server.py


def _inside_real(path):
    p = Path(path).expanduser().resolve()
    return p == REAL_DIR or REAL_DIR in p.parents or p in REAL_DIR.parents


def _loopback(base):
    u = urlparse(str(base or ''))
    return u.scheme == 'http' and u.hostname == '127.0.0.1'


def isolation_problems(env=None):
    """Why this environment is NOT safe for a test server (empty list = isolated)."""
    env = os.environ if env is None else env; out = []
    d = env.get('CURIVEN_NOTION_DIR')
    if not d: out.append('CURIVEN_NOTION_DIR is not set (would use the real ~/.config/curiven/notion)')
    elif _inside_real(d): out.append('CURIVEN_NOTION_DIR points at the real Notion folder')
    if env.get('CURIVEN_NOTION_SECRETS') != 'memory': out.append('CURIVEN_NOTION_SECRETS is not "memory" (would use the Keychain token)')
    if not _loopback(env.get('CURIVEN_NOTION_API')): out.append('CURIVEN_NOTION_API is not a 127.0.0.1 fake (would reach api.notion.com)')
    return out


guard_network = test_guard.guard_network   # test mode: loopback-only networking for the whole process


class _RefuseRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_notion_http = build_opener(_RefuseRedirect())


class NotionError(Exception):
    def __init__(self, status, message, code=None):
        super().__init__(message); self.status, self.message, self.code = status, message, code


def page_id_from(value):
    """A page link or id → canonical dashed UUID. Only the 32-hex id is used; nothing else from the link."""
    s = str(value or '').strip().split('?')[0].split('#')[0]
    B = r'(?<![0-9a-fA-F])'; A = r'(?![0-9a-fA-F])'
    m = [x.replace('-', '') for x in re.findall(B + r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' + A, s)] or re.findall(B + r'[0-9a-fA-F]{32}' + A, s)
    if not m: raise NotionError(400, '페이지 링크에서 페이지 ID를 찾지 못했어요. Notion에서 ‘링크 복사’로 받은 주소를 붙여 넣어 주세요.')
    h = m[-1].lower()
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}'


class KeychainStore:
    """The token in the macOS login Keychain. Output of `security` is consumed here and never logged."""
    def _run(self, args, stdin=None):
        if test_mode(): raise NotionError(500, 'CURIVEN test mode: the Keychain is never used in tests.', 'blocked')
        try:
            r = subprocess.run(['/usr/bin/security', *args], input=(stdin or '').encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, shell=False)
            return r.returncode, r.stdout.decode('utf-8', 'replace')
        except (OSError, subprocess.SubprocessError): return -1, ''
    def available(self): return os.path.exists('/usr/bin/security')
    def get(self):
        code, out = self._run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])
        if code == NOT_FOUND: return None
        tok = out.strip()
        if code != 0 or not TOKEN_RE.match(tok): raise NotionError(500, '키체인에서 Notion 연결 정보를 읽지 못했어요.')
        return tok
    def set(self, token):
        if not TOKEN_RE.match(token): raise NotionError(400, 'Notion 토큰 형식이 올바르지 않아요.')
        code, _ = self._run(['-i'], f'add-generic-password -U -s {SERVICE} -a {ACCOUNT} -w {token}\n')
        if code != 0 or self.get() != token: raise NotionError(500, '키체인에 Notion 연결 정보를 저장하지 못했어요.')
    def delete(self):
        code, _ = self._run(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT])
        if code not in (0, NOT_FOUND): raise NotionError(500, '키체인에서 Notion 연결 정보를 지우지 못했어요.')


class MemoryStore:
    """Tests only (CURIVEN_NOTION_SECRETS=memory): keeps the token in this process's memory, never on disk."""
    def __init__(self): self.token = None
    def available(self): return True
    def get(self): return self.token
    def set(self, token):
        if not TOKEN_RE.match(token): raise NotionError(400, 'Notion 토큰 형식이 올바르지 않아요.')
        self.token = token
    def delete(self): self.token = None


BLOCKED_BASE = 'blocked://notion-in-tests'
def api_base():
    """The official API, or — for automated tests only — a fake server on this machine's loopback interface.
    In test mode there is no default: without a loopback fake every request is refused."""
    v = os.environ.get('CURIVEN_NOTION_API')
    if not v: return BLOCKED_BASE if test_mode() else 'https://api.notion.com'
    u = urlparse(v)
    if u.scheme != 'http' or u.hostname != '127.0.0.1': raise RuntimeError('CURIVEN_NOTION_API must be http://127.0.0.1:<port> (tests only)')
    return v.rstrip('/')


def _title_of(page):
    for prop in (page.get('properties') or {}).values():
        if isinstance(prop, dict) and prop.get('type') == 'title':
            return ''.join(t.get('plain_text') or t.get('text', {}).get('content', '') for t in prop.get('title') or [])[:200]
    return ''


def _now(): return datetime.now(timezone.utc).isoformat(timespec='seconds')


def fingerprint(markdown):
    """Exact fingerprint of a page's markdown, compared before any replacement. Only line endings and newlines at the very
    end are ignored: indentation, blank lines and spacing are content (2026-11-24 review — the earlier whitespace-collapsing
    fingerprint let a re-indented list or code block edited in Notion be overwritten). Prefixed 'v2:' so a fingerprint
    stored by the earlier version never matches: such a page counts as unverifiable until CURIVEN writes it again."""
    return 'v2:' + hashlib.sha256(str(markdown or '').replace('\r\n', '\n').rstrip('\n').encode('utf-8')).hexdigest()


def _baseline(rec):
    """The exact fingerprint CURIVEN stored after its last write, or None (legacy, linked, or never written)."""
    h = rec.get('remoteHash')
    return h if isinstance(h, str) and h.startswith('v2:') else None


def _canon_id(value):
    """A page id taken from an API response, as a canonical dashed lowercase UUID — or None if it is not one."""
    s = str(value or '').strip().lower().replace('-', '')
    return f'{s[:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:]}' if re.fullmatch(r'[0-9a-f]{32}', s) else None


def _safe_url(value):
    """A Notion page link from a response, only if it is an https Notion address ('' otherwise; it is shown as a link)."""
    u = urlparse(str(value or '')); host = (u.hostname or '').lower()
    return str(value) if u.scheme == 'https' and (host in ('notion.so', 'www.notion.so') or host.endswith('.notion.site')) else ''


def _sync(fd):
    """fsync; on macOS also F_FULLFSYNC, which asks the drive to flush its write cache (plain fsync does not there).
    Filesystems that refuse F_FULLFSYNC keep the plain fsync."""
    os.fsync(fd)
    if hasattr(fcntl, 'F_FULLFSYNC'):
        try: fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
        except OSError: pass


def _sync_dir(path):
    """Make a rename/create in `path` durable. Filesystems that can't fsync a directory (EINVAL/ENOTSUP) are skipped."""
    fd = os.open(path, os.O_RDONLY)
    try:
        try: _sync(fd)
        except OSError as e:
            if e.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF): raise
    finally: os.close(fd)


_DAMAGED = object()
_STR_FIELDS = ('url', 'title', 'savedAt', 'createdAt', 'at', 'archivedAt', 'archivedBy', 'restoredAt', 'linkedAt', 'contentKey', 'remoteHash', 'baseline', 'reason', 'opId', 'reportedPageId')


def _valid_record(r, top):
    if not isinstance(r, dict): return False
    if 'pageId' in r and _canon_id(r['pageId']) is None: return False
    if any(k in r and r[k] is not None and not isinstance(r[k], str) for k in _STR_FIELDS): return False
    if not top: return True
    if 'unconfirmed' in r and not isinstance(r['unconfirmed'], bool): return False
    if not (r.get('pageId') or r.get('unconfirmed') is True): return False      # a page, or a pending/unresolved create
    return all(k not in r or (isinstance(r[k], list) and all(_valid_record(x, False) for x in r[k])) for k in ('previous', 'unresolved'))


def _valid_ledger(v):
    """The exploration → page ledger schema (every field CURIVEN has ever written; unknown extra keys are tolerated)."""
    return isinstance(v, dict) and all(isinstance(k, str) and EXPLORATION_RE.match(k) and _valid_record(r, True) for k, r in v.items())


UNKNOWN_BLOCK_RE = re.compile(r'<unknown[\s/>]', re.I)   # Notion's placeholder for blocks it cannot express in markdown
BAD_RESPONSE = 'Notion의 응답이 이 페이지에 대한 것인지 확인할 수 없어서 아무것도 바꾸지 않았어요.'


class NotionLink:
    def __init__(self, directory=None, store=None, base=None, sleep=time.sleep):
        self.testing = test_mode()
        if self.testing:
            guard_network()
            d = directory or os.environ.get('CURIVEN_NOTION_DIR') or tempfile.mkdtemp(prefix='curiven-notion-test-')
            if _inside_real(d): raise RuntimeError('CURIVEN test mode: refusing the real Notion folder')
            if store is not None and isinstance(store, KeychainStore): raise RuntimeError('CURIVEN test mode: refusing the Keychain store')
            self.dir, self.store = Path(d).expanduser(), store or MemoryStore()
            self.base = base or api_base()
            if self.base != BLOCKED_BASE and not _loopback(self.base): raise RuntimeError('CURIVEN test mode: refusing a non-loopback Notion API')
        else:
            self.dir = Path(directory or os.environ.get('CURIVEN_NOTION_DIR') or Path.home() / '.config' / 'curiven' / 'notion').expanduser()
            self.store = store or (MemoryStore() if os.environ.get('CURIVEN_NOTION_SECRETS') == 'memory' else KeychainStore())
            self.base = base or api_base()
        self.sleep = sleep

    # ---- local files (no secrets): the durable store -------------------------------------------------
    # 2026-11-24 (review of e5c86f7): two server processes could publish the same exploration and lose a mapping, and a
    # damaged ledger was read as empty (→ duplicate pages, history overwritten). The store contract now:
    #   Locks (fcntl.flock, advisory, per open file description — so they also separate threads of one process):
    #     - `.store.lock`         every read-modify-write of notion.json / notion-pages.json / the journal, held only for
    #                             the local transaction (never across a network request); 10 s, then 'store_locked'.
    #     - `locks/<eid>.lock`    one operation per exploration (save, check, reconnect) across processes, held for the
    #                             WHOLE operation including the Notion request; not available within 1 s → 'busy'.
    #     The kernel drops a flock when its process dies, so a crashed holder never blocks anyone; the lock files stay
    #     (deleting them would break mutual exclusion). Works on local macOS (APFS/HFS+) and Linux filesystems; NOT a
    #     guarantee on network filesystems (NFS/SMB) — this store is meant for the local ~/.config folder only.
    #   Reads are strict: absent file → empty only for a ledger that has never been written (`notion-store.json` marker);
    #     unreadable (permissions, I/O) → 'store_unreadable'; invalid JSON / wrong schema / empty or torn file →
    #     'store_corrupt' with the damaged bytes copied to `<name>.corrupt-<sha256 prefix>` (the original stays in place).
    #     Nothing is created, written or replaced while a file is damaged — every write starts with a strict read.
    #   Writes: unique temp file (O_EXCL, 0600) → write → fsync (F_FULLFSYNC on macOS when the filesystem supports it)
    #     → rename over the target (atomic on one filesystem) → fsync the directory. A crash leaves the old or the new
    #     file, never a mix; stray temp files are ignored. Journal lines are appended and synced the same way.
    #   Publication is a write-ahead sequence (see save/_create): reserve (pending + journal, synced) → POST → settle
    #     (journal, then ledger, both synced; only if the pending record is still this operation's).
    LEDGER, CONFIG, MARKER, JOURNAL, LOCKFILE = 'notion-pages.json', 'notion.json', 'notion-store.json', 'notion-journal.jsonl', '.store.lock'
    STORE_MSG = {'store_corrupt': 'CURIVEN의 Notion 저장 기록 파일이 손상돼서 아무것도 저장하지 않았어요. 원래 파일은 그대로 두고 복사본을 남겼어요.',
                 'store_unreadable': 'CURIVEN의 Notion 저장 기록 파일을 읽을 수 없어서 아무것도 저장하지 않았어요. 파일 권한을 확인해 주세요.',
                 'store_missing': 'CURIVEN의 Notion 저장 기록 파일이 없어졌어요. 중복 저장을 막으려고 아무것도 저장하지 않았어요.',
                 'store_unwritable': 'CURIVEN의 Notion 저장 기록을 쓰지 못해서 아무것도 보내지 않았어요.',
                 'store_locked': 'Notion 저장 기록을 다른 작업이 쓰고 있어요. 잠시 뒤 다시 시도해 주세요.'}
    def _store_error(self, code): return NotionError(503 if code == 'store_locked' else 500, self.STORE_MSG[code], code)

    def _ensure_dir(self):
        if not self.dir.is_dir():
            self.dir.mkdir(parents=True, exist_ok=True); _sync_dir(self.dir.parent)
        os.chmod(self.dir, 0o700)

    @contextmanager
    def _flock(self, path, timeout, code):
        self._ensure_dir(); path.parent.mkdir(mode=0o700, exist_ok=True); os.chmod(path.parent, 0o700)
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            deadline = time.monotonic() + timeout
            while True:
                try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
                except BlockingIOError:
                    if time.monotonic() >= deadline: raise (NotionError(409, '이 탐험을 이미 저장하고 있어요.', 'busy') if code == 'busy' else self._store_error(code))
                    time.sleep(0.02)
            yield
        finally: os.close(fd)          # closing the descriptor releases the lock (as does process death)

    def _store_lock(self): return self._flock(self.dir / self.LOCKFILE, 10, 'store_locked')
    def _op_lock(self, eid): return self._flock(self.dir / 'locks' / f'{eid}.lock', 1, 'busy')

    def _load(self, name, valid):
        """The parsed file, None if it legitimately does not exist; raises on anything unreadable or damaged."""
        p = self.dir / name
        try:
            with open(p, 'rb') as f: raw = f.read()
        except FileNotFoundError:
            if name == self.LEDGER and self._ledger_written(): raise self._store_error('store_missing')
            return None
        except OSError: raise self._store_error('store_unreadable')
        try: value = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, ValueError): value = _DAMAGED
        if value is _DAMAGED or not valid(value):
            self._quarantine(name, raw); raise self._store_error('store_corrupt')
        return value

    def _ledger_written(self):
        try:
            with open(self.dir / self.MARKER, 'rb') as f: m = json.loads(f.read().decode('utf-8'))
        except FileNotFoundError: return False
        except (OSError, UnicodeDecodeError, ValueError): return True          # can't tell: assume it was (fail closed)
        return not (isinstance(m, dict) and m.get('ledger') is False)

    def _quarantine(self, name, raw):
        """Keep a byte-exact copy of a damaged file next to it (once per distinct content); the original is not touched."""
        copy = self.dir / f'{name}.corrupt-{hashlib.sha256(raw).hexdigest()[:16]}'
        try:
            fd = os.open(copy, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try: os.write(fd, raw); _sync(fd)
            finally: os.close(fd)
            _sync_dir(self.dir)
        except FileExistsError: pass
        except OSError: pass                      # the original is still in place; nothing will overwrite it

    def _write_json(self, name, value):
        """Durable atomic replacement (see the store contract above). Callers hold the store lock."""
        data = json.dumps(value, ensure_ascii=False, indent=1).encode('utf-8')
        self._ensure_dir()
        tmp = self.dir / f'.{name}.{os.getpid()}.{uuid.uuid4().hex}.tmp'
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                view = memoryview(data)
                while view: view = view[os.write(fd, view):]
                _sync(fd)
            finally: os.close(fd)
            os.replace(tmp, self.dir / name)
            _sync_dir(self.dir)
        except OSError:
            try: os.unlink(tmp)
            except OSError: pass
            raise self._store_error('store_unwritable')
        if name == self.LEDGER and not (self.dir / self.MARKER).exists(): self._write_json(self.MARKER, {'version': 1, 'ledger': True})

    def _journal(self, event):
        """Append one synced line to the operation journal (never rewritten; a recovery record if the ledger is lost)."""
        line = (json.dumps({'at': _now(), **event}, ensure_ascii=False) + '\n').encode('utf-8')
        try:
            fd = os.open(self.dir / self.JOURNAL, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            try: os.write(fd, line); _sync(fd)
            finally: os.close(fd)
        except OSError: raise self._store_error('store_unwritable')

    def config(self): return self._load(self.CONFIG, lambda v: isinstance(v, dict)) or {}
    def mapping(self): return self._load(self.LEDGER, _valid_ledger) or {}

    def _mutate(self, name, change):
        """Under the store lock: strict read → change(value) (may raise: nothing is written) → durable write.
        Returns what change() returns."""
        with self._store_lock():
            value = self.mapping() if name == self.LEDGER else self.config()
            out = change(value)
            self._write_json(name, value)
            return out

    # ---- HTTP ---------------------------------------------------------------------------------------
    def _call(self, method, path, body=None, token=None, retry=True):
        if (self.testing or test_mode()) and not _loopback(self.base):   # checked on every request, not only at start
            raise NotionError(503, 'CURIVEN test mode: Notion requests are blocked.', 'blocked')
        token = token or self.store.get()
        if not token: raise NotionError(409, 'Notion이 연결되지 않았어요. 설정 → Notion에서 연결해 주세요.', 'not_connected')
        req = Request(self.base + path, method=method, data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
                      headers={'Authorization': 'Bearer ' + token, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json'})
        try:
            with _notion_http.open(req, timeout=40) as r: raw = r.read()
        except HTTPError as e:
            if 300 <= e.code < 400:
                e.close()
                raise NotionError(502, 'Notion API 리디렉션을 거부했어요.', 'redirect_refused')
            try: err = json.loads(e.read() or b'{}')
            except ValueError: err = {}
            code = err.get('code') or ''
            if e.code == 429 and retry:
                wait = int(e.headers.get('Retry-After') or 1)
                if wait <= 5: self.sleep(wait); return self._call(method, path, body, token, retry=False)
                raise NotionError(429, f'Notion이 잠시 요청을 제한했어요. {wait}초 뒤에 다시 시도해 주세요.', 'rate_limited')
            if e.code == 401: raise NotionError(401, 'Notion 토큰이 올바르지 않거나 취소됐어요. 설정 → Notion에서 다시 연결해 주세요.', 'unauthorized')
            if e.code == 403: raise NotionError(403, '통합에 필요한 권한이 없어요. Notion 통합 설정에서 ‘콘텐츠 읽기·업데이트·삽입’을 켜 주세요.', 'restricted_resource')
            if e.code == 404: raise NotionError(404, '페이지를 찾을 수 없어요. 그 페이지의 ••• → ‘연결 추가’에서 이 통합을 추가했는지 확인해 주세요.', 'object_not_found')
            if e.code == 400: raise NotionError(400, 'Notion이 노트를 받아들이지 않았어요: ' + str(err.get('message') or code)[:200], code or 'validation_error')
            raise NotionError(502, f'Notion 오류({e.code})로 저장하지 못했어요.', 'server_error')
        except (URLError, TimeoutError, OSError, http.client.HTTPException):   # incl. a reply cut off mid-body
            raise NotionError(503, 'Notion에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', 'network')
        try: out = json.loads(raw or b'{}')
        except ValueError: out = None
        if not isinstance(out, dict): raise NotionError(502, 'Notion의 응답을 읽지 못했어요.', 'bad_response')
        return out

    # ---- connection ---------------------------------------------------------------------------------
    def status(self):
        try: c = self.config()
        except NotionError as e:   # a damaged settings file: report it, never treat it as "not set up yet"
            return {'available': self.store.available(), 'connected': False, 'page': None, 'autoSave': False, 'storeError': e.code}
        try: connected = bool(self.store.get())
        except NotionError: connected = False
        return {'available': self.store.available(), 'connected': connected and bool(c.get('page')),
                'page': c.get('page') if connected else None, 'autoSave': bool(c.get('autoSave')) if connected else False}

    def _page(self, pid, token=None):
        """GET a page and make sure the answer describes THAT page with well-formed lifecycle flags. Anything else is
        uncertainty (502 unexpected_response): it never changes a mapping, a state or a write target."""
        page = self._call('GET', f'/v1/pages/{pid}', token=token)
        flags = [page.get(k) for k in ('in_trash', 'archived') if k in page] if isinstance(page, dict) else []
        if not flags or page.get('object') != 'page' or _canon_id(page.get('id')) != _canon_id(pid) or any(not isinstance(f, bool) for f in flags):
            raise NotionError(502, BAD_RESPONSE, 'unexpected_response')
        return page

    def _check_page(self, page_ref, token=None):
        pid = page_id_from(page_ref)
        page = self._page(pid, token=token)
        if page.get('in_trash') is True or page.get('archived') is True: raise NotionError(400, '그 페이지는 휴지통에 있어요. 다른 페이지를 골라 주세요.')
        return {'id': pid, 'title': _title_of(page) or '(제목 없음)', 'url': _safe_url(page.get('url'))}

    def connect(self, token, page_ref):
        token = str(token or '').strip()
        if not TOKEN_RE.match(token): raise NotionError(400, 'Notion 토큰 형식이 올바르지 않아요. 통합의 ‘구성’ 탭에 있는 내부 통합 시크릿을 붙여 넣어 주세요.')
        page = self._check_page(page_ref, token=token)   # verified BEFORE anything is stored
        def change(c): c.update(page=page, connectedAt=_now()); c.setdefault('autoSave', False)
        self._mutate(self.CONFIG, change)                # refuses (and keeps) a damaged settings file
        self.store.set(token)
        return self.status()

    def set_page(self, page_ref):
        page = self._check_page(page_ref)
        self._mutate(self.CONFIG, lambda c: c.update(page=page))
        return self.status()

    def test(self):
        c = self.config()
        if not c.get('page'): raise NotionError(409, '저장할 페이지가 정해지지 않았어요.', 'no_page')
        page = self._check_page(c['page']['id'])
        at = _now(); self._mutate(self.CONFIG, lambda c: c.update(page=page, checkedAt=at))
        return {**self.status(), 'checkedAt': at}

    def set_auto(self, on):
        if not self.status()['connected']: raise NotionError(409, 'Notion이 연결되지 않았어요.', 'not_connected')
        self._mutate(self.CONFIG, lambda c: c.update(autoSave=bool(on)))
        return self.status()

    def disconnect(self):
        """Forgets the token and destination on this computer. The exploration→page mapping is kept, so reconnecting
        the same workspace updates the same pages instead of duplicating them."""
        self.store.delete()
        def change(c): c.pop('page', None); c['autoSave'] = False
        self._mutate(self.CONFIG, change)
        return self.status()

    # ---- saving ---------------------------------------------------------------------------------------
    def entry(self, eid):
        if not EXPLORATION_RE.match(str(eid or '')): raise NotionError(400, '탐험 ID가 올바르지 않아요.')
        m = self.mapping().get(eid)
        if m and m.get('unconfirmed'): return {'unconfirmed': True, 'at': m.get('at')}
        if not (m and m.get('pageId')): return None
        out = {'url': m.get('url'), 'savedAt': m.get('savedAt'), 'contentKey': m.get('contentKey')}
        return {**out, 'archived': True, 'archivedAt': m['archivedAt']} if m.get('archivedAt') else out

    @staticmethod
    def _mapped_ids(ledger):
        """Every page id the ledger knows: current, previous, and ids reported by unresolved creates."""
        out = set()
        for m in ledger.values():
            out.add(_canon_id(m.get('pageId'))); out.add(_canon_id(m.get('reportedPageId')))
            for p in (m.get('previous') or []) + (m.get('unresolved') or []):
                out.add(_canon_id(p.get('pageId'))); out.add(_canon_id(p.get('reportedPageId')))
        return out - {None}

    def _markdown(self, pid):
        """The page's current markdown, only from a well-formed, complete, lossless answer about THIS page; None otherwise
        (truncated, unknown/unsupported blocks, conversion warnings, another page id, malformed fields)."""
        try: r = self._call('GET', f'/v1/pages/{pid}/markdown?markdown_version=v2')
        except NotionError as e:
            if e.status in (401, 429): raise
            return None
        md, ids = r.get('markdown'), r.get('unknown_block_ids')
        if (r.get('object') != 'page_markdown' or _canon_id(r.get('id')) != _canon_id(pid) or r.get('truncated') is not False
                or not isinstance(ids, list) or ids or r.get('warnings') or not isinstance(md, str) or UNKNOWN_BLOCK_RE.search(md)):
            return None
        return md

    @staticmethod
    def _history(prev, action):
        hist = list(prev.get('previous') or [])
        if action == 'new' and prev.get('pageId'):
            hist.append({'pageId': prev['pageId'], 'url': prev.get('url', ''), **{k: prev[k] for k in ('title', 'savedAt', 'archivedAt', 'archivedBy') if prev.get(k)}})
        return hist

    # ---- creating a page (the only write CURIVEN makes to Notion) ------------------------------------------------
    # Identity first, content proof second, no guessing — and every step durable before the next (store contract above):
    #   1. reserve  (store lock): re-read the ledger, decide, journal 'reserved', store a pending record with a fresh
    #      opId (+ every earlier page id and unresolved attempt). Synced before anything is sent. The exploration's
    #      operation lock is held from here to the end, so no other process can decide the same exploration meanwhile.
    #   2. POST (no store lock held: other explorations go on).
    #   3. settle   (store lock): only if the ledger still holds THIS pending record (opId) — journal, then ledger:
    #        definite refusal (4xx) → the previous record exactly; uncertain (5xx, timeout, dropped/undecodable/odd
    #        answer, wrong parent, duplicate id) → unresolved (kept); a well-formed new page → its id at once with
    #        baseline 'unknown'. If the record is not ours any more, nothing is overwritten: journal 'orphan' + error.
    #   4. optional read (no lock) → baseline 'verified' only if the stored content equals what was sent; settled under
    #      the store lock only if the ledger still maps this exploration to this page.
    #   An unresolved exploration is never searched, adopted, retried or re-created automatically: only an explicit
    #   'new' with confirm=True creates again (the unresolved attempt is kept in `unresolved`).
    def _settle(self, eid, op, value, event):
        def change(m):
            cur = m.get(eid)
            if not (cur and cur.get('opId') == op):
                self._journal({**event, 'event': 'orphan', 'eid': eid, 'opId': op})
                raise NotionError(503, self.UNCONFIRMED_MSG, 'unconfirmed')
            self._journal({**event, 'eid': eid, 'opId': op})
            if value is None: m.pop(eid, None)
            else: m[eid] = value
        self._mutate(self.LEDGER, change)

    def _create(self, eid, dest, title, markdown, content_key, prev, pending, known, action):
        op = pending['opId']
        tprop = {'title': {'title': [{'type': 'text', 'text': {'content': title}}]}}
        def unresolved(reason, reported=None):
            self._settle(eid, op, {**pending, 'reason': reason, **({'reportedPageId': reported} if reported else {})},
                         {'event': 'unresolved', 'reason': reason, **({'pageId': reported} if reported else {})})
            return NotionError(503, self.UNCONFIRMED_MSG, 'unconfirmed')
        try:
            made = self._call('POST', '/v1/pages', {'parent': {'type': 'page_id', 'page_id': dest}, 'properties': tprop, 'markdown': markdown, 'markdown_version': 'v2'})
        except NotionError as e:
            if e.status < 500 and e.code not in ('network', 'bad_response'):   # Notion refused it: nothing was created
                self._settle(eid, op, prev or None, {'event': 'refused', 'reason': e.code}); raise
            raise unresolved(e.code or 'server_error')
        pid = _canon_id(made.get('id'))
        if not pid or made.get('object') != 'page': raise unresolved('bad_response')
        if _canon_id((made.get('parent') or {}).get('page_id')) != _canon_id(dest): raise unresolved('wrong_parent', pid)
        if made.get('in_trash') is not False or made.get('archived') not in (None, False): raise unresolved('bad_response', pid)
        if pid in known: raise unresolved('duplicate_id', pid)
        now = _now(); keep = {k: pending[k] for k in ('previous', 'unresolved') if pending.get(k)}
        rec = {**keep, 'pageId': pid, 'url': _safe_url(made.get('url')), 'savedAt': now, 'createdAt': now, 'title': title,
               'contentKey': content_key, 'baseline': 'unknown'}
        self._settle(eid, op, rec, {'event': 'created', 'pageId': pid})   # the page is CURIVEN's from here on
        try: md = self._markdown(pid)                                       # optional; never decides whether the save happened
        except NotionError: md = None
        if md is not None:
            verified = fingerprint(md) == fingerprint(markdown)
            def change(m):
                cur = m.get(eid) or {}
                if cur.get('pageId') == pid and cur.get('baseline') == 'unknown':
                    cur.update({'baseline': 'verified', 'remoteHash': fingerprint(md)} if verified else {'baseline': 'unverified'})
            try: self._mutate(self.LEDGER, change)
            except NotionError: pass                                         # the page id is already durable
        return {'url': rec['url'], 'savedAt': now, 'action': action, 'contentKey': content_key}

    # A saved page that is no longer usable is never replaced behind the learner's back (2026-11-24):
    #   - confirmed in Notion's trash (the page read succeeds and says in_trash/archived) → the mapping is kept and
    #     marked `archivedAt`; nothing is written;
    #   - unreadable (404/403: deleted for good, or the integration lost access — Notion does not say which) → refused,
    #     nothing is marked, nothing is created;
    #   - a page response that is not clearly THIS page (other id, non-boolean in_trash/archived) → refused as uncertain;
    #   - a new page is made only by an explicit 'new' save with confirm=True; the old page id stays in `previous`;
    #   - a page restored from the trash is linked again with reconnect() (read-only).
    ARCHIVED_MSG = '이 노트의 Notion 페이지가 휴지통에 있어요. 새 페이지는 만들지 않았어요.'
    UNAVAILABLE_MSG = '이 노트의 Notion 페이지를 열 수 없어요. 삭제됐거나 접근 권한이 없을 수 있어요. 새 페이지는 만들지 않았어요.'
    UNCONFIRMED_MSG = 'Notion에 페이지가 만들어졌는지 확인하지 못했어요. 만들어졌을 수 있어서 다시 만들지 않았어요. 저장 위치를 Notion에서 확인한 뒤, 필요하면 ‘새 페이지로 저장’을 고를 수 있어요.'
    # Writing into a page that already exists is OFF (2026-11-24 reviews, HOLD): Notion's API has no conditional write,
    # so a replacement can destroy an edit made in Notion after CURIVEN's last read, and a read right after a create can't
    # prove what CURIVEN wrote. CURIVEN publishes new pages; it does not sync. Both refused before any request.
    UPDATE_OFF_MSG = '이미 저장한 Notion 페이지는 CURIVEN이 바꾸지 않아요. Notion에서 고친 내용을 지킬 안전한 방법이 아직 없어서 업데이트를 꺼 두었어요. 원래 페이지는 그대로예요. 필요하면 새 페이지로 저장할 수 있어요.'
    OVERWRITE_OFF_MSG = 'Notion에서 바뀐 페이지를 덮어쓰는 기능은 꺼 두었어요. Notion의 내용은 그대로예요. 이 노트는 새 페이지로 저장할 수 있어요.'

    def _archived_error(self, rec):
        e = NotionError(409, self.ARCHIVED_MSG, 'archived'); e.archivedAt = rec.get('archivedAt'); return e

    def _page_state(self, pid):
        """('active', page) | ('archived', page) | ('unavailable', None). Other errors (auth, rate limit, network, a
        response that is not clearly this page) raise."""
        try: page = self._page(pid)
        except NotionError as e:
            if e.status in (403, 404): return 'unavailable', None
            raise
        return ('archived' if page.get('in_trash') is True or page.get('archived') is True else 'active'), page

    def _mark_archived(self, eid, pid):
        """Record a trash confirmation — only if the ledger still maps this exploration to that page."""
        def change(m):
            cur = m.get(eid)
            if cur and cur.get('pageId') == pid and not cur.get('archivedAt'): cur.update(archivedAt=_now(), archivedBy='notion-trash')
            return cur or {}
        return self._mutate(self.LEDGER, change)

    def reconnect(self, eid):
        """Link an archived exploration to its page again after the learner restored it in Notion. Writes nothing to Notion."""
        if not EXPLORATION_RE.match(str(eid or '')): raise NotionError(400, '탐험 ID가 올바르지 않아요.')
        if not self.status()['connected']: raise NotionError(409, 'Notion이 연결되지 않았어요. 설정 → Notion에서 연결해 주세요.', 'not_connected')
        with self._op_lock(eid):
            prev = self.mapping().get(eid) or {}
            if not prev.get('pageId'): raise NotionError(404, '다시 연결할 Notion 페이지가 없어요.', 'no_page')
            state, page = self._page_state(prev['pageId'])
            if state == 'archived': raise NotionError(409, 'Notion 휴지통에 아직 있어요. Notion에서 복원한 뒤 다시 연결해 주세요.', 'archived')
            if state == 'unavailable': raise NotionError(409, self.UNAVAILABLE_MSG, 'unavailable')
            def change(m):
                cur = m.get(eid)
                if not (cur and cur.get('pageId') == prev['pageId']): raise NotionError(409, '이 탐험의 저장 기록이 그사이 바뀌었어요. 다시 시도해 주세요.', 'busy')
                was = bool(cur.pop('archivedAt', None)); cur.pop('archivedBy', None)
                cur['url'] = _safe_url(page.get('url')) or cur.get('url') or ''
                if was: cur['restoredAt'] = _now()
            self._mutate(self.LEDGER, change)
            return {'saved': self.entry(eid)}

    # A read-only look at the saved page, asked for explicitly from the dialog: whether it still matches what CURIVEN
    # verified after creating it. Never writes to Notion; like other reads it marks a page confirmed in the trash.
    PREVIEW = 20_000   # characters of the live page shown to the learner

    def check(self, eid):
        """remote state 'same' | 'changed' | 'unknown' (readable, but no verified baseline) | 'unreadable'. Reads only."""
        if not EXPLORATION_RE.match(str(eid or '')): raise NotionError(400, '탐험 ID가 올바르지 않아요.')
        if not self.status()['connected']: raise NotionError(409, 'Notion이 연결되지 않았어요. 설정 → Notion에서 연결해 주세요.', 'not_connected')
        with self._op_lock(eid):
            prev = self.mapping().get(eid) or {}
            if not prev.get('pageId') or prev.get('unconfirmed'): raise NotionError(404, '확인할 Notion 페이지가 없어요.', 'no_page')
            if prev.get('archivedAt'): raise self._archived_error(prev)             # no request
            state, _ = self._page_state(prev['pageId'])
            if state == 'archived': raise self._archived_error(self._mark_archived(eid, prev['pageId']))
            if state == 'unavailable': raise NotionError(409, self.UNAVAILABLE_MSG, 'unavailable')
            md, base = self._markdown(prev['pageId']), _baseline(prev)
            remote = 'unreadable' if md is None else 'unknown' if not base else 'same' if fingerprint(md) == base else 'changed'
            out = {'state': remote, 'checkedAt': _now()}
            if remote in ('changed', 'unknown'): out.update(markdown=md[:self.PREVIEW], clipped=len(md) > self.PREVIEW)
            return {'remote': out}

    def save(self, eid, title, markdown, mode='update', content_key=None, confirm=False):
        """Publishes the note as a Notion page. mode 'update' (default; also auto-save) creates the exploration's FIRST page
        and nothing else: with a page already saved it is refused ('update_disabled'), after an unresolved create it is
        refused ('unconfirmed'), both before any request. 'new' makes a separate page; when a page is saved or a create
        is unresolved it needs confirm=True. 'overwrite' is refused. Nothing ever writes into an existing page.
        The decision is taken under the store lock from a fresh, strict read, while the exploration's operation lock is
        held across processes (see the store contract)."""
        if not EXPLORATION_RE.match(str(eid or '')): raise NotionError(400, '탐험 ID가 올바르지 않아요.')
        if mode not in ('update', 'new', 'overwrite'): raise NotionError(400, '저장 방식이 올바르지 않아요.')
        if mode == 'overwrite': raise NotionError(409, self.OVERWRITE_OFF_MSG, 'overwrite_disabled')
        title = re.sub(r'\s+', ' ', str(title or '')).strip()[:200] or 'CURIVEN 학습 노트'
        markdown = str(markdown or ''); content_key = str(content_key or '')[:80] or None
        if not markdown.strip(): raise NotionError(400, '저장할 노트 내용이 없어요.')
        if len(markdown) > MAX_MARKDOWN: raise NotionError(413, '노트가 너무 길어 Notion에 한 번에 저장할 수 없어요.')
        st = self.status()
        if st.get('storeError'): raise self._store_error(st['storeError'])
        dest = (st.get('page') or {}).get('id')
        if not dest or not st['connected']: raise NotionError(409, 'Notion이 연결되지 않았어요. 설정 → Notion에서 연결해 주세요.', 'not_connected')
        with self._op_lock(eid):
            def reserve(m):
                prev = dict(m.get(eid) or {})
                if mode == 'new':
                    if (prev.get('pageId') or prev.get('unconfirmed')) and confirm is not True: raise NotionError(400, '새 페이지로 저장하려면 확인이 필요해요.', 'confirm_required')
                else:
                    if prev.get('unconfirmed'): raise NotionError(409, self.UNCONFIRMED_MSG, 'unconfirmed')
                    if prev.get('pageId'):
                        if prev.get('archivedAt'): raise self._archived_error(prev)
                        raise NotionError(409, self.UPDATE_OFF_MSG, 'update_disabled')
                action = 'new' if mode == 'new' else 'created'
                hist = self._history(prev, action)
                older = list(prev.get('unresolved') or [])
                if prev.get('unconfirmed'): older.append({k: prev[k] for k in ('at', 'title', 'reason', 'reportedPageId', 'opId') if prev.get(k)})
                pending = {**({'previous': hist} if hist else {}), **({'unresolved': older} if older else {}),
                           'unconfirmed': True, 'at': _now(), 'title': title, 'reason': 'sending', 'opId': uuid.uuid4().hex}
                self._journal({'event': 'reserved', 'eid': eid, 'opId': pending['opId'], 'title': title, 'mode': mode})
                known = self._mapped_ids(m)
                m[eid] = pending
                return prev, pending, known, action
            prev, pending, known, action = self._mutate(self.LEDGER, reserve)   # durable before anything is sent
            return self._create(eid, dest, title, markdown, content_key, prev, pending, known, action)

