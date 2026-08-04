# 13 · Náklady a provoz

> Kapitola pro kritického oponenta, který se ptá „kolik to reálně stojí, kde
> rozpočet uteče a co se stane, až dojde free kvóta". Odpovídáme poctivě: část
> čísel je **naměřená**, část je **řádový odhad** a jedna položka je **klíčová
> neznámá, kterou teprve měříme ve F0**. Kde nemáme tvrdé číslo, říkáme to.

---

## 13.1 Model účtování — na čem se reálně platí

Ekonomika nástroje stojí na dvou vrstvách, které se účtují jinak:

- **Cloudflare Workers AI** (default, zdarma/placený tier) se účtuje v **neuronech**
  — normalizované jednotce spotřeby napříč modely (LLM inference, `toMarkdown`,
  embeddings). Free příděl je **10 000 neuronů/den**.
- **Claude API** (volitelný placený backend, zatím **NENÍ** — chybí klíč) se účtuje
  ve **vstupních a výstupních tokenech** s cenou podle modelu.

Zásadní zjištění z vývoje (HANDOFF 2026-08-04): **účtování LLM je dominantně na
vygenerovaných (výstupních) tokenech**, ne na délce promptu. To má přímý dopad na to,
co má a nemá smysl optimalizovat:

- Ořezávání `max_tokens` a rušení „ping" volání dostupnosti = **kosmetika**, ne úspora.
  (Provedeno, ale s vědomím, že reálný efekt je malý.)
- Appka **už neplýtvá** na úrovni běhů: identické spuštění téže dávky i změna vah,
  gate nebo jazyka jedou přes `/api/rescore` (deterministický rubrik) **bez jediného
  AI volání**. Přepočet nespotřebuje žádné neurony ani tokeny.

Kdo hledá slabé místo v ekonomice, nenajde ho v „zbytečných voláních příkazů", ale
v **objemu extrakcí** a v **podílu drahé vision cesty** (§13.5).

### Co spotřebuje neurony na jeden dokument

Na jeden zpracovaný dokument (mimo cache) padne několik neuronových položek, ne jedna:

| Položka | Kdy | Řádová váha |
|---|---|---|
| `toMarkdown` (PDF → text) | u PDF | nízká (edge, textová vrstva) |
| LLM #1 extrakce → JSON schéma | u každého CV | střední (dominantní u textu) |
| Klasifikace druhu dokumentu (cv/dopis/inzerát) | u každého | nízká |
| Injection/bezpečnostní klasifikátor (Llama Guard) | u každého | nízká |
| **Vision / OCR obrázku** | jen sken/foto | **vysoká** (§13.5) |

Digitální CV = suma nízkých + jedné střední položky. Obrázkové CV = totéž plus jedna
**vysoká** položka, která obvykle převáží všechny ostatní dohromady. Přesné neuronové
hodnoty na dokument jsou **nenaměřené** — měří se ve F0 spolu s podílem vision.

---

## 13.2 Free tier Workers AI: 10 000 neuronů/den

Default provoz jede na **Cloudflare Workers AI free** — 10 000 neuronů/den,
**reset o půlnoci UTC** (pozor: pro ČR to znamená 01:00/02:00 lokálního času, ne
o naší půlnoci). Model je Llama 3.1 8B fp8 (volitelně 70B fp8-fast / gpt-oss 120B).

Při vyčerpání denního free přídělu vrací platforma chybu:

```
4006  ... daily free allocation exceeded
```

**Co se pak stane a jak to appka komunikuje** (záměrně, ať operátor pozná stav — ne
tiché prázdné výsledky):

- Lišta `/api/health` a červený banner ve výsledcích (`extract_error`) **explicitně
  hlásí** vyčerpání kvóty místo prázdné odpovědi.
