"""Supervises the Node bridge (chatgpt/bridge.mjs) that runs OpenAI's official Sign in with ChatGPT SDK.

server.py never sees OAuth tokens: it sends credential-free requests over the child's stdin and gets
back credential-free results (session state, model list, response text, sanitized error codes).
The child gets a minimal environment, so OPENAI_* variables or proxies set in the user's shell cannot
redirect or log requests, and its stderr is discarded rather than logged."""
import itertools, json, os, shutil, subprocess, tempfile, threading
from pathlib import Path
import test_guard

HERE = Path(__file__).resolve().parent
SDK_COMMIT = '0a36fefeb913055c8c7a1a29b63d82b96b2e841a'
DEFAULT_SDK_DIR = Path.home() / '.local' / 'opt' / f'siwc-devkit-{SDK_COMMIT[:7]}'
DEFAULT_STORE = Path.home() / '.config' / 'curiven' / 'chatgpt'
ENV_KEEP = ('PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR')


class BridgeError(Exception):
    def __init__(self, code, message, retryable=False, status=None, request_id=None):
        super().__init__(message)
        self.code, self.message, self.retryable, self.status, self.request_id = code, message, retryable, status, request_id

    @classmethod
    def from_json(cls, e):
        e = e if isinstance(e, dict) else {}
        return cls(str(e.get('code') or 'internal'), str(e.get('message') or 'ChatGPT 연결 처리 중 오류가 발생했어요.'),
                   bool(e.get('retryable')), e.get('status'), e.get('requestId'))


# Test mode (test_guard): the real credential folder, the model choice next to it and the installed SDK are never
# used, whatever the environment says. Without an explicit temporary folder a fresh one is used; the SDK defaults to
# a folder that does not exist, so the real bridge cannot start and no sign-in or model request can happen.
_TEST_STORE = None
TEST_NO_SDK = Path(tempfile.gettempdir()) / 'curiven-test-no-sdk'


def storage_dir():
    global _TEST_STORE
    v = os.environ.get('CURIVEN_CHATGPT_DIR')
    if test_guard.test_mode():
        if not v:
            _TEST_STORE = _TEST_STORE or os.path.join(tempfile.mkdtemp(prefix='curiven-chatgpt-test-'), 'chatgpt'); v = _TEST_STORE   # private parent for settings.json
        if test_guard.related(v, test_guard.REAL_CONFIG) or test_guard.related(v, DEFAULT_STORE):
            raise RuntimeError('CURIVEN test mode: refusing the real ChatGPT credential folder')
    d = Path(v or DEFAULT_STORE).expanduser().resolve()
    if d == HERE or HERE in d.parents:
        raise RuntimeError('ChatGPT credentials must be stored outside the CURIVEN repository')
    return d


def sdk_dir():
    v = os.environ.get('CURIVEN_SIWC_DIR')
    if test_guard.test_mode():
        if not v: return TEST_NO_SDK
        if test_guard.related(v, DEFAULT_SDK_DIR): raise RuntimeError('CURIVEN test mode: refusing the installed Sign in with ChatGPT SDK')
    return Path(v or DEFAULT_SDK_DIR).expanduser().resolve()


def isolation_problems(env):
    """Why a test server's environment could reach the real ChatGPT setup (empty list = isolated)."""
    out = []
    d, s = env.get('CURIVEN_CHATGPT_DIR'), env.get('CURIVEN_SIWC_DIR')
    if d and (test_guard.related(d, test_guard.REAL_CONFIG) or test_guard.related(d, DEFAULT_STORE)): out.append('CURIVEN_CHATGPT_DIR points at the real ChatGPT credentials')
    if s and test_guard.related(s, DEFAULT_SDK_DIR): out.append('CURIVEN_SIWC_DIR points at the installed ChatGPT SDK')
    return out


def sdk_installed():
    return (sdk_dir() / 'packages' / 'local' / 'dist' / 'index.js').is_file()


