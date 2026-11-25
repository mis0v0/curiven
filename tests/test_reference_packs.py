"""Reference-pack validation and approval gates. Run: python3 -m unittest tests.test_reference_packs
These check structure, provenance, dependencies and gate logic. They do NOT show that excerpts are verbatim at
their sources, that claims are true, or that any learning benefit exists — those need human/expert review and studies."""
import copy, hashlib, json, sys, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tools'))
import validate_reference_packs as V  # noqa: E402
import server  # noqa: E402

PACK_PATH = ROOT / 'reference-packs' / 'http-cookie-vs-server-session.v1.json'
PACK = json.loads(PACK_PATH.read_text(encoding='utf-8'))
CORE_ROOTS = ['R1', 'S1', 'S2', 'P1', 'K1', 'K3']
ADVANCED_ONLY = {'V1', 'D5', 'F11', 'F12', 'F13'}


def mutated(fn):
    p = copy.deepcopy(PACK); fn(p); return V.validate(p)


def by_id(p, i):
    return V.items(p)[i][1]


def approve(p, accept=None, decisions=None, experts=(), accept_checks=False):
    """Simulates a finished human review (tests only). Never used on the real pack file."""
    p['review'].update(status='reviewed', reviewedBy='test reviewer', reviewedAt='2026-12-01')
    p['review']['decisions'] = decisions if decisions is not None else {i: 'ACCEPT' for i in (accept or V.reviewable_ids(p))}
    for i in experts: by_id(p, i)['technicalValidation'] = {'status': 'expert', 'by': 'test expert', 'at': '2026-12-02'}
    if accept_checks:
        for q in p['applicationChecks']: q['status'] = 'accepted'
    return p


class RejectionCase(unittest.TestCase):
    def assertRejected(self, fn, needle):
        errors = mutated(fn)
        self.assertTrue(any(needle in e for e in errors), f'expected an error containing {needle!r}, got {errors}')


class PilotPack(unittest.TestCase):
    def test_valid_draft_with_no_decisions_and_nothing_usable(self):
        self.assertEqual(V.validate(PACK), [])
        r = PACK['review']
        self.assertEqual((r['status'], r['reviewedBy'], r['reviewedAt'], r['decisions']), ('draft', None, None, {}))
        self.assertFalse(V.core_eligible(PACK)); self.assertFalse(V.pack_may_award(PACK))
        self.assertFalse(V.advanced_enabled(PACK, 'V1'))
        self.assertEqual(V.servable_ids(PACK), set(), 'a draft serves nothing')

    def test_no_item_is_technically_validated_or_approved_by_tooling(self):
        for i, (kind, it) in V.items(PACK).items():
            if 'technicalValidation' in it: self.assertEqual(it['technicalValidation'], {'status': 'none'}, i)
            for k in ('humanApproval', 'approved', 'decision'): self.assertNotIn(k, it)

    def test_core_and_advanced_partition(self):
        self.assertEqual(PACK['pilot']['coreRoots'], CORE_ROOTS)
        core, adv = V.core_ids(PACK), V.closure(PACK, ['V1'])
        self.assertEqual(adv - core, ADVANCED_ONLY)
        self.assertFalse(core & ADVANCED_ONLY)
        self.assertEqual(set(V.reviewable_ids(PACK)), core | adv, 'no orphans')

    def test_assessment_label_is_narrow(self):
        self.assertEqual(PACK['pilot']['assessmentLabel']['en'], 'Passed two source-keyed distinction questions.')
        self.assertEqual(len([q for q in PACK['applicationChecks'] if q['status'] != 'retired']), 2)
        self.assertTrue(all(q['status'] == 'candidate' for q in PACK['applicationChecks']), 'no check is pre-accepted')

    def test_quotation_budget_and_normativity(self):
        srcs = [s for f in PACK['facts'] for s in f['sources']] + [s for e in PACK['edgeCases'] for s in e['sources']]
        self.assertLessEqual(sum(V.words(s['excerpt']) for s in srcs), V.MAX_TOTAL_EXCERPT_WORDS)
        self.assertTrue(all(s['normativity'] in V.NORMATIVITY for s in srcs))