- Selžou **jen** operace, které potřebují model: extrakce (LLM #1), odvození požadavků
  z inzerátu (`/api/derive`), OCR/vision obrázků.

### Co běží dál bez AI (i po 4006)

Toto je z hlediska provozu podstatné — po vyčerpání kvóty **není nástroj mrtvý**:

| Funkce | Potřebuje AI? | Stav po 4006 |
|---|---|---|
| Deterministický rubrik / skóre | ne | funguje |
| Přepočet vah, gate, dovedností (`/api/rescore`) | ne | funguje |
| Přepínání CS/EN nad hotovou dávkou | ne | funguje (tichý rescore) |
| Import uloženého výsledku (JSON) | ne | funguje |
| Per-doc cache extrakce (nezměněné CV) | ne | funguje (0 AI) |
| Evidence kotvy (grep z textu) | ne | funguje |
| Kontakty (regex z textu) | ne | funguje |
| **Extrakce nového CV** | ano | **selže, hlásí kvótu** |
| **Odvození požadavků z inzerátu** | ano | **selže, hlásí kvótu** |
| **OCR / vision obrázkového CV** | ano | **selže, hlásí kvótu** |

Jinak řečeno: **jádro hodnoty (skórování, přepočet, návrat k dávce) je odolné vůči
vyčerpání kvóty**, protože nevyužívá model. Kvóta limituje pouze *příjem nových
dokumentů* v daném dni.

---

## 13.3 Kaskáda / cost-tiering (kaskáda AI vrstev)

Návrh počítá s **kaskádou**, která tlačí náklady dolů tím, že hrubou práci dělá
nejlevnější vrstva a eskaluje se jen tam, kde je to nutné:

```
Cloudflare Workers AI (free-tier neurony)   ← hrubá práce na edge
   • klasifikace druhu dokumentu (je to CV? jazyk?)
   • bezpečnostní/injection klasifikátor (Llama Guard)
   • embeddings pro sémantický detektor
        │  eskalace u nuance / češtiny / sporných / skenů
        ▼
Claude Haiku 4.5   ← haléře, text-mode
        │
        ▼
Claude Sonnet 5 (+ vision)  ← jednotky až desítky centů, sken/foto
```

**Invariant přes celou kaskádu:** ať extrahuje kterákoli vrstva, **skóre počítá vždy
deterministický rubrik** — kaskáda mění jen kvalitu/cenu extrakce, ne způsob hodnocení.
Do logu extrakce patří, která vrstva a který model ji provedly (`model`, `model_version`).

**Poctivá poznámka o stavu:** kaskáda je **navržená, ne postavená**. Dnes běží pouze
první stupeň (Workers AI). Claude vrstvy (Haiku → Sonnet + vision) jsou **backlog** —
vyžadují API klíč, který zatím není. To znamená, že reálné náklady horních stupňů
kaskády jsou zatím **neměřené**; dají se pouze odhadnout z ceníků, viz §13.8.

---

## 13.4 Reálná úspora: per-dokument cache extrakce

Jediná úspora, která u free-first premisy skutečně škrtá spotřebu, je **per-dokument
cache extrakce** (nasazena 2026-08-04, čeká na deploy):

- Klient si po každém běhu uloží per-doc extrakci do `docCache`, klíč je
  `jméno + velikost + model + vision + hash(promptu)`.
- Při dalším „Vyhodnotit" pošle pro **nezměněné** soubory příznak `cached` a nahraje
  jen nové → server u cached dokumentů **přeskočí detect + extract (0 AI)**.

Praktický dopad: dřív přidání jednoho CV do dávky re-extrahovalo **všechna** CV.
Nyní se re-extrahuje **jen to nové**. Ověřeno (jsdom, inkrementální test): první běh
`cv=2 / cached=0`, po přidání souboru `cv=1 / cached=2` — dvě CV se nedotkla modelu
(`extract_ms=0`).

> **Bezpečnostní poznámka k cache:** důvěra v klientskou cache je vědomé rozhodnutí,
> které drží jen proto, že **nástroj je jednouživatelský** (útočník je autor CV, ne
> uživatel appky). Sanitizér `asCachedDoc` cache přebírá defenzivně. Detailně to
> rozebírá kapitola 14 (Omezení) — zde ho zmiňujeme jen jako předpoklad úspory.

---

## 13.5 KLÍČOVÁ NEZNÁMÁ: podíl dokumentů s vision fallbackem

Toto je **nejdůležitější věta celé kapitoly o nákladech**:

> **Rozpočet nerozhoduje průměrné CV, ale podíl dokumentů, které spadnou na vision
> (sken / fotka / obrázkové CV).**

Digitální PDF a DOCX se čtou levně z textové vrstvy (`toMarkdown`, jednotky neuronů).
Naproti tomu sken nebo fotka CV vyžadují **vision cestu** (primárně Cloudflare
`toMarkdown` na obrázku, fallback LLaVA; v produkci Claude vision) — a ta je řádově
dražší na dokument.

Aritmetika, proč je to citlivé:

- Když je vision podíl ~1 %, náklady drží spodní hranici.
- Když je vision podíl ~10 %, **rozpočet může vyskočit řádově** — desítka procent
  drahých dokumentů převáží devadesát procent levných.

Proto je „podíl vision fallbacku" **explicitní F0 metrika** (viz kapitola 15,
Roadmapa) — měří se **empiricky na reálné sadě**, ne odhaduje. Dokud tuto hodnotu
nemáme naměřenou, je **jakýkoli měsíční rozpočet spekulace**. Kritický oponent má
plné právo tuto neznámou označit za největší díru v ekonomickém modelu — a my
souhlasíme: proto ji řadíme před spuštění F1, ne za něj.

