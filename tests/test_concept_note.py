"""Phase 2E: the concept-note synthesis request (bounded, data-framed) and validation of what the model returns.
The catalog note is an independently scripted validator fixture. Run: python3 -m unittest tests.test_concept_note"""
import json, os, sys, unittest
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server, material
from tests.test_chatgpt import LiveServer

FX = Path(__file__).parent / 'fixtures'
AI = json.loads((FX / 'sqli_concept_note_ai.json').read_text(encoding='utf-8'))
MAT = {'name': 'math_lecture.pdf', 'kind': 'pdf', 'pages': [{'n': 2, 'text': "미분계수는 f'(a) = lim h→0 (f(a + h) − f(a)) / h 로 정의한다."}], 'unreadable': []}


def note(**over):
    d = {'title': '제목', 'lead': '핵심 문단이에요.', 'sections': [{'heading': '가', 'body': '본문이에요.'}, {'heading': '나', 'body': '둘째 본문이에요.'}]}
    d.update(over); return d


class Validate(unittest.TestCase):
    def test_scripted_output_passes_and_keeps_its_substance(self):
        out = server.validate_note(AI['raw'], 8)
        self.assertEqual(len(out['sections']), 6)
        self.assertEqual([r['n'] for r in out['resolved']], list(range(1, 9)))
        self.assertTrue(any('제목만으로 책을 구별' in c['text'] for c in out['corrections']), 'the tutor correction is recorded')
        body = '\n'.join(s['body'] for s in out['sections'])
        self.assertIn('```python', body); self.assertIn('WHERE title = ?', body)

    def test_learner_questions_are_numbers_only(self):
        out = server.validate_note(note(resolved=[{'n': 1, 'answer': '답이에요.', 'question': '지어낸 학습자 문장'}, {'n': 7, 'answer': '범위 밖'}, {'n': True, 'answer': 'bool'}, {'n': 1, 'answer': '중복'}],
                                        open=[{'n': 2, 'why': '답을 못 받았어요'}, {'n': 9, 'text': ''}, {'text': 'AI가 본 빈틈'}]), 2)
        self.assertEqual(out['resolved'], [{'n': 1, 'answer': '답이에요.', 'section': ''}])
        self.assertNotIn('question', json.dumps(out['resolved'], ensure_ascii=False))
        self.assertEqual(out['open'], [{'n': 2, 'why': '답을 못 받았어요'}, {'n': None, 'text': 'AI가 본 빈틈'}])

    def test_links_are_not_part_of_the_note_except_inside_code(self):
        out = server.validate_note(note(lead='자세한 건 https://example.com/x 참고', sections=[
            {'heading': '가', 'body': '출처: www.made-up.example 에서 확인됨\n```python\nurl = "https://api.example/v1"\n```'}, {'heading': '나', 'body': 'b'}]), 0)
        self.assertNotIn('example.com', out['lead']); self.assertNotIn('made-up', out['sections'][0]['body'])
        self.assertIn('https://api.example/v1', out['sections'][0]['body'], 'code is code')

    def test_material_sources_survive_only_when_literally_on_the_page(self):
        out = server.validate_note(note(sections=[{'heading': '정의', 'body': 'b', 'sources': [{'page': 2, 'quote': "f'(a) = lim h→0 (f(a + h) - f(a)) / h"}, {'page': 2, 'quote': '지어낸 구절이에요'}, {'page': 5, 'quote': '없는 쪽의 구절'}]},
                                              {'heading': '보충', 'body': 'b', 'sources': [{'page': 2, 'quote': '미분계수는'}]}]), 0, material.clean_material(MAT))
        self.assertEqual(len(out['sections'][0]['sources']), 1)
        self.assertEqual(server.validate_note(note(sections=[{'heading': 'a', 'body': 'b', 'sources': [{'page': 2, 'quote': '미분계수는 f'}]}, {'heading': 'c', 'body': 'd'}]), 0)['sections'][0]['sources'], [], 'no material, no sources')

    def test_malformed_or_empty_output_is_refused(self):
        for bad in (None, [], 'x', {}, note(lead=''), note(sections=[{'heading': 'a', 'body': 'b'}]), note(sections=[{'heading': '', 'body': 'b'}, {'heading': 'a', 'body': ' '}])):
            with self.assertRaises(ValueError): server.validate_note(bad, 3)

    def test_bounds(self):
        big = note(sections=[{'heading': 'h' * 500, 'body': 'b' * 9000}] * 40, selfCheck=[{'q': 'q', 'a': 'a'}] * 30, corrections=['c'] * 20)
        out = server.validate_note(big, 0); L = server.NOTE_LIM
        self.assertLessEqual(len(out['sections']), L['sections']); self.assertLessEqual(sum(len(s['body']) for s in out['sections']), L['total'])
        self.assertTrue(all(len(s['heading']) <= L['heading'] for s in out['sections']))
        self.assertLessEqual(len(out['selfCheck']), 8); self.assertLessEqual(len(out['corrections']), 5)


