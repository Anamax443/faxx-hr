// Regrese režimu „výběrové řízení" (relace s vlastní adresou + platnost).
// Testuje DVĚ věci, které se jinak dají zjistit až v prohlížeči:
//   1. tvar adresy podstránky (VR_PATH) — co server pustí na appku a co je 404,
//   2. že se **vygenerovaný** klientský JS parsuje. `app.syntax.test.mjs` čte surový
//      zdroj, kde je escapování o úroveň jinak (\\" v template literalu vs. \" v JS),
//      takže sám o sobě nezaručí, že to, co dostane prohlížeč, vůbec naběhne.
// Spuštění:  node worker/src/vr.test.mjs
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const out = buildSync({ entryPoints: [fileURLToPath(new URL("./app.ts", import.meta.url))], bundle: true, format: "esm", write: false, logLevel: "silent" });
const { VR_PATH, PAGE } = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("✗ " + msg); } else console.log("✓ " + msg); };

// --- 1. adresa jednoho řízení ---------------------------------------------
for (const p of ["/20260807-1432", "/20250101-0000", "/20260807-1432-2", "/20260807-1432-10"])
  ok(VR_PATH.test(p), "adresa řízení projde: " + p);
// nesmí sežrat existující stránky ani nesmysly (jinak by /about zmizelo pod appkou)
for (const p of ["/", "/about", "/o-projektu", "/api/health", "/.well-known/security.txt",
  "/2026-08-07", "/20260807", "/20260807-1432-123", "/20260807-1432/x", "/rizeni"])
  ok(!VR_PATH.test(p), "NEprojde jako adresa řízení: " + p);

// --- 2. vygenerovaný klientský JS se parsuje ------------------------------
const scripts = [...PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
ok(scripts.length >= 2, `stránka nese ${scripts.length} inline skripty`);
scripts.forEach((js, i) => {
  try { new Function(js); ok(true, `vygenerovaný <script> #${i} se parsuje (${js.length} zn.)`); }
  catch (e) { ok(false, `vygenerovaný <script> #${i}: ${e.message}`); }
});

// --- 3. ovládání řízení je na stránce a má obě jazykové verze --------------
for (const id of ["vrCard", "vrNow", "vrNew", "vrCloseBtn", "vrExtendBtn", "vrListBtn", "vrTable", "vrTtl"])
  ok(PAGE.includes('id="' + id + '"'), "v UI je prvek #" + id);
for (const fn of ["function saveSession()", "function vrCloseNow()", "function vrOpen(", "function vrExtendNow()", "function vrLocked()", "function bootVr()"])
  ok(PAGE.includes(fn), "klient umí: " + fn);
for (const key of ["h_vr", "b_vrnew", "b_vrclose", "b_vrextend", "b_vrlist", "hint_vr", "h_vrset", "l_vrttl", "hint_vrttl"])
  ok(PAGE.includes(key + ':"') || PAGE.includes(key + ':'), "EN překlad má klíč " + key);
// zámek po vypršení nesmí zmizet z kódu — je to jediná pojistka proti „věčnému" řízení
ok(/vrLocked\(\)\)return/.test(PAGE), "autosave i přepočet respektují zámek jen pro čtení");

console.log(fail ? `\n${fail} chyb` : "\nvše OK — adresa řízení, generovaný JS i ovládání");
if (fail) process.exitCode = 1;
