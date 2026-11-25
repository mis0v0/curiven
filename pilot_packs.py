"""Development-only Boundary Constellation pilot (Stage B1).

Turns a CURIVEN reference pack into a topic-independent *boundary activity* for the browser:
two concepts, contrasting situations with stated outcomes, one comparison prompt, keyed checks.

Everything is decided fail-closed by the gates in tools/validate_reference_packs.py:
  - an invalid pack is never served;
  - a pack whose core is not eligible (e.g. review.status "draft") is served only as a labelled
    'draft-preview' in development mode, with mayAward False and no awardable checks;
  - advanced items (pilot.advancedRoots and anything only they reach) are never served here.
Nothing in this module writes to a pack or to learner data.

The only domain-specific knowledge lives in ADAPTERS (which pack file, which two concepts form the
boundary). HTTP state vocabularies and contradiction rules stay in the pack and its validator."""
import importlib.util, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTRACT = 1
PACK_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,79}$')

# Isolated domain adapter: one entry per pilot pack. 'pair' names the two pack concepts whose boundary the
# activity is about (the pack schema has no such field; adding one would need a new reviewed schema version).
ADAPTERS = {
    'http-cookie-vs-server-session': {'file': 'http-cookie-vs-server-session.v1.json', 'pair': ['cookie', 'server-session']},
}


def _validator():
    spec = importlib.util.spec_from_file_location('curiven_pack_validator', ROOT / 'tools' / 'validate_reference_packs.py')
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


V = _validator()


class PackError(Exception):
    def __init__(self, status, reason, message):
        super().__init__(message); self.status, self.reason, self.message = status, reason, message


def load(pack_id, pack_dir):
    if not isinstance(pack_id, str) or not PACK_ID.match(pack_id) or pack_id not in ADAPTERS:
        raise PackError(404, 'unknown', '이 주제에는 준비된 참고 자료가 없어요.')
    path = Path(pack_dir) / ADAPTERS[pack_id]['file']
    try:
        with open(path, encoding='utf-8') as f: pack = json.load(f)
    except FileNotFoundError: raise PackError(404, 'missing', '참고 자료 파일을 찾을 수 없어요.')
    except (OSError, ValueError): raise PackError(422, 'unreadable', '참고 자료 파일을 읽을 수 없어요.')
    if not isinstance(pack, dict) or pack.get('id') != pack_id:
        raise PackError(422, 'invalid', '참고 자료 형식이 올바르지 않아요.')
    return pack


def gate(pack):
    """What this pack may do, straight from the validator's fail-closed gates."""
    eligible = V.core_eligible(pack)
    return {
        'reviewStatus': str((pack.get('review') or {}).get('status') or ''),
        'coreEligible': bool(eligible),
        'mayAward': bool(V.pack_may_award(pack)),
        'awardable': sorted(V.awardable_checks(pack)),
    }


def activity(pack_id, pack_dir, dev):
    """Generic learner-facing activity, or PackError. `dev` must be True for anything not core-eligible."""
    pack = load(pack_id, pack_dir)
    errors = V.validate(pack)
    if errors: raise PackError(422, 'invalid', '참고 자료가 검사를 통과하지 못해 사용할 수 없어요.')
    g = gate(pack)
    if not g['coreEligible'] and not dev:
        raise PackError(404, 'not_reviewed', '검토를 마친 참고 자료가 아직 없어요.')
    core = V.core_ids(pack)
    pair = ADAPTERS[pack_id]['pair']
    concepts = {c['id']: c for c in pack.get('concepts', [])}
    if any(p not in concepts for p in pair): raise PackError(422, 'invalid', '참고 자료 형식이 올바르지 않아요.')
    assumptions = {a['id']: a['text'] for a in pack.get('assumptions', [])}
    prompt = pack.get('comparisonPrompt') or {}
    if prompt.get('id') not in core: raise PackError(422, 'invalid', '참고 자료 형식이 올바르지 않아요.')
    situations = {s['id']: s for s in pack.get('situations', [])}
    checks = [q for q in pack.get('applicationChecks', []) if q.get('id') in core and q.get('status') != 'retired']
    rel = pack.get('relationship') or {}
    return {
        'format': 'curiven-boundary-activity', 'contract': CONTRACT,
        'pack': {'id': pack['id'], 'version': pack.get('version'), 'draftRevision': pack.get('draftRevision'),
                 'title': pack.get('title'), 'mode': 'reviewed' if g['coreEligible'] else 'draft-preview', 'gate': g},
        'assessmentLabel': ((pack.get('pilot') or {}).get('assessmentLabel') or {}).get('ko', ''),
        'concepts': [{'id': i, 'name': concepts[i]['name'], 'aliases': list(concepts[i].get('aliases', []))} for i in pair],
        'relationship': {'id': rel.get('id'), 'summary': rel.get('summary', '')} if rel.get('id') in core else None,
        'situations': [{'id': s, 'title': situations[s]['title'], 'setup': situations[s]['setup'], 'outcome': situations[s]['outcome']}
                       for s in prompt.get('situations', []) if s in core and s in situations],
        'prompt': {'id': prompt['id'], 'text': prompt['text'], 'expectedElements': [e['text'] for e in prompt.get('expectedElements', [])]},
        'checks': [{'id': q['id'], 'status': q.get('status'), 'stem': q['stem'],
                    'options': [{'id': o['id'], 'text': o['text']} for o in q['options']],
                    'answer': q['answer'], 'rationale': q['rationale'],
                    'assumptions': [{'id': a, 'text': assumptions[a]} for a in q.get('assumptions', []) if a in assumptions]}
                   for q in checks],
    }
