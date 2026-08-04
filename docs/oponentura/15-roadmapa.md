# 15 · Roadmapa

> Kapitola říká, **co je hotové, co zbývá a v jakém pořadí** — s explicitními
> závislostmi. Píšeme ji poctivě: fáze označené „prototyp v appce" znamenají ověřené
> jádro poskládané do živého nástroje, **ne** produkčně zpevněnou verzi. Pořadí kroků
> není přání, ale řetěz závislostí — některé věci se nesmí dělat dřív, než padne jiné
> rozhodnutí.

---

## 15.1 Fáze F0 → F4: co a jaký stav

```
F0  BENCHMARK detekce      🟡  jádro hotové, gate NEUZAVŘEN
F1  Pipeline skeleton      ⚪  extrakce prototyp; e-mail/perzistence chybí
F2  Review UI personalisty ⚪  ranking/flagy/rozpad prototyp; audit/decisions chybí
F3  Inzerát, rubrik, rating ⚪  rubrik prototyp; parser inzerátu + validace chybí
F4  Regulatorika + zpevnění ⚪  DPIA/Annex IV se ale dělá DŘÍV (viz §15.4)
```

### F0 — Benchmark detekce (GATE) 🟡

**Hotové:** detektor v2 (WCAG kontrast, Unicode nosiče, hlavičky/patičky, PDF render
mode, XFA/off-page/nulová alfa), rozdělení `visible_text` / `hidden_text` s invariantem
zádrže, ladicí regrese **24/24**, živé DOCX + PDF přes `toMarkdown`, hraniční PDF vektory
změřené edge vs. on-prem (`docs/PDF-BOUNDARY-MATRIX.md`).

**Zbývá (a proto je gate NEUZAVŘEN):** held-out sada, externí red-team, měření podílu
vision fallbacku, kalibrace prahů na neznámých datech. **F0 exit:** recall ≥ 98 % na
held-out otrávených, FP ≤ 5–10 % na čistých, přesnost extrakce ≥ 90 %.

### F1 — Pipeline skeleton ⚪

**Prototyp:** LLM #1 extrakce (`worker/src/extract.ts`, Workers AI, přepínatelný model,
soft validace) — ověřeno spikem; vstup jen `visible_text`, bez zadání (least privilege).
**Zbývá:** e-mail Worker (postal-mime) → R2 (originál immutable) → D1 (stav), web upload
jako rovnocenný kanál, deduplikace, dual-path diff (on-prem runner), kaskáda AI vrstev
s logováním tokenů/`cost_czk`, denní práh + alert.

### F2 — Review UI personalisty ⚪

**Prototyp:** dvojjazyčné UI CS/EN + světlý/tmavý motiv, ranking + flagy + rozpad po
kritériích + evidence kotvy. **Zbývá:** seznam dávky se stavem, panel flagů („co viděl
člověk" vs. „co bylo schováno"), akce postoupit/nechat/poznámka do `decisions` (s časem
a uživatelem = důkaz oversight), filtr a řazení **bez tlačítka „hromadně zamítnout"**,
měřitelnost dohledu (podíl odchylek člověka od ratingu).

### F3 — Inzerát, rubrik a rating ⚪

**Prototyp:** deterministický rubrik (`worker/src/rubric.ts`, 6 typů kritérií, gates,
total 0..100), odvození požadavků z inzerátu, editor rubriku (vypínání kritérií +
šablony). **Zbývá:** plný parser inzerátu na strukturované požadavky, validace rubriku
proti historickým rozhodnutím, rozhodnutí kdo rubrik píše, test na proxy diskriminaci.

### F4 — Regulatorika a zpevnění ⚪

DPIA + Annex IV-lite (ale **před pilotem**, ne tady — §15.4), retenční lhůty + mazání,
informování uchazeče, append-only audit, mapování AI Act čl. 9–15, bus factor
(záložní operátor).

---

### Exit kritéria per fáze (aby „hotovo" nebylo dojmové)

| Fáze | Měřitelný exit |
|---|---|
| F0 | recall ≥ 98 % na **held-out** otrávených, FP ≤ 5–10 % na čistých, přesnost extrakce ≥ 90 %; naměřený podíl vision |
| F1 | dávka N dokumentů přežije 1 vadný; extrakce → schéma s logem `model`/tokenů; denní práh + alert |
| F2 | každé rozhodnutí zapsáno do `decisions` (uživatel + čas); měřitelný podíl odchylek člověka od ratingu |
| F3 | rubrik validován proti historickým rozhodnutím; parser inzerátu → editovatelné požadavky; test proxy diskriminace |
| F4 | DPIA + Annex IV-lite hotové **před** reálnými daty; append-only audit ověřen |

Dvě čísla F0 se měří **odděleně**: atributová detekce (skrytý text) a dual-path diff
(ještě neexistuje). Nesměšovat je do jednoho „skóre detektoru".