---

## 13.6 TCO/rok, ne jen měsíční provoz

Oponentura záměru správně vytkla, že odhady „X Kč / CV" jsou jen **řádové** a že chybí
**TCO (Total Cost of Ownership)**. Držíme se toho: ekonomiku je nutné počítat jako
**náklad na rok včetně času provozovatele**, ne jako fakturu za tokeny.

Skutečné roční TCO má tři složky:

1. **Variabilní inference** — neurony/tokeny za extrakce a vision. Řídí ho objem CV
   a **vision podíl** (§13.5). Externí odhad z oponentury: **~0,7–3,7 Kč/CV** — ale
   **řádový, nenaměřený**; skutečné číslo dá až F0.
2. **Fixní edge/úložiště** — Workers, D1, R2 (perzistence dávek zatím nezapojená,
   viz kapitola 14). Na pilotním objemu spíš zanedbatelné.
3. **Čas provozovatele** — správa on-prem runneru (Conduit → Beelink), údržba,
   monitoring, obnova certů/klíčů, reakce na incidenty. **Toto je u sólo provozu
   nejpodceňovanější položka** a u produktu se váže na bus factor (kapitola 14).

> Pro **interní pilot** (jeden operátor, bez SLA) je čas provozovatele „riziko
> vlastního času" a Beelink je nejlevnější varianta s daty v ČR. Pro **produkt s SLA**
> se runner mění na EU cloud VPS (Hetzner) a čas provozovatele se stává reálným
> nákladem se zálohou — jde přes bránu pilot → produkt.

Ilustrativní řádová úvaha (nikoli závazek): při ~5 000 CV/měsíc a spodní hranici
odhadu jde variabilní inference řádově o **jednotky až nižší desítky tisíc Kč/měsíc**,
zatímco kaskáda (free-tier na hrubou práci) tlačí spodní hranici dolů. Tato čísla se
**musí potvrdit měřením**, ne převzít.

---

## 13.7 Měřitelnost: logovat tokeny a cost, denní práh + alert

Aby ekonomika nebyla černá skříňka, návrh vyžaduje **měřit, ne hádat**:

- U každé extrakce logovat `model`, `model_version`, **spotřebované tokeny/neurony**
  a odhadovaný **`cost_czk`**.
- Zavést **denní práh nákladů + alert** — provoz nesmí tiše překročit rozpočet.
- Sledovat **podíl vision** jako průběžnou metriku, ne jen jako jednorázové F0 měření
  (§13.5).

Stav: logování `model`/tokenů je součástí kaskádové vrstvy (TODO F1), stejně jako denní
práh + alert. **Zatím nezapojené** — poctivě: dnes appka hlásí *vyčerpání* kvóty
(4006), ale nevede kontinuální nákladový log s prahem. To je položka F1, ne hotová věc.

---

## 13.8 Cesta do ostrého provozu: Workers Paid nebo Claude

Free tier (10 000 neuronů/den) je pro **pilot / nízký objem** dostatečný, ale pro
**ostrý provoz** je nutné jedno ze dvou:

