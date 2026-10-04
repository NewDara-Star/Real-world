// Runs every tests/*.test.mts with tsx, one after another, and fails if any fails.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dir = new URL(".", import.meta.url).pathname;
const only = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mts") && (!only || f.includes(only))).sort();
const failed = [];
for (const f of files) {
  console.log(`\n${f}`);
  const r = spawnSync("npx", ["tsx", `${dir}${f}`], { stdio: "inherit" });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nAll ${files.length} test files passed.`);
process.exit(failed.length ? 1 : 0);
