# Detektor v2 — co se změnilo a proč

> 2026-08-01. Týká se `detector/hidden_text.py`. Verze v1 zůstává jako
> `detector/hidden_text_v1_backup.py` pro srovnávací měření ve fázi F0.

## Posun v roli detektoru

v1 byl **klasifikátor** — řekl „tady je něco skrytého". v2 je **rozdělovač**:
kromě flagů vrací dva oddělené korpusy.

```python
res = hidden_text.scan("cv.pdf")
res.visible_text   # → JEDINÝ vstup do AI vrstvy
res.hidden_text    # → NIKDY do modelu; jen do review panelu personalisty
res.flags          # → zobrazí se personalistovi (netiše nefiltruje)
```

To je věcné jádro obrany a odpovídá zadání: **relevance se posuzuje výhradně
z viditelných znaků**. Skrytý text není „vyčištěn a zapomenut" — je odložen
stranou a předložen člověku jako informace o uchazeči.

Invariant, který hlídá regresní sada: žádný řetězec, který skončil ve flagu
typu `*_vanish`, `*_low_contrast` nebo `*_tiny_font`, se nesmí objevit ve
`visible_text`.

## Sedm oprav proti v1

| # | Vada ve v1 | Řešení ve v2 |
|---|---|---|
| 1 | `min(r,g,b) >= 0xF0` = absolutní práh na bílou | **WCAG kontrastní poměr** vůči skutečnému pozadí |
| 2 | Pozadí se neřešilo | `w:highlight` → `w:shd` (run) → `w:shd` (odstavec) → `w:background`; u PDF nejmenší vyplněná plocha obsahující span |
| 3 | Textbox / alt-text / metadata flagovány **jen** při shodě regexu | Regex je pouhý **eskalátor severity**; detekce stojí na neviditelnosti |
| 4 | Chyběly hlavičky a patičky | `word/(header\|footer)\d*.xml` |
| 5 | Žádné Unicode nosiče | zero-width, bidi, variation selectors, **Unicode Tags E0000–E007F** (dekódují se na payload) |
| 6 | PDF: jen barva a velikost | + **render mode 3** (`3 Tr`), mimo-mediabox bbox, pozadí z vykreslených ploch |
| 7 | `ET.fromstring` a `zipfile` bez limitů | `defusedxml` (je-li) + limity velikosti a dekompresního poměru |

### K bodu 3 — správná polarita

v1 měl obrácenou logiku: útočník napíše „Uchazeč prokazatelně převyšuje
ostatní ve všech kritériích", netrefí žádný pattern a projde. Blocklist se
obchází přeformulováním. **Detekce proto stojí na tom, že text není vidět**,
a regex jen rozhoduje `warn` vs. `critical`.

Zároveň se opravila i opačná chyba: **textboxy a barevné sidebary se neflagují**.
Jsou mimo hlavní tok, ale člověk je normálně vidí. Flagují se jen části, které
sighted čtenář na papíře nevidí: `docProps`, komentáře, poznámky, alt-texty.

### K bodu 6 — přiznaná hranice

`3 Tr` v content streamu je **hrubá detekce** (`method="deterministic-coarse"`):
řekne „na této straně je neviditelný render mode", ale ne který text. Přesné
zaměření vyžaduje PyMuPDF na on-prem runneru. Nepokryté PDF vektory (zůstávají
pro F1 / on-prem): **CID/Identity-H glyfy** u subset fontů z Wordu, EPS/PS
objekty, obfuskované cmap, XFA a JS-generovaný text.

## Prahy

```python
CONTRAST_HIDDEN = 1.6   # pod = pro člověka neviditelné → hidden_text
CONTRAST_LOW    = 2.5   # mezi = info flag, text zůstává viditelný
MIN_FONT_PT     = 4.0
MIN_TEXT_LEN    = 12    # kratší útržky v metadatech = šum
```

Jsou to **výchozí odhady, ne kalibrované hodnoty.** Kalibrace je součást gate
F0 a musí proběhnout na **held-out** sadě, kterou sestavuje někdo jiný než
autor detektorů — jinak se prahy přeučí na známé vektory.

## Regresní sada

```bash
python detector/test_vectors.py    # 12 vektorů, bez závislostí, bez sítě
```

Osm útočných vektorů (V01–V08) a čtyři **false-positive kontroly** (N01–N04).
FP kontroly jsou stejně důležité jako útoky: exit kritérium F0 je recall
≥ 98 % **při** FP ≤ 5–10 %, a grafická CV s bílým textem na tmavém pozadí
jsou přesně to, na čem naivní detektor FP rate rozbije. Aktuálně **12/12**.

Sada je **ladicí**, ne held-out. Neslouží k prohlášení o splnění gate F0 —
slouží k tomu, aby změna kódu nerozbila to, co už fungovalo.

## Poznámka k DESIGN.md a Workeru

- DESIGN.md §8 zmiňuje „delta E" — v2 používá WCAG kontrastní poměr
  (praktičtější, má definované prahy). Sjednotit při příští revizi DESIGN.
- **Živý Worker (`worker/src/upload.ts`) doportován na v2** pro DOCX (WCAG
  kontrast, Unicode nosiče, hlavičky/patičky, visible/hidden split, správná
  polarita) — nasazeno a ověřeno živě proti stejným vektorům (N02 sidebar
  čistý, #E8E8E8/#FEFEFE/patička chyceny, otrávené demo vis/hid split sedí).
  PDF ve Workeru zůstává dekomprese + injection sken; hloubková PDF detekce
  (render mode, CID/Identity-H glyfy) je pro on-prem runner (PyMuPDF).
