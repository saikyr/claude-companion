#!/bin/sh
# Hook test (docs/DEVELOP.md, "Repo hooks"): proves whether hooks from this repository's
# .claude/settings.json load in a session, and whether a hook can reach the sync backend.
# It only reports; it never blocks anything. Remove once the answer is recorded.
#   hook-test.sh start      SessionStart: adds one line of context
#   hook-test.sh pretool    PreToolUse: appends the tool name to /tmp/cc-hook-test.log
case "$1" in
  start)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://jucbngafdnyaizfxgplk.supabase.co/rest/v1/ 2>/dev/null)
    [ "$code" = 000 ] && code="none (blocked or offline)"
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"REPO HOOK TEST: repository SessionStart hook ran at %s (remote=%s). Sync backend answered HTTP %s (401 = reachable). PreToolUse calls are logged to /tmp/cc-hook-test.log."}}\n' \
      "$(date -u +%FT%TZ)" "${CLAUDE_CODE_REMOTE:-no}" "$code"
    ;;
  pretool)
    tool=$(cat | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_name",""))' 2>/dev/null)
    echo "$(date -u +%FT%TZ) $tool" >> /tmp/cc-hook-test.log
    ;;
esac
exit 0
