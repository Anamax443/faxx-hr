// Regresní syntaktická kontrola KLIENTSKÝCH <script> bloků v app.ts.
// Důvod: klientský JS je uvnitř HTML template-literalu → esbuild ho NEvaliduje.
// Chyba typu rozbitý řetězec (např. \"...\" v template literalu → předčasné ukončení)
// zmrazí celou appku a grep na přítomnost textu ji nechytí. Spuštění:
//   node worker/src/app.syntax.test.mjs
import { readFileSync } from "node:fs";

const s = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
const scripts = [...s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

let bad = 0;
scripts.forEach((raw, i) => {
  if (!raw.trim()) return;
  const js = raw.replace(/\$\{[^{}]*\}/g, '"__I__"'); // neutralizuj ${...} interpolace
  try {
    new Function(js); // parse (ne run) → SyntaxError při chybě
    console.log(`✓ client <script> #${i} parse OK (${js.length} zn.)`);
  } catch (e) {
    bad++;
    console.log(`✗ client <script> #${i} SYNTAX ERROR: ${e.message}`);
  }
});
console.log(bad ? `\n${bad} vadný — appka by zamrzla` : "\nVŠE OK — klientský JS se parsuje");
if (bad) process.exitCode = 1;
