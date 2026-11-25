"""Q3-B: the feedback prompt's teaching rules and the pipeline around them. Offline: all feedback below is AUTHORED (tests/
fixtures/q3b_development.json) and MOCKED. These tests check what the model is told and what the app does with a response.
They cannot show that the prompt changes what a model writes. Run: python3 -m unittest tests.test_feedback_pedagogy"""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tools'))
import server  # noqa: E402

DEV = json.loads((ROOT / 'tests/fixtures/q3b_development.json').read_text(encoding='utf-8'))['cases']
SPEC, CASE = server.FEEDBACK_SPEC, {c['id']: c for c in DEV}
CRITIQUES = ('precision', 'misconceptions', 'missing')


def prompt(c): return server.build_feedback_user({'lesson': c['lesson'], 'text': c['text'], 'context': c.get('context')})[1]
def review(c, which='desired'): return server.review_feedback(json.loads(json.dumps(c[which])), {k['id'] for k in c['lesson']['concepts']}, c['text'])
def first(f): return next(((k, f[k][0]) for k in ('misconceptions', 'precision', 'missing') if f[k]), None)   # index.html renderFeedback order


class Contract(unittest.TestCase):
    def test_each_teaching_rule_is_stated_once(self):
        for rule in ('돌려 말하지 않고', 'question이 묻는 내용(조건 목록, 비교 결과, 고친 문장)을 대신 쓰지 않는다', 'misconceptions, precision, missing 순으로',
                     '꼭 필요하지 않은 precision은 넣지 않는다', '아직 하지 않은 추론', '어디에도 이미 나와 있지 않아야 한다', '꼭 필요한 내용은 지우지 말고',
                     '이미 정확하게 설명했다면 correct로 인정하고', '틀린 결론에 이르는 표현은 짚는다'):
            self.assertEqual(SPEC.count(rule), 1, rule)
    def test_bounded_size(self): self.assertLessEqual(len(SPEC), 2400)
class Pipeline(unittest.TestCase):
    """Authored feedback through the production validators (mocked; nothing generated)."""
    def test_desired_feedback_survives_unchanged(self):
        for c in DEV:
            with self.subTest(c['id']):
                f = review(c); self.assertEqual(f['withheld'], 0)
                for k in ('summary', 'uncertainty'): self.assertEqual(f[k], c['desired'][k])
                if c['id'] == 'D9': continue
                for k in ('correct',) + CRITIQUES: self.assertEqual(f[k], c['desired'][k], k)
    def test_hedged_guess_is_shown_as_a_point_to_refine(self):
        f = review(CASE['D9']); self.assertEqual(f['misconceptions'], []); self.assertEqual(f['precision'][0]['reclassified'], 'hypothesis')
        self.assertEqual(f['precision'][0]['issue'], CASE['D9']['desired']['misconceptions'][0]['issue'], 'the correction itself is kept')
    def test_completed_objective_leaves_no_question(self):
        for i in ('D5', 'D8'): self.assertIsNone(first(review(CASE[i])), i); self.assertTrue(review(CASE[i])['correct'])
    def test_required_gap_is_the_first_question_only_without_optional_precision(self):
        self.assertEqual(first(review(CASE['D6']))[0], 'missing')
        self.assertEqual(first(review(CASE['D6'], 'flawed'))[0], 'precision', 'the app shows precision first: the prompt has to say so')
    def test_flawed_examples_are_valid_so_the_validators_do_not_police_teaching(self):
        """No keyword filter: a factual correction (or a poor one) is never removed for its content."""
        for c in DEV:
            if 'flawed' in c: self.assertEqual(review(c, 'flawed')['withheld'], 0, c['id'])


class Inputs(unittest.TestCase):
    def test_minimal_and_populated_inputs_build_without_labels(self):
        for c in DEV:
            with self.subTest(c['id']):
                p = prompt(c); self.assertTrue(p.endswith(c['text'])); self.assertIn('검증 전', p)
                self.assertIn('[학습자 기록' if c.get('context') else '포함되지 않았다', p)
                expect = [s for v in c['expect'].values() for s in (v if isinstance(v, list) else [v]) if len(s) > 8]
                for s in expect + [c['cover']]: self.assertNotIn(s, p); self.assertNotIn(s, SPEC)
        self.assertTrue({'D4'} <= {c['id'] for c in DEV if c.get('context')})
if __name__ == '__main__': unittest.main()
