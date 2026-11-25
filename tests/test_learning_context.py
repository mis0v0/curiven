"""Learning context for AI feedback and tutoring, visual explanations and source suggestions.
Run: python3 -m unittest tests.test_learning_context

Synthetic scenario regression: a previous review said the story was not supplied — it was right, the request did not contain it (learning.js feedbackPayload
sent title/concepts/technical only). All model output here is scripted; these tests check what the model is GIVEN
and what the app accepts, not how well the real model teaches."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tests'))
import server  # noqa: E402
from test_chatgpt import LiveServer  # noqa: E402

REC = json.loads((ROOT / 'tests/fixtures/memory_session.json').read_text(encoding='utf-8'))['record']
LES = REC['lesson']
PREMISE = '녹음에는 종소리가 없었습니다'

def context(rec=REC, answered=None):
    """Same shape as learning.js learningContext (checked against it in tests/learning_context.test.js)."""
    d = rec['lesson']; out = []
    for i, s in enumerate(d['scenarios']):
        r = next((x for x in rec['scenarios'] if x['i'] == i), None) if answered is None else ({'i': i, 'choice': 0} if answered else None)
        x = {'title': s['title'], 'question': s['question'], 'options': s['options'], 'answered': bool(r), 'unsure': bool(r and r.get('choice') is None),
             'learnerChoice': s['options'][r['choice']] if r and r.get('choice') is not None else None}
        if r: x.update(statedOutcome=s['options'][s['answerIndex']], reason=s['reason'])
        out.append(x)
    return {'story': d['story'], 'prediction': {'question': d['prediction'], 'learner': rec['prediction'], 'unsure': rec.get('predictionUnsure', False)},
            'scenarios': out, 'reflection': rec.get('reflection', '')}

def feedback_prompt(ctx):
    lesson = {k: LES[k] for k in ('title', 'explainPrompt', 'concepts', 'technical')}
    return server.build_feedback_user({'lesson': lesson, 'context': ctx, 'text': REC['drafts'][0]['text']})[1]


class FeedbackContext(unittest.TestCase):
    def test_red_bag_review_sees_the_scenario_premise(self):
        """Test C: the reviewer is given the story and the thought experiment's stated premise (no bag in the video),
        labelled as hypothetical, separately from the learner's own record and explanation."""
        p = feedback_prompt(context())
        self.assertIn(PREMISE, p); self.assertIn('종소리', p.split('[가상 상황')[1])
        self.assertIn('실제 사건이나 실제 실험 결과가 아니다', p)
        self.assertIn('학습자의 예상: (잘 모르겠다고 하고 넘어감)', p)
        self.assertIn('사고 실험 1에서 학습자의 선택: 두 번째 집단에서 더 높아질 수 있다.', p)
        self.assertIn('[제공되지 않은 정보]', p)
        # Order: lesson facts → hypothetical scenario → learner record → the explanation under review (last).
        i = [p.index(s) for s in ('[학습 자료', '[가상 상황', '[학습자 기록', '[학습자의 실제 설명')]
        self.assertEqual(i, sorted(i))
        self.assertTrue(p.rstrip().endswith(REC['drafts'][0]['text']), 'the learner text is passed verbatim')

    def test_spec_forbids_claiming_supplied_context_is_missing_or_real(self):
        for spec in (server.FEEDBACK_SPEC, server.TUTOR_SPEC):
            self.assertIn("'제공되지 않았다'", spec)
            self.assertIn('실제 사건이나 실제 실험 결과', spec)
        self.assertIn('지어내지 않는다', server.FEEDBACK_SPEC)

    def test_without_context_the_absence_is_stated_not_hidden(self):
        p = feedback_prompt(None)
        self.assertIn('이 요청에는 이야기나 사고 실험이 포함되지 않았다', p); self.assertNotIn(PREMISE, p)

    def test_unanswered_thought_experiment_is_not_spoiled(self):
        p = feedback_prompt(context(answered=False))
        self.assertIn(PREMISE, p, 'the premise (question) is shared')
        self.assertNotIn(LES['scenarios'][0]['reason'][:30], p, 'but not the explanation before the learner answers')
        self.assertIn('(아직 고르지 않음)', p)

    def test_context_is_bounded_and_sanitised(self):
        big = context(); big['story'] = '가' * 50_000; big['scenarios'] = big['scenarios'] * 5; big['prediction'] = {**big['prediction'], 'learner': '나' * 9000, 'unsure': False}
        big['scenarios'][0] = {**big['scenarios'][0], 'options': ['x' * 900] * 9}
        c = server.clean_context(big)
        self.assertEqual(len(c['story']), 2200); self.assertEqual(len(c['scenarios']), 4); self.assertEqual(len(c['learnerPrediction']), 800)
        self.assertEqual(len(c['scenarios'][0]['options']), 4); self.assertEqual(len(c['scenarios'][0]['options'][0]), 240)
        self.assertLess(len(server.context_block(c)), 12_000)
        for junk in (None, 'x', [], {'scenarios': 'no'}, {'story': ''}):
            self.assertIsNone(server.clean_context(junk))

    def test_tutor_gets_the_same_context(self):
        user, _ = server.build_tutor_user({'message': '빨간 가방은 왜 기억나요?', 'lesson': LES, 'context': context(), 'stage': 4})
        self.assertIn(PREMISE, user); self.assertIn('[학습자 기록', user)


