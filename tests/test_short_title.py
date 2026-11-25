"""Phase 2C-R: the lesson request asks for a short constellation title; the server keeps it only when it follows the rules
(same cases as tests/short_title.test.js). Run: python3 -m unittest tests.test_short_title"""
import json, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server, material

CASES = json.load(open(os.path.join(os.path.dirname(__file__), 'fixtures', 'short_title_cases.json'), encoding='utf-8'))
BASE = {'title': '미분: 순간의 변화율', 'hook': 'h', 'story': 's', 'prediction': 'p', 'explainPrompt': 'e',
        'concepts': [{'id': f'k{i}', 'name': f'n{i}', 'description': 'd'} for i in range(1, 4)],
        'technical': [{'heading': 'h', 'text': 't'}],
        'scenarios': [{'title': 't', 'question': 'q', 'options': ['a', 'b'], 'answerIndex': 0, 'reason': 'r'}]}

class ShortTitle(unittest.TestCase):
    def test_rules_match_the_browser(self):
        for v in CASES['valid']: self.assertEqual(server.clean_short_title(v, CASES['file']), v, v)
        for v in CASES['invalid']: self.assertIsNone(server.clean_short_title(v, CASES['file']), v)
        for v, out in CASES['trimmed']: self.assertEqual(server.clean_short_title(v, CASES['file']), out)
        self.assertIsNone(server.clean_short_title(None)); self.assertIsNone(server.clean_short_title(['x']))
    def test_valid_short_title_is_kept(self):
        self.assertEqual(server.validate_lesson({**BASE, 'shortTitle': ' 미분의 원리 '})['shortTitle'], '미분의 원리')
    def test_invalid_missing_or_copied_short_title_is_dropped(self):
        for extra in ({}, {'shortTitle': '학습 내용'}, {'shortTitle': '미분: 순간의 변화율'}, {'shortTitle': '미분이란?'}, {'shortTitle': 3}, {'shortTitle': '01장 미분'}):
            self.assertNotIn('shortTitle', server.validate_lesson({**BASE, **extra}), extra)
    def test_material_file_name_is_never_the_short_title(self):
        mat = {'name': CASES['file'], 'kind': 'pdf', 'pageCount': 1, 'pages': [{'n': 1, 'text': 'x'}], 'unreadable': []}
        d = server.validate_lesson({**BASE, 'shortTitle': '01장_웹프로그래밍과_HTML5개요'}, mat)
        self.assertNotIn('shortTitle', d)
        self.assertEqual(server.validate_lesson({**BASE, 'shortTitle': '웹 입문'}, mat)['shortTitle'], '웹 입문')
    def test_requested_in_the_same_lesson_request(self):
        self.assertIn('"shortTitle"', server.LESSON_SPEC)
        for word in ('미분의 원리', '웹 입문', 'SQL 인젝션', '기억의 왜곡', '2~5단어', '파일 이름'): self.assertIn(word, server.LESSON_SPEC)
        self.assertIn('shortTitle', material.MATERIAL_RULES)

if __name__ == '__main__': unittest.main()
