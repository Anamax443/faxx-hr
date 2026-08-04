# TODO — faxx-hr

> Živý backlog. Stav k 2026-08-01. Doplňuje `DESIGN.md` (co a proč) o to,
> **co je potřeba udělat a v jakém pořadí**. Deník průběhu je `HANDOFF.md`.

## Připomenutí zadání — detekce je JEDNA funkce, ne produkt

Produkt je **síto pro personalistu**, ne automat na vyřazování.

```
vícero dokumentů  ──►  1. rozdělení textu    viditelný / skrytý
   (dávka)            2. skrytý text  ───────────────────► flag do review
                      3. viditelný text ──► AI vrstvy ──► strukturovaná data
                      4. porovnání s POŽADAVKY INZERÁTU ──► rating
                      5. personalista ručně postupuje kandidáty dál
```

Body, které se nesmí ztratit z dohledu:
- **relevance se posuzuje výhradně z viditelných znaků** — skrytý text se do
  modelu nedostane vůbec, ani jako „kontext"
- **rating ≠ rozhodnutí**; postup do dalšího kola dělá vždy člověk
- **žádné automatické zamítnutí** (AI Act čl. 14, GDPR čl. 22)
- vstupem požadavků je **konkrétní inzerát**, ne obecná šablona

---

## F0 — Benchmark detekce (GATE) 🟡

Cílem NENÍ hotový produkt, ale doložitelné číslo. Bez něj nemá smysl stavět F1.

- [x] Detektor v2: kontrast, Unicode nosiče, hlavičky/patičky, PDF render mode
- [x] Rozdělení na `visible_text` / `hidden_text` (invariant proti úniku)
- [x] Ladicí regresní sada `detector/test_vectors.py` (9 útoků + 5 FP kontrol), 14/14
- [x] Živě na Cloudflare: DOCX plná v2 + PDF přes Workers AI `toMarkdown` (embedded fonty)
- [x] Oprava FP: metadata/alt-texty jen při injekci; lidské popisy nálezů v UI; otisk verze
- [ ] **HELD-OUT sada** — sestavuje někdo jiný než autor detektorů
  - [ ] ≥ 50 reálných čistých CV (anonymizovaných), z toho ≥ 15 grafických
        s tmavými sidebary a textboxy — hlavní zdroj false positives
  - [ ] ≥ 30 otrávených, min. 10 vektorů, včetně **parafrázovaných** injection
        bez shody s blocklistem
- [ ] **Externí red-team** — někdo dostane detektor a má za úkol ho obejít
- [x] Hraniční PDF vektory změřeny (edge vs. on-prem) → [`docs/PDF-BOUNDARY-MATRIX.md`](docs/PDF-BOUNDARY-MATRIX.md)
      — CID/Identity-H, ToUnicode/cmap obfuskace, XFA, JS/OpenAction, render mode 3, off-page,
      Form XObject. Reprodukce: `python detector/boundary_matrix.py`. **EPS/PS nepostaven**
      (v praxi subsumován Form XObjectem — nízká priorita).
  - Nálezy → hardening níže (F1): on-prem protéká render-mode-3 a ToUnicode-mismatch; XFA nikdo nehlásí; edge FP na viditelné sebeprezentaci.
- [ ] **Změřit podíl dokumentů s vision fallbackem** (sken/foto) — při 10 % vyskočí náklady řádově
- [ ] Kalibrovat prahy (`CONTRAST_HIDDEN`, `CONTRAST_LOW`, `MIN_FONT_PT`) na held-out
- [x] `defusedxml` (+ PyMuPDF) do [`detector/requirements.txt`](detector/requirements.txt)

**Exit:** recall ≥ 98 % na held-out otrávených · FP ≤ 5–10 % na čistých ·
přesnost extrakce ≥ 90 %. **Dvě čísla zvlášť** — atributová detekce a
dual-path diff se měří odděleně (diff ještě neexistuje, viz F1).

---

## F1 — Pipeline skeleton ⚪

