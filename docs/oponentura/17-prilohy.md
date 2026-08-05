# 17 · Přílohy

> Přílohy shromažďují **doslovné technické artefakty**, na které se předchozí
> kapitoly odkazují, aby je oponent nemusel dohledávat v repozitáři. Nejde o
> marketingové shrnutí — jde o **přesný přehled schémat, datového modelu a
> pojmosloví**, aby bylo možné tvrzení dokumentu ověřit proti kódu. Nikde nejsou
> žádné reálné hodnoty (klíče, hesla, tokeny, osobní data) — repozitář je veřejný a
> přílohy popisují **strukturu**, ne obsah.

---

## Příloha A · Extrakční schéma (přehled)

Zdroj: [`schema/extraction.schema.json`](../../schema/extraction.schema.json) (JSON
Schema draft 2020-12). Toto je výstup **LLM #1 (extrakce)** — jediné, co model
produkuje. **Žádné pole neumožňuje skóre ani verdikt.** Scoring engine čte **výhradně**
blok `qualification`; bloky `identity` a `meta` do skórování nevstupují.

Schéma je rozděleno do tří bloků a na kořeni má `additionalProperties: false`
(neznámé klíče se zahazují — zmenšení útočného povrchu):

```
extraction (schema_version = "1.0.0")
├── identity        ── jen pro zobrazení personalistovi; scoring path sem NIKDY nesahá
├── qualification   ── JEDINÝ vstup do deterministického rubriku
└── meta            ── příznaky pro pipeline (ne hodnoty)
```

### Blok `identity` (mimo skórování)

| Pole | Typ | Poznámka |
|---|---|---|
| `full_name` | string \| null | jméno (z modelu) |
| `emails` | string[] | v živé appce plněno **jen regexem z textu** (model halucinoval) |
| `phones` | string[] | dtto — regex, ne model |
| `links` | string[] | odkazy (portfolio, LinkedIn…) |
| `location` | string \| null | lokalita |

> Identita slouží **jen k zobrazení**. Její oddělení od `qualification` je
> architektonická pojistka antidiskriminace: skórovací cesta se jména, kontaktů ani
> lokality **nikdy nedotkne**.

### Blok `qualification` (jediný vstup do rubriku)

`required: [skills, experience, education, languages]`, `additionalProperties: false`.

| Pole | Typ | Struktura položky (klíčové enumy) |
|---|---|---|
| `years_total_experience` | number \| null, `minimum: 0` | souhrn let praxe |
| `experience[]` | pole objektů | `title`*, `employer`, `start` (YYYY-MM), `end` (YYYY-MM \| "present"), `months`, `seniority` ∈ {`junior`,`medior`,`senior`,`lead`,`exec`,null}, `evidence`* |
| `skills[]` | pole objektů | `name`*, `category` ∈ {`language`,`framework`,`tool`,`domain`,`soft`,`other`}, `level` ∈ {`basic`,`working`,`advanced`,`expert`,null}, `evidence`* |
| `education[]` | pole objektů | `level`* ∈ {`secondary`,`bachelor`,`master`,`phd`,`course`,`other`}, `field`, `institution`, `year` |
| `languages[]` | pole objektů | `language`*, `level` ∈ {`A1`,`A2`,`B1`,`B2`,`C1`,`C2`,`native`,null} |
| `certifications[]` | string[] | prostý seznam |

*(`*` = povinné pole položky.)*