class Request(unittest.TestCase):
    PAY = {'mode': 'note', 'title': 'Blind SQLi', 'question': '알고싶어', 'lesson': {'concepts': [{'name': 'SQLi', 'description': 'd'}]},
           'messages': [{'n': 1, 'text': '동명이책은 어떻게 구별하나요?', 'answered': True}],
           'exchanges': [{'n': 1, 'ask': '동명이책은 어떻게 구별하나요?', 'reply': '제목만으로 구별할 수 있다는 설명을 고칠게요.'}], 'drafts': []}

    def test_learner_words_are_framed_as_data_and_rules_are_present(self):
        user = server.build_note_user(self.PAY)
        self.assertIn('동명이책은 어떻게 구별하나요?', user); self.assertIn('[학습자 메시지 — 학습자가 직접 쓴 글, 번호 n]', user)
        for rule in ('Q&A로 덧붙이지 말고', '고친 쪽을 따른다', 'corrections', '이해했다, 숙달했다', 'URL, 링크를 쓰지 않는다', '주입 문자열', '해요체', '고정 틀을 억지로 채우지 않는다'):
            self.assertIn(rule, server.NOTE_SPEC, rule)

    def test_long_conversations_are_bounded_without_cutting_json(self):
        p = dict(self.PAY, messages=[{'n': i, 'text': '가' * 3000, 'answered': True} for i in range(1, 400)],
                 exchanges=[{'n': i, 'ask': '가' * 3000, 'reply': '나' * 5000} for i in range(1, 400)])
        user = server.build_note_user(p)
        self.assertLess(len(user), 120_000)
        block = user.split('[대화 — ')[1].split('\n', 1)[1].split('\n(대화가 길어')[0]
        json.loads(block)   # still valid JSON: whole exchanges were dropped, not characters
        self.assertIn('(대화가 길어 메시지', user)

    def test_material_is_quoted_data(self):
        user = server.build_note_user(dict(self.PAY, material=MAT))
        self.assertIn('=== 수업 자료 시작', user); self.assertIn('데이터다', user)

    def test_nothing_to_synthesise(self):
        with self.assertRaises(ValueError): server.build_note_user({'mode': 'note'})


class Endpoint(LiveServer):
    def test_note_mode_round_trip_through_the_connected_model(self):
        self.bridge.text = json.dumps(AI['raw'], ensure_ascii=False)
        code, out = self.jreq('/api/ai', dict(Request.PAY, messages=[{'n': i, 'text': f'질문 {i}', 'answered': True} for i in range(1, 9)]))
        self.assertEqual(code, 200, out); self.assertEqual(out['provider'], 'chatgpt'); self.assertEqual(out['model'], 'gpt-a')
        self.assertEqual(len(out['data']['sections']), 6)
        op, args = self.bridge.calls[-1]; self.assertEqual(op, 'respond'); self.assertEqual(args['instructions'], server.NOTE_SPEC)

    def test_malformed_model_output_is_an_error_not_a_note(self):
        for text in ('노트를 만들 수 없어요', json.dumps({'title': 't'}), '[]'):
            self.bridge.text = text
            code, out = self.jreq('/api/ai', Request.PAY)
            self.assertEqual(code, 400); self.assertFalse(out['ok']); self.assertNotIn('data', out)

    def test_the_new_scripts_are_served(self):
        for path in ('/concept-note.js', '/concept-ui.js', '/journey.js'):
            code, _, raw = self.request(path); self.assertEqual(code, 200); self.assertIn(b"'use strict'", raw)


if __name__ == '__main__': unittest.main()