## 15.2 Konkrétní další kroky (s pořadím a závislostmi)

Následující posloupnost je **řetěz závislostí**, ne volný seznam:

### Krok 1 — Held-out sada + externí red-team → F0 exit

**Nejvyšší priorita.** Sestaví **někdo jiný** než autor detektoru (oddělit autora
detektorů od autora útoků → proti overfittingu): ≥ 50 čistých CV (≥ 15 grafických),
≥ 30 otrávených (min. 10 vektorů vč. parafrázovaných). Externí red-team dostane detektor
a má ho obejít. **Blokuje vše ostatní** — bez doložitelného čísla nemá smysl stavět F1.
Souběžně změřit **podíl vision fallbacku** (nákladová neznámá, kapitola 13).

### Krok 2 — Plná D1/R2 perzistence dávek se stavem kandidáta

Zapojit dosud **nezapojenou** migraci `0001_init.sql`: dávka žije v D1/R2, kandidát nese
stav **osloven / postupuje / odmítnut**, originály v R2 (immutable), `decisions`
append-only jako důkaz lidského dohledu. Tím se z bezstavového edge nástroje stává
plnohodnotný pracovní nástroj. **Závisí na kroku 1** jen volně (dá se dělat paralelně),
ale nemá smysl škálovat příjem, dokud gate detekce nedoloží čísla.

### Krok 3 — Dual-path diff + sémantická vrstva nad `hidden_text` (prohloubení diferenciátoru)

Textová vrstva PDF vs. render → OCR (on-prem runner) + embeddings nad `hidden_text`
(PhantomLint princip). Toto **prohlubuje diferenciátor** (injection-obrana), který nás
odlišuje od komoditního rankingu. **Závisí na kroku 1** (prahy a metriky se kalibrují na
held-out sadě). Sem patří i uzavření odložené díry **V-PDF-06** (glyf ↔ ToUnicode).

### Krok 4 — Claude backend (přepínatelný, s klíčem)

Zapnout horní stupně kaskády (Haiku 4.5 → Sonnet 5 + vision) pro kvalitu/rychlost češtiny
a skenů. Architektura přepínatelného backendu je připravená; chybí jen klíč a integrace.
**Default zůstává zdarma** (Workers AI); Claude je vědomá eskalace, ne tichá. Váže se na
nákladový model (kapitola 13) — má smysl až se známým vision podílem.

### Krok 5 — DPIA + Annex IV-lite (před reálnými daty)

Viz §15.4 — časově patří **před** pilot, ne až za F4. Uvádíme jako samostatný krok, ne
jako poslední fázi, právě proto.

### Krok 6 — Evidence kotvy i pro certy / vzdělání / jazyky

Dnes jsou evidence kotvy jen u **dovedností** (30 % kritérium, nejdůležitější claim).
Rozšířit deterministické kotvení (grep z viditelného textu, ne od modelu → nedá se
halucinovat) i na certifikace, vzdělání a jazyky. Certy jsou dnes `string[]`, evidence by
chtěla rozšířit typ. **Nezávislý, inkrementální follow-up** — dá se dělat kdykoli po
kroku 1.

---

### Krok 7 — Velké dávky / frontové zpracování

Edge Worker má limity CPU/času, takže velká dávka CV se dnes do jednoho běhu nevejde
(extrakce ~7–16 s/CV na free 8B modelu). Pro produkční objemy je nutné buď **frontové
zpracování** (e-mail ingest je záměrně frontový), nebo dávkování na straně serveru.
Dnešní streamovaný průběh (NDJSON) řeší UX „zamrznutí", ne kapacitu. **Závisí na kroku 2**
(perzistence dávek) — bez stavu dávky nemá fronta kam zapisovat postup. Provozní, ne
diferenciační krok.

---

## 15.2b Nezařazené / dlouhodobé nápady

Body, které nejsou na kritické cestě, ale patří do backlogu:

- **Runner vyměnitelný Beelink → EU VPS (Hetzner FI)** bez změny architektury — realizuje
  se až na bráně pilot → produkt (§15.5).
- **Sdílení extrakčního jádra s `faxx-dox`** — kde přesně je hranice? Otevřená otázka
  reuse; extrakce → pevné schéma je společný vzor, ale bezpečnostní invariant (zádrž
  skrytého textu) je specifický pro HR screening.
- **Export shortlistu pro hiring manažera** (PDF / sdílený odkaz) — navazuje na F2/F3
  a manažerský tiskový výstup, který už existuje.
- **JS/OpenAction flag na on-prem** — dnes se JavaScript v PDF jen zadrží (neextrahuje),
  jistí ho jen edge; volitelný flag „dokument obsahuje JavaScript" je drobný follow-up.

---

## 15.3 PŘED F1 — obchodní validace