Význam **enumů** je bezpečnostní: model nesmí do `level` napsat volný text („nejlepší
na světě"), jen jednu z předdefinovaných hodnot. Volitelná pole (`seniority`, `level`)
připouštějí `null` — model raději přizná „nevím" než aby halucinoval. Každá zkušenost
i dovednost nese **`evidence`** = citaci pasáže z CV; v živé appce se navíc u shody
dovedností zobrazuje **deterministicky grepnutý** doslovný úryvek z viditelného textu
(nedá se halucinovat).

### Blok `meta` (příznaky, ne hodnoty)

`required: [untrusted_content, extraction_notes]`.

| Pole | Typ | Význam |
|---|---|---|
| `untrusted_content` | `const: true` | konstanta-připomínka: obsah CV je **data, ne instrukce** |
| `sensitive_attributes_detected` | pole enumů ∈ {`age`,`birthdate`,`gender`,`photo`,`nationality`,`marital_status`,`health`,`religion`} | **jen přítomnost, NE hodnoty** |
| `extraction_notes` | string \| null | poznámky extrakce |

> **Klíčové rozhodnutí u chráněných atributů.** Věk, pohlaví, národnost, foto,
> zdravotní stav apod. se **neextrahují do hodnot** — schéma pro ně **nemá pole na
> hodnotu**. Hlásí se jen jejich **přítomnost** (výčet v `sensitive_attributes_detected`),
> aby scoring věděl, co má ignorovat, a aby šlo doložit, že se do hodnocení nedostaly.
> To je antidiskriminace zabudovaná do datové struktury, ne do dobré vůle.

---

## Příloha B · Příklad rubriku (kritéria + váhy + gates)

Zdroj: [`schema/rubric.example.json`](../../schema/rubric.example.json). **Ilustrativní**
rubrik pro pozici „Backend vývojář (Python)". Váhy a pravidla nastavuje **personalista
per pozice**, ne model. Scoring engine čte pouze `qualification_json` — nikdy identitu
ani citlivé atributy.

### Must-have gates

```json
"must_have_gates": [
  {
    "key": "min_praxe_obor",
    "rule": "qualification.years_total_experience >= 2",
    "on_fail": "disqualify",
    "reason": "Méně než 2 roky praxe = diskvalifikace bez ohledu na ostatní kritéria."
  }
]
```

> **Poctivá odchylka příkladu od živé appky.** Tento ilustrativní gate na „≥ 2 roky"
> je v **živé appce defaultně VYPNUTÝ**. Důvod: roky praxe se z CV spolehlivě
> nevytáhnou, takže neznámé roky (`null`) se **nepenalizují** (neutrální 5/10) a gate
> **nediskvalifikuje**, dokud reálně nevíme, že je kandidát pod limitem. Příklad
> ukazuje *mechanismus* gate, ne doporučené výchozí nastavení.

### Kritéria (vážená, součet vah po normalizaci = 1,0)

| Klíč | Label | Typ | Váha | Zdroj / pravidlo (zkráceně) |
|---|---|---|---|---|
| `roky_praxe` | Roky praxe v oboru | `numeric_scale` | 0,25 | `years_total_experience`, škála 0–8, clamp |
| `shoda_dovednosti` | Shoda klíčových dovedností | `set_overlap` | 0,30 | průnik `skills[].name` s `required` (python, sql, git, docker, rest api) → poměr |
| `vzdelani` | Úroveň vzdělání | `category_map` | 0,15 | `education[].level` → mapa (master/phd=10, bachelor=7…), agregace `max` |
| `jazyk_en` | Angličtina (CEFR) | `cefr_map` | 0,10 | `languages[EN].level` → mapa (C1=9, B2=7, B1=4…) |
| `stabilita` | Stabilita zaměstnání | `derived_metric` | 0,10 | `experience[].months` → `avg_tenure_months`, penalizace pod 6 měs. |
| `certifikace` | Relevantní certifikace | `bonus` | 0,10 | `certifications[]` → 2 body/kus, strop 10 |

**Šest typů kritérií** (v kódu `rubric.ts` napevno — ověřené a bezpečné; editor je
vyřazuje a konfiguruje, ale nepřidává nové typy):

1. `numeric_scale` — číselná hodnota na škálu s clampem
2. `set_overlap` — poměr průniku množiny dovedností s požadovanými
3. `category_map` — kategorie → body přes mapu (agregace max/…)
4. `cefr_map` — jazyková úroveň CEFR → body
5. `tenure` / `derived_metric` — odvozená metrika (např. průměrná délka setrvání)
6. `bonus` — bodový bonus se stropem (cap)

Výsledek: `total_score` 0–100 = vážený součet **po** aplikaci gates; `breakdown_json`
nese rozpad po kritériích s **evidence-ref**. Celý výpočet je **deterministický** —
tentýž vstup dá tentýž výstup, plně auditovatelný (viz §16.3: reprodukovatelné ≠
správné → rubrik nutno validovat proti historii).

---

## Příloha C · Datový model D1 (přehled tabulek)

Zdroj: [`migrations/0001_init.sql`](../../migrations/0001_init.sql) (D1 / SQLite).
**Důležité upřesnění stavu:** tato migrace **existuje, ale není zapojená** — živá
appka je **bezstavová** (JSON export/import + autosave relace do prohlížeče). Datový
model je tedy **návrh cílové perzistence**, ne běžící databáze. Popisujeme **strukturu
a záměr**, ne reálná data.

Klíčová rozhodnutí zabudovaná ve schématu:

- `scores` se počítá **jen** z `extractions.qualification_json`, **nikdy** nevidí
  `extractions.identity_json`;
- chráněné atributy **nemají vlastní sloupce** — jen se flaguje jejich přítomnost;
- `audit_log` a `decisions` tvoří **důkazní vrstvu** pro AI Act (čl. 12, 14) a GDPR
  (čl. 22).

| Tabulka | Účel | Klíčové sloupce / poznámka |
|---|---|---|
| `job_requirements` | zadání pozice + rubrik | `rubric_json`, `rubric_version`, `retention_days` (GDPR retence per zadání), `status` (open/closed) |
| `candidates` | osoba = **identita** | `status` (received→…→decided/error); *scoring path sem NIKDY nesahá* |
| `documents` | ingestované soubory | `r2_key` (originál immutable v R2), `sha256` (integrita + dedup), `page_count` |
| `extractions` | strukturovaná extrakce | **dvě oddělené JSON kolony:** `qualification_json` (POUZE tohle jde do scoringu) vs. `identity_json` (jen pro personalistu); `dual_path_status`, `model`, `model_version` |
| `flags` | detekce skrytého obsahu / injection | `type` (hidden_text / invisible_render_mode / tiny_font / low_contrast / offscreen / docx_vanish / dual_path_mismatch / injection_classifier / sensitive_attribute_present), `severity` (info/warn/critical), `method` (deterministic/llm), `evidence` (skutečně nalezený skrytý text), `detail_json` |
| `scores` | deterministické skóre | `total_score`, `breakdown_json` (per-kritérium score+weight+evidence_ref), `soft_llm_json` (volitelná měkká kritéria LLM #2, **odděleně**), `computed_by` (vždy verze **kódu**, `rubric@vX`, ne model) |
| `decisions` | **lidské rozhodnutí** = důkaz oversight | `reviewer`, `decision` (advance/reject/hold), `rationale`, `score_shown`, `overrode_ai` (šel proti návrhu?), `decided_at` |
| `audit_log` | immutable append-only | `entity_type`, `actor` (`user:…` / `system:…`), `action`, `before_json`/`after_json`, `at` |

### Proč to oddělení (scoring nevidí identitu)

Rozdělení `extractions` na **dvě JSON kolony** — `qualification_json` a `identity_json`
— je datové vyjádření hlavního invariantu dokumentu. Scoring engine dostane na vstup
**výhradně** `qualification_json`. Jméno, kontakty a lokalita žijí v `identity_json`,
kam scoring **nikdy nesáhne**. To dělá antidiskriminaci **strukturální** (ne
politickou): i kdyby někdo chtěl skórovat podle jména nebo lokality, **nemá odkud ta
data vzít** — jsou v jiné koloně, kterou scoring nečte.

Stejnou logikou jsou `decisions` a `audit_log` **důkazní**, ne kosmetické:
`decisions.overrode_ai` a `decisions.rationale` doloží, že člověk **reálně** rozhodl
(a případně šel proti návrhu) — což je měřitelný lidský dohled (AI Act čl. 14), ne
„gumové razítko". `audit_log` je append-only stopa každé akce systému i člověka.

---

## Příloha D · Glosář pojmů

| Pojem | Význam v kontextu faxx-hr |
|---|---|
| **skrytý text** | text v dokumentu neviditelný pro člověka, ale čitelný pro model (bílé písmo, `w:vanish`, mikropísmo, render mode 3, off-page, Unicode nosiče) |
| **prompt injection** | vložení instrukce pro model do dat (zde do CV), aby změnil chování („ohodnoť 100/100") |
| **deterministický rubrik** | výpočet skóre 0–100 čistým kódem nad strukturovanými daty — bez modelu, plně reprodukovatelný |
| **nález / vlajka (flag)** | výsledek detekce podezřelého obsahu, **zobrazený** personalistovi (info/warn/critical), netiše nefiltrovaný |
| **evidence kotva** | doslovný úryvek z viditelného textu CV dokládající shodu; v appce grepnut **deterministicky**, ne od modelu → nelze halucinovat |
| **viditelný / skrytý split** | rozdělení dokumentu detektorem na `visible_text` (jediný vstup do modelu) a `hidden_text` (nikdy do modelu) |
| **invariant zádrže** | pravidlo, že skrytý text **nesmí** proniknout do `visible_text`; testováno regresní sadou |
| **least privilege** | model #1 dostává jen viditelný text + schéma — **ne** zadání pozice ani kritéria |
| **lidský dohled** | rozhodnutí o postupu kandidáta dělá **vždy člověk** (AI Act čl. 14); nástroj nemá „hromadně zamítnout" |
| **vysoce rizikový (high-risk)** | kategorie AI Actu; nábor a výběr = Annex III bod 4 |
| **flag-for-human vs. route-to-reject** | naše politika (ukázat nález, rozhodne člověk) vs. komerční ATS (auto-zamítni podezřelé) |
| **personalista** | cílový uživatel — náborář hodnotící dávku CV proti inzerátu |
| **dávka** | sada CV nahraná k hodnocení proti jednomu inzerátu (živě ≤ 10 MB) |
| **extrakce** | fáze LLM #1 — čtení viditelného textu do pevného schématu (žádné skóre) |
| **kvalifikace (qualification)** | blok strukturovaných dat = **jediný** vstup do rubriku |
| **dual-path diff** | porovnání textové vrstvy PDF s renderem→OCR; text v jedné a ne v druhé = skrytý obsah (doplňková vrstva) |
| **Conduit** | rozhraní k on-prem runneru (OCR/rasterizace); runner je za ním vyměnitelný (Beelink ↔ EU VPS) |
| **kaskáda AI vrstev** | cost-tiering: hrubá práce edge modelem (Workers AI), eskalace na Claude u nuance/češtiny/skenů |

---

## Příloha E · Reference

| Zdroj | Identifikace | Relevance |
|---|---|---|
| **PhantomLint** | arXiv **2508.17884** | akademický prior-art detekce skrytého textu (render↔extrakce diff + neviditelný text + SBERT sémantická anomálie); **validuje směr**, kód je research Python (ne drop-in) |
| **EU AI Act** | Nařízení (EU) 2024/1689 | nábor a výběr = **Annex III bod 4 = vysoce rizikový**; čl. 9–15 (řízení rizik, data governance, transparentnost, přesnost/robustnost, záznamy), **čl. 14 lidský dohled**, čl. 12 záznamy, čl. 13 transparentnost, Annex IV (technická dokumentace) |
| **GDPR** | Nařízení (EU) 2016/679 | **čl. 22** (žádné plně automatizované rozhodnutí s právním / obdobně významným účinkem), **čl. 35** (DPIA — posouzení vlivu na ochranu údajů) |

> **Poznámka k citaci arXiv.** Identifikátor 2508.17884 je uveden podle interní
> rešerše projektu (viz paměť `faxx-hr-prior-art`). Před formální publikací dokumentu
> doporučeno ověřit doslovné znění a autory přímo na arxiv.org.

---

## Příloha F · Struktura repozitáře

Veřejný repozitář `Anamax443/faxx-hr`. Přehled (bez reálných CV a klíčů — ty do gitu
nepatří):

```
detector/       spustitelný detektor skrytého textu (Python, stdlib) + demo
                ├ hidden_text.py       detektor v2 (DOCX/PDF, visible/hidden split)
                ├ test_vectors.py      regresní sada (DOCX 14 + PDF 10 on-prem = 24/24)
                ├ adversarial_pdf.py   generátor hraničních PDF vektorů (F0)
                ├ boundary_matrix.py   runner: edge (Worker) vs. on-prem → matice
                └ requirements.txt     defusedxml + PyMuPDF (volitelné)
schema/         extraction.schema.json (identity/qualification/meta) + rubric.example.json
migrations/     0001_init.sql — D1 datový model (zatím NEZAPOJENÝ; appka bezstavová)
worker/src/     app.ts       hodnoticí appka (záložky, CS/EN, motiv) — živě
                ├ detect.ts  sdílený detektor (viditelný/skrytý split + flagy)
                ├ extract.ts LLM #1 extrakce do pevného schématu (Workers AI)
                ├ rubric.ts  deterministický skórovací rubrik (0–100, rozpad)
                └ upload.ts  F0 detektor demo (živě)
ui/             demo review UI personalisty (statické)
docs/           ARCHITECTURE / BUILD / AI-ACT / THREAT-MODEL / DETECTOR-V2 /
                OPONENTURA-RESPONSE / PDF-BOUNDARY-MATRIX + oponentura/ (tento dokument)
status.html     front page se stavem projektu
DESIGN.md       plný technický návrh; HANDOFF.md deník stavu
```

Živé nasazení: hodnoticí appka `faxx-hr.maxferit.cz`, demo detektoru
`faxx-hr-upload.bass443.workers.dev`. Deploy **ručně** (`npm run deploy:app` /
`deploy:upload`), bez CI. Extraction jádro je sdílené s repem `faxx-dox`.

---

## Příloha G · Stručný changelog fází

Zestručněno z [`HANDOFF.md`](../../HANDOFF.md) (append-only deník; zde jen milníky).
Registr je poctivý — stav „prototyp" a „nezapojené" se neskrývá.

| Datum | Milník | Stav |
|---|---|---|
| 2026-08-01 | **F0 scaffold** — repo, spustitelný detektor (stdlib), datový model, schémata; oponentura záměru (~60 s.) | detektor demo funguje (4 nosiče injection) |
| 2026-08-01 (b) | **Živě na Cloudflare** (`upload.ts`); 2× externí oponentura zapracována; kaskáda AI vrstev | DOCX 1:1 do TS, PDF přes fflate |
| 2026-08-01 (c) | **Detektor v2** — WCAG kontrast, Unicode nosiče, viditelný/skrytý split; regrese **12/12** | rozdělovač textu; invariant zádrže |
| 2026-08-02 | **PDF přes Workers AI `toMarkdown`** + oprava FP metadat; otisk verze; pdf.js/unpdf ve workerd zavrženo | čte embedded/CID fonty |
| 2026-08-02 (b) | **Hraniční PDF vektory** — coverage matice edge vs. on-prem; závěr: žádný vektor neprojde k modelu nezachycen | 2 hardening úkoly on-prem |
| 2026-08-04 | **On-prem PDF hardening** — render mode 3 / XFA / offpage / ToUnicode; regrese **24/24** (DOCX 14 + PDF 10) | invariant zádrže testován |
| 2026-08-04 (b) | **VERIFY-CORE spike** — extrakce (free 8B) → rubrik → ranking **funguje**; injection empiricky ignorována | jádro stojí; 8b-fp8 = default |
| 2026-08-04 (c) | **Appka skeleton** — záložky, dávka CV, inzerát→požadavky, ranking (F1/F2/F3 v1) | sdílený `detect.ts` |
| 2026-08-04 (d) | **Velká UX vlna** — kandidát=osoba, streamovaný průběh, váhy, manažerský tiskový výstup | živě |
| 2026-08-04 (e) | přepočet **bez AI**, filtr ne-uchazečů, gate off default, kvóta free AI hlášena | rescore bez tokenů |
| 2026-08-04 (f) | **Dvojjazyčnost CS/EN + světlý/tmavý motiv**; veškerá dokumentace aktualizována | i18n slovník + SSR default |
| 2026-08-04 (g–l) | chudá perzistence (JSON export/import), **evidence kotvy**, editor rubriku + šablony, autosave relace, **per-doc cache extrakce** | vše NENASAZENO čeká svolení / dílem živě |

**Zbývá (poctivě):** held-out sada (sestaví někdo jiný než autor detektoru) + externí
red-team → **F0 exit: recall ≥ 98 % na otrávených, FP ≤ 5–10 % na čistých, přesnost
extrakce ≥ 90 %**; plná D1/R2 perzistence dávek se stavem kandidáta; Claude backend
(API klíč); DPIA + Annex IV-lite **před** reálnými CV. Tyto položky nejsou hotové a
dokument je nikde nevydává za hotové.

---

> **Závěr příloh.** Vše výše je ověřitelné proti veřejnému repozitáři — přílohy
> nejsou tvrzení, jsou **odkazy na kód a schémata**. Kde příloha popisuje něco
> nezapojeného (D1 model) nebo ilustrativního (příkladový rubrik s gate, který je v
> appce vypnutý), je to **výslovně označeno**. To je smyslem oponentní dokumentace:
> dát kritikovi přesnou mapu, kde je jádro ověřené a kde je hranice tvrzení.
