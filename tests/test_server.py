"""Run: python3 -m unittest discover -s tests"""
import io, json, sys, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.request import Request, urlopen as real_urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

SAMPLE = json.loads((Path(server.HERE) / 'sample_cookie_lesson.json').read_text(encoding='utf-8'))


def same_origin_headers(base):
    """What CURIVEN's own page sends: same Origin, JSON, and the CSRF token embedded in index.html."""
    return {'Content-Type': 'application/json', 'Origin': base, 'X-CURIVEN-CSRF': server.CSRF_TOKEN}


class OllamaProvider:
    """These classes test the Ollama path, which is used only when explicitly selected."""
    def setUp(self):
        self._provider = mock.patch.object(server, 'PROVIDER', 'ollama'); self._provider.start()
        self.addCleanup(self._provider.stop)


class ProfileCleaning(unittest.TestCase):
    def test_clean_profile(self):
        p = server.clean_profile({'nickname': '  새봄 ', 'interests': ['추리 소설', '추리 소설', ' 등산 '], 'approach': 'x', 'depth': 'deep'})
        self.assertEqual(p, {'nickname': '새봄', 'interests': ['추리 소설', '등산'], 'meaning': '', 'approach': 'mixed', 'depth': 'deep'})
        self.assertIsNone(server.clean_profile('nope'))
        self.assertEqual(len(server.clean_profile({'interests': [str(i) for i in range(40)]})['interests']), 12)

    def test_lesson_prompt_uses_profile(self):
        u = server.build_lesson_user({'topic': '블랙홀', 'profile': {'interests': ['등산'], 'depth': 'some', 'approach': 'experiment', 'meaning': '성취감'}})
        self.assertIn('관심사·취미: 등산', u)
        self.assertIn('원리와 이유까지', u)
        self.assertIn('먼저 예측하고 실험해 보기', u)
        self.assertIn('억지로 비유로 끼워 넣지 말 것', u)

    def test_legacy_interest_string_still_supported(self):
        u = server.build_lesson_user({'topic': '쿠키', 'interests': '추리 소설, 범죄 수사', 'level': 'beginner'})
        self.assertIn('관심사·취미: 추리 소설, 범죄 수사', u)

    def test_no_profile(self):
        u = server.build_lesson_user({'topic': '쿠키'})
        self.assertIn('학습자 프로필: 없음', u)
        with self.assertRaises(ValueError):
            server.build_lesson_user({'topic': '  '})

    def test_feedback_prompt_profile_optional(self):
        _, u = server.build_feedback_user({'lesson': SAMPLE, 'text': '쿠키는 브라우저가 보관하는 값이에요.', 'profile': {'interests': ['요리']}})
        self.assertIn('관심사·취미: 요리', u)
        self.assertIn('대신 완성하지 말 것', u)
        _, u2 = server.build_feedback_user({'lesson': SAMPLE, 'text': '쿠키는 브라우저가 보관하는 값이에요.'})
        self.assertNotIn('학습자 프로필', u2)


class FakeOllama:
    """Captures what the server would send to Ollama and returns a canned answer."""
    def __init__(self):
        self.calls = []

    def __call__(self, req, timeout=None):
        body = json.loads(req.data.decode())
        self.calls.append(body)
        user = body['messages'][1]['content']
        answer = SAMPLE if '학습 주제:' in user and '학습자의 실제 설명' not in user else {'summary': 'ok', 'correct': [], 'misconceptions': [], 'missing': [], 'explained': [{'id': 'k1', 'quote': '세션 ID는 서버 저장소를 가리키는 값'}, {'id': 'zzz', 'quote': '세션 ID는 서버 저장소'}], 'uncertainty': ''}
        return io.BytesIO(json.dumps({'message': {'content': json.dumps(answer, ensure_ascii=False)}}).encode())


