"""Automated tests can never use the real ChatGPT sign-in or reach the model backend.
Negative tests: each tries a way out and must be refused before any credential file, Keychain, bridge process or
network connection is touched. Run: python3 -m unittest tests.test_chatgpt_isolation"""
import json, os, socket, subprocess, sys, tempfile, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import test_guard, chatgpt_bridge, server

ROOT = Path(__file__).resolve().parent.parent
REAL_STORE, REAL_SDK = chatgpt_bridge.DEFAULT_STORE, chatgpt_bridge.DEFAULT_SDK_DIR


class Credentials(unittest.TestCase):
    def test_default_store_is_temporary_never_the_real_one(self):
        with mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': ''}):
            d = chatgpt_bridge.storage_dir()
        self.assertFalse(test_guard.related(d, test_guard.REAL_CONFIG)); self.assertFalse(test_guard.related(d, REAL_STORE))

    def test_inherited_or_explicit_real_store_is_refused(self):
        for v in (str(REAL_STORE), str(REAL_STORE / 'x'), str(test_guard.REAL_CONFIG), str(test_guard.REAL_CONFIG / 'other'), str(Path.home() / '.config')):
            with mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': v}):
                with self.assertRaises(RuntimeError, msg=v): chatgpt_bridge.storage_dir()

    def test_installed_sdk_is_refused_and_the_default_is_missing(self):
        with mock.patch.dict(os.environ, {'CURIVEN_SIWC_DIR': ''}):
            self.assertEqual(chatgpt_bridge.sdk_dir(), chatgpt_bridge.TEST_NO_SDK); self.assertFalse(chatgpt_bridge.sdk_installed())
        for v in (str(REAL_SDK), str(REAL_SDK / 'packages')):
            with mock.patch.dict(os.environ, {'CURIVEN_SIWC_DIR': v}):
                with self.assertRaises(RuntimeError): chatgpt_bridge.sdk_dir()

    def test_model_choice_never_written_next_to_the_real_store(self):
        f = server.ChatGPTProvider(chatgpt_bridge.Bridge())._settings_file()
        self.assertFalse(test_guard.related(f, test_guard.REAL_CONFIG))


class NoRealBridge(unittest.TestCase):
    def test_real_bridge_never_starts_even_with_an_sdk_present(self):
        with mock.patch.object(chatgpt_bridge, 'sdk_installed', lambda: True), mock.patch.object(chatgpt_bridge.subprocess, 'Popen') as popen:
            for op in ('respond', 'models', 'session', 'signIn', 'disconnect'):
                with self.assertRaises(chatgpt_bridge.BridgeError) as e: chatgpt_bridge.Bridge().call(op, timeout=1, model='m', instructions='i', input='x')
                self.assertEqual(e.exception.code, 'test_mode_blocked')
            popen.assert_not_called()

    def test_the_server_provider_cannot_reach_a_model(self):
        p = server.ChatGPTProvider()            # what a test server builds
        with mock.patch.object(chatgpt_bridge.subprocess, 'Popen') as popen:
            self.assertEqual(p.status()['status'], 'sdk_missing'); self.assertFalse(p.status()['online'])
            p.model = 'gpt-anything'
            with self.assertRaises(chatgpt_bridge.BridgeError) as e: p.respond('system', 'user')
            self.assertIn(e.exception.code, ('sdk_missing', 'test_mode_blocked'))
            popen.assert_not_called()

    def test_bridge_child_is_told_it_is_under_test(self):
        b = chatgpt_bridge.Bridge([sys.executable, str(ROOT / 'tests' / 'fake_bridge.py')]); self.addCleanup(b.close)
        with mock.patch.dict(os.environ, {'CURIVEN_CHATGPT_DIR': tempfile.mkdtemp(), 'OPENAI_API_KEY': 'sk-inherited'}):
            keys = b.call('env')
        self.assertIn('CURIVEN_TEST', keys); self.assertNotIn('OPENAI_API_KEY', keys)


class Network(unittest.TestCase):
    def test_only_loopback(self):
        for host in ('api.openai.com', 'chatgpt.com', 'auth.openai.com', 'ab.chatgpt.com', 'api.notion.com', 'example.com', '1.1.1.1', '2606:4700:4700::1111'):
            with self.assertRaises(OSError, msg=host): socket.getaddrinfo(host, 443)
        for addr in (('1.1.1.1', 443), ('8.8.8.8', 53)):
            s = socket.socket(); self.addCleanup(s.close)
            with self.assertRaises(test_guard.Blocked): s.connect(addr)
        with self.assertRaises(OSError): urlopen('https://api.openai.com/v1/models', timeout=3)
        srv = socket.socket(); srv.bind(('127.0.0.1', 0)); srv.listen(); self.addCleanup(srv.close)
        c = socket.create_connection(('127.0.0.1', srv.getsockname()[1]), timeout=3); c.close()   # loopback still works


class ServerStartup(unittest.TestCase):
    def start(self, env):
        base = {k: v for k, v in os.environ.items() if not k.startswith(('CURIVEN_', 'OPENAI_')) and k != 'NODE_TEST_CONTEXT'}
        ok = {'CURIVEN_TEST': '1', 'CURIVEN_NOTION_DIR': tempfile.mkdtemp(), 'CURIVEN_NOTION_SECRETS': 'memory', 'CURIVEN_NOTION_API': 'http://127.0.0.1:9'}
        return subprocess.run([sys.executable, str(ROOT / 'server.py')], env={**base, 'CURIVEN_PORT': '9', **ok, **env}, capture_output=True, text=True, timeout=20)

    def test_refuses_real_chatgpt_settings(self):
        for env in ({'CURIVEN_CHATGPT_DIR': str(REAL_STORE)}, {'CURIVEN_CHATGPT_DIR': str(test_guard.REAL_CONFIG)}, {'CURIVEN_SIWC_DIR': str(REAL_SDK)}):
            r = self.start(env); self.assertEqual(r.returncode, 78, (env, r.stderr)); self.assertIn('refusing to start', r.stderr)


class MissingMock(unittest.TestCase):
    """A test that forgets to mock /api/ai gets an error from its own server — never a model call."""
    def test_unmocked_ai_requests_fail_safely(self):
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler); threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close())); base = f'http://127.0.0.1:{httpd.server_address[1]}'
        with mock.patch.object(chatgpt_bridge.subprocess, 'Popen') as popen, mock.patch.object(server, 'PROVIDER', 'chatgpt'), \
             mock.patch.object(server, 'chatgpt', server.ChatGPTProvider()):
            server.chatgpt.model = 'gpt-anything'
            for body in ({'mode': 'lesson', 'topic': '쿠키'}, {'mode': 'note', 'title': 't', 'messages': []}):
                req = Request(base + '/api/ai', data=json.dumps(body).encode(), method='POST',
                              headers={'Content-Type': 'application/json', 'Origin': base, 'X-CURIVEN-CSRF': server.CSRF_TOKEN})
                with self.assertRaises(HTTPError) as e: urlopen(req, timeout=10)
                out = json.loads(e.exception.read()); self.assertFalse(out['ok']); self.assertIn(out.get('code'), ('sdk_missing', 'test_mode_blocked'))
            with urlopen(base + '/api/status', timeout=10) as r: st = json.load(r)
            self.assertFalse(st['online'])
            popen.assert_not_called()


if __name__ == '__main__': unittest.main()