class PublishedEdition(unittest.TestCase):
    def test_no_upstream_text_and_no_claimed_check(self):
        refs = [s for x in PACK['facts'] + PACK['edgeCases'] for s in x['sources']]
        self.assertEqual(len(refs), 18)
        for s in refs: self.assertTrue(s['excerpt'].startswith('Paraphrase: '), s)
        self.assertIn('No upstream text is reproduced', PACK['authoring']['quotationPolicy'])
        for i, (kind, it) in V.items(PACK).items():
            if 'aiCheck' in it: self.assertEqual(it['aiCheck'], {'result': 'not-checked'}, i)


class SevenCorrections(unittest.TestCase):
    """Guards against regressions of the flagged items (their wording is still for a human to judge)."""
    def test_F2_does_not_imply_cookies_are_always_sent(self):
        f2 = by_id(PACK, 'F2')
        self.assertIn('MAY', [s['normativity'] for s in f2['sources']])
        self.assertEqual([s['normativity'] for s in f2['sources']], ['descriptive', 'MAY', 'descriptive', 'MAY'])
        self.assertIn('항상 저장되거나 전송된다고 할 수는 없다', f2['claim'])
        self.assertIn('저장을 요청한다', f2['claim'])

    def test_F5_keeps_SHOULD_and_guidance_is_attributed(self):
        f5 = by_id(PACK, 'F5')
        self.assertEqual([s['normativity'] for s in f5['sources']], ['SHOULD'])
        self.assertIn('권고', f5['claim'])
        for i in ('F4', 'F6', 'F7', 'F8'):
            self.assertTrue(by_id(PACK, i)['claim'].startswith('OWASP 지침은'), i)
            self.assertEqual({s['normativity'] for s in by_id(PACK, i)['sources']}, {'guidance-must'}, i)

    def test_A2_only_where_the_cookie_exists(self):
        a2 = by_id(PACK, 'A2')
        self.assertIn('저장소에 있는 동안', a2['text']); self.assertIn('서버는 그 안의 세션 식별자를 받는다', a2['text'])
        self.assertEqual(a2['incompatibleWith'], ['browser-cookie-deleted'])
        for i in ('S1', 'K1', 'D1'):
            self.assertNotIn('A2', V.closure(PACK, [i]), f'{i} describes a deleted cookie and must not rely on A2')
        self.assertIn('A2', V.closure(PACK, ['S2'])); self.assertIn('A2', V.closure(PACK, ['K3']))

    def test_D1_is_conditional_on_no_other_identification(self):
        d1 = by_id(PACK, 'D1')
        self.assertTrue(d1['claim'].startswith('다른 식별 수단이 없다는 조건에서'))
        self.assertIn('A3', d1['assumptions'])

    def test_D3_avoids_universal_browser_claims(self):
        d3 = by_id(PACK, 'D3')
        self.assertIn('전송 조건이 맞으면', d3['claim']); self.assertIn('보낼 수 있다', d3['claim'])
        self.assertEqual(sorted(d3['state']), ['browser-cookie-present', 'server-session-ended'])

    def test_S1_states_next_request_conditions_without_contradiction(self):
        s1 = by_id(PACK, 'S1')
        self.assertEqual(s1['assumptions'], ['A1', 'A3', 'A4'])
        self.assertIn('쿠키 저장소에는 이 사이트의 세션 쿠키가 없습니다', s1['setup'])
        self.assertIn('다시 요청을 보냅니다', s1['setup'])

    def test_P1_asks_about_state_not_screens(self):
        p1 = by_id(PACK, 'P1')
        self.assertNotIn('로그아웃된 것처럼', p1['text']); self.assertIn('상태를 기준으로', p1['text'])
        self.assertEqual(p1['situations'], ['S1', 'S2'])

    def test_K1_scope(self):
        self.assertIn('모든 사이트가 이렇게 만들어지는 것은 아닙니다', by_id(PACK, 'K1')['stem'])

    def test_keyed_checks_cover_both_directions(self):
        states = {q['id']: set(q['state']) for q in PACK['applicationChecks']}
        self.assertEqual(set(states), {'K1', 'K3'})
        self.assertEqual(states['K1'], {'browser-cookie-deleted', 'server-session-active'})
        self.assertEqual(states['K3'], {'browser-cookie-present', 'server-session-ended'})
        self.assertIn('D3', V.closure(PACK, ['K3'])); self.assertIn('F7', V.closure(PACK, ['K3']))
        self.assertNotIn('K2', V.items(PACK), 'the cookie-only logout item is no longer part of the pack')


