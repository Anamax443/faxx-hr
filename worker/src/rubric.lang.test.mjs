// Test jazykového kritéria v rubriku (jazyk dle inzerátu, ne napevno angličtina).
// Spuštění:  node worker/src/rubric.lang.test.mjs
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const out = buildSync({ entryPoints: [fileURLToPath(new URL("./rubric.ts", import.meta.url))], bundle: true, format: "esm", write: false, logLevel: "silent" });
const { scoreCandidate } = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("✗ " + msg); } else console.log("✓ " + msg); };

const MAP = { A1: 0, A2: 0, B1: 4, B2: 7, C1: 9, C2: 10, native: 10 };
const rub = (languages) => ({ jobTitle: "Test", gates: [], criteria: [{ key: "en", label: "Jazyk", weight: 1, type: "cefr_map", languages, map: MAP }] });
const lang1 = (q, languages) => scoreCandidate(q, rub(languages), "cs").breakdown.find((b) => b.key === "en");

// --- jazyk se bere z požadavků, ne napevno angličtina ----------------------
const de = lang1({ languages: [{ language: "němčina", level: "C1" }] }, ["němčina"]);
ok(de.score === 9 && de.known && de.basis === "stated", "němčina C1 → 9/10 (požadavek němčina)");

const deOnlyEn = lang1({ languages: [{ language: "angličtina", level: "C2" }] }, ["němčina"]);
ok(deOnlyEn.score === 0 && !deOnlyEn.known, "pozice chce němčinu, kandidát má jen angličtinu → 0 a „neuvedeno“");
ok(/němčina: neuvedeno/.test(deOnlyEn.detail), "detail říká, který jazyk chybí: " + deOnlyEn.detail);

// --- REGRESE: „slovenština" obsahuje „en" → dřív se počítala jako angličtina
const sk = lang1({ languages: [{ language: "slovenština", level_raw: "rodilý mluvčí" }] }, ["angličtina"]);
ok(sk.score === 0 && !sk.known, "REGRESE: rodilá slovenština NEDÁ body za angličtinu");

// --- víc jazyků = průměr přes ně ------------------------------------------
const both = lang1({ languages: [{ language: "angličtina", level: "C1" }, { language: "němčina", level: "B1" }] }, ["angličtina", "němčina"]);
ok(Math.abs(both.score - 6.5) < 1e-9, "AJ C1 (9) + NJ B1 (4) → průměr 6,5/10, dostal " + both.score);
const half = lang1({ languages: [{ language: "angličtina", level: "C1" }] }, ["angličtina", "němčina"]);
ok(Math.abs(half.score - 4.5) < 1e-9 && half.known, "chybějící druhý jazyk = 0 bodů do průměru (4,5), ne vyřazení");
ok(/angličtina: C1 .*němčina: neuvedeno/.test(half.detail), "detail rozepisuje oba jazyky: " + half.detail);

// --- zápis jazyka v CV nerozhoduje (AJ / English / anglicky) --------------
for (const psane of ["AJ", "English", "anglický jazyk", "angličtina"]) {
  const r = lang1({ languages: [{ language: psane, level: "B2" }] }, ["angličtina"]);
  ok(r.score === 7, `zápis „${psane}" v CV se spáruje s požadavkem angličtina`);
}

// --- odvozená úroveň nese evidenci (doslovná fráze z CV) ------------------
const inf = lang1({ languages: [{ language: "Deutsch", level_raw: "fließend" }] }, ["němčina"]);
ok(inf.basis === "inferred" || inf.basis === "unknown", "volná fráze → odvozeno/neznámé, nikdy „doloženo“");

// --- žádný požadovaný jazyk = kritérium nemá co hodnotit ------------------
const none = lang1({ languages: [{ language: "angličtina", level: "C2" }] }, []);
ok(none.score === 0 && !none.known && /není žádný jazyk/.test(none.detail), "prázdné požadavky → „v požadavcích není žádný jazyk“");

// --- zpětná kompatibilita: starý zápis `language` ------------------------
const old = scoreCandidate({ languages: [{ language: "angličtina", level: "C1" }] },
  { jobTitle: "T", gates: [], criteria: [{ key: "en", label: "Angličtina", weight: 1, type: "cefr_map", language: "EN", map: MAP }] }, "cs").breakdown[0];
ok(old.score === 9 && old.known, "starý rubrik s language:'EN' funguje dál (zpětná kompatibilita)");

console.log(fail ? `\n${fail} FAIL` : "\nvše OK");
process.exit(fail ? 1 : 0);
