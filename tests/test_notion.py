"""Personal Notion save (notion_link.py + /api/notion/*) against a FAKE Notion API on 127.0.0.1.
Run: python3 -m unittest tests.test_notion

Everything here is mocked: no request reaches api.notion.com and no real Keychain item is touched (MemoryStore /
a patched `subprocess.run`). These tests show what CURIVEN sends and stores — not that a real workspace accepts it."""
import json, os, stat, sys, tempfile, threading, unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tests'))
import notion_link  # noqa: E402
import server  # noqa: E402
from test_chatgpt import LiveServer  # noqa: E402

TOKEN = 'ntn_' + 'A1b2C3d4' * 6
DEST = '1a2b3c4d5e6f40718293a4b5c6d7e8f9'
DEST_ID = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9'
NOTE = '## 처음 생각\n\n**내 예상:** 질문이 기억을 바꿀 것 같아요\n'


class FakeNotion:
    """Minimal stand-in for the documented endpoints. Records every request (method, path, headers, body)."""
    def __init__(self):
        self.calls, self.pages, self.fail = [], {DEST_ID: {'title': '학습 노트', 'parent': None, 'in_trash': False}}, {}
        self.n = 0; self.before_write = []; self.render = None; fake = self
        class H(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def _send(self, code, obj, headers=None):
                b = json.dumps(obj).encode(); self.send_response(code)   # obj may be any JSON value (e.g. a list)
                for k, v in (headers or {}).items(): self.send_header(k, v)
                self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
            def _handle(self):
                n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n)) if n else None
                fake.calls.append((self.command, self.path, dict(self.headers), body))
                key = f'{self.command} {self.path.split("?")[0]}'
                for pat, resp in list(fake.fail.items()):
                    if (key == pat[:-1]) if pat.endswith('$') else key.startswith(pat):   # 'KEY$' = this exact path only
                        if resp.get('once'): del fake.fail[pat]
                        if resp.get('apply_then_fail'): fake.route(self.command, self.path, body)
                        if resp.get('drop'): self.close_connection = True; return   # no response at all (timeout / reset)
                        if resp.get('cut'):   # a reply cut off mid-body
                            self.send_response(resp['status']); self.send_header('Content-Length', '500'); self.end_headers(); self.wfile.write(b'{"object": "pa'); self.close_connection = True; return
                        if 'raw' in resp:     # an undecodable body
                            self.send_response(resp['status']); self.send_header('Content-Length', str(len(resp['raw']))); self.end_headers(); self.wfile.write(resp['raw']); return
                        return self._send(resp['status'], resp.get('json', {'object': 'error', 'code': 'x', 'message': 'm'}), resp.get('headers'))
                if self.headers.get('Authorization') != 'Bearer ' + TOKEN: return self._send(401, {'object': 'error', 'code': 'unauthorized', 'message': 'API token is invalid.'})
                if self.command != 'GET' and fake.before_write: fake.before_write.pop(0)(self.command, self.path)
                code, obj = fake.route(self.command, self.path, body); self._send(code, obj)
            do_GET = do_POST = do_PATCH = _handle
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
    def page_obj(self, pid):
        p = self.pages[pid]
        return {'object': 'page', 'id': pid, 'url': f'https://www.notion.so/{pid.replace("-", "")}', 'in_trash': p['in_trash'], 'created_time': p.get('created', '2026-01-01T00:00:00.000Z'),
                'parent': {'type': 'page_id', 'page_id': p['parent']} if p['parent'] else {'type': 'workspace'},
                'properties': {'title': {'type': 'title', 'title': [{'plain_text': p['title']}]}}}
    def route(self, method, path, body):
        parts = path.split('?')[0].strip('/').split('/')
        if method == 'GET' and parts[:2] == ['v1', 'pages'] and parts[3:] == ['markdown']:
            if parts[2] not in self.pages: return 404, {'object': 'error', 'code': 'object_not_found'}
            p = self.pages[parts[2]]
            return 200, {'object': 'page_markdown', 'id': parts[2], 'markdown': p.get('markdown', ''), 'truncated': p.get('truncated', False), 'unknown_block_ids': [],
                         **({'warnings': p['warnings']} if p.get('warnings') else {})}
        if method == 'GET' and parts[:2] == ['v1', 'pages']:
            return (200, self.page_obj(parts[2])) if parts[2] in self.pages else (404, {'object': 'error', 'code': 'object_not_found'})
        if method == 'POST' and parts == ['v1', 'pages']:
            self.n += 1; pid = f'00000000-0000-4000-8000-{self.n:012d}'
            self.pages[pid] = {'title': body['properties']['title']['title'][0]['text']['content'], 'parent': body['parent']['page_id'], 'in_trash': False, 'markdown': (self.render or str)(body['markdown']),
                               'created': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
            return 200, self.page_obj(pid)
        if method == 'PATCH' and parts[:2] == ['v1', 'pages'] and len(parts) == 3:
            self.pages[parts[2]]['title'] = body['properties']['title']['title'][0]['text']['content']; return 200, self.page_obj(parts[2])
        if method == 'PATCH' and parts[:2] == ['v1', 'pages'] and parts[3:] == ['markdown']:
            # Notion re-renders what it stores; the fake adds a trailing newline to show the fingerprint uses Notion's version.
            self.pages[parts[2]]['markdown'] = body['replace_content']['new_str'] + '\n'
            return 200, {'object': 'page_markdown', 'id': parts[2], 'markdown': self.pages[parts[2]]['markdown'], 'truncated': False, 'unknown_block_ids': []}
        if method == 'POST' and parts == ['v1', 'search']:
            return 200, {'results': [self.page_obj(k) for k, v in self.pages.items() if body['query'] in v['title'] and not v['in_trash']]}
        return 400, {'object': 'error', 'code': 'validation_error', 'message': 'unknown'}
    def writes(self, method=None, path=None):   # PATCH and search routes stay so that any such request would be visible
        return [c for c in self.calls if c[0] != 'GET' and (method is None or c[0] == method) and (path is None or c[1] == path)]
    def close(self): self.httpd.shutdown(); self.httpd.server_close()


def snapshot(fake): return json.dumps(fake.pages, sort_keys=True, ensure_ascii=False)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.fake = FakeNotion(); self.addCleanup(self.fake.close)
        self.sleeps = []
        self.link = notion_link.NotionLink(directory=Path(self.tmp.name) / 'notion', store=notion_link.MemoryStore(), base=self.fake.base, sleep=self.sleeps.append)
    def connect(self):
        return self.link.connect(TOKEN, f'https://www.notion.so/myspace/Cafe-{DEST}?pvs=4')
    def files_text(self):
        d = Path(self.tmp.name) / 'notion'
        return ''.join(p.read_text() for p in d.rglob('*') if p.is_file()) if d.exists() else ''   # ledger, settings, journal, locks


class PageIds(unittest.TestCase):
    def test_links_and_ids(self):
        for v in (f'https://www.notion.so/Cafe-{DEST}', f'https://www.notion.so/ws/My-Notes-{DEST}?pvs=4#abc', DEST, DEST_ID, f'notion.so/{DEST_ID}'):
            self.assertEqual(notion_link.page_id_from(v), DEST_ID, v)
        for bad in ('', 'https://www.notion.so/no-id-here', 'abc123'):
            with self.assertRaises(notion_link.NotionError): notion_link.page_id_from(bad)

    def test_api_override_is_loopback_only(self):
        for v in ('https://evil.example', 'http://localhost:1', 'http://10.0.0.1:80'):
            with mock.patch.dict(os.environ, {'CURIVEN_NOTION_API': v}):
                with self.assertRaises(RuntimeError): notion_link.api_base()
        with mock.patch.dict(os.environ, {'CURIVEN_NOTION_API': ''}):
            self.assertEqual(notion_link.api_base(), notion_link.BLOCKED_BASE, 'tests never get the real API by default')
            with mock.patch.object(notion_link, 'test_mode', lambda: False): self.assertEqual(notion_link.api_base(), 'https://api.notion.com')


class Connection(Base):
    def test_connect_verifies_the_page_before_storing_anything(self):
        with self.assertRaises(notion_link.NotionError) as e: self.link.connect('ntn_' + 'x' * 40, DEST)
        self.assertEqual(e.exception.status, 401); self.assertIsNone(self.link.store.get()); self.assertFalse(self.link.status()['connected'])
        with self.assertRaises(notion_link.NotionError) as e: self.link.connect(TOKEN, '9' * 32)
        self.assertEqual(e.exception.status, 404); self.assertIn('연결 추가', e.exception.message); self.assertIsNone(self.link.store.get())
        st = self.connect()
        self.assertEqual(st, {'available': True, 'connected': True, 'page': {'id': DEST_ID, 'title': '학습 노트', 'url': f'https://www.notion.so/{DEST}'}, 'autoSave': False})

    def test_headers_and_version(self):
        self.connect(); _, path, h, _ = self.fake.calls[-1]
        self.assertEqual(path, f'/v1/pages/{DEST_ID}'); self.assertEqual(h['Authorization'], 'Bearer ' + TOKEN); self.assertEqual(h['Notion-Version'], '2026-03-11')

    def test_token_never_in_status_files_or_errors(self):
        self.connect(); self.link.set_auto(True); self.link.save('mem', '기억', NOTE); self.link.test()
        self.assertNotIn(TOKEN, json.dumps(self.link.status())); self.assertNotIn(TOKEN, self.files_text())
        d = Path(self.tmp.name) / 'notion'
        self.assertEqual(stat.S_IMODE(d.stat().st_mode), 0o700)
        for f in d.rglob('*'): self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o700 if f.is_dir() else 0o600, f)
        self.fake.fail['POST /v1/pages'] = {'status': 400, 'json': {'object': 'error', 'code': 'validation_error', 'message': 'bad'}}
        for eid in ('mem', 'other'):
            with self.assertRaises(notion_link.NotionError) as e: self.link.save(eid, '기억', NOTE)
            self.assertNotIn(TOKEN, e.exception.message)

    def test_disconnect_forgets_token_keeps_page_mapping(self):
        self.connect(); self.link.save('mem', '기억', NOTE); self.link.set_auto(True)
        st = self.link.disconnect()
        self.assertEqual(st, {'available': True, 'connected': False, 'page': None, 'autoSave': False}); self.assertIsNone(self.link.store.get())
        self.assertIn('mem', self.link.mapping())
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('mem', '기억', NOTE)
        self.assertEqual(e.exception.code, 'not_connected')


