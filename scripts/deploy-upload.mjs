#!/usr/bin/env node
/**
 * Deploy faxx-hr upload Workeru s otiskem verze v patičce (klasika:
 * commit + čas buildu). Commit se injektuje přes wrangler --define, takže
 * běžící appka vždy ukáže, z jaké verze byla nasazena. Bez odkazu na GitHub.
 *
 *   node scripts/deploy-upload.mjs
 */
import { execFileSync } from "node:child_process";

const git = (args) => execFileSync("git", args).toString().trim();
const sha = git(["rev-parse", "--short", "HEAD"]);
const full = git(["rev-parse", "HEAD"]);
const dirty = execFileSync("git", ["status", "--porcelain"]).toString().trim() ? "+dirty" : "";
const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

const args = [
  "wrangler@latest", "deploy", "-c", "wrangler.upload.jsonc",
  "--define", `__COMMIT__:${JSON.stringify(sha + dirty)}`,
  "--define", `__COMMIT_FULL__:${JSON.stringify(full)}`,
  "--define", `__BUILT__:${JSON.stringify(built)}`,
];

console.log(`Deploy faxx-hr-upload · commit ${sha}${dirty} · build ${built}`);
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", args, { stdio: "inherit" });