- **Workers Paid** — zůstává v edge ekosystému, denní free příděl se rozšíří o placenou
  spotřebu nad rámec kvóty (účtováno za neurony nad denní příděl — přesnou sazbu
  **ověřit dle aktuálního ceníku Cloudflare**; řádově jednotky centů za tisíce neuronů).
  Výhoda: žádný nový poskytovatel, data zůstávají na CF/on-prem.
- **Claude backend (API klíč)** — zapne horní stupně kaskády (Haiku 4.5 → Sonnet 5 +
  vision). Vyšší kvalita/rychlost a spolehlivější čeština i vision, ale placené za
  tokeny. **Zatím není implementované** (chybí klíč); přepínatelný backend je připravený
  architektonicky (jako u sesterských projektů), ne zapnutý.

Řádová orientace pro Claude vrstvy (ceníkově, **ne naměřeno na reálném provozu**):
Haiku 4.5 je nejlevnější „haléřová" vrstva pro text, Sonnet 5 (+ vision) je dražší
vrstva pro nuance/češtinu/sken. Přesná cena/CV závisí na délce výstupu a podílu vision,
takže platí totéž co v §13.5 — bez naměřeného vision podílu je to odhad.

> **Zásada, kterou nástroj drží:** default je **zdarma** (Workers AI free) a nástroj
> **nikdy sám neutrácí** za placený backend. Přechod na Workers Paid nebo Claude je
> **vědomé rozhodnutí provozovatele**, ne tichá eskalace.

---

## 13.9 Velké dávky vs. limity CPU a času Workeru

Nákladová stránka není jen o penězích, ale i o **propustnosti**. Edge Worker má limity
na CPU a dobu běhu jednoho requestu, takže **velká dávka CV** nejde zpracovat jedním
synchronním voláním. Praktické dopady na provoz:

- Extrakce má latenci **~7–16 s / CV** (free 8B model); 70B ~65 s; gpt-oss-120b
  8–303 s (pro dávku nepoužitelné). Dávka desítek CV se proto nevejde do jednoho běhu.
- Appka to řeší **streamovaným průběhem** (`/api/evaluate?stream=1`, NDJSON): kandidáti
  naskakují ⏳ → ✓ / ⛔ s živým počítadlem, takže operátor vidí postup a nemá „zamrzlý"
  dojem. `scoreOne` + `rankResults` jsou oddělené, aby šel průběh streamovat.
- **Odolnost dávky:** jeden vadný dokument nesmí shodit celou dávku (`scan_many` /
  per-dokument zpracování to drží). Merge kvalifikací je per-dokument, ne přes spojený
  text (spojení textů slabší 8B mátlo).

**Zbývá (poctivě):** velké dávky vs. limity CPU/času Workeru jsou v backlogu jako
otevřená položka — pro produkční objemy je nutné buď frontové zpracování (e-mail ingest
je záměrně frontový), nebo dávkování na straně serveru. Dnešní web upload dávky
(≤ 10 MB, per-file 8 MB) je vhodný pro **ad-hoc dávky**, ne pro tisíce CV najednou. To
je provozní limit, ne nákladový — ale rozhoduje o tom, kdy je nutné přejít z edge-only
na frontu (a tím i na placený tier).

## 13.10 Shrnutí pro oponenta

| Tvrzení | Stav |
|---|---|
| Free kvóta 10 000 neuronů/den, reset UTC půlnoc, chyba 4006 | **naměřeno / ověřeno** |
| Po 4006 běží skóre, rescore, cache, import bez AI | **ověřeno** |
| Kaskáda Workers AI → Haiku → Sonnet + vision | **navržená; běží jen 1. stupeň** |
| Per-doc cache = jediná reálná úspora | **ověřeno (jsdom), nenasazeno** |
| Podíl vision fallbacku = klíčová neznámá | **NEMĚŘENO — F0 metrika** |
| Náklad/CV ~0,7–3,7 Kč | **řádový odhad, nenaměřeno** |
| Log tokenů/cost + denní práh + alert | **backlog F1, nezapojeno** |
| Claude backend (klíč) | **není — architektura připravená** |

Nejsilnější kritika, kterou přijímáme: **měsíční rozpočet dnes nelze věrohodně
vyčíslit, protože podíl vision fallbacku není naměřený.** Vše ostatní se od něj odvíjí.
Proto tuto neznámou řešíme jako F0 gate — dřív, než se kolem postaví placený provoz.
