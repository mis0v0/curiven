#!/usr/bin/env python3
"""Validate CURIVEN reference packs (format "curiven-reference-pack", schemaVersion 1) and decide,
fail-closed, what a reviewed pack may be used for.

Read-only: files are opened for reading only; packs and learner data are never modified.

Dependency graph (every edge must resolve; derived-claim cycles are rejected)
  relationship R → claims
  situation S    → outcomeClaims, assumptions, supportingFacts
  prompt P       → situations, expectedElements[].claims
  check K        → rationaleClaims, assumptions, distractorClaims[*]
  advanced V     → claims, discussionPoints[].claims
  derived D      → derivedFrom, assumptions
  assumption A   → scopeNotes (edge cases)
  fact F, edge case E → (leaves)
Any item ID mentioned in an item's text must be inside that item's dependency closure (no hidden
dependencies). Every reviewable item must be reachable from pilot.coreRoots or pilot.advancedRoots.

Gates (both require a structurally valid pack with review.status == "reviewed", a named reviewer and date):
  core_eligible     – every item in the closure of coreRoots is ACCEPT, and every expertJudgment item in it
                      has an expert technicalValidation. Advanced items never affect this.
  advanced_enabled  – core rules applied to one advanced root's closure, plus an expert technicalValidation
                      of the advanced item itself. Advanced items are never scored.
  awardable_checks  – core keyed checks with status "accepted", and only when core_eligible. Checks with status
                      "candidate" or "retired" can never produce an achievement.
  pack_may_award    – core_eligible and every keyed check in pilot.coreRoots is "accepted".
AI checks (aiCheck) never count towards any gate.

Usage: python3 tools/validate_reference_packs.py [pack.json ...]   (default: reference-packs/*.json)"""
import json, re, sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
PACK_DIR = ROOT / 'reference-packs'
STATUSES = {'draft', 'in_review', 'reviewed'}
DECISIONS = {'ACCEPT', 'REVISE', 'REJECT'}
# PILOT-SPECIFIC (HTTP cookie/session pilot): the allowed source hosts and the STATES vocabulary below describe this
# first pilot only. They are not CURIVEN's general learning model; other topics will need their own reviewed lists.
PRIMARY_HOSTS = {'www.rfc-editor.org', 'datatracker.ietf.org', 'developer.mozilla.org', 'cheatsheetseries.owasp.org', 'owasp.org'}
FORBIDDEN_KEYS = {'heldback', 'held_back', 'evaluation', 'evaluationitems', 'hidden', 'hiddenquestions', 'blinded'}
BARE_LABELS = {'both', 'neither', 'a', 'b', '둘 다', '둘다', '둘 다 아님', '둘 다 아니다', '해당 없음'}
MAX_EXCERPT_WORDS, MAX_TOTAL_EXCERPT_WORDS = 25, 450
AI_RESULTS_FACT = {'excerpt-found', 'not-checked'}          # 'excerpt-not-found' is never acceptable in a pack
AI_RESULTS_REASONING = {'reasoning-checked', 'not-checked'}
KEY_FIELDS = {'answer', 'options', 'distractornotes', 'distractorclaims', 'answerkey', 'key'}
NORMATIVITY = {'MUST', 'SHOULD', 'MAY', 'MUST NOT', 'SHOULD NOT', 'descriptive', 'guidance-must', 'guidance-should'}
STATES = {'browser-cookie-present', 'browser-cookie-deleted', 'server-session-active', 'server-session-ended'}
OPPOSED = [{'browser-cookie-present', 'browser-cookie-deleted'}, {'server-session-active', 'server-session-ended'}]
FORBIDDEN_LABEL_WORDS = ['마스터', '숙달', '이해 완료', '완전히 이해', '검증된 이해', '영구', 'master', 'mastery', 'verified understanding', 'permanent']
ID_IN_TEXT = re.compile(r'(?<![A-Za-z0-9])([FDAESKPVR][0-9]+)(?![0-9])')