class Publishing(Base):
    """Normal publishing, separate from the failure cases: one page per exploration, later versions only as new pages."""
    def setUp(self): super().setUp(); self.connect()

    def test_first_save_creates_one_page_with_a_verified_baseline(self):
        r = self.link.save('mem', '합성 노트 제목', NOTE, content_key='k1'); self.assertEqual(r['action'], 'created')
        post = self.fake.writes('POST', '/v1/pages')[0][3]
        self.assertEqual(post['parent'], {'type': 'page_id', 'page_id': DEST_ID}); self.assertEqual(post['markdown'], NOTE); self.assertNotIn('children', post)
        m = self.link.mapping()['mem']
        self.assertEqual((m['baseline'], m['remoteHash'], m['contentKey']), ('verified', notion_link.fingerprint(NOTE), 'k1'))
        self.assertEqual(self.link.entry('mem'), {'url': m['url'], 'savedAt': m['savedAt'], 'contentKey': 'k1'})
        self.assertEqual([c[0] for c in self.fake.calls[-2:]], ['POST', 'GET'], 'create, then one read')
        self.assertEqual(self.link.check('mem')['remote']['state'], 'same')
        self.assertEqual(self.link.save('other', '별', NOTE)['action'], 'created'); self.assertEqual(len(self.fake.writes('POST', '/v1/pages')), 2)

    def test_a_later_version_is_a_confirmed_new_page_and_the_old_page_is_untouched(self):
        self.link.save('mem', '기억', NOTE); a = self.link.mapping()['mem']; before = snapshot(self.fake)
        r = self.link.save('mem', '기억 2', NOTE + '더\n', mode='new', confirm=True); self.assertEqual(r['action'], 'new')
        m = self.link.mapping()['mem']; self.assertNotEqual(m['pageId'], a['pageId'])
        self.assertEqual(m['previous'], [{'pageId': a['pageId'], 'url': a['url'], 'title': '기억', 'savedAt': a['savedAt']}])
        self.assertEqual(json.loads(before)[a['pageId']], self.fake.pages[a['pageId']], 'page A not modified')
        self.assertEqual([c[0] for c in self.fake.calls if c[0] != 'GET'][-1:], ['POST'])

    def test_fingerprint_contract(self):
        f = notion_link.fingerprint
        self.assertEqual(f('a\n  b\n'), f('a\r\n  b\n\n\n'), 'only CRLF and final newlines are normalized')
        for a, b in (('a\n  b', 'a\n b'), ('a\n\nb', 'a\nb'), ('a  \nb', 'a\nb'), ('- x\n  - y', '- x\n- y'), ('```\n    x\n```', '```\nx\n```')):
            self.assertNotEqual(f(a), f(b), (a, b))
        self.assertTrue(f('x').startswith('v2:'))


