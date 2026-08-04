// Test view-vrstvy + honesty fixu v rubriku. Spuštění:  node worker/src/view.test.mjs
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

async function load(rel) {
  const ts = readFileSync(new URL(rel, import.meta.url), "utf8");
  const js = transformSync(ts, { loader: "ts", format: "esm" }).code;
  return import("data:text/javascript," + encodeURIComponent(js));
}
const view = await load("./view.ts");
const rubric = await load("./rubric.ts");

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("✗ " + msg); } else console.log("✓ " + msg); };

// --- criterionView: skóre + známo → stav/glyf ---
ok(view.criterionView(9, true).state === "strong" && view.criterionView(9, true).glyph === "●", "9/known → strong ●");
ok(view.criterionView(5, true).state === "partial" && view.criterionView(5, true).glyph === "◐", "5/known → partial ◐");
ok(view.criterionView(2, true).state === "weak" && view.criterionView(2, true).glyph === "○", "2/known → weak ○");
ok(view.criterionView(9, false).state === "unknown" && view.criterionView(9, false).glyph === "—", "known=false → unknown — (i při vysokém skóre)");

// --- osa jistoty ---
ok(view.certaintyView("stated").glyph === "◆" && view.certaintyView("stated").labelCs === "doloženo", "certainty stated ◆ doloženo");
ok(view.certaintyView("inferred").glyph === "◇" && view.certaintyView("inferred").labelCs === "odvozeno", "certainty inferred ◇ odvozeno");
ok(view.certaintyView("unknown").glyph === "·" && view.certaintyView("unknown").labelCs === "nevíme", "certainty unknown · nevíme");
ok(view.gateGlyph(true, true) === "✓" && view.gateGlyph(false, true) === "✗" && view.gateGlyph(false, false) === "—", "gate ✓ / ✗ / — (nevíme)");

// --- rubric: honesty fix (known/basis) — skóre se NEMĚNÍ ---
const R = { jobTitle: "x", gates: [], criteria: [
  { key: "roky", label: "Roky praxe", weight: 0.5, type: "numeric_scale", min: 0, max: 10 },
  { key: "dov", label: "Dovednosti", weight: 0.5, type: "set_overlap", required: ["python", "sql"] },
] };

const q1 = { skills: [{ name: "python" }, { name: "sql" }] };            // BEZ roků, skills bez evidence
const r1 = rubric.scoreCandidate(q1, R, "cs");
const roky1 = r1.breakdown.find((b) => b.key === "roky");
const dov1 = r1.breakdown.find((b) => b.key === "dov");
ok(roky1.known === false && roky1.basis === "unknown" && roky1.score === 5, "roky neuvedeny → known=false, basis=unknown, skóre STÁLE 5");
ok(view.criterionView(roky1.score, roky1.known).state === "unknown", "→ pohledově: nedoloženo (ne falešný průměr)");
ok(dov1.known === true && dov1.basis === "inferred" && dov1.score === 10, "dovednosti bez evidence → known=true, basis=inferred, 2/2=10");

const q2 = { years_total_experience: 8, skills: [{ name: "python", evidence: "5 let v Pythonu" }, { name: "sql", evidence: "MSSQL" }] };
const r2 = rubric.scoreCandidate(q2, R, "cs");
ok(r2.breakdown.find((b) => b.key === "roky").basis === "stated", "roky uvedeny (8) → basis=stated");
ok(r2.breakdown.find((b) => b.key === "dov").basis === "stated", "dovednosti s evidencí → basis=stated");
ok(typeof r2.total === "number" && r2.total > 0, "total je číslo (matematika skóre nedotčena)");

console.log(fail ? `\n${fail} FAIL` : `\nVŠE OK — view + rubric honesty`);
if (fail) process.exitCode = 1;
