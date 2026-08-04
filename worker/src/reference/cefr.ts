/**
 * Referenční vrstva — CEFR (Common European Framework of Reference for Languages).
 *
 * Účel: DETERMINISTICKY normalizovat volný text úrovně jazyka z CV
 * (např. „angličtina – umožňující profesionální práci") na pevnou škálu CEFR,
 * s DOLOŽENÍM (co se shodovalo + z jakého pravidla/zdroje) a s příznakem,
 * zda je úroveň v CV explicitně UVEDENÁ, nebo AI/kódem ODVOZENÁ
 * (→ personalista to vidí a může přepsat).
 *
 * NENÍ to úsudek LLM: mapa vychází z citovaného standardu, je auditovatelná
 * a reprodukovatelná (viz reference/README.md — princip „junior HR předchroustá
 * podle standardu, senior rozhodne"; o mapě rozhoduje KÓD, ne model).
 *
 * Zdroje (viz reference/README.md):
 *  - CEFR global scale + úrovně: Council of Europe,
 *    coe.int/.../level-descriptions a Europass self-assessment grid
 *    (© Council of Europe / EU, 2001–2020).
 *  - Přibližný crosswalk ILR / LinkedIn (Elementary / Limited working /
 *    Professional working / Full professional / Native) ↔ CEFR — přibližný a
 *    konzervativní; žádné oficiální 1:1 mapování neexistuje.
 */

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "native";

export const CEFR_LEVELS: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2", "native"];

/** Pořadí pro porovnání „aspoň úroveň X" (native = nejvyšší). */
export const CEFR_RANK: Record<CefrLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6, native: 7 };

export const CEFR_GROUP: Record<CefrLevel, string> = {
  A1: "A · Basic user", A2: "A · Basic user",
  B1: "B · Independent user", B2: "B · Independent user",
  C1: "C · Proficient user", C2: "C · Proficient user",
  native: "Native / bilingual",
};

/** Oficiální global-scale deskriptory (Council of Europe). CS = pracovní překlad. */
export const CEFR_DESCRIPTOR: Record<CefrLevel, { cs: string; en: string }> = {
  A1: { en: "Can understand and use familiar everyday expressions and very basic phrases.", cs: "Rozumí známým každodenním výrazům a zcela základním frázím a umí je používat." },
  A2: { en: "Can understand sentences and frequently used expressions related to areas of most immediate relevance.", cs: "Rozumí větám a často používaným výrazům z oblastí bezprostředního významu (osobní údaje, nákupy, zaměstnání)." },
  B1: { en: "Can understand the main points of clear standard input on familiar matters (work, school, leisure).", cs: "Rozumí hlavním myšlenkám srozumitelné spisovné řeči o běžných tématech (práce, škola, volný čas)." },
  B2: { en: "Can understand the main ideas of complex text, including technical discussions in their field.", cs: "Rozumí hlavním myšlenkám složitých textů včetně odborných diskusí ve svém oboru." },
  C1: { en: "Can understand a wide range of demanding, longer texts and recognise implicit meaning; fluent, flexible use.", cs: "Rozumí širokému spektru náročných delších textů a rozpozná i skryté významy; jazyk používá plynule a pružně." },
  C2: { en: "Can understand with ease virtually everything heard or read; very fluent and precise.", cs: "Snadno rozumí prakticky všemu, co si přečte nebo vyslechne; vyjadřuje se velmi plynně a přesně." },
  native: { en: "Native or bilingual proficiency (educated native speaker).", cs: "Rodilý mluvčí / bilingvní úroveň (na úrovni vzdělaného rodilého mluvčího)." },
};

export const CEFR_SOURCES: readonly string[] = [
  "Council of Europe — CEFR global scale & level descriptions: https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions",
  "Europass — CEFR self-assessment grid (PDF): https://europass.europa.eu/system/files/2020-05/CEFR%20self-assessment%20grid%20EN.pdf",
  "ILR / LinkedIn ↔ CEFR — přibližný crosswalk (Elementary≈A1/A2, Limited working≈B2, Professional working≈C1, Full professional≈C2, Native≈native); oficiální 1:1 mapa neexistuje.",
];

interface Rule { level: CefrLevel; re: RegExp; stated: boolean; src: string }

