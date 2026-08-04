/**
 * faxx-hr — deterministický rubrik (F3 jádro).
 *
 * Skóre a pořadí kandidátů počítá VÝHRADNĚ tento kód nad strukturovaným
 * `qualification` blokem z extrakce (LLM #1). Skórovací cesta NIKDY nevidí
 * surový text CV — proto sem injection nemá kam zapsat: rozhoduje o pořadí
 * pevný vzorec, ne model, který by šel přemluvit větou „jsem nejlepší".
 *
 * Vstup: `Qualification` (podmnožina schema/extraction.schema.json, blok
 * qualification) + `Rubric` (must-have gates + vážená kritéria, odvozené z
 * inzerátu, doladí personalista).
 * Výstup: `ScoreResult` — total 0..100, gates, rozpad po kritériích s evidencí.
 *
 * Bez závislostí, čistě deterministické → reprodukovatelné a auditovatelné.
 */

import { normalizeLanguageLevel } from "./reference/cefr";

// --- vstupní data (podmnožina extraction schématu) -------------------------
export interface QSkill { name: string; category?: string; level?: string | null; evidence?: string }
export interface QExperience { title: string; employer?: string | null; months?: number | null; seniority?: string | null }
export interface QEducation { level: string; field?: string | null; year?: number | null }
export interface QLanguage { language: string; level?: string | null; level_raw?: string | null }
export interface Qualification {
  years_total_experience?: number | null;
  experience?: QExperience[];
  skills?: QSkill[];
  education?: QEducation[];
  languages?: QLanguage[];
  certifications?: string[];
}

// --- rubrik (odvozený z inzerátu, editovatelný personalistou) ---------------
export type GateOp = ">=" | ">" | "<=" | "<" | "==";
export interface Gate {
  key: string;
  field: string;          // cesta v qualification, např. "years_total_experience"
  op: GateOp;
  value: number;
  reason: string;
}
export type CriterionType =
  | "numeric_scale"   // číselná hodnota → lineární škála (min..max)
  | "set_overlap"     // překryv dovedností s požadovanými
  | "category_map"    // kategorie (vzdělání) → body
  | "cefr_map"        // jazyková úroveň → body
  | "tenure"          // průměrná délka setrvání → stabilita
  | "bonus";          // počet položek × body (certifikace)
export interface Criterion {
  key: string;
  label: string;
  weight: number;                 // 0..1, součet vah ≈ 1 (normalizuje se)
  type: CriterionType;
  min?: number; max?: number;                 // numeric_scale
  required?: string[];                         // set_overlap
  map?: Record<string, number>;                // category_map / cefr_map (0..10)
  aggregate?: "max" | "avg";                   // category_map
  language?: string;                           // cefr_map — který jazyk
  penaltyBelowMonths?: number;                 // tenure
  pointsEach?: number; cap?: number;           // bonus (cap ve výsledných bodech 0..10)
}
export interface Rubric {
  jobTitle: string;
  gates: Gate[];
  criteria: Criterion[];
}

// --- výstup -----------------------------------------------------------------
export interface GateResult { key: string; passed: boolean; reason: string; value: number | null }
export interface EvidenceItem { label: string; text: string }
export interface CriterionResult {
  key: string; label: string; weight: number;
  score: number;          // 0..10
  contribution: number;   // příspěvek do total (0..100), = weight/Σweight * score * 10
  detail: string;         // lidsky čitelná evidence, PROČ tolik bodů
  evidence?: EvidenceItem[]; // doslovné kotvy z viditelného textu CV (ověřené, ne od modelu)
  // --- osy pro „pohledové hodnocení" (viz worker/src/view.ts). NEMĚNÍ skóre. ---
  known: boolean;         // false = pro toto kritérium NEBYLA data → stav „nedoloženo", ne průměr
  basis: "stated" | "inferred" | "unknown"; // jak jistě: doloženo / odvozeno / nevíme
}
export interface ScoreResult {
  total: number;          // 0..100 (0 při diskvalifikaci)
  disqualified: boolean;
  gates: GateResult[];
  breakdown: CriterionResult[];
}

// --- jazyk (jen lidsky čitelné řetežce; logika je stejná) -------------------
export type Lang = "cs" | "en";
const L = (lang: Lang, cs: string, en: string): string => (lang === "en" ? en : cs);