def words(s):
    return len(str(s).split())


def _walk_keys(v, path=''):
    if isinstance(v, dict):
        for k, x in v.items():
            yield k, f'{path}.{k}'
            yield from _walk_keys(x, f'{path}.{k}')
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from _walk_keys(x, f'{path}[{i}]')


def _strings(v):
    if isinstance(v, str): yield v
    elif isinstance(v, dict):
        for x in v.values(): yield from _strings(x)
    elif isinstance(v, list):
        for x in v: yield from _strings(x)


# ---------------------------------------------------------------- graph

def items(pack):
    """id -> (kind, item) for every reviewable item."""
    out = {}
    def add(kind, seq):
        for it in seq or []:
            if isinstance(it, dict) and it.get('id'): out.setdefault(it['id'], (kind, it))
    add('fact', pack.get('facts')); add('derived', pack.get('derivedClaims')); add('assumption', pack.get('assumptions'))
    add('edge', pack.get('edgeCases')); add('situation', pack.get('situations')); add('check', pack.get('applicationChecks'))
    add('advanced', pack.get('advancedScenarios'))
    if isinstance(pack.get('comparisonPrompt'), dict): add('prompt', [pack['comparisonPrompt']])
    if isinstance(pack.get('relationship'), dict): add('relationship', [pack['relationship']])
    return out


def reviewable_ids(pack):
    return list(items(pack))


def direct_deps(kind, it):
    d = []
    if kind == 'relationship': d += it.get('claims', [])
    elif kind == 'situation': d += it.get('outcomeClaims', []) + it.get('assumptions', []) + it.get('supportingFacts', [])
    elif kind == 'prompt':
        d += it.get('situations', [])
        for e in it.get('expectedElements', []): d += e.get('claims', [])
    elif kind == 'check':
        d += it.get('rationaleClaims', []) + it.get('assumptions', [])
        for v in (it.get('distractorClaims') or {}).values(): d += v if isinstance(v, list) else []
    elif kind == 'advanced':
        d += it.get('claims', [])
        for p in it.get('discussionPoints', []): d += p.get('claims', [])
    elif kind == 'derived': d += it.get('derivedFrom', []) + it.get('assumptions', [])
    elif kind == 'assumption': d += it.get('scopeNotes', [])
    return [x for x in d if isinstance(x, str)]


def graph(pack):
    return {i: direct_deps(k, it) for i, (k, it) in items(pack).items()}


def closure(pack, roots):
    """Roots plus everything they depend on (unknown IDs are ignored here; validate() reports them)."""
    g, seen, todo = graph(pack), set(), list(roots)
    while todo:
        x = todo.pop()
        if x in seen or x not in g: continue
        seen.add(x); todo.extend(g[x])
    return seen


def keyed_dependencies(pack, check):
    return closure(pack, [check['id']]) - {check['id']}


def _cycles(g):
    WHITE, GREY, BLACK = 0, 1, 2
    color, found = {k: WHITE for k in g}, []
    def visit(n, path):
        color[n] = GREY
        for m in g.get(n, []):
            if m not in g: continue
            if color[m] == GREY: found.append(path + [m])
            elif color[m] == WHITE: visit(m, path + [m])
        color[n] = BLACK
    for n in g:
        if color[n] == WHITE: visit(n, [n])
    return found


# ---------------------------------------------------------------- gates

def _expert_validated(item):
    tv = item.get('technicalValidation') or {}
    return tv.get('status') == 'expert' and bool(tv.get('by')) and bool(tv.get('at'))


def _reviewed(pack):
    r = pack.get('review') or {}
    return r.get('status') == 'reviewed' and bool(r.get('reviewedBy')) and bool(r.get('reviewedAt'))


def _all_accepted(pack, ids):
    decisions = (pack.get('review') or {}).get('decisions') or {}
    its = items(pack)
    for i in ids:
        if decisions.get(i) != 'ACCEPT': return False
        if its[i][1].get('expertJudgment') is True and not _expert_validated(its[i][1]): return False
    return True