class Contradictions(RejectionCase):
    def test_deleted_cookie_with_transmission_assumption(self):
        self.assertRejected(lambda p: by_id(p, 'S1')['assumptions'].append('A2'), 'S1: contradictory assumption A2')
        self.assertRejected(lambda p: by_id(p, 'K1')['assumptions'].append('A2'), 'K1: contradictory assumption A2')

    def test_ended_session_with_active_session_assumption(self):
        self.assertRejected(lambda p: by_id(p, 'S2')['assumptions'].append('A4'), 'S2: contradictory assumption A4')

    def test_contradiction_through_a_derived_claim(self):
        self.assertRejected(lambda p: by_id(p, 'D1')['assumptions'].append('A2'), 'contradictory assumption A2')
        self.assertRejected(lambda p: by_id(p, 'D3')['assumptions'].append('A4'), 'D3: contradictory assumption A4')

    def test_contradictory_state(self):
        self.assertRejected(lambda p: by_id(p, 'S1')['state'].append('browser-cookie-present'), 'contradictory state')
        self.assertRejected(lambda p: by_id(p, 'K3')['state'].append('flying'), 'state must use')
        self.assertRejected(lambda p: by_id(p, 'K3')['assumptions'].append('A4'), 'K3: contradictory assumption A4')


class DependencyGraph(RejectionCase):
    def test_unresolved(self):
        self.assertRejected(lambda p: by_id(p, 'K1')['rationaleClaims'].append('F99'), 'unresolved dependency F99')
        self.assertRejected(lambda p: by_id(p, 'A1')['scopeNotes'].append('E9'), 'unresolved dependency E9')
        self.assertRejected(lambda p: p['pilot']['coreRoots'].append('S9'), 'unknown root S9')

    def test_circular(self):
        def cyc(p):
            by_id(p, 'D4')['derivedFrom'].append('D1'); by_id(p, 'D1')['derivedFrom'].append('D4')
        self.assertRejected(cyc, 'circular dependency')

    def test_hidden_dependency_in_text(self):
        def hide(p):
            by_id(p, 'K1')['distractorClaims']['c'] = ['F3']        # its note still cites F1
        self.assertRejected(hide, 'K1: hidden dependency — text cites F1')
        self.assertRejected(lambda p: by_id(p, 'K3').__setitem__('rationale', by_id(p, 'K3')['rationale'] + ' (F10 참고)'), 'K3: hidden dependency — text cites F10')

    def test_missing_distractor_dependencies(self):
        self.assertRejected(lambda p: by_id(p, 'K3')['distractorClaims'].pop('c'), 'needs distractorClaims')

    def test_incorrect_classification(self):
        self.assertRejected(lambda p: p['pilot']['coreRoots'].append('V1'), 'advanced scenarios cannot be core roots')
        self.assertRejected(lambda p: p['pilot']['coreRoots'].remove('K3'), 'keyed checks must be core roots')
        self.assertRejected(lambda p: by_id(p, 'F9').__setitem__('scope', 'advanced'), 'core depends on advanced material')
        self.assertRejected(lambda p: by_id(p, 'K1')['rationaleClaims'].append('D5'), 'core depends on advanced material')
        self.assertRejected(lambda p: by_id(p, 'D2')['derivedFrom'].append('F11'), 'core depends on advanced material')
        self.assertRejected(lambda p: p['pilot']['advancedRoots'].clear(), 'advancedRoots must list exactly')

    def test_orphans(self):
        def orphan(p):
            f = copy.deepcopy(by_id(p, 'F1')); f['id'] = 'F99'; p['facts'].append(f)
        self.assertRejected(orphan, 'orphan items not reachable from any pilot root')

    def test_concepts_cannot_carry_unreviewed_claims(self):
        self.assertRejected(lambda p: p['concepts'][0].__setitem__('role', '쿠키는 항상 전송된다'), 'only id, name and aliases')