class ExistingPagesAreNeverWritten(Base):
    """Phase A (review of 94d3a87): nothing writes into a page that exists — update, auto-save (the same request), retry,
    overwrite or a stale client. Refused at notion_link.save(), before any request to Notion."""
    def setUp(self):
        super().setUp(); self.connect(); self.link.save('mem', '기억', NOTE, content_key='k1')
        self.pid = self.link.mapping()['mem']['pageId']; self.fake.calls.clear(); self.map = self.link.mapping(); self.snap = snapshot(self.fake)
    def untouched(self):
        self.assertEqual(self.fake.calls, [], 'no request at all'); self.assertEqual(snapshot(self.fake), self.snap); self.assertEqual(self.link.mapping(), self.map)
    def refused(self, code, *a, **kw):
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('mem', '기억', *a, **kw)
        self.assertEqual(e.exception.code, code); return e.exception

    def test_update_auto_save_and_retry_are_refused_before_any_request(self):
        for md, kw in ((NOTE, {}), (NOTE + '바뀐 노트\n', {'content_key': 'k2'}), (NOTE, {'mode': 'update', 'confirm': True})):
            e = self.refused('update_disabled', md, **kw); self.assertEqual(e.status, 409); self.assertIn('원래 페이지는 그대로예요', e.message)
        self.untouched()

    def test_overwrite_is_refused(self):
        for kw in ({}, {'confirm': True}): self.refused('overwrite_disabled', NOTE, mode='overwrite', **kw)
        self.untouched()

    def test_external_edits_survive(self):
        """The edits the earlier design could lose (after the final GET; before the baseline read) are never touched."""
        self.fake.pages[self.pid]['markdown'] += '\n외부 메모\n'; self.snap = snapshot(self.fake)
        self.refused('update_disabled', NOTE + 'x\n'); self.untouched()

    def test_edit_before_the_baseline_read_is_not_taken_as_curivens(self):
        orig = self.fake.route
        def route(m, p, b):
            code, obj = orig(m, p, b)
            if m == 'POST' and p == '/v1/pages': self.fake.pages[obj['id']]['markdown'] += '\n생성 직후 외부 메모\n'
            return code, obj
        self.fake.route = route; self.link.save('race', '경쟁', NOTE); self.fake.route = orig
        m = self.link.mapping()['race']; self.assertEqual(m['baseline'], 'unverified'); self.assertNotIn('remoteHash', m)
        self.assertEqual(self.link.check('race')['remote']['state'], 'unknown', 'no baseline to compare with')
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('race', '경쟁', NOTE)
        self.assertEqual(e.exception.code, 'update_disabled'); self.assertIn('생성 직후 외부 메모', self.fake.pages[m['pageId']]['markdown'])

    def test_legacy_mappings_are_refused_too(self):
        for legacy in ({'pageId': self.pid, 'url': 'https://www.notion.so/x', 'savedAt': 't'}, {**self.map['mem'], 'remoteHash': 'a' * 64}):
            self.link._write_json('notion-pages.json', {'mem': legacy}); self.map = self.link.mapping()
            self.refused('update_disabled', NOTE); self.untouched()

    def test_archived_mapping_is_still_reported_without_a_request(self):
        self.link._write_json('notion-pages.json', {'mem': {**self.map['mem'], 'archivedAt': 't', 'archivedBy': 'notion-trash'}}); self.map = self.link.mapping()
        self.refused('archived', NOTE); self.untouched()

    def test_a_new_page_needs_confirmation(self):
        self.refused('confirm_required', NOTE, mode='new'); self.refused('confirm_required', NOTE, mode='new', confirm='true'); self.untouched()


