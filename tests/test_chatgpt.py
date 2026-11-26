"""ChatGPT provider and local-security tests. Run: python3 -m unittest tests.test_chatgpt

Everything here uses fake bridges: these tests check CURIVEN's request shaping, error handling and
security checks. They are NOT evidence that real ChatGPT sign-in or inference works."""
import json, os, sys, tempfile, threading, unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server, chatgpt_bridge  # noqa: E402
from chatgpt_bridge import BridgeError  # noqa: E402

SAMPLE = json.loads((ROOT / 'sample_cookie_lesson.json').read_text(encoding='utf-8'))
FEEDBACK = {'summary': '좋아요', 'correct': ['세션 ID'], 'misconceptions': [], 'missing': [], 'demonstrated': ['k1'], 'uncertainty': ''}
LEAK = 'tok-SECRET-ACCESS'


class FakeBridge:
    """In-process stand-in for chatgpt_bridge.Bridge."""
    def __init__(self, session=None, models=None, text=None, error=None):
        self.calls = []
        self.session = session if session is not None else {'status': 'connected', 'sharing': True, 'identity': {'email': 'learner@example.com'}}
        self.models = models if models is not None else [{'slug': 'gpt-a', 'displayName': 'A'}, {'slug': 'gpt-b', 'displayName': 'B'}]
        self.text, self.error = text, error

    def call(self, op, timeout=30, **args):
        self.calls.append((op, args))
        if self.error and op == 'respond': raise self.error
        if op == 'session': return self.session
        if op == 'models': return self.models
        if op == 'respond': return {'text': self.text, 'ms': 1234}
        if op == 'disconnect': return {'revoked': True}
        return {}


class LiveServer(unittest.TestCase):
    provider = 'chatgpt'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        env = mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': str(Path(self.tmp.name) / 'chatgpt')}); env.start(); self.addCleanup(env.stop)
        p = mock.patch.object(server, 'PROVIDER', self.provider); p.start(); self.addCleanup(p.stop)
        self.bridge = FakeBridge()
        self.provider_obj = server.ChatGPTProvider(self.bridge)
        self.provider_obj.model = 'gpt-a'   # chosen explicitly, as the learner does in the AI 연결 panel
        c = mock.patch.object(server, 'chatgpt', self.provider_obj); c.start(); self.addCleanup(c.stop)
        self.ollama_calls = []
        o = mock.patch.object(server, 'urlopen', lambda *a, **k: self.ollama_calls.append(a) or (_ for _ in ()).throw(OSError('no ollama'))); o.start(); self.addCleanup(o.stop)
        self.httpd = server.LoopbackHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.httpd.shutdown(), self.httpd.server_close()))
        self.port = self.httpd.server_address[1]
        self.base = f'http://127.0.0.1:{self.port}'

    def request(self, path, body=None, headers=None, method=None, good=True):
        h = {'Content-Type': 'application/json', 'Origin': self.base, 'X-CURIVEN-CSRF': server.CSRF_TOKEN} if good and body is not None else {}
        h.update(headers or {})
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode())
        req = Request(self.base + path, data=data, headers=h, method=method)
        try:
            with urlopen(req, timeout=10) as r: return r.status, dict(r.headers), r.read()
        except HTTPError as e: return e.code, dict(e.headers), e.read()

    def jreq(self, *a, **k):
        code, headers, raw = self.request(*a, **k)
        return code, json.loads(raw or b'{}')


