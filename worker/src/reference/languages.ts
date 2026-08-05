/**
 * Referenční vrstva — JMÉNA JAZYKŮ (ISO 639-1).
 *
 * Účel: DETERMINISTICKY poznat, o který jazyk jde, ať už je v CV nebo v inzerátu
 * napsaný jakkoli („angličtina", „AJ", „anglický jazyk", „English", „Englisch", „en").
 * Rubrik pak porovnává KÓDY, ne řetězce — tím zmizí falešné shody podřetězcem
 * (norm("slovenština") = „slovenstina" obsahuje „en" → dřív se počítalo jako angličtina).
 *
 * NENÍ to úsudek LLM: tabulka je pevná, auditovatelná a reprodukovatelná
 * (viz reference/README.md — o mapě rozhoduje KÓD, ne model).
 *
 * Zdroj: ISO 639-1 (dvoupísmenné kódy jazyků) + běžné české/anglické názvy a zkratky
 * používané v CV a inzerátech (AJ/NJ/RJ… = běžná školní praxe v ČR).
 */

export interface LanguageEntry {
  code: string;      // ISO 639-1
  cs: string;        // český název (zobrazení)
  en: string;        // anglický název (zobrazení)
  exact: string[];   // přesné tvary (zkratky, kódy) — musí sedět CELÝ řetězec
  stems: string[];   // začátky slov — token musí ZAČÍNAT stemem (min. 4 znaky)
}

/** Pořadí rozhoduje při víceznačnosti (první shoda vyhrává). */
export const LANGUAGES: readonly LanguageEntry[] = [
  { code: "en", cs: "angličtina", en: "English", exact: ["en", "eng", "aj", "a.j."], stems: ["anglic", "englis", "englan"] },
  { code: "de", cs: "němčina", en: "German", exact: ["de", "ger", "deu", "nj", "n.j."], stems: ["nemcin", "nemeck", "german", "deutsch"] },
  { code: "cs", cs: "čeština", en: "Czech", exact: ["cs", "cz", "cze", "ces", "cj"], stems: ["cestin", "cesky", "ceske", "cesk", "czech", "tschech"] },
  { code: "sk", cs: "slovenština", en: "Slovak", exact: ["sk", "svk", "slk"], stems: ["slovenc", "slovens", "slovak", "slowak"] },
  { code: "ru", cs: "ruština", en: "Russian", exact: ["ru", "rus", "rj", "r.j."], stems: ["rustin", "rusky", "ruske", "russi", "russl"] },
  { code: "fr", cs: "francouzština", en: "French", exact: ["fr", "fra", "fre", "fj"], stems: ["francou", "french", "franzo"] },
  { code: "es", cs: "španělština", en: "Spanish", exact: ["es", "esp", "spa", "sj"], stems: ["spanel", "spanis", "castell", "espan"] },
  { code: "it", cs: "italština", en: "Italian", exact: ["it", "ita"], stems: ["italst", "italsk", "italia", "italie"] },
  { code: "pl", cs: "polština", en: "Polish", exact: ["pl", "pol"], stems: ["polstin", "polsky", "polske", "polish", "polnis"] },
  { code: "uk", cs: "ukrajinština", en: "Ukrainian", exact: ["uk", "ukr"], stems: ["ukrajin", "ukrain"] },
  { code: "hu", cs: "maďarština", en: "Hungarian", exact: ["hu", "hun"], stems: ["madars", "hungar", "magyar", "ungari"] },
  { code: "ro", cs: "rumunština", en: "Romanian", exact: ["ro", "ron", "rum"], stems: ["rumun", "romani", "rumani"] },
  { code: "nl", cs: "nizozemština", en: "Dutch", exact: ["nl", "nld", "dut"], stems: ["nizozem", "holand", "dutch", "nieder"] },
  { code: "pt", cs: "portugalština", en: "Portuguese", exact: ["pt", "por"], stems: ["portug"] },
  { code: "sv", cs: "švédština", en: "Swedish", exact: ["sv", "swe"], stems: ["svedst", "svedsk", "swedis", "schwed"] },
  { code: "no", cs: "norština", en: "Norwegian", exact: ["no", "nor", "nb", "nn"], stems: ["norstin", "norsky", "norweg", "norwegi"] },
  { code: "da", cs: "dánština", en: "Danish", exact: ["da", "dan"], stems: ["danstin", "dansky", "danish", "danisch"] },
  { code: "fi", cs: "finština", en: "Finnish", exact: ["fi", "fin"], stems: ["finstin", "finsky", "finnis", "suomi"] },
  { code: "tr", cs: "turečtina", en: "Turkish", exact: ["tr", "tur"], stems: ["turect", "turecky", "turkis", "turkce"] },
  { code: "zh", cs: "čínština", en: "Chinese", exact: ["zh", "chi", "zho", "cn"], stems: ["cinstin", "cinsky", "chines", "mandar", "putong"] },
  { code: "ja", cs: "japonština", en: "Japanese", exact: ["ja", "jpn", "jp"], stems: ["japons", "japans", "japane", "nihong"] },
  { code: "ko", cs: "korejština", en: "Korean", exact: ["ko", "kor"], stems: ["korejs", "korean"] },
  { code: "ar", cs: "arabština", en: "Arabic", exact: ["ar", "ara"], stems: ["arabst", "arabsk", "arabic", "arabis"] },
  { code: "he", cs: "hebrejština", en: "Hebrew", exact: ["he", "heb"], stems: ["hebrej", "hebrew", "ivrit"] },
  { code: "el", cs: "řečtina", en: "Greek", exact: ["el", "ell", "gre"], stems: ["rectin", "recky", "greek", "griech"] },
  { code: "hr", cs: "chorvatština", en: "Croatian", exact: ["hr", "hrv"], stems: ["chorvat", "croat", "kroat", "hrvats"] },
  { code: "sr", cs: "srbština", en: "Serbian", exact: ["sr", "srp"], stems: ["srbst", "srbsk", "serbi", "serbis"] },
  { code: "sl", cs: "slovinština", en: "Slovenian", exact: ["sl", "slv"], stems: ["slovinc", "slovins", "sloveni", "slowen"] },
  { code: "bg", cs: "bulharština", en: "Bulgarian", exact: ["bg", "bul"], stems: ["bulhar", "bulgar"] },
  { code: "vi", cs: "vietnamština", en: "Vietnamese", exact: ["vi", "vie"], stems: ["vietnam"] },
];