class CreationIdentity(Base):
    """Phase B: a create is trusted only when its answer clearly names a new page under the destination; anything else
    is unresolved, kept on record, and never retried, searched, adopted or re-created without the learner."""
    def setUp(self):
        super().setUp(); self.connect(); self.fake.calls.clear()
    def code(self, *a, **kw):
        with self.assertRaises(notion_link.NotionError) as e: self.link.save(*a, **kw)
        return e.exception.code
    def creates(self): return [c for c in self.fake.calls if c[0] == 'POST' and c[1] == '/v1/pages']
    def nothing_more(self, eid='mem'):
        """Repeated actions after an unresolved create: no request at all, and the record stays as it is."""
        self.fake.calls.clear(); before = self.link.mapping()
        for kw in ({}, {'content_key': 'x'}): self.assertEqual(self.code(eid, '기억', NOTE, **kw), 'unconfirmed')
        self.assertEqual(self.code(eid, '기억', NOTE, mode='new'), 'confirm_required')
        for call in (self.link.check, self.link.reconnect):
            with self.assertRaises(notion_link.NotionError) as e: call(eid)
            self.assertEqual(e.exception.code, 'no_page')
        self.assertEqual(self.fake.calls, []); self.assertEqual(self.link.mapping(), before)
        self.assertEqual(self.link.entry(eid), {'unconfirmed': True, 'at': before[eid]['at']})
    def answer_post(self, change):
        """Replace the fake's answer to the create (each call wraps the ORIGINAL route, never a previous wrapper)."""
        orig = self.__dict__.setdefault('_orig_route', self.fake.route)
        def route(m, p, b):
            code, obj = orig(m, p, b)
            return (code, change(obj)) if m == 'POST' and p == '/v1/pages' else (code, obj)
        self.fake.route = route; self.addCleanup(setattr, self.fake, 'route', orig)

    def test_pending_record_is_written_before_the_request(self):
        seen = []
        self.fake.before_write.append(lambda m, p: seen.append(json.loads((self.link.dir / 'notion-pages.json').read_text())))
        self.link.save('mem', '기억', NOTE)
        self.assertEqual(seen[0]['mem']['unconfirmed'], True); self.assertEqual(seen[0]['mem']['reason'], 'sending')
        self.assertNotIn('unconfirmed', self.link.mapping()['mem'])

    def test_crash_after_sending_leaves_the_create_unresolved(self):
        real = self.link._call
        def call(method, path, *a, **k):
            out = real(method, path, *a, **k)
            if method == 'POST': raise RuntimeError('process died here')
            return out
        with mock.patch.object(self.link, '_call', call):
            with self.assertRaises(RuntimeError): self.link.save('mem', '기억', NOTE)
        self.assertEqual(self.link.mapping()['mem']['reason'], 'sending'); self.nothing_more(); self.assertEqual(len(self.fake.pages), 2)

    def test_create_succeeds_then_the_read_fails_no_duplicate(self):
        for i, fail in enumerate(({'status': 429, 'headers': {'Retry-After': '30'}}, {'status': 502}, {'status': 404}, {'drop': True}, {'status': 200, 'raw': b'not json'})):
            eid = f'e{i}'; self.fake.fail['GET /v1/pages/'] = fail
            r = self.link.save(eid, f'노트 {i}', NOTE); self.assertEqual(r['action'], 'created', fail)
            del self.fake.fail['GET /v1/pages/']
            m = self.link.mapping()[eid]; self.assertEqual(m['baseline'], 'unknown'); self.assertNotIn('remoteHash', m)
            with self.assertRaises(notion_link.NotionError) as e: self.link.save(eid, f'노트 {i}', NOTE)
            self.assertEqual(e.exception.code, 'update_disabled')
        self.assertEqual(len(self.creates()), 5, 'one page per exploration')

    def test_lost_responses_are_unresolved(self):
        for i, fail in enumerate(({'drop': True, 'apply_then_fail': True}, {'drop': True}, {'status': 502, 'apply_then_fail': True}, {'status': 503},
                                  {'status': 200, 'raw': b'{"object": "page", "id": ', 'apply_then_fail': True}, {'status': 200, 'cut': True, 'apply_then_fail': True},
                                  {'status': 409, 'json': {'object': 'error', 'code': 'conflict_error', 'message': 'm'}})):
            eid = f'e{i}'; self.fake.fail['POST /v1/pages'] = {**fail, 'once': True}; self.fake.calls.clear()
            self.assertEqual(self.code(eid, '기억', NOTE), 'unconfirmed', fail); self.assertEqual(len(self.creates()), 1, 'sent once, not retried')
            self.assertNotIn('pageId', self.link.mapping()[eid]); self.nothing_more(eid)

    def test_malformed_successful_answers_are_unresolved(self):
        for i, change in enumerate((lambda o: [o], lambda o: {k: v for k, v in o.items() if k != 'id'}, lambda o: {**o, 'id': 'not-an-id'},
                                    lambda o: {**o, 'object': 'database'}, lambda o: {k: v for k, v in o.items() if k != 'in_trash'},
                                    lambda o: {**o, 'in_trash': 'false'}, lambda o: {**o, 'in_trash': True}, lambda o: {**o, 'archived': True},
                                    lambda o: {k: v for k, v in o.items() if k != 'parent'})):
            self.answer_post(change); eid = f'm{i}'
            self.assertEqual(self.code(eid, '기억', NOTE), 'unconfirmed', i); self.assertNotIn('pageId', self.link.mapping()[eid]); self.nothing_more(eid)

    def test_wrong_parent_and_duplicate_id_are_unresolved_and_map_nothing(self):
        self.link.save('a', 'A', NOTE); a = self.link.mapping()['a']; before_a = dict(a)
        self.answer_post(lambda o: {**o, 'parent': {'type': 'page_id', 'page_id': '11111111-1111-4111-8111-111111111111'}})
        self.assertEqual(self.code('b', 'B', NOTE), 'unconfirmed'); m = self.link.mapping()['b']
        self.assertEqual((m['reason'], m['reportedPageId']), ('wrong_parent', '00000000-0000-4000-8000-000000000002')); self.assertNotIn('pageId', m)
        self.answer_post(lambda o: {**o, 'id': a['pageId']})
        self.assertEqual(self.code('c', 'C', NOTE), 'unconfirmed'); self.assertEqual(self.link.mapping()['c']['reason'], 'duplicate_id')
        self.assertEqual(self.link.mapping()['a'], before_a, "the other exploration's mapping is untouched")
        self.answer_post(lambda o: {**o, 'id': '00000000-0000-4000-8000-000000000002'})   # the id reported by the wrong-parent answer
        self.assertEqual(self.code('d', 'D', NOTE), 'unconfirmed'); self.assertEqual(self.link.mapping()['d']['reason'], 'duplicate_id')

    def test_definite_refusals_restore_the_previous_record_exactly(self):
        self.link.save('mem', '기억', NOTE); before = self.link.mapping()
        for status, code in ((400, 'validation_error'), (401, 'unauthorized'), (403, 'restricted_resource'), (404, 'object_not_found')):
            self.fake.fail['POST /v1/pages'] = {'status': status, 'once': True, 'json': {'object': 'error', 'code': code, 'message': 'm'}}
            with self.assertRaises(notion_link.NotionError) as e: self.link.save('mem', '기억', NOTE, mode='new', confirm=True)
            self.assertEqual(e.exception.status, status); self.assertEqual(self.link.mapping(), before, status)
            self.fake.fail['POST /v1/pages'] = {'status': status, 'once': True, 'json': {'object': 'error', 'code': code, 'message': 'm'}}
            with self.assertRaises(notion_link.NotionError): self.link.save('fresh', '새', NOTE)
            self.assertNotIn('fresh', self.link.mapping(), 'a first save that Notion refused leaves no record')
        self.fake.fail['POST /v1/pages'] = {'status': 429, 'headers': {'Retry-After': '30'}}
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('fresh', '새', NOTE)
        self.assertEqual(e.exception.code, 'rate_limited'); self.assertNotIn('fresh', self.link.mapping())
        self.fake.fail['POST /v1/pages'] = {'status': 429, 'once': True, 'headers': {'Retry-After': '1'}}
        self.assertEqual(self.link.save('fresh', '새', NOTE)['action'], 'created'); self.assertEqual(self.sleeps, [1], 'a rate-limited request was not processed: sent once more')

    def test_no_search_and_no_adoption_of_plausible_pages(self):
        later = notion_link._now().replace('+00:00', 'Z')
        self.fake.fail['POST /v1/pages'] = {'status': 502, 'once': True}
        self.assertEqual(self.code('mem', '같은 제목', NOTE), 'unconfirmed')
        for n in (1, 2): self.fake.pages[f'99999999-0000-4000-8000-00000000000{n}'] = {'title': '같은 제목', 'parent': DEST_ID, 'in_trash': False, 'markdown': NOTE, 'created': later}
        snap = snapshot(self.fake); self.nothing_more()
        self.link._write_json('notion-pages.json', {**self.link.mapping()})   # nothing else changes either
        del self.fake.pages['99999999-0000-4000-8000-000000000002']; self.nothing_more()   # even a single perfect match
        self.assertFalse([c for c in self.fake.calls if c[1] == '/v1/search'])
        self.assertEqual(json.loads(snap)['99999999-0000-4000-8000-000000000001'], self.fake.pages['99999999-0000-4000-8000-000000000001'])

    def test_explicit_new_page_after_an_unresolved_create_keeps_every_identity(self):
        self.link.save('mem', '기억', NOTE); a = self.link.mapping()['mem']['pageId']
        self.fake.fail['POST /v1/pages'] = {'drop': True, 'apply_then_fail': True, 'once': True}
        self.assertEqual(self.code('mem', '기억 2', NOTE, mode='new', confirm=True), 'unconfirmed')
        m = self.link.mapping()['mem']; self.assertEqual([p['pageId'] for p in m['previous']], [a], 'page A is not forgotten')
        self.nothing_more()
        r = self.link.save('mem', '기억 3', NOTE, mode='new', confirm=True); self.assertEqual(r['action'], 'new')
        m = self.link.mapping()['mem']
        self.assertEqual([p['pageId'] for p in m['previous']], [a]); self.assertEqual([u['title'] for u in m['unresolved']], ['기억 2'])
        self.assertEqual(m['unresolved'][0]['reason'], 'network')
        self.assertEqual(len([p for p in self.fake.pages.values() if p['title'].startswith('기억')]), 3, 'A, the unresolved one, and the confirmed one')

    def test_legacy_unconfirmed_record_is_honoured(self):
        self.link._write_json('notion-pages.json', {'mem': {'unconfirmed': True, 'at': '2026-11-23T00:00:00+00:00'}}); self.nothing_more()

    def test_concurrent_saves_of_one_exploration(self):
        gate = threading.Event(); self.fake.before_write.append(lambda m, p: gate.wait(5))
        out = []
        def run():
            try: out.append(self.link.save('mem', '기억', NOTE)['action'])
            except notion_link.NotionError as e: out.append(e.code)
        t1 = threading.Thread(target=run); t1.start()
        for _ in range(100):
            if self.creates(): break
            threading.Event().wait(0.02)
        t2 = threading.Thread(target=run); t2.start(); t2.join(5)
        with self.assertRaises(notion_link.NotionError) as e: self.link.check('mem')
        self.assertEqual(e.exception.code, 'busy')
        gate.set(); t1.join(5)
        self.assertEqual(sorted(out), ['busy', 'created']); self.assertEqual(len(self.creates()), 1)
        self.assertEqual(self.code('mem', '기억', NOTE), 'update_disabled')


