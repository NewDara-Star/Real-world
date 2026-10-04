// The Claude-side git guard blocks commands that go around the repo's git
// hooks, and nothing else: a false block stops honest work.
import { spawnSync } from "node:child_process";
import { check, done } from "./check";

const root = new URL("../..", import.meta.url).pathname;
const guard = (command: string) =>
  spawnSync("bash", [`${root}.claude/hooks/guard-git.sh`], {
    input: JSON.stringify({ tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  }).status;

const blocked = [
  "git commit -n -m x",
  "git commit -qn -m x",
  "git add . && git commit -an -m x | head -n 3",
  "git push --no-verify",
  "REALWORLD_SKIP_REVIEW=1 git push",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git config --unset core.hooksPath",
  "git config core.hooksPath other",
];
const allowed = [
  'git commit -qam "x" && grep -n foo bar',
  'git commit -m "x" ; ls -n',
  'git commit -m "no -n here, honest"',
  "git commit -q -F - <<'EOF'\nTitle\n\na real\ncommit -n is still refused\nEOF",
  "git config --get core.hooksPath",
  "grep -n commit notes.txt",
];
for (const c of blocked) check(`guard blocks: ${c}`, guard(c) === 2);
for (const c of allowed) check(`guard allows: ${c}`, guard(c) === 0);
done();
