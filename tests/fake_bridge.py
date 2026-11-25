"""Stand-in for chatgpt/bridge.mjs used by tests/test_chatgpt.py. Speaks the same line protocol.
It never contacts OpenAI; results are canned. Behaviour is selected by the request op/args."""
import json, os, sys, time

for line in sys.stdin:
    msg = json.loads(line)
    op = msg.get('op')
    if op == 'env':
        out = {'id': msg['id'], 'ok': True, 'result': sorted(os.environ)}
    elif op == 'sleep':
        time.sleep(msg.get('s', 2)); out = {'id': msg['id'], 'ok': True, 'result': 'late'}
    elif op == 'crash':
        sys.exit(3)
    elif op == 'echo':
        out = {'id': msg['id'], 'ok': True, 'result': msg.get('v')}
    else:
        out = {'id': msg['id'], 'ok': False, 'error': {'code': 'unknown_op', 'message': 'x', 'retryable': False}}
    sys.stdout.write(json.dumps(out) + '\n'); sys.stdout.flush()
