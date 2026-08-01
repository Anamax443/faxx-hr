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
- [x] Ladicí regresní sada `detector/test_vectors.py` (8 útoků + 4 FP kontroly), 12/12
- [ ] **HELD-OUT sada** — sestavuje někdo jiný než autor detektorů
  - [ ] ≥ 50 reálných čistých CV (anonymizovaných), z toho ≥ 15 grafických
        s tmavými sidebary a textboxy — hlavní zdroj false positives
  - [ ] ≥ 30 otrávených, min. 10 vektorů, včetně **parafrázovaných** injection
        bez shody s blocklistem
- [ ] **Externí red-team** — někdo dostane detektor a má za úkol ho obejít
- [ ] Hraniční PDF vektory: CID/Identity-H glyfy, EPS/PS, obfuskovaná cmap, XFA, JS-text
- [ ] **Změřit podíl dokumentů s vision fallbackem** (sken/foto) — při 10 % vyskočí náklady řádově
- [ ] Kalibrovat prahy (`CONTRAST_HIDDEN`, `CONTRAST_LOW`, `MIN_FONT_PT`) na held-out
- [ ] `defusedxml` do `requirements.txt` (teď jen volitelný import)

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
- [ ] LLM #1 extrakce → `schema/extraction.schema.json`, vstup **jen `visible_text`**, bez zadání (least privilege)
- [ ] Soft validace (field-level): neznámé klíče zahodit, sporné pole → flag, ne ERROR celého CV
- [ ] Kaskáda: Workers AI (klasifikace, Llama Guard) → Haiku 4.5 → Sonnet 5 + vision; logovat `model`, tokeny, `cost_czk`
- [ ] Denní práh nákladů + alert
- [ ] **Doportovat detekci do Workeru** (kontrast/Unicode) NEBO edge jen triáž + full on-prem

---

## F2 — Review UI personalisty ⚪

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
- [ ] Deterministický rubrik nad `qualification_json`: vážený součet po gates
- [ ] `breakdown_json` s odkazem na evidence — bez toho není vysvětlitelnost
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
