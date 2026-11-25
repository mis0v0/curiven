"""A separate OS process that runs the PRODUCTION NotionLink.save() against a fake Notion on 127.0.0.1 (tests only).

    python3 tests/notion_store_child.py '<json>'
    {"dir": store dir, "base": fake API, "eid": ..., "title": ..., "mode": "update"|"new", "confirm": bool,
     "start": unix time to wait for (to line processes up), "crash": null | "before_post" | "after_post" |
     "before_replace" | "after_replace" | "hold_store_lock"}

Crashes are simulated with os._exit() at the named point (no cleanup, no finally blocks, open locks are dropped by the
kernel) by patching functions inside this child only; production code has no test hooks. Prints one JSON line."""
import json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
args = json.loads(sys.argv[1])
os.environ.update(CURIVEN_TEST='1', CURIVEN_NOTION_SECRETS='memory', CURIVEN_NOTION_API=args['base'], CURIVEN_NOTION_DIR=args['dir'])
sys.path.insert(0, str(ROOT))
import notion_link  # noqa: E402

TOKEN = 'ntn_' + 'A1b2C3d4' * 6
store = notion_link.MemoryStore(); store.set(TOKEN)
link = notion_link.NotionLink(directory=args['dir'], store=store, base=args['base'], sleep=lambda s: None)
crash = args.get('crash')
LEDGER = 'notion-pages.json'

if crash in ('before_post', 'after_post'):
    real = link._call
    def call(method, path, *a, **k):
        if method == 'POST' and path == '/v1/pages':
            if crash == 'before_post': os._exit(17)
            out = real(method, path, *a, **k); os._exit(17)
        return real(method, path, *a, **k)
    link._call = call
if crash in ('before_replace', 'after_replace'):
    real_replace, seen = os.replace, []
    def replace(src, dst, *a, **k):
        if str(dst).endswith(LEDGER):
            seen.append(dst)
            if len(seen) == args.get('nth', 1):
                if crash == 'before_replace': os._exit(17)
                real_replace(src, dst, *a, **k); os._exit(17)
        return real_replace(src, dst, *a, **k)
    os.replace = replace
if crash == 'hold_store_lock':
    real_journal = link._journal
    def journal(event):   # dies while it holds the store lock, inside the reservation (the 'reserved' journal line)
        if event.get('event') == 'reserved': time.sleep(args.get('hold', 1.0)); os._exit(17)
        return real_journal(event)
    link._journal = journal

if args.get('start'): time.sleep(max(0, args['start'] - time.time()))
try:
    r = link.save(args['eid'], args.get('title', '노트'), args.get('markdown', '## 노트\n\n내용\n'), mode=args.get('mode', 'update'), confirm=args.get('confirm', False))
    print(json.dumps({'ok': True, 'action': r['action'], 'url': r['url']}))
except notion_link.NotionError as e:
    print(json.dumps({'ok': False, 'code': e.code, 'status': e.status}))