class AnswerKeysAndRationales(RejectionCase):
    def test_invalid_answer_keys(self):
        self.assertRejected(lambda p: by_id(p, 'K1').__setitem__('answer', 'z'), 'answer must be exactly one existing option')
        self.assertRejected(lambda p: by_id(p, 'K1')['options'].append({'id': 'a', 'text': 'x'}), 'option ids must be present and unique')
        self.assertRejected(lambda p: by_id(p, 'K3')['distractorNotes'].__setitem__('a', 'x'), 'distractor note')
        self.assertRejected(lambda p: by_id(p, 'K3').__setitem__('options', by_id(p, 'K3')['options'][:2]), 'at least three options')

    def test_unsupported_rationales(self):
        self.assertRejected(lambda p: by_id(p, 'K1').__setitem__('rationaleClaims', []), 'rationale and rationaleClaims are required')
        self.assertRejected(lambda p: by_id(p, 'K1').__setitem__('rationale', ''), 'rationale and rationaleClaims are required')
        self.assertRejected(lambda p: by_id(p, 'K1')['rationaleClaims'].append('A1'), 'unknown claim reference A1')

    def test_ambiguous_label_options_need_justification(self):
        def labels(p):
            q = by_id(p, 'K1')
            q['options'] = [{'id': 'a', 'text': '쿠키'}, {'id': 'b', 'text': '세션'}, {'id': 'c', 'text': '둘 다'}]
            q['distractorNotes'] = {'b': 'x', 'c': 'x'}; q['distractorClaims'] = {'b': ['F2'], 'c': ['F2']}
        self.assertRejected(labels, 'labelOptionsJustification')

    def test_label_cannot_claim_mastery(self):
        self.assertRejected(lambda p: p['pilot']['assessmentLabel'].__setitem__('en', 'Verified understanding'), 'must not claim mastery')
        self.assertRejected(lambda p: p['pilot']['assessmentLabel'].__setitem__('ko', '쿠키와 세션 마스터'), 'must not claim mastery')


class ProvenanceAndAssurance(RejectionCase):
    def test_provenance(self):
        self.assertRejected(lambda p: by_id(p, 'F1').__setitem__('sources', []), 'at least one source is required')
        self.assertRejected(lambda p: by_id(p, 'F1')['sources'][0].__setitem__('locator', ''), 'locator')
        self.assertRejected(lambda p: by_id(p, 'F1')['sources'][0].__setitem__('url', 'https://example.com/x'), 'does not belong to source')
        self.assertRejected(lambda p: by_id(p, 'F1')['sources'][0].__setitem__('excerpt', 'word ' * 30), 'longer than')
        self.assertRejected(lambda p: by_id(p, 'F5')['sources'][0].pop('normativity'), 'normativity must be one of')
        self.assertRejected(lambda p: by_id(p, 'D2').__setitem__('sources', by_id(p, 'F9')['sources']), 'must not carry source excerpts')

    def test_assurance_levels_stay_separate(self):
        self.assertRejected(lambda p: by_id(p, 'F1')['aiCheck'].__setitem__('result', 'excerpt-not-found'), 'aiCheck.result')
        self.assertRejected(lambda p: by_id(p, 'F1')['aiCheck'].__setitem__('result', 'excerpt-found'), 'checkedAt date is required')
        self.assertEqual(mutated(lambda p: by_id(p, 'F1').__setitem__('aiCheck', {'result': 'excerpt-found', 'checkedAt': '2026-01-02'})), [])
        self.assertRejected(lambda p: by_id(p, 'D2')['technicalValidation'].__setitem__('status', 'expert'), 'needs by and at')
        self.assertRejected(lambda p: by_id(p, 'F1').__setitem__('humanApproval', 'ACCEPT'), 'belongs only in review.decisions')

    def test_hidden_evaluation_fields_rejected(self):
        self.assertRejected(lambda p: p.__setitem__('heldBack', ['Q3']), 'hidden-evaluation field')
        self.assertRejected(lambda p: by_id(p, 'V1').__setitem__('answer', 'a'), 'must not carry options or an answer key')


