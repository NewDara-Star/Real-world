#!/usr/bin/env bash
# End of a turn: if code is changed and not committed, the typecheck and tests
# must pass, or Claude goes back to fix them. Cached by the exact change, so an
# unchanged tree isn't re-tested.
input="$(cat)"
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] || exit 0
cd "$root" || exit 0
CODE_RE='^(game/src/|game/tests/|game/desktop/|game/index\.html|game/globe\.html|game/package\.json|tools/)'
dirty="$( { git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | grep -E "$CODE_RE" || true)"
[ -z "$dirty" ] && exit 0
[ -d game/node_modules ] || exit 0
key="$( { git diff HEAD; git ls-files -o --exclude-standard -z | xargs -0 -r sha1sum; } 2>/dev/null | sha1sum | cut -c1-40)"
stamp="$(git rev-parse --git-dir)/stop-check-passed"
[ -f "$stamp" ] && [ "$(cat "$stamp")" = "$key" ] && exit 0
if (cd game && npm run check --silent) > /tmp/realworld-stop-check.log 2>&1; then
  echo "$key" > "$stamp"
  exit 0
fi
reason="$(grep -E 'FAIL|error TS|Error' /tmp/realworld-stop-check.log | head -15)"
jq -n --arg r "Changed code fails npm run check. Fix it before finishing (full log: /tmp/realworld-stop-check.log):
$reason" '{decision: "block", reason: $r}'
exit 0
