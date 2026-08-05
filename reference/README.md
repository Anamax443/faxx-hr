# Referenční vrstva — externí standardy pro posuzování

> 🇨🇿 Čeština · [🇬🇧 English](README.en.md)

Sada **veřejných, citovatelných standardů**, o které se opírá normalizace údajů z CV.
Myšlenka: **AI (junior HR) předchroustá podle dokumentovaného standardu, senior HR rozhodne.**

## Princip použití — čti, než něco přidáš

Standardy se používají jako **deterministická reference**, ze které čte **kód** — ne jako
kontext, do kterého bychom „nasypali" PDF a nechali LLM volně posoudit.

- ✅ **Správně:** standard = taxonomie / číselník / škála, kód podle ní **mapuje a doloží**
  (skill → ESCO id, „profesní AJ" → CEFR C1 podle deskriptoru). Model zůstává jen *překladač
  do schématu*, u každé hodnoty visí **evidence** (úsek z CV) a příznak **uvedeno / odvozeno**,
  který personalista může přepsat.
- ❌ **Špatně:** nahrát metodiku do promptu a nechat model „posoudit uchazeče". Vrací to
  subjektivitu modelu do skóre → poruší invariant *„kód skóruje, ne model"*, je to
  neauditovatelné a v režimu **EU AI Act (high-risk nábor)** rizikové.

To drží princip celého faxx-hr: **AI pomáhá tam, kde pravidlo nestačí, ale nikdy potichu —
vždy s doložením a možností přepisu.** Posudek musí být *job-related* a nediskriminační
(EU AI Act čl. 14, GDPR čl. 22; US EEOC Uniform Guidelines).

## Zdroje

| Standard | K čemu | Dostupnost | Odkaz |
|---|---|---|---|
| **CEFR** (jazyky A1–C2) | `languages.level` — mapovat volný text na škálu podle „can-do" deskriptorů | **zdarma** (© CoE/EU) | [coe.int – level descriptions](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions) · [Europass grid](https://europass.europa.eu/en/common-european-framework-reference-language-skills) |
| **ESCO** (dovednosti/kompetence/povolání) | `skills`, `seniority` — normalizace na EU taxonomii (i česky) | **zdarma**, v1.2.1 (12/2025), CSV/RDF/JSON-LD, 28 jazyků | [esco.ec.europa.eu/download](https://esco.ec.europa.eu/en/use-esco/download) |
| **EQF** + **NSK / NSP** (ČR, MPSV) | `education.level`, kvalifikace/obory (Ing→master, české obory) | **zdarma** | [NSK](https://www.narodnikvalifikace.cz) · [NSP](https://nsp.cz) · [EQF](https://europa.eu/europass/en/europass-tools/european-qualifications-framework) |
| **O\*NET** (US DOL) | knihovna povolání / dovedností / seniority | **zdarma** | [onetonline.org](https://www.onetonline.org) |
| **EU AI Act** (Annex III) · **EEOC** Uniform Guidelines | fér-overlay: posudek job-related, nediskriminační | **zdarma** | AI Act Annex III · EEOC 1978 |
| ISO 10667 (assessment) · ISO 30405 (nábor) · SHRM/CIPD | metodika posuzování jako norma | **placené** (nelze jen „nakrmit") | ISO.org |

## Stav

- ✅ **CEFR — jazyky** (NAPOJENO): [`worker/src/reference/cefr.ts`](../worker/src/reference/cefr.ts) —
  deterministický `normalizeLanguageLevel()`; regrese [`cefr.test.mjs`](../worker/src/reference/cefr.test.mjs)
  **23/23**. **Napojeno do skórování** (`rubric.ts` → `cefr_map`): extrakce dává `languages[].level_raw`
  (doslovná fráze), mapu na CEFR dělá kód → `stated`/`inferred` + evidence v rozpadu i tisku.
- ✅ **ISO 639-1 — jména jazyků** (NAPOJENO): [`worker/src/reference/languages.ts`](../worker/src/reference/languages.ts) —
  `normalizeLanguageName()` / `sameLanguage()` mapují volný zápis („angličtina", „AJ", „anglický jazyk",
  „English", „en") na ISO kód; regrese [`languages.test.mjs`](../worker/src/reference/languages.test.mjs) **45/45**.
  **Napojeno do skórování** (`rubric.ts` → `cefr_map`): jazyk se páruje podle KÓDU, ne podřetězcem —
  tím padla falešná shoda „slovenština" ⊃ „en" (rodilý Slovák dřív dostal body za angličtinu).
  Hodnotí se jazyky, které **požaduje inzerát** (dřív napevno angličtina).
- ⚪ **ESCO — dovednosti / seniorita** (roadmap): taxonomie + fuzzy match `skills.name`.
- ⚪ **EQF / NSK — vzdělání** (roadmap): mapa `education.level` a českých oborů.

## CEFR — detail (co dnes kód umí)

Šest úrovní ve třech skupinách (Council of Europe, global scale):

| Úroveň | Skupina | „Can-do" (zkráceně) |
|---|---|---|
| **A1** | A · Basic user | Rozumí základním frázím a výrazům každodenní potřeby. |
| **A2** | A · Basic user | Rozumí větám a výrazům z oblastí bezprostředního významu. |
| **B1** | B · Independent user | Rozumí hlavním myšlenkám o běžných tématech (práce, škola, volný čas). |
| **B2** | B · Independent user | Rozumí složitějším textům včetně odborných diskusí ve svém oboru. |
| **C1** | C · Proficient user | Rozumí náročným delším textům, rozpozná skryté významy; plynulý a pružný jazyk. |
| **C2** | C · Proficient user | Snadno rozumí prakticky všemu; velmi plynulý a přesný projev. |

**Mapování volných formulací → CEFR** (přibližný, konzervativní crosswalk ILR/LinkedIn ↔ CEFR;
oficiální 1:1 mapa neexistuje). `uvedeno` = úroveň je v CV explicitní; jinak `odvozeno`
(personalista ověří, u hodnoty visí i úsek z CV, ze kterého to vzniklo):

| Formulace v CV (CS / EN) | → CEFR | druh |
|---|---|---|
| `A1`–`C2`, „úroveň C1", rozsah „B2/C1" | daná úroveň (u rozsahu **nižší**) | uvedeno |
| rodilý mluvčí · mateřský jazyk · native · bilingual | **native** | uvedeno |
| full professional · plná profesní | **C2** | odvozeno |
| professional working · umožňující profesionální práci · profesní | **C1** | odvozeno |
| plynně · fluent · téměř rodilý / near-native | **C1** | odvozeno |
| limited working · upper-intermediate · vyšší středně pokročilá | **B2** | odvozeno |
| pokročilá · advanced | **B2** | odvozeno |
| mírně/středně pokročilá · intermediate · konverzační · komunikativní | **B1** | odvozeno |
| základy · basic · elementary · pre-intermediate | **A2** | odvozeno |
| začátečník · beginner | **A1** | odvozeno |
| cokoli neurčitého | **null** (rubrik neutrálně, doplní člověk) | — |

Hranice jsou konzervativní (u rozsahu bereme nižší, ať se **nepřecení**) a jsou v jednom místě
v `cefr.ts` (`RULES`) — snadno se ladí. Každý výstup nese `matched` (evidence) a `source`
(které pravidlo/standard rozhodlo) → **doložitelné do tiskového dokladu výběrového řízení.**

## Napojeno (hotovo, commit 8028398)

Extrakční schéma nese **surovou formulaci** úrovně (`level_raw`); `rubric.ts` ji v `cefr_map`
prožene `normalizeLanguageLevel()` **v kódu, ne v modelu**, a v rozpadu i tisku ukáže
*úroveň + úsek z CV + „odvozeno"* (osa jistoty pohledového hodnocení). LLM je tak jen extraktor
a **mapa je podle citovaného standardu, ne podle názoru modelu**. Další v řadě: ESCO (dovednosti).

## Licence / provenience

CEFR deskriptory © Council of Europe / EU (2001–2020), citováno jako reference. ESCO, EQF,
NSK/NSP, O\*NET, EEOC — veřejné. ISO / SHRM / CIPD jsou **placené** a do repa se **nekopírují**
— odkazujeme na ně, nepřebíráme text.
