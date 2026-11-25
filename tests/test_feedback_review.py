"""Feedback correctness rules (schema 2). Run: python3 -m unittest tests.test_feedback_review
Uses hand-written stand-ins for model output: tests CURIVEN's enforcement, not model quality."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402

FIX = json.loads((ROOT / 'tests' / 'fixtures' / 'feedback_cases.json').read_text(encoding='utf-8'))


class FeedbackCases(unittest.TestCase):
    def test_shared_cases(self):
        for case in FIX['cases']:
            with self.subTest(case['name']):
                out = server.review_feedback(case['model'], set(FIX['concepts']), case['text'])
                e = case['expect']
                self.assertEqual(out['schema'], 2)
                for k in ('correct', 'precision', 'misconceptions'):
                    self.assertEqual(len(out[k]), e[k], k)
                self.assertEqual([x['id'] for x in out['explained']], e['explained'])
                self.assertEqual(out['demonstrated'], e['explained'], 'legacy field mirrors evidence-backed concepts only')
                self.assertEqual(out['withheld'], e['withheld'])
                # Withheld judgements are counted in the record, not narrated to the learner (UX-01/UX-11).
                self.assertNotIn('표시하지 않았어요', out['uncertainty'])
                if e.get('uncertainty'): self.assertTrue(out['uncertainty'])
                # Every criticism that survives quotes the learner and says why.
                for item in out['precision'] + out['misconceptions']:
                    self.assertTrue(server.quote_found(item['quote'], case['text']), item)
                    self.assertTrue(item['why'])
                for item in out['correct']:
                    if item['quote']: self.assertTrue(server.quote_found(item['quote'], case['text']))

    def test_speech_acts_and_partial_critique_quotes(self):
        cases = json.loads((ROOT / 'tests/fixtures/q3a_speech_acts.json').read_text())
        for text, kind, reason in cases['development'] + cases['reserve']:
            with self.subTest(text=text):
                self.assertEqual(server.utterance_kind(text), kind, reason)
        for text, quote, kind, reason in cases['partialQuotes']:
            item = dict(quote=quote, issue='i', why='w', question='q')
            feedback = server.review_feedback(dict(summary='s', misconceptions=[item]), set(), text)
            self.assertEqual(server.quote_kind(quote, text), kind, reason)
            if kind == 'claim':
                self.assertEqual(feedback['misconceptions'], [item])
            else:
                self.assertEqual(feedback['precision'], [{**item, 'reclassified': kind}])

    def test_evidence_integrity_and_revalidation(self):
        cases = json.loads((ROOT / 'tests/fixtures/evidence_integrity.json').read_text())
        for text, quote, eligible, *critique in cases:
            with self.subTest(text=text, quote=quote):
                item = dict(id='k1', quote=quote)
                raw = dict(summary='s', explained=[item, item, dict(id='unknown', quote=quote)])
                if critique:
                    raw['misconceptions'] = [dict(quote=critique[0], issue='i', why='w', question='q')]
                f = server.review_feedback(raw, {'k1'}, text)
                self.assertEqual(f['explained'], [item] if eligible else [])
                self.assertEqual(server.review_feedback(f, {'k1'}, text), f)

    def test_ordinary_precision_and_full_reclassified_list(self):
        own, guess = '물은 높은 데서 낮은 데로 흘러요.', '물이 거꾸로 흐를 것 같아요.'
        text, at = own + ' ' + guess, lambda quote: [dict(quote=quote, issue='i', why='w', question='q')] * 8
        f = server.review_feedback(dict(summary='s', explained=[dict(id='k1', quote=own)], precision=at(own),
                                        misconceptions=at(guess)), {'k1'}, text)
        self.assertEqual([len(f[k]) for k in ('explained', 'precision', 'misconceptions')], [1, 16, 0])
        self.assertEqual(server.review_feedback(f, {'k1'}, text), f)

    def test_empty_lists_are_valid(self):
        out = server.review_feedback({'summary': '좋아요'}, {'k1'}, '아무 설명이나 충분히 길게 적었어요.')
        self.assertEqual((out['precision'], out['misconceptions'], out['explained'], out['withheld']), ([], [], [], 0))

    def test_quote_matching(self):
        text = 'HTTP는 상태가 없어서 서버는 요청 하나만 보고는 같은 사용자인지 알 수 없어요.'
        self.assertTrue(server.quote_found('서버는 요청 하나만 보고는', text))
        self.assertTrue(server.quote_found('서버는  요청 하나만, 보고는!', text), 'spacing and punctuation never decide')
        self.assertTrue(server.quote_found('같은 사용자인지 알 수 없다', text), 'changed sentence ending tolerated')
        self.assertFalse(server.quote_found('서버는 모든 요청을 기억한다', text))
        self.assertFalse(server.quote_found('HTTP', text), 'too short to identify a claim')
        self.assertFalse(server.quote_found('', text))

    def test_prompt_states_the_three_categories_and_no_model_answer(self):
        spec = server.FEEDBACK_SPEC
        for needle in ['correct:', 'precision:', 'misconceptions:', '오개념이 아니다', '글자 그대로', '모범 답안을 쓰지 않는다', 'uncertainty', '"why"']:
            self.assertIn(needle, spec)


if __name__ == '__main__':
    unittest.main()