def core_ids(pack):
    return closure(pack, (pack.get('pilot') or {}).get('coreRoots', []))


def core_eligible(pack):
    """Fail-closed: invalid packs, drafts, missing decisions or unvalidated expert items → False."""
    if validate(pack) or not _reviewed(pack): return False
    ids = core_ids(pack)
    return bool(ids) and _all_accepted(pack, ids)


def advanced_enabled(pack, advanced_id):
    if validate(pack) or not _reviewed(pack): return False
    if advanced_id not in (pack.get('pilot') or {}).get('advancedRoots', []): return False
    its = items(pack)
    return _all_accepted(pack, closure(pack, [advanced_id])) and _expert_validated(its[advanced_id][1])


def awardable_checks(pack):
    """Core keyed checks that may produce an achievement: status "accepted" (set by a human) and an eligible core.
    "candidate" and "retired" checks are never awardable."""
    if not core_eligible(pack): return set()
    roots = set((pack.get('pilot') or {}).get('coreRoots', []))
    return {q['id'] for q in pack.get('applicationChecks', []) if q.get('id') in roots and q.get('status') == 'accepted'}


def pack_may_award(pack):
    """True only when the core is eligible and every keyed check in the core roots is "accepted"."""
    roots = set((pack.get('pilot') or {}).get('coreRoots', []))
    keyed = {q.get('id') for q in pack.get('applicationChecks', []) if q.get('id') in roots}
    return bool(keyed) and awardable_checks(pack) == keyed


def servable_ids(pack):
    """What a future UI may show from this pack: nothing unless the core is eligible; an advanced item
    (with its closure) only when it is separately enabled. Unapproved advanced items never leak."""
    if not core_eligible(pack): return set()
    out = set(core_ids(pack))
    for v in (pack.get('pilot') or {}).get('advancedRoots', []):
        if advanced_enabled(pack, v): out |= closure(pack, [v])
    return out


# ---------------------------------------------------------------- validation

