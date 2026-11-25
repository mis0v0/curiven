"""The Notion mapping store (notion_link.py): cross-process locking, strict reads, durable write-ahead publication.
Run: python3 -m unittest tests.test_notion_store

Everything runs on synthetic stores in temporary folders against the FAKE Notion API of tests/test_notion.py. Separate
OS processes are real (tests/notion_store_child.py runs the production NotionLink.save()); crashes are os._exit() at a
named point. These tests show the store's behaviour on this machine's local filesystem — not on network filesystems,
and not against power loss (fsync / F_FULLFSYNC are called, but no test can pull the plug)."""
import json, os, stat, subprocess, sys, tempfile, threading, time, unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tests'))
import notion_link  # noqa: E402
from test_notion import FakeNotion, TOKEN, DEST, NOTE, snapshot  # noqa: E402

CHILD = str(ROOT / 'tests' / 'notion_store_child.py')
LEDGER, CONFIG = 'notion-pages.json', 'notion.json'


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='curiven-notion-test-'); self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / 'notion'
        self.fake = FakeNotion(); self.addCleanup(self.fake.close)
        self.link = self.new_link(); self.link.connect(TOKEN, DEST); self.fake.calls.clear()
    def new_link(self):
        store = notion_link.MemoryStore(); store.set(TOKEN)
        return notion_link.NotionLink(directory=self.dir, store=store, base=self.fake.base, sleep=lambda s: None)
    def slow_posts(self, seconds):
        orig = self.fake.route
        def route(m, p, b):
            if m == 'POST' and p == '/v1/pages': time.sleep(seconds)
            return orig(m, p, b)
        self.fake.route = route; self.addCleanup(setattr, self.fake, 'route', orig)
    def spawn(self, **kw):
        return subprocess.Popen([sys.executable, CHILD, json.dumps({'dir': str(self.dir), 'base': self.fake.base, **kw})],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    def result(self, p, timeout=60):
        out, err = p.communicate(timeout=timeout); lines = out.strip().splitlines()
        return json.loads(lines[-1]) if lines else {'exit': p.returncode, 'stderr': err.strip()[-300:]}
    def child(self, **kw): return self.result(self.spawn(**kw))
    def creates(self): return [c for c in self.fake.calls if c[0] == 'POST' and c[1] == '/v1/pages']
    def ledger(self): return json.loads((self.dir / LEDGER).read_text())
    def journal(self):
        p = self.dir / 'notion-journal.jsonl'
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
    def pages(self): return {k: v for k, v in self.fake.pages.items() if k.startswith('0000')}
    def code(self, call, *a, **kw):
        with self.assertRaises(notion_link.NotionError) as e: call(*a, **kw)
        return e.exception.code


class CrossProcess(Store):
    """1, 2, 12: independent OS processes sharing one ledger."""
    def test_two_processes_first_publication_of_the_same_exploration(self):
        self.slow_posts(1.5)
        for round_ in range(3):
            eid = f'mem{round_}'; start = time.time() + 1.0
            outs = [self.result(p) for p in [self.spawn(eid=eid, title=f'같은 탐험 {round_}', start=start) for _ in range(2)]]
            self.assertEqual(sorted(o.get('action') or o.get('code') for o in outs), ['busy', 'created'], outs)
            mine = [k for k, v in self.fake.pages.items() if v['title'] == f'같은 탐험 {round_}']
            self.assertEqual(len(mine), 1, 'exactly one page'); self.assertEqual(self.ledger()[eid]['pageId'], mine[0], 'and it is the mapped one')
            self.assertEqual([j['event'] for j in self.journal() if j.get('eid') == eid], ['reserved', 'created'])
        self.assertEqual(len(self.creates()), 3)

    def test_different_explorations_in_parallel_processes_and_threads_lose_nothing(self):
        self.slow_posts(0.4)
        start = time.time() + 1.0
        outs = [self.result(p) for p in [self.spawn(eid=f'p{i}', title=f'노트 {i}', start=start) for i in range(5)]]
        self.assertEqual([o.get('action') for o in outs], ['created'] * 5, outs)
        errs = []
        def run(i):
            try: self.new_link().save(f't{i}', f'스레드 {i}', NOTE)
            except Exception as e: errs.append(e)
        ts = [threading.Thread(target=run, args=(i,)) for i in range(6)]; [t.start() for t in ts]; [t.join(30) for t in ts]
        self.assertEqual(errs, [])
        led = self.ledger(); ids = [led[k]['pageId'] for k in led]
        self.assertEqual(sorted(led), sorted([f'p{i}' for i in range(5)] + [f't{i}' for i in range(6)]), 'no lost update')
        self.assertEqual(len(set(ids)), 11); self.assertEqual(set(ids), set(self.pages()), 'every page is mapped, every mapping is a page')
        self.assertTrue(notion_link._valid_ledger(led))

    def test_one_exploration_from_threads_of_one_process(self):
        self.slow_posts(0.8); out = []
        def run():
            try: out.append(self.new_link().save('mem', '기억', NOTE)['action'])
            except notion_link.NotionError as e: out.append(e.code)
        ts = [threading.Thread(target=run) for _ in range(4)]; [t.start() for t in ts]; [t.join(30) for t in ts]
        self.assertEqual(out.count('created'), 1, out); self.assertTrue(set(out) <= {'created', 'busy', 'update_disabled'}, out)
        self.assertEqual(len(self.creates()), 1, 'waiting threads either give up (busy) or then see the page (update_disabled)')


class Crashes(Store):
    """5, 6, 7, 9, 11: a process dies at each step; nothing is retried, duplicated or lost, and no lock stays held."""
    def after_crash(self, eid='mem'):
        """What any later process may do: nothing that creates; the operation lock is free again."""
        for _ in range(3):   # 9: repeated invocations
            self.assertEqual(self.child(eid=eid).get('code'), 'unconfirmed')
        self.assertEqual(self.child(eid=eid, mode='new').get('code'), 'confirm_required')
        self.assertEqual(self.code(self.link.check, eid), 'no_page', 'not busy: the dead process holds no lock')

    def test_crash_before_post(self):
        self.assertEqual(self.child(eid='mem', crash='before_post').get('exit'), 17)
        self.assertEqual(self.creates(), []); m = self.ledger()['mem']
        self.assertEqual((m['unconfirmed'], m['reason']), (True, 'sending')); self.assertEqual([j['event'] for j in self.journal()], ['reserved'])
        self.fake.calls.clear(); self.after_crash(); self.assertEqual(self.fake.calls, [], 'no request at all after the crash')

    def test_crash_after_post_before_the_answer_is_stored(self):
        self.assertEqual(self.child(eid='mem', title='기억', crash='after_post').get('exit'), 17)
        self.assertEqual(len(self.pages()), 1, 'Notion made the page'); self.assertTrue(self.ledger()['mem']['unconfirmed'])
        op = self.ledger()['mem']['opId']; self.fake.calls.clear(); self.after_crash(); self.assertEqual(self.creates(), [])
        r = self.child(eid='mem', title='기억', mode='new', confirm=True); self.assertEqual(r.get('action'), 'new', r)
        m = self.ledger()['mem']; self.assertEqual(len(self.pages()), 2, 'only the explicitly confirmed second page')
        self.assertEqual([u['opId'] for u in m['unresolved']], [op], 'the crashed attempt is kept, not forgotten')

    def test_crash_while_replacing_the_ledger(self):
        self.link.save('other', '다른 노트', NOTE); before = (self.dir / LEDGER).read_bytes(); self.fake.calls.clear()
        # (a) dies before the reservation's rename: the old ledger is intact; nothing was sent, so nothing is pending
        self.assertEqual(self.child(eid='mem', crash='before_replace', nth=1).get('exit'), 17)
        self.assertEqual((self.dir / LEDGER).read_bytes(), before); self.assertEqual(self.creates(), [])
        self.assertTrue([p for p in self.dir.iterdir() if p.name.endswith('.tmp')], 'its temp file is left behind, unread')
        self.assertEqual(self.child(eid='mem').get('action'), 'created', 'the first publication can go ahead (nothing was sent)')
        # (b) dies right after the reservation's rename (before the POST): the reservation is durable
        self.assertEqual(self.child(eid='mem2', crash='after_replace', nth=1).get('exit'), 17)
        self.assertEqual(self.ledger()['mem2']['reason'], 'sending'); self.after_crash('mem2')
        # (c) dies before the rename that would record the created page: the ledger still says pending, the journal has the id
        self.fake.calls.clear()
        self.assertEqual(self.child(eid='mem3', title='셋째', crash='before_replace', nth=2).get('exit'), 17)
        made = [k for k, v in self.fake.pages.items() if v['title'] == '셋째']; self.assertEqual(len(made), 1)
        self.assertTrue(self.ledger()['mem3']['unconfirmed'])
        self.assertIn({'event': 'created', 'eid': 'mem3', 'pageId': made[0]}, [{k: j[k] for k in ('event', 'eid', 'pageId') if k in j} for j in self.journal()],
                      'the page id survives in the journal for manual recovery')
        self.after_crash('mem3'); self.assertEqual(len([v for v in self.fake.pages.values() if v['title'] == '셋째']), 1)
        led = self.ledger(); self.assertEqual(led['other'], json.loads(before)['other']); self.assertTrue(notion_link._valid_ledger(led))

    def test_a_dead_lock_holder_never_blocks_and_a_live_one_times_out_safely(self):
        p = self.spawn(eid='holder', crash='hold_store_lock', hold=2.0); time.sleep(0.8)   # it now holds the store lock
        t0 = time.monotonic(); r = self.link.save('mem', '기억', NOTE); waited = time.monotonic() - t0
        self.assertEqual(r['action'], 'created'); self.assertGreater(waited, 0.5, 'it waited for the holder'); self.assertLess(waited, 9)
        self.assertEqual(self.result(p).get('exit'), 17); self.assertNotIn('holder', self.ledger(), 'the holder died before writing')
        p = self.spawn(eid='holder2', crash='hold_store_lock', hold=4.0); time.sleep(0.8)
        orig = notion_link.NotionLink._store_lock
        with mock.patch.object(notion_link.NotionLink, '_store_lock', lambda s: s._flock(s.dir / s.LOCKFILE, 0.5, 'store_locked')):
            self.fake.calls.clear(); self.assertEqual(self.code(self.link.save, 'mem4', '넷', NOTE), 'store_locked'); self.assertEqual(self.fake.calls, [])
        self.assertIs(notion_link.NotionLink._store_lock, orig); self.result(p)
        self.assertEqual(self.link.save('mem4', '넷', NOTE)['action'], 'created', 'free again once the holder is gone')
        # the exploration lock is dropped with its process too
        self.slow_posts(2.0); p = self.spawn(eid='mem5', crash='after_post'); time.sleep(0.8)
        self.assertEqual(self.code(self.link.check, 'mem5'), 'busy', 'held while that process is alive')
        self.assertEqual(self.result(p).get('exit'), 17); self.assertEqual(self.code(self.link.check, 'mem5'), 'no_page')


class Damage(Store):
    """3, 4: damaged or unreadable files never mean "empty", are never overwritten, and are copied for recovery."""
    def setUp(self):
        super().setUp(); self.link.save('mem', '기억', NOTE); self.link.save('old', '옛 노트', NOTE); self.fake.calls.clear()
        self.good = (self.dir / LEDGER).read_bytes()

    def refused_everywhere(self, code):
        for call, a in ((self.link.save, ('new1', '새', NOTE)), (self.link.save, ('mem', '기억', NOTE)), (self.link.save, ('mem', '기억', NOTE, 'new', None, True)),
                        (self.link.entry, ('mem',)), (self.link.check, ('mem',)), (self.link.reconnect, ('mem',))):
            self.assertEqual(self.code(call, *a), code, (call.__name__, a))
        self.assertEqual(self.fake.calls, [], 'not one request to Notion')

    def test_invalid_json_and_schema(self):
        for bad in (b'', b'{', self.good[: len(self.good) // 2], b'\xff\xfe', b'[]', b'null', b'{"mem": 5}', b'{"../x": {"pageId": "00000000-0000-4000-8000-000000000001"}}',
                    b'{"mem": {"pageId": "not-a-page"}}', b'{"mem": {"title": "x"}}', b'{"mem": {"unconfirmed": "yes"}}', b'{"mem": {"pageId": "00000000-0000-4000-8000-000000000001", "previous": {}}}',
                    b'{"mem": {"pageId": "00000000-0000-4000-8000-000000000001", "url": 5}}'):
            (self.dir / LEDGER).write_bytes(bad)
            self.refused_everywhere('store_corrupt')
            self.assertEqual((self.dir / LEDGER).read_bytes(), bad, 'the damaged file is left exactly as it was')
            copies = [p for p in self.dir.iterdir() if p.name.startswith(LEDGER + '.corrupt-')]
            self.assertIn(bad, [p.read_bytes() for p in copies], 'a byte-exact copy is kept')
            self.assertEqual(stat.S_IMODE([p for p in copies if p.read_bytes() == bad][0].stat().st_mode), 0o600)
        (self.dir / LEDGER).write_bytes(self.good); self.assertEqual(self.code(self.link.save, 'mem', '기억', NOTE), 'update_disabled', 'restored by hand: works again')

    def test_unreadable_ledger_and_settings(self):
        os.chmod(self.dir / LEDGER, 0o000); self.addCleanup(os.chmod, self.dir / LEDGER, 0o600)
        self.refused_everywhere('store_unreadable'); os.chmod(self.dir / LEDGER, 0o600)
        self.assertEqual((self.dir / LEDGER).read_bytes(), self.good)
        os.chmod(self.dir / CONFIG, 0o000); self.addCleanup(os.chmod, self.dir / CONFIG, 0o600)
        self.assertEqual(self.link.status()['storeError'], 'store_unreadable'); self.assertFalse(self.link.status()['connected'])
        self.assertEqual(self.code(self.link.save, 'new1', '새', NOTE), 'store_unreadable')
        self.assertEqual(self.code(self.link.connect, TOKEN, DEST), 'store_unreadable', 'reconnecting never replaces the settings')
        self.assertEqual(self.creates(), [])

    def test_damaged_settings_are_kept(self):
        (self.dir / CONFIG).write_bytes(b'{"page": '); st = self.link.status()
        self.assertEqual((st['connected'], st['storeError']), (False, 'store_corrupt'))
        for call, a in ((self.link.save, ('new1', '새', NOTE)), (self.link.connect, (TOKEN, DEST)), (self.link.set_auto, (True,)), (self.link.disconnect, ())):
            with self.assertRaises(notion_link.NotionError): call(*a)
        self.assertEqual((self.dir / CONFIG).read_bytes(), b'{"page": '); self.assertEqual(self.creates(), [])

    def test_missing_ledger_after_it_existed(self):
        os.unlink(self.dir / LEDGER); self.refused_everywhere('store_missing')
        (self.dir / 'notion-store.json').write_bytes(b'garbage'); self.refused_everywhere('store_missing')   # a damaged marker counts as "written"
        os.unlink(self.dir / 'notion-store.json')
        self.assertEqual(self.link.save('fresh', '처음', NOTE)['action'], 'created', 'a store with no ledger and no marker is a new store')

    def test_write_failures_send_nothing(self):
        real = os.replace
        with mock.patch.object(notion_link.os, 'replace', side_effect=OSError(28, 'No space left on device')):
            self.assertEqual(self.code(self.link.save, 'new1', '새', NOTE), 'store_unwritable')
        self.assertIs(notion_link.os.replace, real); self.assertEqual(self.fake.calls, []); self.assertEqual((self.dir / LEDGER).read_bytes(), self.good)
        self.assertEqual([p for p in self.dir.iterdir() if p.name.endswith('.tmp')], [], 'a failed write cleans up its temp file')
        with mock.patch.object(notion_link.os, 'fsync', side_effect=OSError(5, 'I/O error')):
            self.assertEqual(self.code(self.link.save, 'new1', '새', NOTE), 'store_unwritable')
        self.assertEqual(self.fake.calls, [])
        with mock.patch.object(notion_link.NotionLink, '_journal', side_effect=notion_link.NotionError(500, 'x', 'store_unwritable')):
            self.assertEqual(self.code(self.link.save, 'new1', '새', NOTE), 'store_unwritable')
        self.assertEqual(self.fake.calls, []); self.assertEqual((self.dir / LEDGER).read_bytes(), self.good)

    def test_failure_to_store_the_outcome_keeps_the_page_in_the_journal(self):
        real, n = notion_link.NotionLink._write_json, []
        def flaky(link, name, value):
            if name == LEDGER: n.append(1)
            if name == LEDGER and len(n) == 2: raise link._store_error('store_unwritable')   # the write after the POST
            return real(link, name, value)
        with mock.patch.object(notion_link.NotionLink, '_write_json', flaky):
            self.assertEqual(self.code(self.link.save, 'new1', '새', NOTE), 'store_unwritable')
        made = [k for k, v in self.fake.pages.items() if v['title'] == '새']; self.assertEqual(len(made), 1)
        self.assertTrue(self.ledger()['new1']['unconfirmed'], 'still pending: never re-created')
        self.assertIn(made[0], [j.get('pageId') for j in self.journal() if j['event'] == 'created'])
        self.assertEqual(self.code(self.link.save, 'new1', '새', NOTE), 'unconfirmed')


class Durability(Store):
    """The write protocol, step by step; the optional read; history kept (8, 10)."""
    def test_write_protocol_order(self):
        seq = []
        real_fsync, real_replace, real_fcntl = os.fsync, os.replace, notion_link.fcntl.fcntl
        def fsync(fd):
            seq.append(('fsync', 'dir' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')); return real_fsync(fd)
        def fcntl_(fd, cmd, *a):
            if cmd == getattr(notion_link.fcntl, 'F_FULLFSYNC', None): seq.append(('fullfsync', 'dir' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file'))
            return real_fcntl(fd, cmd, *a)
        def replace(src, dst): seq.append(('replace', Path(dst).name)); return real_replace(src, dst)
        with mock.patch.object(notion_link.os, 'fsync', fsync), mock.patch.object(notion_link.os, 'replace', replace), mock.patch.object(notion_link.fcntl, 'fcntl', fcntl_):
            with self.link._store_lock(): self.link._write_json(LEDGER, {})
        i = seq.index(('replace', LEDGER))
        self.assertIn(('fsync', 'file'), seq[:i], 'the temp file is synced before the rename')
        self.assertIn(('fsync', 'dir'), seq[i:], 'the directory is synced after the rename')
        if hasattr(notion_link.fcntl, 'F_FULLFSYNC'): self.assertIn(('fullfsync', 'file'), seq[:i])

    def test_reservation_is_on_disk_before_the_post(self):
        seen = []
        self.fake.before_write.append(lambda m, p: seen.append((json.loads((self.dir / LEDGER).read_text())['mem'], [j['event'] for j in self.journal()])))
        self.link.save('mem', '기억', NOTE)
        rec, events = seen[0]
        self.assertEqual((rec['unconfirmed'], rec['reason']), (True, 'sending')); self.assertEqual(events, ['reserved'])
        self.assertEqual(rec['opId'], [j for j in self.journal() if j['event'] == 'created'][0]['opId'])

    def test_create_ok_then_read_fails(self):
        self.fake.fail['GET /v1/pages/'] = {'drop': True}
        self.assertEqual(self.link.save('mem', '기억', NOTE)['action'], 'created'); del self.fake.fail['GET /v1/pages/']
        m = self.ledger()['mem']; self.assertEqual(m['baseline'], 'unknown'); self.assertNotIn('remoteHash', m)
        self.assertEqual(self.child(eid='mem').get('code'), 'update_disabled', 'another process sees the page'); self.assertEqual(len(self.creates()), 1)

    def test_history_and_other_explorations_are_preserved(self):
        self.link.save('mem', '기억', NOTE); self.link.save('other', '다른 노트', NOTE); a = self.ledger()['mem']['pageId']
        self.fake.fail['POST /v1/pages'] = {'drop': True, 'apply_then_fail': True, 'once': True}
        self.assertEqual(self.code(self.link.save, 'mem', '기억 2', NOTE, mode='new', confirm=True), 'unconfirmed')
        other = self.ledger()['other']
        r = self.child(eid='mem', title='기억 3', mode='new', confirm=True); self.assertEqual(r.get('action'), 'new', r)
        m = self.ledger()['mem']
        self.assertEqual([p['pageId'] for p in m['previous']], [a]); self.assertEqual([u['title'] for u in m['unresolved']], ['기억 2'])
        self.assertEqual(self.ledger()['other'], other)
        events = [(j['event'], j.get('eid')) for j in self.journal()]
        self.assertEqual(events.count(('reserved', 'mem')), 3); self.assertIn(('unresolved', 'mem'), events)

    def test_settle_never_overwrites_a_record_that_is_not_its_own(self):
        """Defence in depth: if the pending record changed under an operation (only possible by hand while it ran),
        its outcome goes to the journal as an orphan and nothing in the ledger is replaced."""
        def swap(m, p):   # during the POST, someone rewrites this exploration's record
            with self.link._store_lock():
                led = json.loads((self.dir / LEDGER).read_text()); led['mem'] = {'pageId': '11111111-1111-4111-8111-111111111111', 'url': ''}
                self.link._write_json(LEDGER, led)
        self.fake.before_write.append(swap)
        self.assertEqual(self.code(self.link.save, 'mem', '기억', NOTE), 'unconfirmed')
        self.assertEqual(self.ledger()['mem']['pageId'], '11111111-1111-4111-8111-111111111111')
        self.assertIn('orphan', [j['event'] for j in self.journal()])


if __name__ == '__main__':
    unittest.main()