class Gates(unittest.TestCase):
    def test_core_usable_while_advanced_is_unapproved(self):
        p = copy.deepcopy(PACK)
        decisions = {i: 'ACCEPT' for i in V.core_ids(p)}
        decisions.update({i: 'REJECT' for i in ADVANCED_ONLY})
        approve(p, decisions=decisions, accept_checks=True)
        self.assertEqual(V.validate(p), [])
        self.assertTrue(V.core_eligible(p)); self.assertTrue(V.pack_may_award(p))
        self.assertFalse(V.advanced_enabled(p, 'V1'))
        self.assertFalse(V.servable_ids(p) & ADVANCED_ONLY, 'unapproved advanced material never becomes servable')

    def test_advanced_needs_its_whole_closure_and_an_expert(self):
        p = approve(copy.deepcopy(PACK))
        self.assertTrue(V.core_eligible(p))
        self.assertFalse(V.advanced_enabled(p, 'V1'), 'ACCEPT without expert validation')
        approve(p, experts=['D5'])
        self.assertFalse(V.advanced_enabled(p, 'V1'), 'the advanced item itself always needs an expert, even when its claims are validated')
        p = approve(copy.deepcopy(PACK), experts=['V1'])
        self.assertFalse(V.advanced_enabled(p, 'V1'), 'D5 is expertJudgment and still unvalidated')
        approve(p, experts=['V1', 'D5'])
        self.assertTrue(V.advanced_enabled(p, 'V1'))
        self.assertTrue(ADVANCED_ONLY <= V.servable_ids(p))
        p['review']['decisions']['F12'] = 'REVISE'
        self.assertFalse(V.advanced_enabled(p, 'V1'), 'any dependency not accepted blocks the advanced item')
        self.assertTrue(V.core_eligible(p), '…without affecting the core')

    def test_any_core_dependency_not_accepted_blocks_core(self):
        for dep in ('F9', 'A3', 'D2', 'E1', 'R1', 'P1', 'S2'):
            p = approve(copy.deepcopy(PACK))
            p['review']['decisions'][dep] = 'REVISE'
            self.assertFalse(V.core_eligible(p), dep); self.assertEqual(V.servable_ids(p), set(), dep)

    def test_missing_and_invalid_decisions(self):
        p = approve(copy.deepcopy(PACK)); p['review']['decisions'].pop('F2')
        self.assertTrue(any('requires a decision for every item' in e for e in V.validate(p))); self.assertFalse(V.core_eligible(p))
        p = approve(copy.deepcopy(PACK)); p['review']['decisions']['F2'] = 'MAYBE'
        self.assertTrue(any('must be ACCEPT, REVISE or REJECT' in e for e in V.validate(p))); self.assertFalse(V.core_eligible(p))
        p = approve(copy.deepcopy(PACK)); p['review']['decisions']['Z1'] = 'ACCEPT'
        self.assertTrue(any('unknown item Z1' in e for e in V.validate(p))); self.assertFalse(V.core_eligible(p))
        p = approve(copy.deepcopy(PACK)); p['review']['reviewedBy'] = None
        self.assertFalse(V.core_eligible(p))

    def test_draft_never_awards_even_with_all_accepted(self):
        p = approve(copy.deepcopy(PACK), experts=['V1', 'D5'])
        for status in ('in_review', 'draft'):
            p['review']['status'] = status
            if status == 'draft': p['review'].update(reviewedBy=None, reviewedAt=None)
            self.assertFalse(V.pack_may_award(p), status); self.assertEqual(V.servable_ids(p), set(), status)

    def test_expert_dependent_core_material_needs_expert_validation(self):
        p = copy.deepcopy(PACK); by_id(p, 'K1')['expertJudgment'] = True; approve(p, accept_checks=True)
        self.assertFalse(V.core_eligible(p), 'human ACCEPT is not technical validation'); self.assertFalse(V.pack_may_award(p))
        approve(p, experts=['K1']); self.assertTrue(V.core_eligible(p))
        p = copy.deepcopy(PACK); by_id(p, 'D2')['expertJudgment'] = True; approve(p)
        self.assertFalse(V.core_eligible(p), 'an expert-flagged claim deep in the core also needs validation')

    def test_invalid_pack_fails_closed(self):
        p = approve(copy.deepcopy(PACK)); by_id(p, 'K1')['answer'] = 'z'
        self.assertFalse(V.core_eligible(p)); self.assertFalse(V.pack_may_award(p)); self.assertEqual(V.servable_ids(p), set())

    def test_candidate_and_retired_checks_never_award(self):
        p = approve(copy.deepcopy(PACK))                       # everything ACCEPT, checks still "candidate"
        self.assertTrue(V.core_eligible(p))
        self.assertFalse(V.pack_may_award(p)); self.assertEqual(V.awardable_checks(p), set())
        by_id(p, 'K1')['status'] = 'accepted'
        self.assertEqual(V.awardable_checks(p), {'K1'}); self.assertFalse(V.pack_may_award(p), 'K3 is still a candidate')
        by_id(p, 'K3')['status'] = 'accepted'
        self.assertTrue(V.pack_may_award(p)); self.assertEqual(V.awardable_checks(p), {'K1', 'K3'})
        q = copy.deepcopy(p); by_id(q, 'K3')['status'] = 'retired'
        self.assertTrue(any('retired checks cannot be core roots' in e for e in V.validate(q)))
        self.assertFalse(V.pack_may_award(q)); self.assertEqual(V.awardable_checks(q), set())
        q['pilot']['coreRoots'].remove('K3')                  # retired and moved out of the core: kept only as history
        self.assertEqual(V.validate(q), [])
        self.assertNotIn('K3', V.awardable_checks(q))

    def test_accepted_status_needs_a_human_accept(self):
        p = copy.deepcopy(PACK); by_id(p, 'K1')['status'] = 'accepted'
        self.assertTrue(any('requires a human ACCEPT decision' in e for e in V.validate(p)), 'a draft cannot pre-accept a check')
        p = approve(copy.deepcopy(PACK), accept_checks=True); p['review']['decisions']['K3'] = 'REVISE'
        self.assertTrue(any('K3: status "accepted" requires a human ACCEPT' in e for e in V.validate(p)))
        self.assertFalse(V.pack_may_award(p)); self.assertEqual(V.awardable_checks(p), set())

    def test_draft_with_accepted_checks_never_awards(self):
        p = approve(copy.deepcopy(PACK), accept_checks=True); p['review'].update(status='draft', reviewedBy=None, reviewedAt=None)
        self.assertFalse(V.pack_may_award(p)); self.assertEqual(V.awardable_checks(p), set())

    def test_ai_checks_never_count(self):
        p = copy.deepcopy(PACK)
        p['review'].update(status='reviewed', reviewedBy='x', reviewedAt='2026-12-01', decisions={})
        self.assertFalse(V.core_eligible(p), 'every item is AI-checked, yet nothing is approved')


