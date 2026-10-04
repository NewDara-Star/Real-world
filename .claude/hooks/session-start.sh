#!/usr/bin/env bash
# Session start: switch on the repo's git hooks (.githooks) and make sure the
# game's dependencies are installed so the checks can run.
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
git config core.hooksPath .githooks
if [ ! -d game/node_modules ]; then
  (cd game && timeout 300 npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1) || echo "game/node_modules couldn't be installed; run: cd game && npm install"
fi
exit 0