// --- pomůcky ----------------------------------------------------------------
function isNum(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function norm(s: string): string {
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function getField(q: Qualification, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? null : (o as Record<string, unknown>)[k]), q);
}
function gateEval(v: number, op: GateOp, target: number): boolean {
  switch (op) {
    case ">=": return v >= target;
    case ">": return v > target;
    case "<=": return v <= target;
    case "<": return v < target;
    case "==": return v === target;
  }
}

// --- skóre jednoho kritéria (vždy 0..10) ------------------------------------
type ScoreParts = { score: number; detail: string; evidence?: EvidenceItem[]; known: boolean; basis: "stated" | "inferred" | "unknown" };
function criterionScore(c: Criterion, q: Qualification, lang: Lang): ScoreParts {
  switch (c.type) {
    case "numeric_scale": {
      const raw = getField(q, "years_total_experience");
      if (!isNum(raw)) return { score: 5, known: false, basis: "unknown", detail: L(lang, "roky praxe v CV neuvedeny → neznámé (neutrální, nepenalizuje se)", "years of experience not stated in CV → unknown (neutral, no penalty)") };
      const v = raw;
      const min = c.min ?? 0, max = c.max ?? 10;
      const s = clamp01(max > min ? (v - min) / (max - min) : 0) * 10;
      return { score: s, known: true, basis: "stated", detail: L(lang, `${v} (škála ${min}–${max}) → ${s.toFixed(1)}/10`, `${v} (scale ${min}–${max}) → ${s.toFixed(1)}/10`) };
    }
    case "set_overlap": {
      const req = (c.required ?? []).map(norm);
      const skills = q.skills ?? [];
      const have = new Set(skills.map((s) => norm(s.name)));
      const hit = req.filter((r) => [...have].some((h) => h === r || h.includes(r) || r.includes(h)));
      const s = req.length ? (hit.length / req.length) * 10 : 0;
      const miss = req.filter((r) => !hit.includes(r));
      // kotvy: dovednosti, které opravdu matchují požadavek A mají doslovný úryvek z CV (ověřený, ne od modelu)
      const matchesReq = (nm: string) => { const n = norm(nm); return req.some((r) => n === r || n.includes(r) || r.includes(n)); };
      const evidence = skills.filter((sk) => sk.evidence && matchesReq(sk.name)).map((sk) => ({ label: sk.name, text: sk.evidence as string }));
      // known: máme co porovnávat (jsou požadavky). basis: doloženo úryvkem vs. jen shoda názvu.
      return { score: s, known: req.length > 0, basis: req.length === 0 ? "unknown" : evidence.length ? "stated" : "inferred", detail: L(lang,
        `${hit.length}/${req.length} klíčových dovedností${miss.length ? ` (chybí: ${miss.join(", ")})` : ""}`,
        `${hit.length}/${req.length} key skills${miss.length ? ` (missing: ${miss.join(", ")})` : ""}`),
        evidence: evidence.length ? evidence : undefined };
    }
    case "category_map": {
      const levels = (q.education ?? []).map((e) => c.map?.[norm(e.level)] ?? 0);
      if (!levels.length) return { score: 0, known: false, basis: "unknown", detail: L(lang, "bez uvedeného vzdělání", "no education stated") };
      const s = c.aggregate === "avg" ? levels.reduce((a, b) => a + b, 0) / levels.length : Math.max(...levels);
      const best = (q.education ?? []).find((e) => (c.map?.[norm(e.level)] ?? 0) === Math.max(...levels));
      return { score: s, known: true, basis: "stated", detail: L(lang, `nejvyšší: ${best?.level ?? "?"} → ${s.toFixed(1)}/10`, `highest: ${best?.level ?? "?"} → ${s.toFixed(1)}/10`) };
    }
    case "cefr_map": {
      const want = norm(c.language ?? "en");
      const langs = (q.languages ?? []).filter((l) => {
        const n = norm(l.language);
        return n === want || n.includes(want) || (want === "en" && (n.includes("angl") || n.includes("english") || n === "aj"));
      });
      // Úroveň mapuje DETERMINISTICKY náš normalizér podle citovaného CEFR standardu
      // (reference/cefr.ts), ne model. level_raw (doslovná fráze z CV) má přednost.
      const cand = langs.map((l) => {
        const src = l.level_raw ?? l.level ?? "";
        const m = normalizeLanguageLevel(src);
        const key = (m.level ?? "").toUpperCase();
        const pts = m.level ? (c.map?.[key] ?? c.map?.[m.level] ?? 0) : 0;
        return { l, m, pts, src };
      });
      if (!cand.length || cand.every((x) => !x.m.level)) {
        return { score: 0, known: false, basis: "unknown", detail: L(lang, `${c.language ?? "EN"}: neuvedeno`, `${c.language ?? "EN"}: not stated`) };
      }
      const best = cand.reduce((a, b) => (b.pts > a.pts ? b : a));
      const basis: "stated" | "inferred" = best.m.stated ? "stated" : "inferred";
      // odvozená úroveň nese jako evidenci doslovnou frázi z CV (personalista ověří/přepíše)
      const evidence = (!best.m.stated && best.src) ? [{ label: best.l.language || (c.language ?? "EN"), text: best.src }] : undefined;
      const tag = best.m.stated ? "" : L(lang, ` (odvozeno z „${best.src}“)`, ` (inferred from “${best.src}”)`);
      return { score: best.pts, known: true, basis, detail: `${c.language ?? "EN"}: ${best.m.level}${tag} → ${best.pts.toFixed(1)}/10`, evidence };
    }
    case "tenure": {
      const months = (q.experience ?? []).map((e) => e.months).filter(isNum) as number[];
      if (!months.length) return { score: 5, known: false, basis: "unknown", detail: L(lang, "bez dat o délce pozic → neznámé (neutrální)", "no data on position tenure → unknown (neutral)") };
      const avg = months.reduce((a, b) => a + b, 0) / months.length;
      const floor = c.penaltyBelowMonths ?? 6;
      // ≤floor = 0 b., ≥24 měs = 10 b., mezi lineárně
      const s = clamp01((avg - floor) / (24 - floor)) * 10;
      return { score: s, known: true, basis: "stated", detail: L(lang, `průměrné setrvání ${avg.toFixed(0)} měs → ${s.toFixed(1)}/10`, `average tenure ${avg.toFixed(0)} months → ${s.toFixed(1)}/10`) };
    }
    case "bonus": {
      const n = (q.certifications ?? []).length;
      const pts = Math.min(n * (c.pointsEach ?? 2), c.cap ?? 10);
      return { score: pts, known: true, basis: "stated", detail: L(lang, `${n} certifikací → ${pts.toFixed(1)}/10`, `${n} certifications → ${pts.toFixed(1)}/10`) };
    }
  }
  return { score: 0, known: false, basis: "unknown", detail: "" };
}