class LocalSecurity(LiveServer):
    LESSON = {'mode': 'lesson', 'topic': '쿠키와 세션'}

    def assert_blocked(self, code, raw, expected):
        self.assertEqual(code, expected, raw)
        self.assertEqual([c for c in self.bridge.calls if c[0] == 'respond'], [], 'blocked request never reached ChatGPT')

    def test_bind_address_is_loopback_and_not_configurable(self):
        self.assertEqual(server.HOST, '127.0.0.1')
        src = (ROOT / 'server.py').read_text()
        self.assertIn("LoopbackHTTPServer((HOST, PORT), Handler)", src)
        self.assertNotIn("environ.get('CURIVEN_HOST'", src)

    def test_same_origin_request_succeeds(self):
        self.bridge.text = json.dumps(SAMPLE, ensure_ascii=False)
        code, out = self.jreq('/api/ai', self.LESSON)
        self.assertEqual(code, 200, out); self.assertEqual(out['provider'], 'chatgpt')

    def test_missing_or_foreign_origin_rejected(self):
        for origin in [None, 'http://evil.example', 'null', f'http://127.0.0.1:{self.port + 1}', f'https://127.0.0.1:{self.port}']:
            h = {'Origin': origin} if origin else {'Origin': ''}
            code, _, raw = self.request('/api/ai', self.LESSON, headers=h)
            self.assert_blocked(code, raw, 403)

    def test_cross_site_fetch_metadata_rejected(self):
        for site in ['cross-site', 'same-site']:
            code, _, raw = self.request('/api/ai', self.LESSON, headers={'Sec-Fetch-Site': site})
            self.assert_blocked(code, raw, 403)
        code, _, _ = self.request('/api/status', headers={'Sec-Fetch-Site': 'cross-site'})
        self.assertEqual(code, 403)

    def test_csrf_token_required(self):
        for token in [None, '', 'guess', server.CSRF_TOKEN[:-1]]:
            h = {'X-CURIVEN-CSRF': token} if token is not None else {'X-CURIVEN-CSRF': ''}
            code, _, raw = self.request('/api/ai', self.LESSON, headers=h)
            self.assert_blocked(code, raw, 403)

    def test_non_json_content_type_rejected(self):
        # text/plain and form posts are "simple" cross-site requests that skip CORS preflight.
        for ctype in ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']:
            code, _, raw = self.request('/api/ai', self.LESSON, headers={'Content-Type': ctype})
            self.assert_blocked(code, raw, 415)

    def test_dns_rebinding_host_rejected(self):
        for host in ['evil.example', f'evil.example:{self.port}', f'127.0.0.1.nip.io:{self.port}', '127.0.0.1', f'0.0.0.0:{self.port}']:
            code, _, raw = self.request('/api/ai', self.LESSON, headers={'Host': host})
            self.assert_blocked(code, raw, 421)
            self.assertEqual(self.request('/', headers={'Host': host})[0], 421, 'page with CSRF token not served to foreign host')
            self.assertEqual(self.request('/api/status', headers={'Host': host})[0], 421)

    def test_no_cors_anywhere_and_preflight_refused(self):
        code, headers, _ = self.request('/api/ai', method='OPTIONS', headers={'Origin': 'http://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-curiven-csrf'})
        self.assertEqual(code, 405)
        self.bridge.text = json.dumps(SAMPLE, ensure_ascii=False)
        for path, body in [('/', None), ('/api/status', None), ('/api/ai', self.LESSON), ('/api/ai', None)]:
            _, headers, _ = self.request(path, body, headers={'Origin': 'http://evil.example'} if body is None else None)
            self.assertFalse([k for k in headers if k.lower().startswith('access-control-')], (path, headers))

    def test_security_headers(self):
        _, headers, body = self.request('/')
        self.assertEqual(headers['X-Frame-Options'], 'DENY')
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertIn(f'name="curiven-csrf" content="{server.CSRF_TOKEN}"'.encode(), body)
        _, _, js = self.request('/learning.js')
        self.assertNotIn(server.CSRF_TOKEN.encode(), js)

    def test_chatgpt_actions_protected(self):
        for path in ['/api/chatgpt/connect', '/api/chatgpt/disconnect', '/api/chatgpt/model']:
            code, _, _ = self.request(path, {}, headers={'Origin': 'http://evil.example'})
            self.assertEqual(code, 403)
            code, _, _ = self.request(path, {}, headers={'X-CURIVEN-CSRF': 'nope'})
            self.assertEqual(code, 403)
        self.assertFalse([c for c in self.bridge.calls if c[0] in ('signIn', 'disconnect')], 'no sign-in/disconnect triggered cross-site')

    def test_oversized_and_malformed_bodies(self):
        # The size check runs on the declared length, before any of the body is read (so it is not streamed here).
        import http.client
        for path, limit in (('/api/ai', server.MATERIAL_AI_BODY), ('/api/material', server.MATERIAL_BODY), ('/api/notion/save', server.NOTION_BODY)):
            c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
            c.putrequest('POST', path); c.putheader('Host', f'127.0.0.1:{self.port}'); c.putheader('Origin', self.base); c.putheader('Content-Type', 'application/json')
            c.putheader('X-CURIVEN-CSRF', server.CSRF_TOKEN); c.putheader('Content-Length', str(limit + 1)); c.endheaders()
            r = c.getresponse(); self.assertEqual(r.status, 400, path); c.close()
        code, _, _ = self.request('/api/ai', b'[1,2]')
        self.assertEqual(code, 400)

    def test_status_exposes_no_credentials(self):
        self.bridge.session = {'status': 'connected', 'sharing': True, 'identity': {'email': 'a@b.c'}, 'accessToken': LEAK, 'credentials': {'refreshToken': LEAK}, 'error': {'code': 'x', 'message': 'm', 'token': LEAK}}
        code, _, raw = self.request('/api/status')
        self.assertEqual(code, 200); self.assertNotIn(LEAK.encode(), raw)
        self.assertEqual(set(json.loads(raw)), {'provider', 'online', 'model', 'status', 'sharing', 'account', 'error', 'models', 'modelError', 'needsModel'})

    def test_credentials_dir_must_be_outside_repo(self):
        with mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': str(ROOT / 'secrets')}):
            with self.assertRaises(RuntimeError): chatgpt_bridge.storage_dir()
        with mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': str(ROOT)}):
            with self.assertRaises(RuntimeError): chatgpt_bridge.storage_dir()
        with mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': ''}), mock.patch.object(chatgpt_bridge.test_guard, 'test_mode', lambda: False):
            self.assertEqual(chatgpt_bridge.storage_dir(), Path.home() / '.config' / 'curiven' / 'chatgpt')   # production default (path only; nothing is read)

    def test_no_codex_or_cookie_credentials_referenced(self):
        for f in ['server.py', 'chatgpt_bridge.py', 'chatgpt/bridge.mjs', 'chatgpt/keychain.mjs', 'index.html']:
            src = (ROOT / f).read_text()
            for bad in ['.codex', 'auth.json"', 'chatgpt.com/backend-api', 'document.cookie', '__Secure-next-auth']:
                self.assertNotIn(bad, src, f'{f} references {bad}')