/** Bez diakritiky, malá písmena, sjednocené mezery. Stejná normalizace jako v rubriku. */
export function normName(s: string | null | undefined): string {
  return (s == null ? "" : String(s)).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// slova, která nenesou informaci o jazyce („anglický JAZYK", „business ENGLISH")
const STOP = new Set(["jazyk", "jazyka", "jazyku", "jazyky", "language", "sprache", "obchodni", "business", "technicka", "technicky", "technical", "odborna", "odborny", "aktivne", "pasivne", "urovni", "uroven"]);

/**
 * Volný název jazyka → záznam ISO 639-1. `null` = nepoznáno (rubrik pak
 * porovnává opatrně podle názvu, nikdy podřetězcem kratším než 4 znaky).
 */
export function normalizeLanguageName(raw: string | null | undefined): LanguageEntry | null {
  const s = normName(raw);
  if (!s) return null;
  // 1) přesný tvar celého řetězce (kódy a zkratky — jen tady, aby „en" nechytlo „slovenstina")
  for (const e of LANGUAGES) if (e.exact.includes(s)) return e;
  // 2) tokeny: slovo musí ZAČÍNAT stemem (≥4 znaky) → „obchodní angličtina" i „anglického jazyka".
  //    Zkratky (2–3 znaky) se tu ZÁMĚRNĚ neberou — jen jako celý řetězec výše.
  const tokens = s.split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
  for (const e of LANGUAGES) {
    if (tokens.some((t) => e.stems.some((st) => st.length >= 4 && t.startsWith(st)))) return e;
  }
  // 3) víceslovné přesné tvary bez stopslov („anglicky jazyk" → „anglicky")
  const bare = tokens.join(" ");
  if (bare && bare !== s) for (const e of LANGUAGES) if (e.exact.includes(bare)) return e;
  return null;
}

/** Název jazyka pro zobrazení (CS/EN). Nepoznaný jazyk vrací původní text. */
export function languageLabel(raw: string, lang: "cs" | "en" = "cs"): string {
  const e = normalizeLanguageName(raw);
  if (!e) return String(raw || "").trim();
  return lang === "en" ? e.en : e.cs;
}

/**
 * Jde o týž jazyk? Porovnává ISO kódy; když aspoň jeden název nepoznáme,
 * srovnává opatrně názvy (shoda celého názvu nebo začátek slova ≥4 znaky).
 * NIKDY ne podřetězcem — „en" ⊄ „slovenstina".
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const ea = normalizeLanguageName(a), eb = normalizeLanguageName(b);
  if (ea && eb) return ea.code === eb.code;
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const stem = (x: string, y: string) => x.length >= 4 && y.startsWith(x);
  return stem(na, nb) || stem(nb, na);
}
