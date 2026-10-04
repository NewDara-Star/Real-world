#!/usr/bin/env bash
# Before a shell command: commits and pushes go through the repo's git hooks,
# never around them. Exit 2 blocks the command and tells Claude why.
cmd="$(jq -r '.tool_input.command // ""')"
grep -qE '\bgit\b' <<<"$cmd" || exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"

block() {
  echo "Blocked: $1" >&2
  exit 2
}
if grep -qE '\bgit\b[^;&|]*\b(commit|push)\b' <<<"$cmd"; then
  # Only the flags count, not the message text: cut at the message (-m, -F, a heredoc).
  flags="$(sed -E 's/[[:space:]](-m|--message|-F|--file)([[:space:]=]).*//; s/<<.*//' <<<"$cmd")"
  grep -qE -- '--no-verify\b' <<<"$flags" && block "--no-verify skips the checks, story, credits and review gates. Fix what they find instead."
  grep -qE '\bcommit\b.*[[:space:]]-[a-zA-Z]*n[a-zA-Z]*([[:space:]]|$)' <<<"$flags" && block "git commit -n skips the hooks. Fix what they find instead."
  grep -qE 'REALWORLD_SKIP_REVIEW' <<<"$cmd" && block "The push review can only be skipped by the owner, not by Claude."
  grep -qE '\-c\s*core\.hooksPath' <<<"$cmd" && block "Don't override core.hooksPath; the gates live in .githooks."
  # Make sure the gates are switched on (a fresh clone, or a session that skipped SessionStart).
  [ -n "$root" ] && git -C "$root" config core.hooksPath .githooks
fi
# Changing the hooks path (unsetting it, or setting anything but .githooks) switches the gates off.
# Reading it is fine.
if grep -qE '\bgit\b[^;&|]*\bconfig\b' <<<"$cmd"; then
  grep -qE -- '--(unset|unset-all|remove-section)[[:space:]]+core(\.hooksPath)?\b' <<<"$cmd" && block "core.hooksPath must stay .githooks."
  setto="$(grep -oE 'core\.hooksPath[[:space:]]+[^[:space:];&|)]+' <<<"$cmd" | awk '{print $2}' | head -1)"
  [ -n "$setto" ] && [ "$setto" != ".githooks" ] && block "core.hooksPath must stay .githooks."
fi
exit 0
