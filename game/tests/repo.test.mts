// The project's standing rules that can be checked in the files themselves:
// every asset is credited, and no personal data or keys are committed.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { check, done } from "./check";

const root = new URL("../..", import.meta.url).pathname;

// Licences: every file or folder in an asset directory is named in its CREDITS.md.
for (const dir of ["game/public/tex", "game/public/models", "game/public/globe"]) {
  const credits = existsSync(`${root}${dir}/CREDITS.md`) ? readFileSync(`${root}${dir}/CREDITS.md`, "utf8") : "";
  const assets = readdirSync(`${root}${dir}`).filter((f) => f !== "CREDITS.md" && f !== "manifest.json");
  const missing = assets.filter((f) => !credits.includes(f.replace(/\.[^.]+$/, "")));
  check(`every asset in ${dir} is credited in its CREDITS.md`, !!credits && missing.length === 0, missing.join(", ") || `${assets.length} credited`);
}

// Privacy and secrets: scan every tracked text file.
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/\.(bin|glb|jpg|jpeg|png|webp|ktx2|parquet|ico|woff2?)$/i.test(f) && !f.endsWith("package-lock.json"));
const emails: string[] = [], secrets: string[] = [];
// Allowed addresses: commit attribution, and example placeholders.
const okEmail = /^(noreply@anthropic\.com|[^@]+@example\.(com|org))$/i;
const secretRe = /(MLY\|[0-9a-f]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
for (const f of files) {
  let text: string;
  try {
    text = readFileSync(`${root}${f}`, "utf8");
  } catch {
    continue;
  }
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    if (!okEmail.test(m[0]) && !/@(2x|3x)\b/.test(m[0]) && !/\.(png|jpg|js|ts)$/i.test(m[0])) emails.push(`${f}: ${m[0]}`);
  }
  const s = text.match(secretRe);
  if (s) secrets.push(`${f}: ${s[0].slice(0, 12)}…`);
}
check("no personal email addresses in the repo", emails.length === 0, emails.slice(0, 5).join("; ") || `${files.length} files scanned`);
check("no API keys or tokens in the repo", secrets.length === 0, secrets.join("; "));
done();