class MarkdownValidation(Base):
    """Phase C: only a well-formed, complete, lossless answer about THIS page that equals what was sent becomes a baseline."""
    def setUp(self): super().setUp(); self.connect()
    def baseline_with(self, change, eid):
        orig = self.fake.route
        def route(m, p, b):
            code, obj = orig(m, p, b)
            return (code, change(obj)) if m == 'GET' and p.split('?')[0].endswith('/markdown') else (code, obj)
        self.fake.route = route
        try: self.link.save(eid, '노트', NOTE); return self.link.mapping()[eid], self.link.check(eid)['remote']['state']
        finally: self.fake.route = orig

    def test_invalid_answers_never_become_a_baseline(self):
        for i, change in enumerate((lambda o: {**o, 'truncated': True}, lambda o: {**o, 'truncated': None}, lambda o: {k: v for k, v in o.items() if k != 'truncated'},
                                    lambda o: {**o, 'truncated': 'false'}, lambda o: {**o, 'unknown_block_ids': ['b1']}, lambda o: {**o, 'unknown_block_ids': None},
                                    lambda o: {**o, 'unknown_block_ids': 'x'}, lambda o: {**o, 'object': 'page'}, lambda o: {**o, 'id': DEST_ID},
                                    lambda o: {**o, 'warnings': [{'code': 'unsupported_tag', 'message': 'm'}]}, lambda o: {**o, 'markdown': None},
                                    lambda o: {**o, 'markdown': o['markdown'] + '<unknown url="https://x" alt="embed"/>'})):
            m, state = self.baseline_with(change, f'v{i}')
            self.assertEqual(m['baseline'], 'unknown', i); self.assertNotIn('remoteHash', m); self.assertEqual(state, 'unreadable', i)

    def test_lossy_or_rewritten_content_is_unverified(self):
        self.fake.render = lambda md: md.replace('**', '__')                  # Notion re-renders: not provably what we sent
        self.link.save('mem', '노트', NOTE); m = self.link.mapping()['mem']
        self.assertEqual(m['baseline'], 'unverified'); self.assertNotIn('remoteHash', m); self.assertEqual(self.link.check('mem')['remote']['state'], 'unknown')
        self.fake.render = lambda md: md.replace('\n', '\r\n') + '\n\n'         # the documented normalization only
        self.link.save('ok', '노트', NOTE); self.assertEqual(self.link.mapping()['ok']['baseline'], 'verified')
        self.fake.render = lambda md: '  ' + md                                 # indentation is content
        self.link.save('ind', '노트', NOTE); self.assertEqual(self.link.mapping()['ind']['baseline'], 'unverified')