class NothingServedOrChanged(unittest.TestCase):
    def setUp(self):
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close()

    def get(self, path):
        try:
            with urlopen(Request(self.base + path), timeout=5) as r: return r.status, r.read()
        except HTTPError as e: return e.code, b''

    def test_packs_docs_and_tools_are_not_served(self):
        for path in ['/reference-packs/http-cookie-vs-server-session.v1.json', '/reference-packs/', '/docs/BOUNDARY_CONSTELLATION_SPEC.md',
                     '/tools/validate_reference_packs.py', '/research/', '/../reference-packs/http-cookie-vs-server-session.v1.json']:
            self.assertEqual(self.get(path)[0], 404, path)

    def test_served_app_files_do_not_contain_pack_content(self):
        snippets = [q['stem'][:40] for q in PACK['applicationChecks']] + [PACK['comparisonPrompt']['text'][:40], PACK['advancedScenarios'][0]['prompt'][:40]]
        for path in server.STATIC:
            code, body = self.get(path)
            self.assertEqual(code, 200, path)
            text = body.decode('utf-8')
            for s in snippets: self.assertNotIn(s, text, path)
            for k in ('heldBack', 'reference-packs', 'advancedScenarios'): self.assertNotIn(k, text, path)

    def test_validator_is_read_only_and_app_does_not_read_packs(self):
        before = hashlib.sha256(PACK_PATH.read_bytes()).hexdigest()
        self.assertEqual(V.main([str(PACK_PATH)]), 0)
        self.assertEqual(hashlib.sha256(PACK_PATH.read_bytes()).hexdigest(), before)
        src = (ROOT / 'tools' / 'validate_reference_packs.py').read_text()
        for w in ["open(p, 'w'", '.write_text(', '.write_bytes(', 'localStorage']:
            self.assertNotIn(w, src)
        for f in ('index.html', 'learning.js', 'records.js', 'constellation.js', 'boundary.js', 'boundary-ui.js'):
            self.assertNotIn('reference-packs', (ROOT / f).read_text(), f'{f}: browser code never reads packs directly')
        # Stage B1: the server reads packs only through pilot_packs, only on the dev-gated /api/pilot/ route
        # (see tests/test_boundary_pilot.py), and the adapter is read-only like the validator.
        lines = [ln for ln in (ROOT / 'server.py').read_text().splitlines() if 'reference-packs' in ln]
        self.assertEqual(len(lines), 1); self.assertTrue(lines[0].startswith('PACK_DIR = '))
        adapter = (ROOT / 'pilot_packs.py').read_text()
        for w in ["'w'", '.write_text(', '.write_bytes(', 'json.dump(']:
            self.assertNotIn(w, adapter)


if __name__ == '__main__':
    unittest.main()
