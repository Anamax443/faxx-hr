#!/usr/bin/env node
/**
 * Deploy faxx-hr upload Workeru s otiskem verze (klasika: commit + čas buildu).
 * Commit se injektuje přes wrangler --define, takže běžící appka vždy ukáže,
 * z jaké verze byla nasazena (v hlavičce i patičce). Bez odkazu na GitHub.
 *
 *   node scripts/deploy-upload.mjs      (nebo: npm run deploy:upload)
 *
 * Cross-platform: volá lokální wrangler přes `node` (žádné npx.cmd/shell peklo).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (a) => execFileSync("git", a).toString().trim();
const sha = git(["rev-parse", "--short", "HEAD"]);
const full = git(["rev-parse", "HEAD"]);
const dirty = execFileSync("git", ["status", "--porcelain"]).toString().trim() ? "+dirty" : "";
const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

const args = [
  "deploy", "-c", "wrangler.upload.jsonc",
  "--define", `__COMMIT__:${JSON.stringify(sha + dirty)}`,
  "--define", `__COMMIT_FULL__:${JSON.stringify(full)}`,
  "--define", `__BUILT__:${JSON.stringify(built)}`,
];

console.log(`Deploy faxx-hr-upload · commit ${sha}${dirty} · build ${built}`);

const local = "node_modules/wrangler/bin/wrangler.js";
if (existsSync(local)) {
  execFileSync(process.execPath, [local, ...args], { stdio: "inherit" });
} else {
  // fallback: npx (bez shellu, aby quoting --define zůstal zachovaný)
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["--yes", "wrangler@latest", ...args], { stdio: "inherit" });
}
