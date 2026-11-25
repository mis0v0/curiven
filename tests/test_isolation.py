"""Tests must never reach personal storage, Keychain or external APIs.
Run: python3 -m unittest tests.test_isolation"""
import os, socket, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
from urllib.request import urlopen
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import notion_link, server

ROOT = Path(__file__).resolve().parent.parent


class Detection(unittest.TestCase):
    def test_unittest_runs_are_test_mode(self):
        self.assertTrue(notion_link.test_mode())

    def test_markers(self):
        for env in ({'CURIVEN_TEST': '1'}, {'NODE_TEST_CONTEXT': 'child-v8'}):
            with mock.patch.dict(os.environ, env): self.assertTrue(notion_link.test_mode())

    def test_isolation_problems(self):
        ok = {'CURIVEN_NOTION_DIR': tempfile.mkdtemp(), 'CURIVEN_NOTION_SECRETS': 'memory', 'CURIVEN_NOTION_API': 'http://127.0.0.1:9'}
        self.assertEqual(notion_link.isolation_problems(ok), [])
        for bad in ({}, {**ok, 'CURIVEN_NOTION_DIR': str(notion_link.REAL_DIR)}, {**ok, 'CURIVEN_NOTION_DIR': str(notion_link.REAL_DIR / 'sub')},
                    {**ok, 'CURIVEN_NOTION_DIR': str(notion_link.REAL_DIR.parent)}, {**ok, 'CURIVEN_NOTION_SECRETS': ''},
                    {**ok, 'CURIVEN_NOTION_API': 'https://api.notion.com'}, {**ok, 'CURIVEN_NOTION_API': 'http://localhost:9'}):
            self.assertTrue(notion_link.isolation_problems(bad), bad)


class ModuleRefusesProduction(unittest.TestCase):
    def test_the_server_module_object_is_isolated(self):
        n = server.NOTION
        self.assertFalse(notion_link._inside_real(n.dir), 'never the real folder')
        self.assertIsInstance(n.store, notion_link.MemoryStore)
        self.assertTrue(n.base == notion_link.BLOCKED_BASE or notion_link._loopback(n.base))

    def test_default_link_is_temporary_memory_and_blocked(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ('CURIVEN_NOTION_DIR', 'CURIVEN_NOTION_SECRETS', 'CURIVEN_NOTION_API'): os.environ.pop(k, None)
            n = notion_link.NotionLink()
        self.assertFalse(notion_link._inside_real(n.dir)); self.assertIsInstance(n.store, notion_link.MemoryStore); self.assertEqual(n.base, notion_link.BLOCKED_BASE)

    def test_explicit_production_settings_are_refused(self):
        with self.assertRaises(RuntimeError): notion_link.NotionLink(directory=notion_link.REAL_DIR)
        with self.assertRaises(RuntimeError): notion_link.NotionLink(directory=tempfile.mkdtemp(), base='https://api.notion.com')
        with self.assertRaises(RuntimeError): notion_link.NotionLink(directory=tempfile.mkdtemp(), store=notion_link.KeychainStore())
        with mock.patch.dict(os.environ, {'CURIVEN_NOTION_DIR': str(notion_link.REAL_DIR)}):
            with self.assertRaises(RuntimeError): notion_link.NotionLink()

    def test_no_request_leaves_even_if_the_base_is_changed_later(self):
        n = notion_link.NotionLink(store=notion_link.MemoryStore()); n.store.token = 'x' * 40
        n.base = 'https://api.notion.com'
        with mock.patch.object(notion_link._notion_http, 'open') as net:
            for call in (lambda: n._call('GET', '/v1/pages/abc'), lambda: n.save('e1', 't', 'md'), lambda: n.connect('y' * 40, '0' * 32)):
                with self.assertRaises(notion_link.NotionError): call()
            net.assert_not_called()

    def test_keychain_is_never_touched(self):
        with mock.patch.object(notion_link.subprocess, 'run') as run:
            for call in (lambda: notion_link.KeychainStore().get(), lambda: notion_link.KeychainStore().set('t' * 40), lambda: notion_link.KeychainStore().delete()):
                with self.assertRaises(notion_link.NotionError): call()
            run.assert_not_called()

    def test_notion_hosts_cannot_be_resolved_in_this_process(self):
        notion_link.NotionLink()   # installs the guard
        for host in ('api.notion.com', 'www.notion.so', 'app.notion.com', 'API.NOTION.COM.'):
            with self.assertRaises(OSError): socket.getaddrinfo(host, 443)
        with self.assertRaises(OSError): urlopen('https://api.notion.com/v1/users/me', timeout=3)
        self.assertTrue(socket.getaddrinfo('127.0.0.1', 80))   # everything else is unaffected


class ServerFailsClosed(unittest.TestCase):
    """server.py started by a test with anything less than full isolation exits before serving."""
    def start(self, env):
        base = {k: v for k, v in os.environ.items() if not k.startswith('CURIVEN_') and k != 'NODE_TEST_CONTEXT'}
        return subprocess.run([sys.executable, str(ROOT / 'server.py')], env={**base, 'CURIVEN_PORT': '9', **env}, capture_output=True, text=True, timeout=20)

    def test_refuses_to_start(self):
        ok = {'CURIVEN_NOTION_DIR': tempfile.mkdtemp(), 'CURIVEN_NOTION_SECRETS': 'memory', 'CURIVEN_NOTION_API': 'http://127.0.0.1:9'}
        for marker in ({'CURIVEN_TEST': '1'}, {'NODE_TEST_CONTEXT': 'child-v8'}):
            for env in ({}, {**ok, 'CURIVEN_NOTION_DIR': str(notion_link.REAL_DIR)}, {**ok, 'CURIVEN_NOTION_SECRETS': 'keychain'}, {**ok, 'CURIVEN_NOTION_API': 'https://api.notion.com'}):
                r = self.start({**marker, **env})
                self.assertEqual(r.returncode, 78, (marker, env, r.stderr)); self.assertIn('refusing to start', r.stderr)


if __name__ == '__main__': unittest.main()
