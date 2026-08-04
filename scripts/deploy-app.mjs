#!/usr/bin/env node
/**
 * Deploy faxx-hr hodnoticí appky s otiskem verze (commit + čas buildu).
 * Commit se injektuje přes wrangler --define → běžící appka vždy ukáže ve
 * stavové liště, z jaké verze byla nasazena.
 *
 *   node scripts/deploy-app.mjs      (nebo: npm run deploy:app)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (a) => execFileSync("git", a).toString().trim();
const sha = git(["rev-parse", "--short", "HEAD"]);
const full = git(["rev-parse", "HEAD"]);
const dirty = execFileSync("git", ["status", "--porcelain"]).toString().trim() ? "+dirty" : "";
const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

const args = [
  "deploy", "-c", "wrangler.app.jsonc",
  "--define", `__COMMIT__:${JSON.stringify(sha + dirty)}`,
  "--define", `__COMMIT_FULL__:${JSON.stringify(full)}`,
  "--define", `__BUILT__:${JSON.stringify(built)}`,
];

console.log(`Deploy faxx-hr-app · commit ${sha}${dirty} · build ${built}`);

const local = "node_modules/wrangler/bin/wrangler.js";
if (existsSync(local)) {
  execFileSync(process.execPath, [local, ...args], { stdio: "inherit" });
} else {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["--yes", "wrangler@latest", ...args], { stdio: "inherit" });
}