class ArchivedPages(Base):
    """Trashed, deleted or inaccessible pages: found by the read-only check or reconnect; never written, never recreated."""
    def setUp(self):
        super().setUp(); self.connect(); self.link.save('mem', '기억', NOTE, content_key='k1')
        self.pid = self.link.mapping()['mem']['pageId']; self.fake.calls.clear()
    def writes(self): return [c for c in self.fake.calls if c[0] in ('POST', 'PATCH')]
    def check_code(self):
        with self.assertRaises(notion_link.NotionError) as e: self.link.check('mem')
        return e.exception.code
    def patch_page_obj(self, change):
        orig = self.fake.page_obj; self.fake.page_obj = lambda p: change(orig(p), p); self.addCleanup(setattr, self.fake, 'page_obj', orig)

    def test_trash_found_by_check_is_marked_and_then_refused_without_requests(self):
        before = dict(self.link.mapping()['mem']); self.fake.pages[self.pid]['in_trash'] = True
        self.assertEqual(self.check_code(), 'archived'); m = self.link.mapping()['mem']
        self.assertEqual(m['archivedBy'], 'notion-trash'); self.assertEqual({k: v for k, v in m.items() if k not in ('archivedAt', 'archivedBy')}, before)
        self.assertTrue(self.link.entry('mem')['archived']); self.fake.calls.clear()
        self.assertEqual(self.check_code(), 'archived')
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('mem', '기억', NOTE)
        self.assertEqual(e.exception.code, 'archived'); self.assertEqual(self.fake.calls, [])

    def test_api_archived_flag_counts_as_trash(self):
        self.patch_page_obj(lambda o, p: {**{k: v for k, v in o.items() if k != 'in_trash'}, 'archived': True})
        self.assertEqual(self.check_code(), 'archived')

    def test_deleted_or_inaccessible_is_not_marked(self):
        for status in (404, 403):
            self.fake.fail[f'GET /v1/pages/{self.pid}'] = {'status': status, 'json': {'object': 'error', 'code': 'x', 'message': 'm'}}; before = self.link.mapping()
            self.assertEqual(self.check_code(), 'unavailable'); self.assertEqual(self.link.mapping(), before)
            with self.assertRaises(notion_link.NotionError) as e: self.link.reconnect('mem')
            self.assertEqual(e.exception.code, 'unavailable'); del self.fake.fail[f'GET /v1/pages/{self.pid}']
        self.assertEqual(self.writes(), [])

    def test_malformed_lifecycle_or_other_page_is_uncertainty(self):
        before = self.link.mapping()
        for change in (lambda o, p: {**o, 'in_trash': 'false'}, lambda o, p: {**o, 'in_trash': None}, lambda o, p: {k: v for k, v in o.items() if k != 'in_trash'},
                       lambda o, p: {**o, 'object': 'database'}, lambda o, p: {**o, 'id': '00000000-0000-4000-8000-00000000abcd'}):
            self.patch_page_obj(change)
            self.assertEqual(self.check_code(), 'unexpected_response')
            with self.assertRaises(notion_link.NotionError) as e: self.link.reconnect('mem')
            self.assertEqual(e.exception.code, 'unexpected_response')
        self.assertEqual(self.link.mapping(), before); self.assertEqual(self.writes(), [])

    def test_restored_page_reconnects_read_only_and_updates_stay_off(self):
        self.fake.pages[self.pid]['in_trash'] = True; self.check_code(); self.fake.calls.clear()
        with self.assertRaises(notion_link.NotionError) as e: self.link.reconnect('mem')
        self.assertEqual(e.exception.code, 'archived')
        self.fake.pages[self.pid]['in_trash'] = False; out = self.link.reconnect('mem')
        self.assertFalse(out['saved'].get('archived')); self.assertTrue(self.link.mapping()['mem']['restoredAt']); self.assertEqual(self.writes(), [])
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('mem', '기억', NOTE + 'x\n')
        self.assertEqual(e.exception.code, 'update_disabled')

    def test_new_page_from_an_archived_note_keeps_history(self):
        self.fake.pages[self.pid]['in_trash'] = True; self.check_code(); old = dict(self.link.mapping()['mem'])
        with self.assertRaises(notion_link.NotionError) as e: self.link.save('mem', '기억', NOTE, mode='new')
        self.assertEqual(e.exception.code, 'confirm_required')
        self.assertEqual(self.link.save('mem', '기억', NOTE, mode='new', confirm=True)['action'], 'new')
        m = self.link.mapping()['mem']; self.assertNotIn('archivedAt', m)
        self.assertEqual(m['previous'], [{'pageId': self.pid, 'url': old['url'], 'title': '기억', 'savedAt': old['savedAt'], 'archivedAt': old['archivedAt'], 'archivedBy': 'notion-trash'}])
        self.assertTrue(self.fake.pages[self.pid]['in_trash'], 'the trashed page is left alone')

    def test_check_reports_changes_read_only(self):
        self.assertEqual(self.link.check('mem')['remote']['state'], 'same')
        self.fake.pages[self.pid]['markdown'] += '\n메모\n'; r = self.link.check('mem')['remote']
        self.assertEqual(r['state'], 'changed'); self.assertIn('메모', r['markdown']); self.assertNotIn('fingerprint', r)
        self.fake.pages[self.pid]['markdown'] = '가' * (notion_link.NotionLink.PREVIEW + 3); r = self.link.check('mem')['remote']
        self.assertEqual((r['clipped'], len(r['markdown'])), (True, notion_link.NotionLink.PREVIEW))
        self.assertEqual(self.writes(), [])
        with self.assertRaises(notion_link.NotionError) as e: self.link.check('nothing')
        self.assertEqual(e.exception.code, 'no_page')


