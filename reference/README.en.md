# Reference layer — external standards for assessment

> [🇨🇿 Čeština](README.md) · 🇬🇧 English

A set of **public, citable standards** that the normalisation of CV data leans on.
The idea: **the AI (junior HR) pre-chews according to a documented standard, the senior HR decides.**

## Usage principle — read before adding anything

The standards are used as a **deterministic reference that the code reads** — not as context
we'd "dump" a PDF into and let the LLM freely assess.

- ✅ **Right:** standard = taxonomy / code list / scale; the code **maps and evidences** against
  it (skill → ESCO id, "professional English" → CEFR C1 per the descriptor). The model stays a
  mere *translator into the schema*; every value carries **evidence** (a CV snippet) and a
  **stated / inferred** flag the recruiter can override.
- ❌ **Wrong:** load a methodology into the prompt and let the model "assess the candidate". That
  reintroduces model subjectivity into the score → breaks the invariant *"code scores, not the
  model"*, is non-auditable, and risky under the **EU AI Act (high-risk recruitment)**.

This preserves faxx-hr's whole principle: **AI helps where a rule can't, but never silently —
always with evidence and an override.** The assessment must be *job-related* and
non-discriminatory (EU AI Act Art. 14, GDPR Art. 22; US EEOC Uniform Guidelines).

## Sources

| Standard | For what | Availability | Link |
|---|---|---|---|
| **CEFR** (languages A1–C2) | `languages.level` — map free text to the scale via "can-do" descriptors | **free** (© CoE/EU) | [coe.int – level descriptions](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions) · [Europass grid](https://europass.europa.eu/en/common-european-framework-reference-language-skills) |
| **ESCO** (skills/competences/occupations) | `skills`, `seniority` — normalise to the EU taxonomy (Czech incl.) | **free**, v1.2.1 (12/2025), CSV/RDF/JSON-LD, 28 languages | [esco.ec.europa.eu/download](https://esco.ec.europa.eu/en/use-esco/download) |
| **EQF** + **NSK / NSP** (CZ, MoLSA) | `education.level`, qualifications/fields (Ing→master, Czech fields) | **free** | [NSK](https://www.narodnikvalifikace.cz) · [NSP](https://nsp.cz) · [EQF](https://europa.eu/europass/en/europass-tools/european-qualifications-framework) |
| **O\*NET** (US DOL) | occupation / skill / seniority library | **free** | [onetonline.org](https://www.onetonline.org) |
| **EU AI Act** (Annex III) · **EEOC** Uniform Guidelines | fairness overlay: job-related, non-discriminatory | **free** | AI Act Annex III · EEOC 1978 |
| ISO 10667 (assessment) · ISO 30405 (recruitment) · SHRM/CIPD | assessment methodology as a standard | **paid** (can't just "feed" it) | ISO.org |

## Status

- ✅ **CEFR — languages** (WIRED): [`worker/src/reference/cefr.ts`](../worker/src/reference/cefr.ts) —
  deterministic `normalizeLanguageLevel()`; regression [`cefr.test.mjs`](../worker/src/reference/cefr.test.mjs)
  **23/23**. **Wired into scoring** (`rubric.ts` → `cefr_map`): extraction emits `languages[].level_raw`
  (the verbatim phrase), the code maps it to CEFR → `stated`/`inferred` + evidence in breakdown and print.
- ✅ **ISO 639-1 — language names** (WIRED): [`worker/src/reference/languages.ts`](../worker/src/reference/languages.ts) —
  `normalizeLanguageName()` / `sameLanguage()` map free-form spellings ("angličtina", "AJ", "English", "en")
  to an ISO code; regression [`languages.test.mjs`](../worker/src/reference/languages.test.mjs) **45/45**.
  **Wired into scoring** (`rubric.ts` → `cefr_map`): languages are matched by CODE, never by substring —
  this killed the false match "slovenština" ⊃ "en" (a native Slovak speaker used to score for English).
  The criterion scores the languages **the job ad requires** (English used to be hard-coded).
- ⚪ **ESCO — skills / seniority** (roadmap): taxonomy + fuzzy match of `skills.name`.
- ⚪ **EQF / NSK — education** (roadmap): map `education.level` and Czech fields.

## CEFR — detail (what the code does today)

Six levels in three groups (Council of Europe, global scale):

| Level | Group | "Can-do" (short) |
|---|---|---|
| **A1** | A · Basic user | Understands and uses basic everyday phrases. |
| **A2** | A · Basic user | Understands sentences/expressions of immediate relevance. |
| **B1** | B · Independent user | Understands the main points on familiar matters (work, school, leisure). |
| **B2** | B · Independent user | Understands complex text incl. technical discussion in their field. |
| **C1** | C · Proficient user | Understands demanding longer texts, implicit meaning; fluent, flexible. |
| **C2** | C · Proficient user | Understands virtually everything with ease; very fluent and precise. |

**Mapping free phrasings → CEFR** (approximate, conservative ILR/LinkedIn ↔ CEFR crosswalk; no
official 1:1 map exists). `stated` = the level is explicit in the CV; otherwise `inferred`
(recruiter verifies; the value also carries the source snippet):

| Phrasing in CV (CS / EN) | → CEFR | kind |
|---|---|---|
| `A1`–`C2`, "level C1", range "B2/C1" | that level (range → **lower**) | stated |
| native speaker · mother tongue · bilingual · rodilý/mateřský | **native** | stated |
| full professional · plná profesní | **C2** | inferred |
| professional working · umožňující profesionální práci · profesní | **C1** | inferred |
| fluent · plynně · near-native | **C1** | inferred |
| limited working · upper-intermediate · vyšší středně pokročilá | **B2** | inferred |
| advanced · pokročilá | **B2** | inferred |
| intermediate · mírně/středně pokročilá · conversational | **B1** | inferred |
| basic · elementary · pre-intermediate · základy | **A2** | inferred |
| beginner · začátečník | **A1** | inferred |
| anything indeterminate | **null** (rubric neutral, human fills in) | — |

Boundaries are conservative (ranges take the lower level, to avoid **over-crediting**) and live in
one place in `cefr.ts` (`RULES`) — easy to tune. Every output carries `matched` (evidence) and
`source` (which rule/standard decided) → **documentable in the printed selection-procedure record.**

## Wired (done, commit 8028398)

The extraction schema carries the **raw phrasing** of the level (`level_raw`); `rubric.ts` runs it
through `normalizeLanguageLevel()` in `cefr_map` **in code, not in the model**, and shows
*level + CV snippet + "inferred"* in the breakdown and print (the certainty axis of the at-a-glance
view). The LLM is thus a mere extractor and the **map follows a cited standard, not the model's
opinion.** Next up: ESCO (skills).

## Licence / provenance

CEFR descriptors © Council of Europe / EU (2001–2020), cited as reference. ESCO, EQF, NSK/NSP,
O\*NET, EEOC — public. ISO / SHRM / CIPD are **paid** and are **not copied** into the repo — we
link to them, we don't reproduce the text.
