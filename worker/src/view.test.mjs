// Test view-vrstvy + honesty fixu + CEFR napojení v rubriku. Spuštění: node worker/src/view.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync, buildSync } from "esbuild";

async function loadFlat(rel) { // modul bez importů (view.ts)
  const js = transformSync(readFileSync(new URL(rel, import.meta.url), "utf8"), { loader: "ts", format: "esm" }).code;
  return import("data:text/javascript," + encodeURIComponent(js));
}
async function loadBundle(rel) { // modul s importy (rubric.ts → reference/cefr.ts)
  const out = buildSync({ entryPoints: [fileURLToPath(new URL(rel, import.meta.url))], bundle: true, format: "esm", write: false, logLevel: "silent" });
  return import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));
}
const view = await loadFlat("./view.ts");
const rubric = await loadBundle("./rubric.ts");

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("✗ " + msg); } else console.log("✓ " + msg); };

// --- criterionView ---
ok(view.criterionView(9, true).state === "strong" && view.criterionView(9, true).glyph === "●", "9/known → strong ●");
ok(view.criterionView(5, true).state === "partial" && view.criterionView(5, true).glyph === "◐", "5/known → partial ◐");
ok(view.criterionView(2, true).state === "weak" && view.criterionView(2, true).glyph === "○", "2/known → weak ○");
ok(view.criterionView(9, false).state === "unknown" && view.criterionView(9, false).glyph === "—", "known=false → unknown — (i při vysokém skóre)");

// --- osa jistoty ---
ok(view.certaintyView("stated").glyph === "◆" && view.certaintyView("stated").labelCs === "doloženo", "certainty stated ◆ doloženo");
ok(view.certaintyView("inferred").glyph === "◇" && view.certaintyView("inferred").labelCs === "odvozeno", "certainty inferred ◇ odvozeno");
ok(view.gateGlyph(true, true) === "✓" && view.gateGlyph(false, true) === "✗" && view.gateGlyph(false, false) === "—", "gate ✓ / ✗ / —");

// --- rubric honesty (known/basis), skóre se nemění ---
const R = { jobTitle: "x", gates: [], criteria: [
  { key: "roky", label: "Roky praxe", weight: 0.5, type: "numeric_scale", min: 0, max: 10 },
  { key: "dov", label: "Dovednosti", weight: 0.5, type: "set_overlap", required: ["python", "sql"] },
] };
const r1 = rubric.scoreCandidate({ skills: [{ name: "python" }, { name: "sql" }] }, R, "cs");
ok(r1.breakdown.find((b) => b.key === "roky").known === false && r1.breakdown.find((b) => b.key === "roky").score === 5, "roky neuvedeny → known=false, skóre STÁLE 5");
ok(r1.breakdown.find((b) => b.key === "dov").basis === "inferred", "dovednosti bez evidence → basis=inferred");

// --- CEFR napojení: level_raw → deterministický normalizér → basis + evidence ---
const RL = { jobTitle: "x", gates: [], criteria: [
  { key: "en", label: "Angličtina", weight: 1, type: "cefr_map", language: "en", map: { A1: 2, A2: 4, B1: 6, B2: 8, C1: 9, C2: 10, NATIVE: 10 } },
] };
const e1 = rubric.scoreCandidate({ languages: [{ language: "angličtina", level_raw: "umožňující profesionální práci" }] }, RL, "cs").breakdown.find((b) => b.key === "en");
ok(e1.known === true && e1.basis === "inferred", "level_raw fráze → known=true, basis=inferred");
ok(e1.score === 9, "„umožňující profesionální práci\" → C1 → 9 bodů (dle mapy)");
ok(e1.evidence && /profesionální/.test(e1.evidence[0].text), "nese evidenci = doslovná fráze z CV");
ok(/odvozeno/.test(e1.detail), "detail obsahuje 'odvozeno'");

const e2 = rubric.scoreCandidate({ languages: [{ language: "english", level: "C1" }] }, RL, "cs").breakdown.find((b) => b.key === "en");
ok(e2.basis === "stated" && !e2.evidence && e2.score === 9, "explicitní C1 (bez level_raw) → basis=stated, bez evidence, 9");

const e3 = rubric.scoreCandidate({ languages: [] }, RL, "cs").breakdown.find((b) => b.key === "en");
ok(e3.known === false, "bez jazyka → known=false (nedoloženo)");

const e4 = rubric.scoreCandidate({ languages: [{ language: "aj", level_raw: "rodilý mluvčí" }] }, RL, "cs").breakdown.find((b) => b.key === "en");
ok(e4.score === 10 && e4.basis === "stated", "„rodilý mluvčí\" → native → 10, basis=stated");

console.log(fail ? `\n${fail} FAIL` : `\nVŠE OK — view + rubric honesty + CEFR napojení`);
if (fail) process.exitCode = 1;
