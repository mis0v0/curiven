"""Stage B1 Boundary Constellation prototype: pack adapter, gates and dev-only routes.
Run: python3 -m unittest discover -s tests
Approvals below are simulated on in-memory copies (tests only); the real pack file is never modified."""
import copy, hashlib, json, sys, tempfile, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tools')); sys.path.insert(0, str(ROOT / 'tests'))
import pilot_packs  # noqa: E402
import server  # noqa: E402
from test_reference_packs import approve  # noqa: E402

PID = 'http-cookie-vs-server-session'
PACK_PATH = ROOT / 'reference-packs' / 'http-cookie-vs-server-session.v1.json'
PACK = json.loads(PACK_PATH.read_text(encoding='utf-8'))
V = pilot_packs.V


def served(pack, dev=True):
    """Serve an in-memory pack copy through the real adapter (from a temporary directory)."""
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / pilot_packs.ADAPTERS[PID]['file']).write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
        return pilot_packs.activity(PID, d, dev=dev)


class DraftPreview(unittest.TestCase):
    def test_draft_is_preview_only_and_never_awards(self):
        a = served(PACK)
        self.assertEqual(a['pack']['mode'], 'draft-preview')
        self.assertEqual(a['pack']['gate'], {'reviewStatus': 'draft', 'coreEligible': False, 'mayAward': False, 'awardable': []})

    def test_draft_is_refused_outside_development(self):
        with self.assertRaises(pilot_packs.PackError) as e: served(PACK, dev=False)
        self.assertEqual((e.exception.status, e.exception.reason), (404, 'not_reviewed'))

    def test_advanced_items_are_never_served(self):
        text = json.dumps(served(PACK), ensure_ascii=False)
        core = V.core_ids(PACK)
        hidden = [(i, it) for i, (kind, it) in V.items(PACK).items() if i not in core]
        self.assertEqual(sorted(i for i, _ in hidden), ['D5', 'F11', 'F12', 'F13', 'V1'])
        for i, it in hidden:
            for s in V._strings(it):
                if len(s) > 25: self.assertNotIn(s, text, f'{i} leaked')
        self.assertNotIn('advanced', text.lower())

    def test_content_and_keys_are_the_packs_own(self):
        a = served(PACK)
        self.assertEqual([c['id'] for c in a['checks']], ['K1', 'K3'])
        for q in a['checks']:
            src = next(x for x in PACK['applicationChecks'] if x['id'] == q['id'])
            self.assertEqual((q['stem'], q['answer'], q['rationale']), (src['stem'], src['answer'], src['rationale']))
            self.assertEqual(q['options'], [{'id': o['id'], 'text': o['text']} for o in src['options']])
            self.assertEqual([x['id'] for x in q['assumptions']], src['assumptions'])
        for s in a['situations']:
            src = next(x for x in PACK['situations'] if x['id'] == s['id'])
            self.assertEqual((s['setup'], s['outcome']), (src['setup'], src['outcome']))
        self.assertEqual(a['prompt']['text'], PACK['comparisonPrompt']['text'])

    def test_generic_contract_has_no_domain_state_fields(self):
        a = served(PACK)
        self.assertNotIn('state', json.dumps({k: v for k, v in a.items() if k != 'pack'}, ensure_ascii=False).replace('statement', ''))
        for s in a['situations']: self.assertEqual(set(s), {'id', 'title', 'setup', 'outcome'})

    def test_serving_never_modifies_the_pack(self):
        before = hashlib.sha256(PACK_PATH.read_bytes()).hexdigest()
        pilot_packs.activity(PID, ROOT / 'reference-packs', dev=True)
        self.assertEqual(hashlib.sha256(PACK_PATH.read_bytes()).hexdigest(), before)
        self.assertEqual(json.loads(PACK_PATH.read_text(encoding='utf-8'))['review']['status'], 'draft')