class HedgedRecollection(unittest.TestCase):
    def test_scripted_quote_across_a_sentence_boundary_is_not_a_misconception(self):
        """Synthetic partial quotation spanning an uncertainty marker and a question."""
        draft = REC['drafts'][0]['text']; q = '아마 이 종을 전에 들은 적 있나요? 라고 물으면'
        self.assertEqual(server.quote_kind(q, draft), 'check')
        self.assertEqual(server.quote_kind('아마 가방이 있었을 거야', '아마 가방이 있었을 거야. 그건 확실해.'), 'hypothesis')
        self.assertEqual(server.sentence_kind('아마추어 사진가가 찍었다'), 'claim', '“아마추어” is not a hedge')
        out = server.review_feedback({'summary': 's', 'misconceptions': [{'quote': q, 'issue': 'i', 'why': 'w', 'question': 'q'}]}, set(), draft)
        self.assertEqual(out['misconceptions'], []); self.assertEqual(out['precision'][0]['reclassified'], 'check')


class ContextOverHttp(LiveServer):
    def test_feedback_request_carries_context_to_the_model(self):
        self.bridge.text = json.dumps({'summary': '좋아요', 'uncertainty': ''}, ensure_ascii=False)
        lesson = {k: LES[k] for k in ('title', 'explainPrompt', 'concepts', 'technical')}
        code, out = self.jreq('/api/ai', {'mode': 'feedback', 'lesson': lesson, 'context': context(), 'text': REC['drafts'][0]['text']})
        self.assertEqual(code, 200, out)
        sent = [c for c in self.bridge.calls if c[0] == 'respond'][-1][1]['input']
        self.assertIn(PREMISE, sent); self.assertIn(REC['drafts'][0]['text'], sent)


class VisualsAndReading(unittest.TestCase):
    FLOW = {'type': 'flow', 'title': '기억이 달라지는 흐름', 'relation': 'possible', 'note': '단순화한 개념 모델이에요.',
            'steps': [{'label': '원래 사건', 'detail': '영상을 본다'}, {'label': '부호화'}, {'label': '나중의 오정보'}, {'label': '출처 판단'}, {'label': '부정확한 보고'}]}
    CMP = {'type': 'compare', 'title': '확신과 정확성', 'columns': ['확신', '정확성'],
           'rows': [{'aspect': '뜻', 'values': ['맞다고 느끼는 정도', '실제와 일치하는 정도']}, {'aspect': '확인 방법', 'values': ['스스로 느낌', '독립적인 자료와 비교']}]}

    def test_flow_and_compare_kept(self):
        self.assertEqual(server.clean_visual(self.FLOW)['relation'], 'possible')
        self.assertEqual(len(server.clean_visual(self.CMP)['rows']), 2)

    def test_invalid_visuals_dropped_not_fatal(self):
        bad = [None, 'svg', {'type': 'flow', 'title': 't', 'steps': [{'label': 'only one'}]},
               {'type': 'compare', 'title': 't', 'columns': ['a', 'b'], 'rows': [{'aspect': 'x', 'values': ['1']}, {'aspect': 'y', 'values': ['1', '2']}]},
               {'type': 'chart', 'title': 'invented numbers', 'data': [12, 87]}, {'type': 'html', 'title': 'x', 'html': '<script>alert(1)</script>'},
               {**FLOW, 'title': ''}]
        for v in bad: self.assertIsNone(server.clean_visual(v), v)
        self.assertEqual(server.clean_visual({**self.FLOW, 'relation': 'proves'})['relation'], 'sequence', 'unknown relation → plain sequence, never a causal claim')
        d = json.loads(json.dumps(LES)); d['technical'][0]['visual'] = {'type': 'html', 'html': '<b>x</b>'}
        out = server.validate_lesson(d)
        self.assertNotIn('visual', out['technical'][0]); self.assertEqual(len(out['technical']), 2, 'the lesson still loads')

    def test_at_most_two_visuals_and_old_lessons_unchanged(self):
        d = json.loads(json.dumps(LES)); d['technical'] = [{**t, 'visual': self.FLOW} for t in d['technical'] * 2]
        self.assertEqual(sum('visual' in t for t in server.validate_lesson(d)['technical']), 2)
        out = server.validate_lesson(LES)
        self.assertFalse(any('visual' in t for t in out['technical'])); self.assertNotIn('reading', out)

    def test_reading_never_accepts_citations_or_urls(self):
        r = server.clean_reading([{'claim': '사후 오정보 효과', 'query': 'misinformation effect eyewitness memory review', 'kind': '리뷰 논문', 'url': 'https://x', 'title': '가짜 제목', 'year': 1999},
                                  {'claim': '링크', 'query': 'see https://example.com'}, {'claim': 'www', 'query': 'www.example.com'}, {'query': 'no claim'}] + [{'claim': f'c{i}', 'query': f'q{i}'} for i in range(9)])
        self.assertEqual(r[0], {'claim': '사후 오정보 효과', 'query': 'misinformation effect eyewitness memory review', 'kind': '리뷰 논문'}, 'title/url/year dropped')
        self.assertEqual(len(r), 4); self.assertFalse(any('://' in x['query'] or 'www.' in x['query'] for x in r))

FLOW = VisualsAndReading.FLOW

if __name__ == '__main__':
    unittest.main()