class ChatGPTProviderBehaviour(LiveServer):
    def test_lesson_request_shape_and_validation(self):
        self.bridge.text = json.dumps(SAMPLE, ensure_ascii=False)
        code, out = self.jreq('/api/ai', {'mode': 'lesson', 'topic': '쿠키와 세션', 'profile': {'interests': ['추리소설'], 'depth': 'some'}})
        self.assertEqual(code, 200, out)
        self.assertEqual(out['model'], 'gpt-a'); self.assertEqual(out['ms'], 1234)
        op, args = [c for c in self.bridge.calls if c[0] == 'respond'][0]
        self.assertEqual(set(args), {'model', 'instructions', 'input'}, 'no temperature / max_output_tokens / format')
        self.assertEqual(args['instructions'], server.LESSON_SPEC)
        self.assertIn('관심사·취미: 추리소설', args['input'])
        self.assertEqual(out['data']['concepts'][0]['id'], 'k1')

    def test_feedback_request_validated_strictly(self):
        self.bridge.text = json.dumps({**FEEDBACK, 'explained': [{'id': 'k1', 'quote': '세션 ID를 쿠키로 보내면'}, {'id': 'zzz', 'quote': '서버가 저장소에서 찾아요'}]}, ensure_ascii=False)
        code, out = self.jreq('/api/ai', {'mode': 'feedback', 'lesson': SAMPLE, 'text': '세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.'})
        self.assertEqual(code, 200); self.assertEqual(out['data']['demonstrated'], ['k1'])
        self.assertEqual([c for c in self.bridge.calls if c[0] == 'respond'][0][1]['instructions'], server.FEEDBACK_SPEC)
        for bad in ['```json\n{"summary":"s"}\n``` 추가 설명', '설명: {"summary":"s"}', '{"summary":"s","correct":"문자열"}', '']:
            self.bridge.text = bad
            code, out = self.jreq('/api/ai', {'mode': 'feedback', 'lesson': SAMPLE, 'text': '세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.'})
            self.assertEqual(code, 400, bad); self.assertFalse(out['ok'])

    def test_errors_mapped_and_never_fall_back_to_ollama(self):
        cases = [('subscription_sharing_usage_limit_exceeded', False, 429), ('sign_in_required', False, 401), ('sharing_not_enabled', False, 401),
                 ('subscription_sharing_user_not_eligible', False, 403), ('stream_interrupted', True, 503), ('response_incomplete', True, 503),
                 ('subscription_sharing_unsupported_capability', False, 502), ('storage_encryption_unavailable', True, 403)]
        for code_name, retryable, status in cases:
            self.bridge.error = BridgeError(code_name, 'sdk message', retryable, None, 'req_123')
            code, out = self.jreq('/api/ai', {'mode': 'lesson', 'topic': '쿠키'})
            self.assertEqual(code, status, code_name); self.assertEqual(out['code'], code_name); self.assertFalse(out['ok'])
            self.assertEqual(out['requestId'], 'req_123')
        self.bridge.error = BridgeError('subscription_sharing_usage_limit_exceeded', 'x')
        out = self.jreq('/api/ai', {'mode': 'lesson', 'topic': '쿠키'})[1]
        self.assertEqual(out['usageUrl'], 'https://chatgpt.com/settings/usage'); self.assertIn('chatgpt.com/settings/usage', out['error'])
        self.assertEqual(self.ollama_calls, [], 'ChatGPT failures never silently switch to Ollama')

    def test_status_and_model_discovery(self):
        self.provider_obj.model = None
        code, s = self.jreq('/api/status')
        self.assertEqual((s['online'], s['model'], s['needsModel']), (False, None, True), 'no implicit first-model default')
        code, out = self.jreq('/api/ai', {'mode': 'lesson', 'topic': '쿠키'})
        self.assertEqual((code, out['code']), (502, 'model_not_selected'))
        self.assertEqual([c for c in self.bridge.calls if c[0] == 'respond'], [], 'nothing is sent before a model is chosen')
        self.assertEqual(self.jreq('/api/chatgpt/model', {'model': 'gpt-a'})[0], 200)
        code, s = self.jreq('/api/status')
        self.assertEqual((s['online'], s['model'], s['account']), (True, 'gpt-a', 'learner@example.com'))
        self.assertEqual([m['slug'] for m in s['models']], ['gpt-a', 'gpt-b'])
        code, out = self.jreq('/api/chatgpt/model', {'model': 'gpt-b'})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads((Path(self.tmp.name) / 'settings.json').read_text()), {'chatgptModel': 'gpt-b'})
        self.assertEqual(oct((Path(self.tmp.name) / 'settings.json').stat().st_mode & 0o777), '0o600')
        code, out = self.jreq('/api/chatgpt/model', {'model': 'not-listed'})
        self.assertEqual(code, 400)
        self.assertEqual(self.jreq('/api/status')[1]['model'], 'gpt-b')

    def test_not_ready_states_are_offline(self):
        for session in [{'status': 'disconnected', 'sharing': False}, {'status': 'connected', 'sharing': False}, {'status': 'connecting', 'sharing': False},
                        {'status': 'reauth_required', 'sharing': False, 'error': {'code': 'invalid_id_token', 'message': 'x'}}]:
            self.bridge.session = session; self.provider_obj.models = None
            code, s = self.jreq('/api/status')
            self.assertFalse(s['online'], session)
        self.assertNotIn('models', [c[0] for c in self.bridge.calls], 'models are only discovered after scope-verified sign-in')
        self.assertIn('다시 로그인', s['error']['message'])
        self.bridge.models = []; self.bridge.session = {'status': 'connected', 'sharing': True}
        self.assertFalse(self.jreq('/api/status')[1]['online'], 'no listed model → offline')

    def test_connect_cancel_disconnect(self):
        self.assertEqual(self.jreq('/api/chatgpt/connect', {})[0], 200)
        self.assertEqual(self.jreq('/api/chatgpt/cancel', {})[0], 200)
        code, out = self.jreq('/api/chatgpt/disconnect', {})
        self.assertEqual((code, out['revoked']), (200, True))
        self.assertEqual([c[0] for c in self.bridge.calls], ['signIn', 'cancelSignIn', 'disconnect'])


