"""Phase 2D-B: generation rules for material-based lessons and ordering of explanation feedback.
These check that the rules are in the requests the server sends; they cannot show that a model follows them
(that was probed separately with a real model and reported as such). Run: python3 -m unittest tests.test_phase2db"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server, material

MAT = {'name': 'math_lecture.pdf', 'kind': 'pdf', 'pageCount': 1, 'pages': [{'n': 1, 'text': '평균변화율은 (f(b) − f(a)) / (b − a)이다.'}], 'unreadable': []}

class MaterialLessonRules(unittest.TestCase):
    def test_material_request_carries_the_new_rules(self):
        user = server.build_lesson_user({'topic': '수업 자료: math_lecture.pdf', 'material': MAT})
        for rule in ('가상 학습 상황입니다', '문제 풀이 목록으로 만들지 않는다', '1~3개', '계산으로 답하는 문항은 최대 1개',
                     'technical의 example과 steps', '그 자료 구절을 sources에 그대로 두고', '단락 전체가 자료 밖 내용일 때만', '해요체'):
            self.assertIn(rule, user, rule)
        self.assertIn("'scenarios 2~3개'보다 이 규칙이 우선", user)

    def test_free_topic_request_is_unchanged(self):
        user = server.build_lesson_user({'topic': '백신은 어떻게 몸을 지킬까?'})
        self.assertNotIn('계산으로 답하는 문항', user)
        self.assertNotIn('해요체', user)

    def test_a_single_scenario_is_still_a_valid_material_lesson(self):
        d = {'title': '평균변화율에서 미분계수로', 'hook': 'h', 'story': 's', 'prediction': 'p', 'explainPrompt': 'e',
             'concepts': [{'id': f'k{i}', 'name': f'n{i}', 'description': 'd'} for i in range(1, 4)],
             'technical': [{'heading': 'h', 'text': 't', 'example': '(9.61 − 9) / 0.1 = 6.1', 'steps': ['a', 'b']}],
             'scenarios': [{'title': 't', 'question': 'q', 'options': ['a', 'b'], 'answerIndex': 0, 'reason': 'r'}]}
        out = server.validate_lesson(d, material.clean_material(MAT))
        self.assertEqual(len(out['scenarios']), 1)
        self.assertEqual(out['technical'][0]['example'], '(9.61 − 9) / 0.1 = 6.1')

class FeedbackOrdering(unittest.TestCase):
    def test_most_important_item_first_and_no_padding(self):
        self.assertIn('9) 각 배열은 중요한 순서로 쓴다', server.FEEDBACK_SPEC)
        self.assertIn('가장 중요한 질문 하나만 먼저 보이므로', server.FEEDBACK_SPEC)
        # evidence rules are untouched
        for rule in ('4) explained에는 학습자가 자기 말로 정확하게 설명한 개념만', 'misconceptions: 사실과 명백히 어긋나는 주장이나 추론만'):
            self.assertIn(rule, server.FEEDBACK_SPEC)

if __name__ == '__main__': unittest.main()