/**
 * Pořadí ROZHODUJE — první shoda vyhrává:
 *  1) explicitní CEFR token VZESTUPNĚ (u rozsahů „B2/C1" vezme NIŽŠÍ = konzervativně),
 *  2) rodilý / bilingvní,
 *  3) konkrétní ILR/LinkedIn fráze + obecná slovní úroveň (specifické PŘED obecné).
 * `stated=true` = úroveň je v textu explicitní; `false` = odvozeno (personalista ověří).
 */
const RULES: Rule[] = [
  // 1) explicitní CEFR token — vzestupně, aby „B2/C1" dalo konzervativně B2
  { level: "A1", re: /\ba1\b/i, stated: true, src: "CEFR token" },
  { level: "A2", re: /\ba2\b/i, stated: true, src: "CEFR token" },
  { level: "B1", re: /\bb1\b/i, stated: true, src: "CEFR token" },
  { level: "B2", re: /\bb2\b/i, stated: true, src: "CEFR token" },
  { level: "C1", re: /\bc1\b/i, stated: true, src: "CEFR token" },
  { level: "C2", re: /\bc2\b/i, stated: true, src: "CEFR token" },
  // 2) rodilý / bilingvní  (bez \b — to v JS nefunguje s diakritikou; stemy jsou dost specifické)
  { level: "native", re: /native|mother\s*tongue|bilingual|rodil[ýáaé]|mate[řr][šs]tin|mate[řr]sk[ýáaé]|rodn[ýíyi]\s*jazyk/i, stated: true, src: "native/bilingual" },
  // 3a) ILR/LinkedIn crosswalk (odvozeno)
  { level: "C2", re: /full\s*professional|pln[áaé]\s*profes/i, stated: false, src: "ILR/LinkedIn: full professional ≈ C2" },
  { level: "C1", re: /professional\s*working|profesion[áa]ln|profesn[íiěe]|umož[ňn]uj[íi]c[íi]\s*profes/i, stated: false, src: "ILR/LinkedIn: professional working ≈ C1" },
  { level: "C1", re: /fluent|plyn(ule|n[ěe]|ul[áaý])|near[-\s]?native|t[ée]m[ěe][řr]\s*rodil/i, stated: false, src: "plynně / fluent ≈ C1" },
  { level: "B2", re: /limited\s*working|upper[-\s]?intermediate|vy[šs]{2}[íi]\s*(st[řr]edn|pokro)/i, stated: false, src: "limited working / upper-intermediate ≈ B2" },
  // 3b) obecná slovní úroveň — specifické (mírně/středně pokročilá) PŘED obecné (pokročilá)
  { level: "B1", re: /(m[íi]rn[ěe]|st[řr]edn[ěe])\s*pokro[čc]il|intermediate|conversational|konverza[čc]|komunikativn|domluv/i, stated: false, src: "mírně/středně pokročilá / intermediate ≈ B1" },
  { level: "B2", re: /advanced|pokro[čc]il/i, stated: false, src: "pokročilá / advanced ≈ B2" },
  { level: "A2", re: /elementary|pre[-\s]?intermediate|z[áa]klad|basic/i, stated: false, src: "základy / elementary ≈ A2" },
  { level: "A1", re: /beginner|za[čc][áa]te[čc]n[íi]k/i, stated: false, src: "začátečník / beginner ≈ A1" },
];

export interface CefrMatch {
  level: CefrLevel | null;   // null = nejde spolehlivě určit → rubrik neutrálně, doplní člověk
  matched: string | null;    // úsek textu, který pravidlo chytil (evidence)
  stated: boolean;           // true = v CV explicitně; false = odvozeno (ověřit)
  source: string | null;     // které pravidlo/standard rozhodlo
}

/**
 * Normalizuj volný text úrovně jazyka na CEFR. Deterministické, bez AI.
 * Vrací i evidenci (matched) a příznak stated/inferred pro doložitelnost.
 */
export function normalizeLanguageLevel(raw: string | null | undefined): CefrMatch {
  const s = (raw == null ? "" : String(raw)).trim();
  if (!s) return { level: null, matched: null, stated: false, source: null };
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) return { level: r.level, matched: m[0], stated: r.stated, source: r.src };
  }
  return { level: null, matched: null, stated: false, source: null };
}

/** Krátký štítek úrovně pro UI/tisk. */
export function cefrLabel(level: CefrLevel, lang: "cs" | "en" = "cs"): string {
  return level === "native" ? (lang === "en" ? "Native/bilingual" : "Rodilý/bilingvní") : level;
}