def validate(pack):
    """Returns a list of error strings (empty when valid)."""
    E = []
    err = E.append
    if not isinstance(pack, dict): return ['pack is not a JSON object']
    if pack.get('format') != 'curiven-reference-pack': err('format must be "curiven-reference-pack"')
    if pack.get('schemaVersion') != 1: err('schemaVersion must be 1')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,80}', str(pack.get('id', ''))): err('id must be a lowercase slug')
    if not isinstance(pack.get('version'), int) or pack['version'] < 1: err('version must be a positive integer')
    if 'draftRevision' in pack and (not isinstance(pack['draftRevision'], int) or pack['draftRevision'] < 1): err('draftRevision must be a positive integer')
    for k in ('title', 'language'):
        if not isinstance(pack.get(k), str) or not pack[k].strip(): err(f'{k} is required')
    for k, path in _walk_keys(pack):
        if k.lower().replace('-', '') in FORBIDDEN_KEYS: err(f'hidden-evaluation field not allowed in a pack: {path}')

    groups = {k: pack.get(k) or [] for k in ('concepts', 'facts', 'derivedClaims', 'assumptions', 'edgeCases', 'situations', 'applicationChecks', 'advancedScenarios')}
    if 'distinctions' in pack: err('distinctions are not part of schema 1 pilots; express them as reviewable claims')

    # unique ids across every layer
    seen = {}
    for g, seq in groups.items():
        if not isinstance(seq, list): err(f'{g} must be a list'); continue
        for it in seq:
            i = it.get('id') if isinstance(it, dict) else None
            if not i: err(f'{g}: item without id'); continue
            if i in seen: err(f'duplicate id {i} ({seen[i]} and {g})')
            seen[i] = g
    cp, rel = pack.get('comparisonPrompt'), pack.get('relationship')
    for name, obj in (('comparisonPrompt', cp), ('relationship', rel)):
        if not isinstance(obj, dict) or not obj.get('id'): err(f'{name} with an id is required'); continue
        if obj['id'] in seen: err(f'duplicate id {obj["id"]} ({seen[obj["id"]]} and {name})')
        seen[obj['id']] = name
    if isinstance(cp, dict):
        for e in cp.get('expectedElements', []):
            if not e.get('id') or e['id'] in seen: err(f'duplicate or missing id in comparisonPrompt: {e.get("id")}')
            seen[e.get('id')] = 'comparisonPrompt'
    its = items(pack)
    facts = {i for i, (k, _) in its.items() if k == 'fact'}
    derived = {i for i, (k, _) in its.items() if k == 'derived'}
    assumptions = {i for i, (k, _) in its.items() if k == 'assumption'}
    edges = {i for i, (k, _) in its.items() if k == 'edge'}
    claims = facts | derived
    concepts = {c['id'] for c in groups['concepts'] if isinstance(c, dict) and 'id' in c}
    if len(concepts) < 2: err('at least two concepts are required')
    for c in groups['concepts']:
        if set(c) - {'id', 'name', 'aliases'}: err(f'concept {c.get("id")}: only id, name and aliases are allowed (descriptive text must be a reviewable claim)')

    def refs(where, ids, allowed, kind):
        if not isinstance(ids, list): err(f'{where}: {kind} must be a list'); return
        for x in ids:
            if x not in allowed: err(f'{where}: unknown {kind} reference {x}')

    # review block: decisions only for known items, only valid values; "reviewed" needs a decision for every item
    r = pack.get('review')
    if not isinstance(r, dict) or r.get('status') not in STATUSES: err('review.status must be draft, in_review or reviewed')
    else:
        dec = r.get('decisions')
        if not isinstance(dec, dict): err('review.decisions must be an object'); dec = {}
        for k, v in dec.items():
            if k not in its: err(f'review.decisions: unknown item {k}')
            if v not in DECISIONS: err(f'review.decisions[{k}]: must be ACCEPT, REVISE or REJECT')
        if r['status'] == 'draft' and (r.get('reviewedBy') or r.get('reviewedAt')): err('a draft pack must not name a reviewer or review date')
        if r['status'] == 'reviewed':
            if not (r.get('reviewedBy') and r.get('reviewedAt')): err('status "reviewed" requires reviewedBy and reviewedAt')
            missing = sorted(set(its) - set(dec))
            if missing: err(f'status "reviewed" requires a decision for every item; missing {missing}')

    # sources and provenance
    sources = {}
    for s in pack.get('sources') or []:
        sid = s.get('id')
        if not sid or sid in sources: err(f'source id missing or duplicated: {sid}')
        u = urlparse(str(s.get('url', '')))
        if u.scheme != 'https' or u.hostname not in PRIMARY_HOSTS: err(f'source {sid}: url must be https on a primary-source host')
        for k in ('title', 'publisher', 'license'):
            if not str(s.get(k, '')).strip(): err(f'source {sid}: {k} is required')
        sources[sid] = s
    if not sources: err('at least one source is required')
    total_words = 0
    def check_source_refs(where, srcs, required):
        nonlocal total_words
        if required and not srcs: err(f'{where}: at least one source is required')
        for s in srcs or []:
            if s.get('source') not in sources: err(f'{where}: unknown source {s.get("source")}'); continue
            if str(s.get('url', '')).split('#')[0] != sources[s['source']]['url'].split('#')[0]: err(f'{where}: url does not belong to source {s["source"]}')
            if not str(s.get('locator', '')).strip(): err(f'{where}: locator (section/anchor) is required')
            ex = str(s.get('excerpt', '')).strip()
            if not ex: err(f'{where}: excerpt is required')
            if words(ex) > MAX_EXCERPT_WORDS: err(f'{where}: excerpt longer than {MAX_EXCERPT_WORDS} words')
            if s.get('normativity') not in NORMATIVITY: err(f'{where}: normativity must be one of {sorted(NORMATIVITY)}')
            total_words += words(ex)

    def assurance(i, item, allowed):
        ai = item.get('aiCheck')
        if not isinstance(ai, dict) or ai.get('result') not in allowed: err(f'{i}: aiCheck.result must be one of {sorted(allowed)}')
        elif ai['result'] != 'not-checked' and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(ai.get('checkedAt', ''))): err(f'{i}: aiCheck.checkedAt date is required')
        tv = item.get('technicalValidation')
        if not isinstance(tv, dict) or tv.get('status') not in ('none', 'expert'): err(f'{i}: technicalValidation.status must be none or expert')
        elif tv['status'] == 'expert' and not (tv.get('by') and tv.get('at')): err(f'{i}: an expert technical validation needs by and at')
        for k in ('humanApproval', 'approved', 'accepted', 'decision'):
            if k in item: err(f'{i}: human approval belongs only in review.decisions, not in the item ({k})')

    def check_state(i, item):
        st = item.get('state', [])
        if not isinstance(st, list) or set(st) - STATES: err(f'{i}: state must use {sorted(STATES)}'); return
        for pair in OPPOSED:
            if pair <= set(st): err(f'{i}: contradictory state {sorted(pair)}')
        # every assumption this item relies on, directly or through derived claims, must fit its state
        used = [a for a in closure(pack, [i]) if a in assumptions]
        for a in used:
            bad = set(its[a][1].get('incompatibleWith', [])) & set(st)
            if bad: err(f'{i}: contradictory assumption {a} for state {sorted(bad)}')

    for f in groups['facts']:
        i = f.get('id')
        if not str(f.get('claim', '')).strip(): err(f'{i}: claim is required')
        if f.get('scope') not in ('core', 'advanced'): err(f'{i}: scope must be core or advanced')
        if not str(f.get('conditions', '')).strip(): err(f'{i}: conditions are required (write "none known" if none)')
        check_source_refs(i, f.get('sources'), True)
        assurance(i, f, AI_RESULTS_FACT)
    for e in groups['edgeCases']:
        check_source_refs(e.get('id'), e.get('sources'), False)
    if total_words > MAX_TOTAL_EXCERPT_WORDS: err(f'total quoted text {total_words} words exceeds {MAX_TOTAL_EXCERPT_WORDS}')
    for a in groups['assumptions']:
        if not str(a.get('text', '')).strip(): err(f'{a.get("id")}: text is required')
        refs(a.get('id'), a.get('scopeNotes', []), edges, 'edge case')
        if not isinstance(a.get('incompatibleWith', []), list) or set(a.get('incompatibleWith', [])) - STATES: err(f'{a.get("id")}: incompatibleWith must use known states')

    for d in groups['derivedClaims']:
        i = d.get('id')
        if 'sources' in d or 'excerpt' in d: err(f'{i}: derived claims must not carry source excerpts (cite facts instead)')
        if not d.get('derivedFrom'): err(f'{i}: derivedFrom is required')
        refs(i, d.get('derivedFrom', []), claims - {i}, 'claim')
        refs(i, d.get('assumptions', []), assumptions, 'assumption')
        if not isinstance(d.get('expertJudgment'), bool): err(f'{i}: expertJudgment must be true or false')
        check_state(i, d)
        assurance(i, d, AI_RESULTS_REASONING)

    if isinstance(rel, dict):
        if not str(rel.get('summary', '')).strip(): err('relationship.summary is required')
        refs(rel.get('id'), rel.get('claims', []), claims, 'claim')
        assurance(rel.get('id'), rel, AI_RESULTS_REASONING)
    for s in groups['situations']:
        i = s.get('id')
        for k in ('title', 'setup', 'outcome'):
            if not str(s.get(k, '')).strip(): err(f'{i}: {k} is required')
        if not s.get('outcomeClaims'): err(f'{i}: outcomeClaims are required')
        refs(i, s.get('outcomeClaims', []), claims, 'claim')
        refs(i, s.get('assumptions', []), assumptions, 'assumption')
        refs(i, s.get('supportingFacts', []), facts, 'fact')
        check_state(i, s)
        assurance(i, s, AI_RESULTS_REASONING)
    if len(groups['situations']) != 2: err('exactly two contrasting situations are required')
    if isinstance(cp, dict):
        if not str(cp.get('text', '')).strip(): err('comparisonPrompt.text is required')
        for e in cp.get('expectedElements', []): refs(e.get('id'), e.get('claims', []), claims, 'claim')
        refs(cp.get('id'), cp.get('situations', []), {x.get('id') for x in groups['situations']}, 'situation')
        assurance(cp.get('id'), cp, AI_RESULTS_REASONING)

    if not groups['applicationChecks']: err('at least one application check is required')
    for q in groups['applicationChecks']:
        qid = q.get('id')
        if q.get('status') not in ('candidate', 'accepted', 'retired'): err(f'{qid}: status must be candidate, accepted or retired')
        opts = q.get('options') or []
        oids = [o.get('id') for o in opts]
        if len(opts) < 3: err(f'{qid}: at least three options are required')
        if len(set(oids)) != len(oids) or not all(oids): err(f'{qid}: option ids must be present and unique')
        if not all(str(o.get('text', '')).strip() for o in opts): err(f'{qid}: every option needs text')
        if len({str(o.get('text', '')).strip() for o in opts}) != len(opts): err(f'{qid}: duplicate option texts')
        if q.get('answer') not in oids: err(f'{qid}: answer must be exactly one existing option id')
        wrong = set(oids) - {q.get('answer')}
        notes, dclaims = q.get('distractorNotes') or {}, q.get('distractorClaims') or {}
        if set(notes) != wrong: err(f'{qid}: every wrong option (and only those) needs a distractor note')
        if set(dclaims) != wrong or not all(isinstance(v, list) and v for v in dclaims.values()): err(f'{qid}: every wrong option (and only those) needs distractorClaims')
        for v in dclaims.values(): refs(qid, v if isinstance(v, list) else [], claims, 'claim')
        if not str(q.get('rationale', '')).strip() or not q.get('rationaleClaims'): err(f'{qid}: rationale and rationaleClaims are required')
        refs(qid, q.get('rationaleClaims', []), claims, 'claim')
        if not set(q.get('rationaleClaims', [])) & facts and not any(f in facts for f in closure(pack, q.get('rationaleClaims', []))):
            err(f'{qid}: the rationale must rest on at least one source fact')
        refs(qid, q.get('assumptions', []), assumptions, 'assumption')
        if not isinstance(q.get('expertJudgment'), bool): err(f'{qid}: expertJudgment must be true or false')
        bare = [o for o in opts if str(o.get('text', '')).strip().lower() in BARE_LABELS]
        if bare and not str(q.get('labelOptionsJustification', '')).strip():
            err(f'{qid}: bare A/B/both/neither style options need a reviewed labelOptionsJustification')
        if not str(q.get('ambiguity', '')).strip(): err(f'{qid}: ambiguity note is required (write "none known" if none)')
        check_state(qid, q)
        assurance(qid, q, AI_RESULTS_REASONING)

    for v in groups['advancedScenarios']:
        vid = v.get('id')
        if any(k.lower() in KEY_FIELDS for k in v): err(f'{vid}: advanced scenarios must not carry options or an answer key')
        if not str(v.get('prompt', '')).strip() or not str(v.get('notKeyed', '')).strip(): err(f'{vid}: prompt and notKeyed are required')
        refs(vid, v.get('claims', []), claims, 'claim')
        for p in v.get('discussionPoints', []): refs(vid, p.get('claims', []), claims, 'claim')
        assurance(vid, v, AI_RESULTS_REASONING)

    # ---- dependency graph: resolved, acyclic, no hidden dependencies, correctly classified, no orphans
    g = graph(pack)
    for i, deps in g.items():
        for x in deps:
            if x not in g: err(f'{i}: unresolved dependency {x}')
    for cyc in _cycles(g): err(f'circular dependency: {" → ".join(cyc)}')
    for i, (kind, it) in its.items():
        if kind in ('fact', 'edge', 'assumption'): continue
        reach = closure(pack, [i])
        for s in _strings({k: v for k, v in it.items() if k not in ('aiCheck', 'technicalValidation')}):
            for m in ID_IN_TEXT.findall(s):
                if m in its and m not in reach: err(f'{i}: hidden dependency — text cites {m}, which is not a declared dependency')
    pilot = pack.get('pilot')
    if not isinstance(pilot, dict): err('pilot.coreRoots and pilot.advancedRoots are required'); return E
    core_roots, adv_roots = pilot.get('coreRoots') or [], pilot.get('advancedRoots') or []
    for x in core_roots + adv_roots:
        if x not in its: err(f'pilot: unknown root {x}')
    checks = {q.get('id') for q in groups['applicationChecks'] if q.get('status') != 'retired'}
    retired = {q.get('id') for q in groups['applicationChecks'] if q.get('status') == 'retired'}
    advanced = {v.get('id') for v in groups['advancedScenarios']}
    if checks - set(core_roots): err(f'pilot: keyed checks must be core roots: {sorted(checks - set(core_roots))}')
    if retired & set(core_roots): err(f'pilot: retired checks cannot be core roots: {sorted(retired & set(core_roots))}')
    decisions = (r or {}).get('decisions') or {} if isinstance(r, dict) else {}
    for q in groups['applicationChecks']:
        if q.get('status') == 'accepted' and decisions.get(q.get('id')) != 'ACCEPT':
            err(f'{q.get("id")}: status "accepted" requires a human ACCEPT decision for that check')
    if set(core_roots) & advanced: err(f'pilot: advanced scenarios cannot be core roots: {sorted(set(core_roots) & advanced)}')
    if set(adv_roots) != advanced: err('pilot.advancedRoots must list exactly the advanced scenarios')
    core = closure(pack, core_roots)
    adv_facts = {f.get('id') for f in groups['facts'] if f.get('scope') == 'advanced'}
    leaked = sorted(core & (adv_facts | advanced))
    if leaked: err(f'core depends on advanced material {leaked} (incorrectly classified dependency)')
    for qid in checks:
        bad = sorted(closure(pack, [qid]) & adv_facts)
        if bad: err(f'{qid}: keyed check depends on advanced facts {bad}')
    orphans = sorted(set(its) - core - closure(pack, adv_roots) - retired)   # retired checks are kept only as history
    if orphans: err(f'orphan items not reachable from any pilot root: {orphans}')
    label = (pilot.get('assessmentLabel') or {})
    if not label.get('ko') or not label.get('en'): err('pilot.assessmentLabel needs ko and en text')
    low = (str(label.get('ko', '')) + ' ' + str(label.get('en', ''))).lower()
    for w in FORBIDDEN_LABEL_WORDS:
        if w.lower() in low: err(f'pilot.assessmentLabel must not claim mastery or permanence ({w})')
    return E


def main(paths):
    paths = [Path(p) for p in paths] or sorted(PACK_DIR.glob('*.json'))
    bad = 0
    for p in paths:
        with open(p, encoding='utf-8') as f: pack = json.load(f)
        errors = validate(pack)
        status = (pack.get('review') or {}).get('status')
        print(f'{p.name}: {"OK" if not errors else "INVALID"} · review={status} · core_eligible={core_eligible(pack)} · '
              f'may_award={pack_may_award(pack)} · core items={len(core_ids(pack))}')
        for e in errors: print('  -', e)
        bad += bool(errors)
    return 1 if bad or not paths else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
