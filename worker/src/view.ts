/**
 * Prezentační vrstva — „pohledové hodnocení".
 *
 * Mapuje deterministický výsledek kritéria (skóre 0..10 + zda byla DATA)
 * na STAV čitelný na první pohled — bez falešné přesnosti desetin.
 * NEMĚNÍ skóre ani pořadí: je to jen jak se tentýž výsledek zobrazí.
 *
 * Klíčová poctivost: „neznámo" je vlastní stav, NE průměr. Chybějící údaj
 * se nesmí tvářit jako 5/10 (to je oprava nekonzistence v rubric.ts, kde
 * neuvedené roky/tenure dávaly 5, ale neuvedené vzdělání/jazyk 0).
 *
 * Granularita se řídí daty: běžná kritéria = 4 stavy; jazyk (CEFR) si nese
 * vlastní reálnou škálu (A1..C2/native) mimo tuto funkci — viz reference/cefr.ts.
 */

export type MatchState = "strong" | "partial" | "weak" | "unknown";

/** Prahy převodu skóre 0..10 → stav (konzervativní; v jednom místě k doladění). */
export const VIEW_THRESHOLDS = { strong: 7.5, partial: 4.0 } as const;

export interface CriterionView {
  state: MatchState;
  glyph: string;        // ● ◐ ○ —  (čitelné i černobíle / pro barvoslepé)
  tone: "good" | "mid" | "bad" | "muted";  // vodítko pro barvu (nikdy JEN barva)
  labelCs: string;
  labelEn: string;
}

const META: Record<MatchState, { glyph: string; tone: CriterionView["tone"]; cs: string; en: string }> = {
  strong:  { glyph: "●", tone: "good",  cs: "silná",     en: "strong" },
  partial: { glyph: "◐", tone: "mid",   cs: "částečná",  en: "partial" },
  weak:    { glyph: "○", tone: "bad",   cs: "slabá",     en: "weak" },
  unknown: { glyph: "—", tone: "muted", cs: "nedoloženo", en: "not evidenced" },
};

/**
 * Stav kritéria „na pohled". `known=false` → vždy `unknown` (nezáleží na skóre).
 */
export function criterionView(score: number, known: boolean): CriterionView {
  const state: MatchState = !known
    ? "unknown"
    : score >= VIEW_THRESHOLDS.strong ? "strong"
    : score >= VIEW_THRESHOLDS.partial ? "partial"
    : "weak";
  const m = META[state];
  return { state, glyph: m.glyph, tone: m.tone, labelCs: m.cs, labelEn: m.en };
}

export function viewLabel(state: MatchState, lang: "cs" | "en" = "cs"): string {
  return lang === "en" ? META[state].en : META[state].cs;
}

// --- osa jistoty (druhá, nezávislá osa: JAK JISTĚ to víme) ------------------
// Odděluje „jak dobrá shoda" (state) od „jak jistý údaj" (basis). Tatáž
// hodnota může být doložená (úryvek z CV), odvozená (např. CEFR z volné fráze)
// nebo neznámá. Personalista tak pozná, kde se dívat obezřetně / co přepsat.
export type Certainty = "stated" | "inferred" | "unknown";

const CERT: Record<Certainty, { glyph: string; cs: string; en: string }> = {
  stated:   { glyph: "◆", cs: "doloženo", en: "stated" },   // v CV explicitně (ideálně s evidencí)
  inferred: { glyph: "◇", cs: "odvozeno", en: "inferred" }, // namapováno/spočítáno → ověřit
  unknown:  { glyph: "·", cs: "nevíme",   en: "unknown" },   // bez dat
};

export interface CertaintyView { basis: Certainty; glyph: string; labelCs: string; labelEn: string }

export function certaintyView(basis: Certainty): CertaintyView {
  const m = CERT[basis];
  return { basis, glyph: m.glyph, labelCs: m.cs, labelEn: m.en };
}

export function certaintyLabel(basis: Certainty, lang: "cs" | "en" = "cs"): string {
  return lang === "en" ? CERT[basis].en : CERT[basis].cs;
}

/** Gate (musí-mít): ✓ splněno / ✗ nesplněno / — nevíme. */
export function gateGlyph(passed: boolean, known: boolean): string {
  return !known ? "—" : passed ? "✓" : "✗";
}
