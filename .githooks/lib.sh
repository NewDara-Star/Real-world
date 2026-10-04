# Shared helpers for the git hooks. Sourced, not run.
# A hook must never fail without saying why.
trap 'rc=$?; echo "✗ $(basename "$0") stopped unexpectedly at line $LINENO (exit $rc). This is a bug in the hook; fix it rather than skipping it." >&2' ERR
ROOT="$(git rev-parse --show-toplevel)"
GAME="$ROOT/game"
STAMP="$(git rev-parse --git-dir)/check-passed"

# Paths whose changes need the checks and a Story: the app, its tests, the bake pipeline, the desktop shell.
CODE_RE='^(game/src/|game/tests/|game/desktop/|game/index\.html|game/globe\.html|game/package\.json|tools/)'

fail() {
  echo "" >&2
  echo "✗ $1" >&2
  shift
  for line in "$@"; do echo "  $line" >&2; done
  echo "" >&2
  exit 1
}

# Run typecheck + tests unless they already passed on exactly this tree.
run_checks() {
  local tree="$1"
  if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$tree" ]; then
    echo "✓ checks already passed on this exact tree" >&2
    return 0
  fi
  if [ ! -d "$GAME/node_modules" ]; then
    fail "Can't run the checks: game/node_modules is missing." "Run: cd game && npm install"
  fi
  echo "… npm run check (typecheck + tests), about 25 s" >&2
  if ! (cd "$GAME" && npm run check --silent) > /tmp/realworld-check.log 2>&1; then
    tail -40 /tmp/realworld-check.log >&2
    fail "npm run check failed (full log: /tmp/realworld-check.log)." "Fix what failed, then commit again. Don't skip the hook."
  fi
  echo "$tree" > "$STAMP"
  echo "✓ npm run check passed" >&2
}
