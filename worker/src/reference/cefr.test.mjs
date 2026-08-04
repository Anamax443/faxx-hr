// Regresní test CEFR normalizéru. Spuštění:  node worker/src/reference/cefr.test.mjs
// (cefr.ts je TS → přeložíme přes esbuild, který je devDependency projektu.)
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const ts = readFileSync(new URL("./cefr.ts", import.meta.url), "utf8");
const js = transformSync(ts, { loader: "ts", format: "esm" }).code;
const mod = await import("data:text/javascript," + encodeURIComponent(js));
const { normalizeLanguageLevel } = mod;

// [vstup, očekávaná úroveň, očekávané stated] — směs CS/EN reálných formulací z CV
const cases = [
  ["C1", "C1", true],
  ["úroveň B2", "B2", true],
  ["Angličtina C1", "C1", true],                         // jediný token
  ["B2/C1", "B2", true],                                 // rozsah → konzervativně nižší
  ["angličtina – umožňující profesionální práci", "C1", false],
  ["English - professional working proficiency", "C1", false],
  ["full professional proficiency", "C2", false],
  ["AJ plynně", "C1", false],
  ["fluent English", "C1", false],
  ["němčina mírně pokročilá", "B1", false],
  ["středně pokročilá", "B1", false],
  ["konverzační úroveň", "B1", false],
  ["limited working proficiency", "B2", false],
  ["pokročilá znalost", "B2", false],
  ["upper-intermediate", "B2", false],
  ["základní znalost", "A2", false],
  ["elementary", "A2", false],
  ["úplný začátečník", "A1", false],
  ["rodilý mluvčí", "native", true],
  ["native speaker", "native", true],
  ["mateřský jazyk", "native", true],
  ["", null, false],
  ["nějaká věta bez úrovně", null, false],
];

let fail = 0;
for (const [input, expLevel, expStated] of cases) {
  const r = normalizeLanguageLevel(input);
  const ok = r.level === expLevel && (expLevel === null || r.stated === expStated);
  if (!ok) fail++;
  const tag = r.level ? `${r.level} (${r.stated ? "stated" : "inferred"}${r.source ? " · " + r.source : ""})` : "null";
  console.log(`${ok ? "✓" : "✗"} "${input}" → ${tag}${ok ? "" : `   [čekáno ${expLevel}/${expStated ? "stated" : "inferred"}]`}`);
}
console.log(fail ? `\n${fail}/${cases.length} FAIL` : `\nVŠE OK — ${cases.length}/${cases.length}`);
if (fail) process.exitCode = 1;