class EndToEndApi(OllamaProvider, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        self.fake = FakeOllama()
        self.patch = mock.patch.object(server, 'urlopen', self.fake)
        self.patch.start()

    def tearDown(self):
        self.patch.stop(); self.httpd.shutdown(); self.httpd.server_close()

    def post(self, body):
        req = Request(self.base + '/api/ai', data=json.dumps(body).encode(), headers=same_origin_headers(self.base))
        with real_urlopen(req, timeout=10) as r:
            return json.load(r)

    def test_edited_profile_reaches_next_request(self):
        self.post({'mode': 'lesson', 'topic': 'A', 'profile': {'interests': ['등산']}})
        self.post({'mode': 'lesson', 'topic': 'B', 'profile': {'interests': ['요리', '사진']}})
        first, second = (c['messages'][1]['content'] for c in self.fake.calls)
        self.assertIn('관심사·취미: 등산', first)
        self.assertIn('관심사·취미: 요리, 사진', second)
        self.assertNotIn('등산', second)

    def test_feedback_receives_profile_and_filters_ids(self):
        out = self.post({'mode': 'feedback', 'lesson': SAMPLE, 'text': '세션 ID는 서버 저장소를 가리키는 값이에요.', 'profile': {'depth': 'deep'}})
        self.assertTrue(out['ok'])
        self.assertEqual(out['data']['demonstrated'], ['k1'])
        self.assertIn('세부 조건과 예외까지', self.fake.calls[0]['messages'][1]['content'])

    def test_serves_profile_js(self):
        with real_urlopen(self.base + '/profile.js', timeout=5) as r:
            self.assertIn(b'CuriProfile', r.read())


class AiOutputIntegrity(OllamaProvider, unittest.TestCase):
    """D2/D5/D6 regressions. These use a fake Ollama — they test CURIVEN's parsing/validation, not model quality."""
    def setUp(self):
        super().setUp()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        self.sent = []

    def tearDown(self):
        self.httpd.shutdown(); self.httpd.server_close()

    def run_with(self, body, message):
        def fake(req, timeout=None):
            self.sent.append(json.loads(req.data.decode()))
            return io.BytesIO(json.dumps({'message': message}, ensure_ascii=False).encode())
        with mock.patch.object(server, 'urlopen', fake):
            req = Request(self.base + '/api/ai', data=json.dumps(body, ensure_ascii=False).encode(), headers=same_origin_headers(self.base))
            try:
                with real_urlopen(req, timeout=10) as r: return r.status, json.load(r)
            except Exception as e:  # HTTPError
                return e.code, json.load(e)

    FB = {'mode': 'feedback', 'lesson': SAMPLE, 'text': '세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.'}

    def test_malformed_feedback_rejected(self):
        for bad in [{'summary': '좋아요', 'correct': '쿠키 저장'}, {'summary': 's', 'misconceptions': ['문자열']},
                    {'summary': 's', 'missing': [{'issue': 'x'}]}, {'summary': 's', 'explained': 'k1'}, {'summary': 's', 'explained': [{'quote': 'q'}]},
                    {'summary': 's', 'precision': [{'quote': 'x'}]}, {'summary': 's', 'correct': [{'quote': 'x'}]}, {'correct': []}, []]:
            code, out = self.run_with(self.FB, {'content': json.dumps(bad, ensure_ascii=False)})
            self.assertEqual(code, 400, bad); self.assertFalse(out['ok'])

    def test_valid_feedback_normalized(self):
        raw = {'summary': 's', 'explained': [{'id': 'k1', 'quote': '세션 ID를 쿠키로 보내면'}, {'id': 'x', 'quote': '서버가 저장소에서 찾아요'}], 'demonstrated': ['k2']}
        code, out = self.run_with(self.FB, {'content': json.dumps(raw, ensure_ascii=False)})
        self.assertEqual(code, 200)
        self.assertEqual(out['data'], {'schema': 2, 'summary': 's', 'correct': [], 'precision': [], 'misconceptions': [], 'missing': [],
                                       'explained': [{'id': 'k1', 'quote': '세션 ID를 쿠키로 보내면'}], 'demonstrated': ['k1'], 'uncertainty': '', 'withheld': 0,
                                       'reviewer': {'provider': 'local-ollama', 'model': server.MODEL}})

    def test_feedback_prompt_includes_explain_question(self):
        self.run_with(self.FB, {'content': '{"summary":"s"}'})
        self.assertIn(SAMPLE['explainPrompt'], self.sent[0]['messages'][1]['content'])

    def test_large_but_valid_lesson_feedback_accepted(self):
        big = {**SAMPLE, 'story': '가' * 7000, 'hook': '나' * 7000, 'explainPrompt': '다' * 7000}
        body = {**self.FB, 'lesson': big, 'text': '세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.' + 'x' * 3000}
        self.assertGreater(len(json.dumps(body, ensure_ascii=False).encode()), 50000)
        code, _ = self.run_with(body, {'content': '{"summary":"s"}'})
        self.assertEqual(code, 200)

    def test_requests_no_thinking_and_ignores_thinking_field(self):
        code, out = self.run_with({'mode': 'lesson', 'topic': '쿠키'},
                                  {'thinking': '먼저 {"title": 스키마를} 생각하자', 'content': json.dumps(SAMPLE, ensure_ascii=False)})
        self.assertEqual(code, 200); self.assertIs(self.sent[0]['think'], False); self.assertEqual(self.sent[0]['format'], 'json')

    def test_unstructured_content_rejected_not_guessed(self):
        for content in ['<think>{"a":1}</think>' + json.dumps(SAMPLE, ensure_ascii=False), '설명: ' + json.dumps(SAMPLE, ensure_ascii=False),
                        json.dumps(SAMPLE, ensure_ascii=False)[:900], '', '[1,2]']:
            code, out = self.run_with({'mode': 'lesson', 'topic': '쿠키'}, {'content': content})
            self.assertEqual(code, 400, content[:40]); self.assertFalse(out['ok'])

    def test_single_code_fence_accepted(self):
        code, _ = self.run_with({'mode': 'lesson', 'topic': '쿠키'}, {'content': '```json\n' + json.dumps(SAMPLE, ensure_ascii=False) + '\n```'})
        self.assertEqual(code, 200)


if __name__ == '__main__':
    unittest.main()
