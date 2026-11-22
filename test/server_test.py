# python3 test/server_test.py: server.py's own rules (no network, no browser)
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ClaudeCompanion', 'web'))
os.environ['CC_BACKGROUND'] = '0'
import server  # noqa: E402

fails = 0
def check(ok, what):
    global fails
    print(('PASS ' if ok else 'FAIL ') + what)
    fails += 0 if ok else 1

due = server.background_due
check(due('s2', 's1', 's1', True, 30), 'a new save with no snapshot of it yet: the hidden browser runs')
check(not due('s2', 's1', 's2', True, 30), 'a window (loaded since the server started) already wrote it: no')
check(due('s2', 's1', 's2', False, 30), 'a window from before the restart (an old page) wrote it: the hidden browser runs anyway')
check(not due('s2', 's2', 's1', False, 30), 'already tried this save: no')
check(not due('s2', 's1', 's1', True, 5), 'saved under 10 s ago: wait')
print(f'{5 - fails}/5 passed')
sys.exit(1 if fails else 0)
