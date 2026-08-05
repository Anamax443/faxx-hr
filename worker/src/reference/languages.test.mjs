// Regresní test normalizéru jmen jazyků. Spuštění:  node worker/src/reference/languages.test.mjs
// (languages.ts je TS → přeložíme přes esbuild, který je devDependency projektu.)
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const ts = readFileSync(new URL("./languages.ts", import.meta.url), "utf8");
const js = transformSync(ts, { loader: "ts", format: "esm" }).code;
const { normalizeLanguageName, sameLanguage, languageLabel } = await import("data:text/javascript," + encodeURIComponent(js));

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("✗ " + msg); } else console.log("✓ " + msg); };

// --- rozpoznání názvu → ISO kód -------------------------------------------
const names = [
  ["angličtina", "en"], ["Angličtina", "en"], ["anglický jazyk", "en"], ["AJ", "en"], ["aj", "en"],
  ["English", "en"], ["english (business)", "en"], ["obchodní angličtina", "en"], ["EN", "en"],
  ["němčina", "de"], ["NJ", "de"], ["Deutsch", "de"], ["German", "de"], ["německý jazyk", "de"],
  ["čeština", "cs"], ["český jazyk", "cs"], ["Czech", "cs"],
  ["slovenština", "sk"], ["Slovak", "sk"], ["slovenský jazyk", "sk"],
  ["slovinština", "sl"], ["Slovenian", "sl"],
  ["ruština", "ru"], ["RJ", "ru"], ["Russian", "ru"],
  ["francouzština", "fr"], ["španělština", "es"], ["italština", "it"], ["polština", "pl"],
  ["ukrajinština", "uk"], ["maďarština", "hu"], ["čínština", "zh"], ["japonština", "ja"],
];
for (const [input, code] of names) {
  const e = normalizeLanguageName(input);
  ok(e && e.code === code, `„${input}" → ${code}` + (e ? "" : " (nepoznáno)") + (e && e.code !== code ? ` (dostal ${e.code})` : ""));
}
ok(normalizeLanguageName("klingonština") === null, "neznámý jazyk → null (nehádá se)");
ok(normalizeLanguageName("") === null && normalizeLanguageName(null) === null, "prázdný vstup → null");

// --- shoda jazyků (jádro opravy) ------------------------------------------
ok(sameLanguage("angličtina", "English"), "angličtina = English");
ok(sameLanguage("AJ", "anglický jazyk"), "AJ = anglický jazyk");
ok(sameLanguage("en", "angličtina"), "en = angličtina");
ok(sameLanguage("Němčina", "de"), "Němčina = de");
// REGRESE: norm(„slovenština") = „slovenstina" OBSAHUJE „en" → dřív se počítalo jako angličtina
ok(!sameLanguage("en", "slovenština"), "REGRESE: slovenština NENÍ angličtina");
ok(!sameLanguage("angličtina", "slovenština"), "angličtina ≠ slovenština");
ok(!sameLanguage("slovenština", "slovinština"), "slovenština ≠ slovinština");
ok(!sameLanguage("čeština", "slovenština"), "čeština ≠ slovenština");
ok(!sameLanguage("němčina", "nizozemština"), "němčina ≠ nizozemština");
ok(!sameLanguage("en", ""), "prázdný jazyk se neshoduje");
// neznámé jazyky: opatrné srovnání názvu, nikdy podřetězcem kratším než 4 znaky
ok(sameLanguage("klingonština", "klingonstina"), "neznámý jazyk: shoda přes diakritiku");
ok(!sameLanguage("kl", "klingonština"), "neznámý jazyk: 2 znaky nestačí na shodu");

// --- štítky pro zobrazení ---------------------------------------------------
ok(languageLabel("aj", "cs") === "angličtina" && languageLabel("aj", "en") === "English", "štítek AJ → angličtina / English");
ok(languageLabel("Deutsch", "cs") === "němčina", "štítek Deutsch → němčina");
ok(languageLabel("klingonština", "cs") === "klingonština", "neznámý jazyk se zobrazí, jak byl zadán");

console.log(fail ? `\n${fail} FAIL` : "\nvše OK");
process.exit(fail ? 1 : 0);