class Bridge:
    def __init__(self, argv=None):
        self._argv = argv  # tests inject a fake bridge command
        self._proc = None
        self._lock = threading.Lock()
        self._pending = {}
        self._ids = itertools.count(1)

    def _command(self):
        if self._argv: return list(self._argv)
        if test_guard.test_mode() and sdk_installed():   # a test never starts the real bridge, even against a copied SDK
            raise BridgeError('test_mode_blocked', 'CURIVEN 테스트에서는 실제 ChatGPT 연결을 시작하지 않아요.')
        node = os.environ.get('CURIVEN_NODE') or shutil.which('node')
        if not node: raise BridgeError('node_missing', 'Node.js 22 이상이 필요해요. README의 ChatGPT 설정 절차를 확인해 주세요.')
        if not sdk_installed(): raise BridgeError('sdk_missing', '공식 Sign in with ChatGPT SDK가 설치되지 않았어요. tools/setup-chatgpt-sdk.sh 를 실행해 주세요.')
        return [node, str(HERE / 'chatgpt' / 'bridge.mjs')]

    def _ensure(self):
        if self._proc and self._proc.poll() is None: return self._proc
        env = {k: os.environ[k] for k in ENV_KEEP if k in os.environ}
        env.update({'CURIVEN_SIWC_DIR': str(sdk_dir()), 'CURIVEN_CHATGPT_DIR': str(storage_dir()), 'NODE_ENV': 'production'})
        if test_guard.test_mode(): env['CURIVEN_TEST'] = '1'   # the child guards its own Keychain and network too
        self._proc = subprocess.Popen(self._command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                      env=env, cwd=str(HERE), text=True, encoding='utf-8', bufsize=1)
        threading.Thread(target=self._read, args=(self._proc,), daemon=True).start()
        return self._proc

    def _read(self, proc):
        for line in proc.stdout:
            try: msg = json.loads(line)
            except ValueError: continue
            slot = self._pending.pop(msg.get('id'), None) if isinstance(msg, dict) else None
            if slot: slot['msg'] = msg; slot['done'].set()
        # Child exited: fail everything still waiting on it, and release its pipes.
        for key, slot in list(self._pending.items()):
            if slot['proc'] is proc:
                self._pending.pop(key, None); slot['done'].set()
        proc.wait()
        for pipe in (proc.stdin, proc.stdout):
            try: pipe.close()
            except OSError: pass

    def call(self, op, timeout=30, **args):
        with self._lock:
            # A child that just exited can still look alive for a moment. If the request cannot even be
            # written, it was never delivered, so starting a fresh child and sending it once more is safe.
            for attempt in (0, 1):
                proc = self._ensure()
                rid = next(self._ids)
                slot = {'done': threading.Event(), 'msg': None, 'proc': proc}
                self._pending[rid] = slot
                try:
                    proc.stdin.write(json.dumps({'id': rid, 'op': op, **args}, ensure_ascii=False) + '\n'); proc.stdin.flush()
                    break
                except (OSError, ValueError):  # BrokenPipeError, or the pipe was already closed
                    self._pending.pop(rid, None)
                    self._proc = None
                    if attempt: raise BridgeError('bridge_unavailable', 'ChatGPT 연결 프로세스를 시작하지 못했어요.', True)
        if not slot['done'].wait(timeout):
            self._pending.pop(rid, None)
            raise BridgeError('timeout', 'ChatGPT 응답 시간이 초과됐어요. 다시 시도해 주세요.', True)
        msg = slot['msg']
        if msg is None: raise BridgeError('bridge_unavailable', 'ChatGPT 연결 프로세스가 종료됐어요. 다시 시도해 주세요.', True)
        if msg.get('ok'): return msg.get('result')
        raise BridgeError.from_json(msg.get('error'))

    def close(self):
        proc = self._proc
        if not proc: return
        try: proc.stdin.close()
        except OSError: pass
        try: proc.wait(3)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()