class AwardGate(unittest.TestCase):
    """Negative tests: draft material cannot produce awardable evidence, whatever else is set."""
    def test_draft_with_all_accepts_and_accepted_checks_still_cannot_award(self):
        p = approve(copy.deepcopy(PACK), accept_checks=True)
        p['review'].update(status='draft', reviewedBy=None, reviewedAt=None)
        self.assertEqual(V.validate(p), [])  # a structurally valid draft that already carries every ACCEPT
        g = served(p)['pack']
        self.assertEqual((g['mode'], g['gate']['mayAward'], g['gate']['awardable']), ('draft-preview', False, []))

    def test_inconsistent_review_states_are_not_served_at_all(self):
        for change in ({'status': 'draft'}, {'reviewedBy': None}, {'reviewedAt': None}):
            p = approve(copy.deepcopy(PACK), accept_checks=True); p['review'].update(change)
            with self.assertRaises(pilot_packs.PackError) as e: served(p)
            self.assertEqual(e.exception.reason, 'invalid', change)

    def test_reviewed_with_candidate_checks_cannot_award(self):
        g = served(approve(copy.deepcopy(PACK)))['pack']
        self.assertEqual((g['mode'], g['gate']['coreEligible'], g['gate']['mayAward'], g['gate']['awardable']), ('reviewed', True, False, []))

    def test_one_rejected_core_item_blocks_everything(self):
        p = approve(copy.deepcopy(PACK), accept_checks=True); p['review']['decisions']['F7'] = 'REVISE'
        self.assertEqual(served(p)['pack']['mode'], 'draft-preview')
        self.assertEqual(served(p)['pack']['gate']['awardable'], [])

    def test_positive_control_fully_reviewed_pack(self):
        """The gate is wired both ways: only a complete simulated human review enables awarding."""
        g = served(approve(copy.deepcopy(PACK), accept_checks=True), dev=False)['pack']
        self.assertEqual((g['mode'], g['gate']['mayAward'], g['gate']['awardable']), ('reviewed', True, ['K1', 'K3']))


class BadPacks(unittest.TestCase):
    def assertPackError(self, status, reason, fn):
        with self.assertRaises(pilot_packs.PackError) as e: fn()
        self.assertEqual((e.exception.status, e.exception.reason), (status, reason))

    def test_invalid_pack_is_never_served(self):
        p = copy.deepcopy(PACK); p['applicationChecks'][0]['rationaleClaims'].append('F99')
        self.assertPackError(422, 'invalid', lambda: served(p))

    def test_missing_unreadable_and_unknown(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertPackError(404, 'missing', lambda: pilot_packs.activity(PID, d, dev=True))
            (Path(d) / pilot_packs.ADAPTERS[PID]['file']).write_text('{not json', encoding='utf-8')
            self.assertPackError(422, 'unreadable', lambda: pilot_packs.activity(PID, d, dev=True))
        for bad in ('../etc/passwd', 'unknown-pack', '', 'HTTP-COOKIE'):
            self.assertPackError(404, 'unknown', lambda: pilot_packs.activity(bad, ROOT / 'reference-packs', dev=True))

    def test_pack_id_mismatch_rejected(self):
        p = copy.deepcopy(PACK); p['id'] = 'something-else'
        self.assertPackError(422, 'invalid', lambda: served(p))


class Routes(unittest.TestCase):
    def start(self, dev):
        patch = mock.patch.object(server, 'DEV_PILOT', dev); patch.start(); self.addCleanup(patch.stop)
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        return f'http://127.0.0.1:{httpd.server_address[1]}'

    def get(self, url, headers=None):
        try:
            with urlopen(Request(url, headers=headers or {}), timeout=5) as r: return r.status, r.read().decode()
        except HTTPError as e: return e.code, e.read().decode()

    def test_production_route_has_no_prototype(self):
        base = self.start(False)
        self.assertEqual(self.get(base + '/dev/boundary')[0], 404)
        self.assertEqual(self.get(base + '/api/pilot/' + PID)[0], 404)
        status, page = self.get(base + '/')
        self.assertEqual(status, 200); self.assertNotIn('curiven-dev-pilot', page)

    def test_dev_route_serves_labelled_draft_preview(self):
        base = self.start(True)
        status, page = self.get(base + '/dev/boundary')
        self.assertEqual(status, 200)
        self.assertIn('<meta name="curiven-dev-pilot" content="http-cookie-vs-server-session">', page)
        self.assertIn('curiven-csrf', page)
        self.assertNotIn('curiven-dev-pilot', self.get(base + '/')[1])  # the normal route stays normal in dev mode too
        status, body = self.get(base + '/api/pilot/' + PID)
        j = json.loads(body)
        self.assertEqual((status, j['ok'], j['activity']['pack']['mode']), (200, True, 'draft-preview'))
        self.assertEqual(j['activity']['pack']['gate']['awardable'], [])
        self.assertEqual(self.get(base + '/api/pilot/nope')[0], 404)
        for f in ('/boundary.js', '/boundary-ui.js', '/boundary.css'): self.assertEqual(self.get(base + f)[0], 200)

    def test_pilot_endpoint_keeps_local_security(self):
        base = self.start(True)
        self.assertEqual(self.get(base + '/api/pilot/' + PID, {'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.get(base + '/api/pilot/' + PID, {'Host': 'evil.example'})[0], 421)


if __name__ == '__main__':
    unittest.main()