Toto je **brzda vloženého úsilí**, kterou obě oponentury označily za závazný bod:

> Než se postaví F1, ověřit trh: **~10 CZ HR manažerů** — platí si za **ochranu proti
> injection**, nebo chtějí hlavně **funkční parser a rating**?

Odpověď **mění pořadí F2 vs. F3**:

- Když trh chce **injection-obranu** → těžiště je diferenciátor (kroky 1 a 3), F2 review
  UI s panelem flagů „co bylo schováno".
- Když trh chce **parser + rating** → těžiště je F3 (parser inzerátu, kvalita rankingu),
  injection-obrana je hygiena, ne prodejní argument.

Bez této validace hrozí, že postavíme technicky správnou obranu proti hrozbě, kterou trh
neocení — nebo naopak zanedbáme parser, který je pro personalistu skutečnou hodnotou.
**Systematická rešerše komerčních ATS** je relevantní pro produktové go/no-go, ne pro
uzavřený pilot (ten stejně padá na on-prem + češtinu + auditovatelnost, které kontroluje
operátor).

---

## 15.4 DPIA a Annex IV: časování PŘED pilotem

Regulatorní dokumentaci **neodkládáme na F4**. Nábor a výběr = **AI Act Annex III bod 4
= vysoce rizikový** → decision support, nikdy auto-zamítnutí. Z toho plyne:

- **DPIA** (GDPR čl. 35) u profilování uchazečů je prakticky povinná — **před zpracováním
  reálných CV**. Smí běžet **souběžně s F0**, pokud F0 jede na syntetických/souhlasných
  vzorcích (což dnes jede — spike data nejsou reálná CV).
- **Annex IV-lite** (technická dokumentace) sdílí obsah s DPIA — připravit před pilotem.
- **Měřitelný lidský dohled** (čl. 14): minimální čas review, povinný komentář
  u rozhodnutí, randomizované audity shody — ne „gumové razítko".

Praktický princip: **stavět podle standardu high-risk už teď.** Případný odklad účinnosti
AI Act = rezerva na dokumentaci, **ne** důvod odkládat návrh. A relabeling z high-risk
(kapitola 14, §14.2.1) **nestavíme jako plán** — jen jako případný bonus po posouzení
právníkem.

---

## 15.5 Rozhodnutí pilot vs. produkt

Toto rozhodnutí **rámuje celou roadmapu** — proto stojí na konci, ne na začátku:

| | Interní pilot | Produkt |
|---|---|---|
| Runner | Beelink (ČR, nejlevnější) | EU cloud VPS (Hetzner FI), SLA — **bez změny architektury** (runner je za Conduit vyměnitelný) |
| Bus factor | akceptované riziko | podmínka: záložní operátor / outsourcing |
| AI Act role | operátor = provider i deployer | role se štěpí (provider = QMS/CE/registrace) |
| Compliance | DPIA + Annex IV-lite | plná dokumentace |
| Trh | uzavřený, kontrolovaný | vyžaduje market validaci (§15.3) |

Návrh je **záměrně postavený tak, aby brána pilot → produkt nevyžadovala přestavbu**:
runner se vymění za rozhraním Conduit, GDPR vyžaduje EU (ne nutně ČR), kaskáda a rubrik
zůstávají. **Rozhodnutí padne na této bráně** — a dokud nepadne, držíme rozsah AI Act
povinností v nejnáročnější (pilotní sólo) variantě, aby produkt nikdy nebyl méně
připravený, než regulace vyžaduje.

---

## 15.6 Shrnutí posloupnosti

```
1. Held-out sada + red-team + vision podíl   →  UZAVŘÍT F0 GATE   (blokuje vše)
   ├─ 3. dual-path diff + sémantika (prohloubení diferenciátoru; závisí na 1)
   └─ 6. evidence kotvy pro certy/vzdělání/jazyky (nezávislý follow-up)
─── PŘED F1: obchodní validace (~10 HR manažerů) → určí pořadí F2 vs. F3 ───
─── PŘED reálnými daty: DPIA + Annex IV-lite (krok 5) ───
2. Plná D1/R2 perzistence dávek se stavem kandidáta
4. Claude backend (přepínatelný, se známým vision podílem)
─── BRÁNA: pilot vs. produkt → runner, bus factor, compliance hloubka ───
```

> **Pro oponenta:** roadmapa **nezačíná stavěním funkcí, ale uzavřením gate** (krok 1) a
> **ověřením trhu** (§15.3). To je záměrné — metodika *verify-core-first*: ověř jádro
> a poptávku dřív, než kolem stavíš a nasazuješ. Regulatoriku (DPIA/Annex IV) posouváme
> **před** reálná data, ne na konec. Sporné body (relabeling, pilot/produkt) necháváme
> otevřené pro provozovatele a právníka — nezavíráme je technickým rozhodnutím.
