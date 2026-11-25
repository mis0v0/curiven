"""Phase 2B: optional explanation-stage copy is plain, bounded text; prompts ask for open self-explanation and
content-based titles. Run: python3 -m unittest tests.test_phase2b"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server, material

BASE = {'title': '미분: 순간의 변화율', 'hook': 'h', 'story': 's', 'prediction': 'p', 'explainPrompt': 'e',
        'concepts': [{'id': f'k{i}', 'name': f'n{i}', 'description': 'd'} for i in range(1, 4)],
        'technical': [{'heading': 'h', 'text': 't'}],
        'scenarios': [{'title': 't', 'question': 'q', 'options': ['a', 'b'], 'answerIndex': 0, 'reason': 'r'}]}

class ExplainCopy(unittest.TestCase):
    def test_optional_fields_are_clipped_plain_text(self):
        d = server.validate_lesson({**BASE, 'explainTitle': '  순간 변화율의 뜻을 정리해요' + 'x' * 80, 'explainStarters': ['내가 이해한 건…', '', 3, 'b' * 90, 'c', 'd']})
        self.assertEqual(len(d['explainTitle']), 40)
        self.assertEqual(d['explainStarters'], ['내가 이해한 건…', 'b' * 60, 'c'])
    def test_absent_or_malformed_fields_are_omitted(self):
        for extra in ({}, {'explainTitle': ['x'], 'explainStarters': 'x'}, {'explainTitle': '  ', 'explainStarters': []}):
            d = server.validate_lesson({**BASE, **extra})
            self.assertNotIn('explainTitle', d); self.assertNotIn('explainStarters', d)
    def test_prompts_ask_for_open_explanation_and_content_titles(self):
        self.assertIn('빈칸', server.LESSON_SPEC); self.assertIn('explainStarters', server.LESSON_SPEC)
        self.assertIn('꼭 필요한 것만 prerequisites에 1~3개', server.LESSON_SPEC)
        self.assertIn('파일 이름', material.MATERIAL_RULES)

if __name__ == '__main__': unittest.main()
