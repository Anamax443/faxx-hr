// Regrese režimu „výběrové řízení" (relace s vlastní adresou + platnost).
// Testuje DVĚ věci, které se jinak dají zjistit až v prohlížeči:
//   1. routing podstránek — co server pustí na appku a co je 404 (volá se PŘÍMO
//      `default.fetch`, aby se testovalo chování, ne opsaný regulární výraz),
//   2. že se **vygenerovaný** klientský JS parsuje. `app.syntax.test.mjs` čte surový
//      zdroj, kde je escapování o úroveň jinak (\\" v template literalu vs. \" v JS),
//      takže sám o sobě nezaručí, že to, co dostane prohlížeč, vůbec naběhne.
// Pozn.: modul workeru NESMÍ exportovat nic než `default` (jinak runtime odmítne start),
// proto se stránka získává přes handler, ne přes export konstanty.
// Spuštění:  node worker/src/vr.test.mjs
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const out = buildSync({ entryPoints: [fileURLToPath(new URL("./app.ts", import.meta.url))], bundle: true, format: "esm", write: false, logLevel: "silent" });
const mod = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("✗ " + msg); } else console.log("✓ " + msg); };

// Runtime workeru přijme z modulu jen `default`, funkce a objekty (třídy DO apod.).
// Export prostého řetězce / RegExpu shodí start: „Incorrect type for map entry '…'".
const badExports = Object.entries(mod).filter(([k, v]) =>
  k !== "default" && typeof v !== "function" && (typeof v !== "object" || v === null || v instanceof RegExp));
ok(badExports.length === 0, "žádný export, na kterém runtime spadne: " + (badExports.map(([k]) => k).join(", ") || "—"));

const get = (p) => mod.default.fetch(new Request("https://faxx-hr.test" + p), {});

// --- 1. adresa jednoho řízení ---------------------------------------------
for (const p of ["/20260807-1432", "/20250101-0000", "/20260807-1432-2", "/20260807-1432-10"]) {
  const r = await get(p);
  ok(r.status === 200 && (r.headers.get("content-type") || "").includes("text/html"), "adresa řízení servíruje appku: " + p);
}
// nesmí sežrat existující stránky ani nesmysly (jinak by /about zmizelo pod appkou)
for (const [p, want] of [["/", 200], ["/about", 200], ["/o-projektu", 200], ["/.well-known/security.txt", 200],
  ["/2026-08-07", 404], ["/20260807", 404], ["/20260807-1432-123", 404], ["/20260807-1432/x", 404], ["/rizeni", 404]])
  ok((await get(p)).status === want, `${p} → ${want}`);

const PAGE = await (await get("/")).text();

// --- 2. vygenerovaný klientský JS se parsuje ------------------------------
const scripts = [...PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
ok(scripts.length >= 2, `stránka nese ${scripts.length} inline skripty`);
scripts.forEach((js, i) => {
  try { new Function(js); ok(true, `vygenerovaný <script> #${i} se parsuje (${js.length} zn.)`); }
  catch (e) { ok(false, `vygenerovaný <script> #${i}: ${e.message}`); }
});

// --- 3. ovládání řízení je na stránce a má obě jazykové verze --------------
for (const id of ["vrCard", "vrNow", "vrNew", "vrCloseBtn", "vrExtendBtn", "vrListBtn", "vrSaveAs", "vrImport", "vrTable", "vrTtl"])
  ok(PAGE.includes('id="' + id + '"'), "v UI je prvek #" + id);
for (const fn of ["function saveSession()", "function vrCloseNow()", "function vrOpen(", "function vrExtendNow()", "function vrLocked()", "function bootVr()",
  "function vrExportData()", "async function vrSaveAs()", "async function vrImportFile("])
  ok(PAGE.includes(fn), "klient umí: " + fn);
// „Uložit jako…" musí umět obojí: File System Access API i prosté stažení
ok(PAGE.includes("window.showSaveFilePicker"), "Uložit jako… využije picker, kde je");
ok(/vrSaveAs[\s\S]{0,1600}a\.download=name/.test(PAGE), "…a jinak spadne na stažení souboru");
ok(PAGE.includes("kind==='evaluation'"), "import přijme i starší export samotného vyhodnocení");
for (const key of ["h_vr", "b_vrnew", "b_vrclose", "b_vrextend", "b_vrlist", "b_vrsave", "b_vrload", "hint_vr", "h_vrset", "l_vrttl", "hint_vrttl"])
  ok(PAGE.includes(key + ':"') || PAGE.includes(key + ':'), "EN překlad má klíč " + key);
// zámek po vypršení nesmí zmizet z kódu — je to jediná pojistka proti „věčnému" řízení
ok(/vrLocked\(\)\)return/.test(PAGE), "autosave i přepočet respektují zámek jen pro čtení");

console.log(fail ? `\n${fail} chyb` : "\nvše OK — adresa řízení, generovaný JS i ovládání");
if (fail) process.exitCode = 1;
