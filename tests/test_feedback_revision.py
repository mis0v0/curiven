"""server.review_feedback keeps an explanation the AI itself rewrote — only if it wrote one (mirrors learning.js).
Run: python3 -m unittest tests.test_feedback_revision   (no network, no AI)"""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402

TEXT = '열은 온도가 높은 곳에서 낮은 곳으로 흐른다. 차가운 기운이 따뜻한 물체로 들어가서 물체가 식는다.'
REV = '열은 온도가 높은 물체에서 낮은 물체로 이동해요. 물체가 식는 것은 열이 빠져나가기 때문이에요.'
BASE = {'summary': '방향은 맞아요.', 'correct': [{'quote': '열은 온도가 높은 곳에서 낮은 곳으로 흐른다', 'point': '방향이 맞아요.'}],
        'misconceptions': [{'quote': '차가운 기운이 따뜻한 물체로 들어가서 물체가 식는다', 'issue': '차가운 기운', 'why': '이동하는 것은 열이에요.', 'question': '무엇이 이동할까요?'}]}


class Revision(unittest.TestCase):
    def test_kept_when_written(self):
        out = server.review_feedback({**BASE, 'revision': '  ' + REV + '\n'}, {'c1'}, TEXT)
        self.assertEqual(out['revision'], REV)
        self.assertEqual(len(server.review_feedback({**BASE, 'revision': 'x' * 5000}, {'c1'}, TEXT)['revision']), 3000)

    def test_absent_otherwise_and_never_derived(self):
        for v in (None, '', '   ', 7, ['a'], {'text': REV}):
            out = server.review_feedback({**BASE, **({} if v is None else {'revision': v})}, {'c1'}, TEXT)
            self.assertNotIn('revision', out, repr(v))
        self.assertNotIn('revision', server.review_feedback(BASE, {'c1'}, TEXT), 'not built from the summary or the items')

    def test_prompt_still_asks_for_no_answers(self):
        """Keeping a rewrite does not ask for one: the feedback prompt still forbids writing the answer (reviewed in Q3-B)."""
        self.assertIn('정답 공개 금지', server.FEEDBACK_SPEC)
        self.assertNotIn('revision', server.FEEDBACK_SPEC)


if __name__ == '__main__':
    unittest.main()