class OllamaOnlyWhenChosen(LiveServer):
    provider = 'ollama'

    def test_chatgpt_endpoints_off_when_ollama_selected(self):
        self.assertEqual(self.jreq('/api/chatgpt/connect', {})[0], 404)
        self.assertEqual(self.bridge.calls, [])

    def test_default_provider_is_chatgpt(self):
        src = (ROOT / 'server.py').read_text()
        self.assertIn("PROVIDER = os.environ.get('CURIVEN_PROVIDER', 'chatgpt')", src)


class BridgeProcess(unittest.TestCase):
    """chatgpt_bridge.Bridge against a fake child process speaking the same protocol."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        env = mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': self.tmp.name, 'OPENAI_API_KEY': 'sk-should-not-pass', 'OPENAI_BASE_URL': 'http://evil', 'HTTPS_PROXY': 'http://evil', 'NODE_OPTIONS': '--require /tmp/x.js'})
        env.start(); self.addCleanup(env.stop)
        self.b = chatgpt_bridge.Bridge([sys.executable, str(ROOT / 'tests' / 'fake_bridge.py')]); self.addCleanup(self.b.close)

    def test_minimal_environment(self):
        keys = self.b.call('env')
        for k in ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HTTPS_PROXY', 'NODE_OPTIONS']: self.assertNotIn(k, keys)
        self.assertIn('CURIVEN_CHATGPT_DIR', keys)

    def test_concurrent_calls_matched_by_id(self):
        out = {}
        ts = [threading.Thread(target=lambda i=i: out.__setitem__(i, self.b.call('echo', v=i))) for i in range(20)]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(out, {i: i for i in range(20)})

    def test_timeout_crash_and_restart(self):
        with self.assertRaises(BridgeError) as e: self.b.call('sleep', timeout=0.3, s=1)
        self.assertEqual(e.exception.code, 'timeout')
        with self.assertRaises(BridgeError) as e: self.b.call('crash', timeout=5)
        self.assertEqual(e.exception.code, 'bridge_unavailable')
        self.assertEqual(self.b.call('echo', v='again'), 'again', 'bridge restarts on next call')
        with self.assertRaises(BridgeError) as e: self.b.call('nope')
        self.assertEqual(e.exception.code, 'unknown_op')


if __name__ == '__main__':
    unittest.main()