class KeychainArgs(unittest.TestCase):
    def test_token_goes_through_stdin_never_argv(self):
        seen = []
        def run(args, input=None, **k):
            seen.append((args, input))
            if args[1] == 'find-generic-password': return mock.Mock(returncode=0, stdout=(TOKEN + '\n').encode())
            return mock.Mock(returncode=0, stdout=b'')
        # Production behaviour with `security` mocked (in test mode the Keychain is refused outright: tests/test_isolation.py).
        with mock.patch.object(notion_link, 'test_mode', lambda: False), mock.patch.object(notion_link.subprocess, 'run', run): notion_link.KeychainStore().set(TOKEN)
        add = seen[0]; self.assertEqual(add[0], ['/usr/bin/security', '-i']); self.assertIn(TOKEN.encode(), add[1])
        self.assertFalse(any(TOKEN in ' '.join(a) for a, _ in seen), 'token never in process arguments')
        with self.assertRaises(notion_link.NotionError): notion_link.KeychainStore().set('ntn_x y; rm -rf ~')


class NotionOverHttp(LiveServer):
    def setUp(self):
        super().setUp()
        self.fake = FakeNotion(); self.addCleanup(self.fake.close)
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        link = notion_link.NotionLink(directory=d.name, store=notion_link.MemoryStore(), base=self.fake.base, sleep=lambda s: None)
        p = mock.patch.object(server, 'NOTION', link); p.start(); self.addCleanup(p.stop)

    def test_endpoints_need_csrf_and_never_echo_the_token(self):
        code, _, _ = self.request('/api/notion/connect', {'token': TOKEN, 'page': DEST}, good=False, headers={'Content-Type': 'application/json', 'Origin': self.base})
        self.assertEqual(code, 403); self.assertEqual(self.fake.calls, [], 'nothing sent without the CSRF token')
        code, out = self.jreq('/api/notion/connect', {'token': TOKEN, 'page': DEST}); self.assertEqual(code, 200, out); self.assertTrue(out['connected'])
        code, out2 = self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE}); self.assertEqual(code, 200, out2)
        code, out3 = self.jreq('/api/notion/entry', {'explorationId': 'mem'}); self.assertEqual(out3['saved']['url'], out2['url'])
        code, _, raw = self.request('/api/notion/status')
        for body in (json.dumps(out), json.dumps(out2), raw.decode()): self.assertNotIn(TOKEN, body)
        code, out = self.jreq('/api/notion/connect', {'token': 'bad token', 'page': DEST}); self.assertEqual(code, 400); self.assertNotIn('bad token', json.dumps(out))

    def test_direct_and_stale_client_requests_cannot_write_into_a_saved_page(self):
        """What an old browser tab, auto-save, or a hand-made request could send. None reaches Notion."""
        self.jreq('/api/notion/connect', {'token': TOKEN, 'page': DEST})
        self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE})
        pid = server.NOTION.mapping()['mem']['pageId']; self.fake.pages[pid]['markdown'] += '\n메모\n'; before = snapshot(self.fake); self.fake.calls.clear()
        for body, code_ in (({}, 'update_disabled'), ({'mode': 'update', 'contentKey': 'k'}, 'update_disabled'), ({'mode': None}, 'update_disabled'),
                            ({'mode': 'overwrite'}, 'overwrite_disabled'), ({'mode': 'overwrite', 'confirm': True, 'expectedRemote': 'v2:' + '0' * 64}, 'overwrite_disabled'),
                            ({'mode': 'new'}, 'confirm_required'), ({'mode': 'new', 'confirm': 'true'}, 'confirm_required')):
            code, out = self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE + 'x\n', **body})
            self.assertEqual(out.get('code'), code_, body); self.assertIn(code, (400, 409))
        code, _, _ = self.request('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE, 'mode': 'new', 'confirm': True}, good=False, headers={'Content-Type': 'application/json', 'Origin': self.base})
        self.assertEqual(code, 403, 'CSRF still required')
        self.assertEqual(self.fake.calls, []); self.assertEqual(snapshot(self.fake), before)
        code, out = self.jreq('/api/notion/check', {'explorationId': 'mem'}); self.assertEqual(out['remote']['state'], 'changed')
        self.assertEqual([c[0] for c in self.fake.calls], ['GET', 'GET'], 'the check only reads'); self.assertEqual(snapshot(self.fake), before)

    def test_unresolved_create_over_http(self):
        self.jreq('/api/notion/connect', {'token': TOKEN, 'page': DEST})
        self.fake.fail['POST /v1/pages'] = {'drop': True, 'apply_then_fail': True, 'once': True}
        code, out = self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE}); self.assertEqual((code, out['code']), (503, 'unconfirmed'))
        code, out = self.jreq('/api/notion/entry', {'explorationId': 'mem'}); self.assertTrue(out['saved']['unconfirmed'])
        self.fake.calls.clear()
        code, out = self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE}); self.assertEqual(out['code'], 'unconfirmed')
        self.assertEqual(self.fake.calls, [])
        code, out = self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '기억', 'markdown': NOTE, 'mode': 'new', 'confirm': True}); self.assertEqual(out['action'], 'new')

    def test_large_korean_note_fits_the_body_limit(self):
        self.jreq('/api/notion/connect', {'token': TOKEN, 'page': DEST})
        code, out = self.jreq('/api/notion/save', {'explorationId': 'mem', 'title': '긴 노트', 'markdown': '가' * 140_000}); self.assertEqual(code, 200, out)


if __name__ == '__main__':
    unittest.main()
