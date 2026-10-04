#!/usr/bin/env bash
# A second Claude reads CLAUDE.md, the commit messages and the diff of a push,
# and blocks it with findings when a change breaks a rule there. If a finding
# is wrong, say why in a commit message line starting "Review:"; the reviewer
# reads those. Usage: review.sh <base> <head>
set -euo pipefail
source "$(dirname "$0")/lib.sh"
base="$1"; head="$2"

if [ "${REALWORLD_SKIP_REVIEW:-}" = "1" ]; then
  echo "⚠ review skipped (REALWORLD_SKIP_REVIEW=1)" >&2
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "⚠ review skipped: the claude CLI isn't installed here. Install Claude Code to get push reviews." >&2
  exit 0
fi

messages="$(git log --format='--- %h %s%n%b' "$base..$head")"
# Code first, then docs, capped so the prompt stays a sensible size. (head
# closes the pipe early on a big diff; that's expected, not an error.)
skip=(':(exclude)*package-lock.json' ':(exclude)game/public/world/*' ':(exclude)*.bin' ':(exclude)*.glb' ':(exclude)*.png' ':(exclude)*.jpg')
diff="$( { git diff --no-color --stat "$base" "$head"; echo;
  git diff --no-color "$base" "$head" -- . "${skip[@]}" ':(exclude)*.md';
  git diff --no-color "$base" "$head" -- '*.md'; } | head -c 300000 || true)"
prompt_file="$(mktemp)"
cat > "$prompt_file" <<PROMPT
You are reviewing a push to the Real World driving simulator before it goes to GitHub.
The project's rules are in CLAUDE.md below. Judge the change against those rules only:
the driver's story (is there a Story: paragraph, and does the change do what it says from the driver's side?),
words that mean what they say, nothing done behind the driver's back, first principles over patches,
one source of truth, dead code and stale comments deleted, names, the four test paths
(happy, sad, idiot-proof, tragedy) for what changed, licences and credits, privacy, honesty
(nothing claimed as fixed or tested that wasn't), and ROADMAP.md kept current.
Lines starting "Review:" in commit messages are the author's answers to earlier findings; accept them when they're reasonable.
Only block for real, specific problems you can point to in the diff. Style preferences are not findings.

Answer in this exact format and nothing else:
VERDICT: PASS
or
VERDICT: BLOCK
- <file:line or commit>: <the problem, and the rule it breaks, in one or two plain sentences>
- ...

===== CLAUDE.md =====
$(cat "$ROOT/CLAUDE.md")

===== Commit messages =====
$messages

===== Diff =====
$diff
PROMPT

echo "… a second Claude is reviewing the push against CLAUDE.md (up to 4 minutes)" >&2
# Run outside the repo so the reviewer doesn't load this project's hooks.
if ! out="$(cd /tmp && timeout 240 claude -p --output-format text < "$prompt_file" 2>&1)"; then
  rm -f "$prompt_file"
  echo "⚠ review couldn't run (claude exited with an error or timed out); pushing without it:" >&2
  echo "$out" | tail -5 >&2
  exit 0
fi
rm -f "$prompt_file"
if grep -q '^VERDICT: PASS' <<<"$out"; then
  echo "✓ review passed" >&2
  exit 0
fi
if grep -q '^VERDICT: BLOCK' <<<"$out"; then
  echo "$out" | sed -n '/^VERDICT: BLOCK/,$p' >&2
  fail "The reviewer blocked the push. Fix what it found, or if a finding is wrong," \
    "explain why in a commit message line starting 'Review:' and push again. Never work around it."
fi
echo "⚠ the reviewer's answer wasn't in the expected format; pushing without it:" >&2
echo "$out" | tail -8 >&2
exit 0