- [ ] **Dávkový vstup** — N dokumentů najednou, jeden vadný nesmí shodit dávku (`scan_many` už drží)
- [ ] Email Worker (postal-mime) → R2 (originál immutable) → D1 (stav)
- [ ] Web upload jako rovnocenný kanál (provozovatel chce obojí)
- [ ] Deduplikace — týž uchazeč pošle CV dvakrát / přes dva kanály
- [ ] **Dual-path diff** — textová vrstva vs. render→OCR, on-prem runner (Conduit → Beelink)
- [ ] Rozhodnout doménu pro e-mail ingest — *blokuje spuštění*
- [~] LLM #1 extrakce → `schema/extraction.schema.json`, vstup **jen `visible_text`**, bez zadání (least privilege) — **prototyp hotový** `worker/src/extract.ts` (Workers AI, přepínatelný model, soft validace), ověřeno spikem 2026-08-04 (b); zbývá napojit na pipeline + Claude backend
- [ ] Soft validace (field-level): neznámé klíče zahodit, sporné pole → flag, ne ERROR celého CV
- [ ] Kaskáda: Workers AI (klasifikace, Llama Guard) → Haiku 4.5 → Sonnet 5 + vision; logovat `model`, tokeny, `cost_czk`
- [ ] Denní práh nákladů + alert
- [ ] **Doportovat detekci do Workeru** (kontrast/Unicode) NEBO edge jen triáž + full on-prem
- [~] **Hardening on-prem z boundary matice** (viz [`docs/PDF-BOUNDARY-MATRIX.md`](docs/PDF-BOUNDARY-MATRIX.md)) — 2026-08-04, PDF regrese 10/10:
  - [x] render mode 3 (+ nulová alfa `ca 0`) zadržet do `hidden_text` — přes `get_texttrace` (`type`/`opacity`), ne jen coarse `3 Tr`
  - [x] offpage: text mimo mediabox, který `get_text` zahazuje, hlásit `pdf_offpage` (z `get_texttrace`) do `hidden_text`
  - [~] ToUnicode/cmap ↔ glyph mismatch — injection nad `visible_text` = `visible_instruction_tone` (warn); **payload ve `visible_text` zatím zůstává**, plná zádrž chce porovnat glyf↔ToUnicode (odloženo)
  - [x] číst XFA/AcroForm XML (`catalog→AcroForm→XFA`, stream i pole) → `pdf_xfa` warn/critical + obsah do `hidden_text`
  - [x] viditelný instrukční tón jako mírnější kategorie `visible_instruction_tone` (warn) odděleně od skrytého injection (méně FP)
  - [ ] JS/OpenAction na on-prem: dnes jen zadržen (neextrahuje se), jistí jen edge → volitelně flag „dokument obsahuje JavaScript"

---

## F2 — Review UI personalisty ⚪

- [x] Dvojjazyčné UI **CS/EN** + **světlý/tmavý motiv** (přepínače v liště, ukládané v prohlížeči; server generuje lokalizované řetezce přes `lang`) — 2026-08-04 (f)
- [ ] Seznam dávky: kandidát · rating · nejhorší severity · stav
- [ ] Detail: skóre + **rozpad podle kritérií** + evidence kotvy do CV
- [ ] **Panel flagů** — co bylo skryto, kde, doslovné znění; „co viděl člověk" vs. „co bylo schováno"
- [ ] Akce: postoupit / nechat / poznámka — vždy s uživatelem a časem do `decisions`
- [ ] Filtr a řazení podle ratingu, ale **bez tlačítka „hromadně zamítnout"**
- [ ] Měřitelnost dohledu: podíl případů, kde se člověk odchýlil od ratingu

---

## F3 — Inzerát, rubrik a rating ⚪

Jádro hodnoty pro personalistu, zatím nejméně rozpracované.

- [ ] **Parsování inzerátu** na strukturované požadavky (must-have / nice-to-have, roky, technologie, jazyky, lokalita, úvazek)
- [ ] Editor požadavků — personalista musí umět váhy a gates upravit ručně (inzerát bývá marketingový)
- [~] Deterministický rubrik nad `qualification_json`: vážený součet po gates — **prototyp hotový** `worker/src/rubric.ts` (gates + 6 typů kritérií, total 0..100), /selftest 6/6, ověřeno spikem 2026-08-04 (b); zbývá editor rubriku + parser inzerátu
- [~] `breakdown_json` s odkazem na evidence — rozpad po kritériích s `detail` hotový v `rubric.ts`; dopojit evidence kotvy z extrakce
- [ ] **Validace rubriku proti historickým rozhodnutím** personalisty (reprodukovatelné ≠ správné)
- [ ] Rozhodnout, kdo rubrik píše: personalista se šablonou vs. správce
- [ ] Chráněné atributy: `meta.sensitive_attributes_detected` hlásí přítomnost, **hodnoty se neextrahují**
- [ ] Test na proxy diskriminaci — koreluje rating s pohlavím/věkem/původem přes zástupné znaky?

---

## F4 — Regulatorika a zpevnění ⚪

- [ ] **DPIA + Annex IV-lite PŘED zpracováním prvních reálných CV** — před pilotem, ne tady
- [ ] Retenční lhůty CV + mazání, souhlas/informování uchazeče
- [ ] Záznam o zpracování, ZDR nastavení u Claude API
- [ ] `audit_log` append-only, ověřit že jde skutečně jen přidávat
- [ ] AI Act čl. 9–15 mapování (rozpracováno v `docs/AI-ACT.md`)
- [ ] Bus factor: backup operátor / outsourcing provozu

---

## Před F1 — obchodní validace

- [ ] ~10 CZ HR manažerů: **platí za ochranu proti injection, nebo chtějí hlavně
      funkční parser a rating?** Odpověď mění pořadí F2 vs. F3.
- [ ] Rozhodnout **interní pilot vs. produkt** — mění rozsah AI Act povinností

---

## Nezařazené / nápady

- [ ] Runner vyměnitelný Beelink → EU VPS (Hetzner FI) bez změny architektury
- [ ] Sdílení extraction jádra s `faxx-dox` — kde přesně je hranice?
- [ ] Sémantická detekce: embeddings (PhantomLint princip) nad `hidden_text`
- [ ] Export shortlistu pro hiring manažera (PDF / sdílený odkaz)