// --- veřejné API ------------------------------------------------------------
export function scoreCandidate(q: Qualification, rubric: Rubric, lang: Lang = "cs"): ScoreResult {
  const gates: GateResult[] = rubric.gates.map((g) => {
    const raw = getField(q, g.field);
    const v = isNum(raw) ? raw : null;
    // Neznámý údaj NEDISKVALIFIKUJE (benefit of the doubt) — vyřadí jen když reálně víme, že je pod limitem.
    const passed = v == null ? true : gateEval(v, g.op, g.value);
    return { key: g.key, passed, reason: g.reason, value: v };
  });
  const disqualified = gates.some((g) => !g.passed);

  const wsum = rubric.criteria.reduce((a, c) => a + c.weight, 0) || 1;
  const breakdown: CriterionResult[] = rubric.criteria.map((c) => {
    const { score, detail, evidence, known, basis } = criterionScore(c, q, lang);
    return { key: c.key, label: c.label, weight: c.weight, score, contribution: (c.weight / wsum) * score * 10, detail, evidence, known, basis };
  });
  const total = disqualified ? 0 : breakdown.reduce((a, b) => a + b.contribution, 0);
  return { total: Math.round(total * 10) / 10, disqualified, gates, breakdown };
}

/** Seřadí kandidáty: nediskvalifikovaní podle skóre sestupně, diskvalifikovaní nakonec. */
export function rankCandidates<T extends { score: ScoreResult }>(cands: T[]): T[] {
  return [...cands].sort((a, b) => {
    if (a.score.disqualified !== b.score.disqualified) return a.score.disqualified ? 1 : -1;
    return b.score.total - a.score.total;
  });
}
