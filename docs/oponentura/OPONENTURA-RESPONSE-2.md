# Reakce na oponentury (konsolidovaná) — faxx-hr

> Odpověď autorského týmu na **dvě nezávislé technicko-regulatorní oponentury** projektu
> faxx-hr (2026-08-04). Formát převzatý z [`../OPONENTURA-RESPONSE.md`](../OPONENTURA-RESPONSE.md):
> u každého bodu **✅ přijato / 🟡 upřesněno / ↩︎ oponováno**, s odůvodněním. Cíl není
> obhájit se, ale **oddělit platnou kritiku od nepřesné** a převést platné body na
> konkrétní brány s prioritou. Dokument je záměrně sebekritický.

---

## 0. Klíčové zjištění: obě oponentury konvergují

Přišly dva nezávislé posudky. První (dimenzionální, ostřejší) a druhý (podmíněné přijetí
se čtyřmi podmínkami). **Nezávisle dospěly ke stejným branám** — held-out sada + red-team,
perzistence + auditní substrát, DPIA před reálnými daty, alert fatigue, nezměřená vision
ekonomika, bus factor, „živá appka ≠ MVP". Když dva kritici konvergují, není to náhoda —
je to nejsilnější signál, co dělat. Většinu z toho dokumentace sama přiznává (což oba
oponenti korektně citují); přidaná hodnota posudků je v **prioritizaci** a v **reframu**.

## 0.1 Rozhodnutí o rozsahu: dvě větve produktu

Před bodovou reakcí je nutné jedno rozhodnutí, které **mění platnost části kritiky**:

| Větev | Co to je | Data | Compliance |
|---|---|---|---|
| **A — edge demonstrátor** | současná bezstavová appka (Cloudflare Workers, veřejná URL) | JEN ukázková / testovací; **reálná CV nikdy** | netýká se jí (nezpracovává osobní údaje reálných uchazečů) |
| **B — lokální DB modifikace** | budoucí **samostatná** varianta s databází na lokální síti | reálná CV | teprve zde: perzistence, `audit_log`/`decisions`, GDPR, DPIA, Annex IV |

Bezpečnostní jádro (`detect` / `extract` / `rubric`) je **sdílené**, takže bezpečnostní
a validační práce (held-out, dual-path diff, kalibrace FP, měření vision) se dělá jednou
a platí pro obě větve. **Compliance-brány se přesouvají do větve B; bezpečnostní brány
zůstávají.**

To přímo adresuje nejsilnější regulatorní námitku obou posudků: *edge demonstrátor
nemůže porušit GDPR/AI Act, protože se z principu nikdy nedotkne reálného CV.* Podmínku
to nezruší — jen ji **správně umístí**: platí pro větev B, ne pro A. Průřezově z toho
plyne závazek: **komunikovat živou appku striktně jako demonstrátor, ne jako HR nástroj**,
a **zastavit** jakýkoli reálný nábor na edge verzi.

---

## 1. Bezpečnost: „chráníme verdikt, ne fakta" — ✅ přijato (klíčový reframe)

**Námitka (oba posudky):** invariant „injection nemá kam zapsat verdikt" je pravdivý
doslovně, ale útočník má kam zapsat **vstupní fakta** verdiktu (`skills`, `seniority`).
Skrytým textem (zejména **ToUnicode obfuskace, V-PDF-06**) lze zobrazit „Junior", ale do
extrakce protlačit „Senior". Evidence kotva `snippetFor` grepuje `visible_text`, kde
otrávený řetězec fyzicky je → **kotva ho „potvrdí"**, což dává falešnou jistotu.

**Reakce:** přijímáme jako **nejcennější bod celé oponentury.** Je pravdivý a dokumentace
ho podceňuje. Dvě upřesnění (přesnost, ne obhajoba):

- **V-PDF-06 je známý, dokumentovaný a vědomě odložený vektor** (`docs/PDF-BOUNDARY-MATRIX.md`),
  ne skrytá díra. To ale nesnižuje závažnost — jen mění formulaci na „otevřený vektor
  s navrženou, nepostavenou mitigací".
- **Edge to principiálně nechytí.** `toMarkdown` čte ToUnicode textovou vrstvu; edge nemá
  rasterizaci, takže rozdíl *display ↔ extrakce* nevidí. Čistý fact-swap bez instrukčního
  tónu neprojde injection heuristikou a extrahuje se jako fakt.

**Důsledek:** **dual-path diff** (textová vrstva PDF vs. render → OCR) se povyšuje z
„P2 diferenciátor" na **P0 — podmínku platnosti invariantu na PDF**. Právě dual-path chytá
*všechny* display-vs-extrakce záměny (ToUnicode, render mode, off-page) deterministicky,
porovnáním „co vidí člověk" s „co dostal model". Běží on-prem (edge rasterizaci nemá).
Sem patří i uzavření V-PDF-06 (glyf ↔ ToUnicode diff).

## 1.1 Skrytý fact-swap vs. viditelné nadsazené tvrzení — 🟡 nutné rozlišit

Oba posudky pod „data poisoning" slévají **dvě různé věci**, a to rozlišení je podstatné:

- **Skrytý fact-swap** (neviditelným textem přetavit `Python: pasivní` → `Python: expert`,
  co člověk nevidí) = **reálná bezpečnostní díra** → řeší dual-path diff (viz výše). Přijato.
- **Viditelné nadsazené tvrzení** („jsem expert na Python", napsané normálně a čitelně) =
  **není injection vuln.** To je prostě fakt, že *CV o sobě lže* — a to neřeší žádný
  screener; od toho je pohovor a lidský dohled. faxx-hr nikdy netvrdil, že detekuje
  nepravdivé sebehodnocení; tvrdí, že detekuje **skrytou manipulaci** a drží skórování
  **deterministické a auditovatelné**.

Držíme tuto hranici vědomě: obrana míří na *skryté* zkreslení, ne na *legitimně zapsanou*
chlubivost. Zaměňovat je znamená slíbit něco, co žádný nástroj neumí.

---

## 2. Validace: held-out chybí, spike je jen PoC — ✅ přijato / 🟡 dílčí oponentura

**Námitka:** metriky (recall ≥ 98 %, FP ≤ 5–10 %) jsou cíle, ne měření; regrese 24/24 je
na ladicí sadě autorů (self-bias); verify-core spike je jeden model + jedno znění injekce.

**Reakce:** přijímáme plně — **F0 gate je neuzavřen** a dokumentace to říká. Bez nezávislé
held-out sady a externího red-teamu je tvrzení o odolnosti proti injection **vědecky
neobhajitelné**; „24/24" je ladicí, ne důkaz.

🟡 Dílčí oponentura formulace „spike bez hodnoty / statisticky bezvýznamný": spike měl
**jiný účel** — de-riskovat *jádrový mechanismus* (schéma bez pole na skóre → verdict-
injection nemá kam zapsat) DŘÍV, než se kolem staví (metodika verify-core-first). Ten účel
splnil a nikdy nesuploval F0 benchmark. „Jako **security audit** bezcenný" = ano; „bez
hodnoty" = ne. Oponentův bod, že spike netestoval **faktovou** injekci (bod 1.1), je ale
platný a míří správně.

---

## 3. Regulatorika a auditní substrát — ✅ přijato, přesunuto do větve B

**Námitka:** bezstavová appka nemůže splnit AI Act čl. 12 (záznamy) ani GDPR čl. 5(2)
(accountability); export JSON je snapshot, ne auditní log procesu; metrika lidského
dohledu (odchylka od ratingu) není implementovaná → nelze odlišit dohled od rubber-
stampingu; DPIA + Annex IV chybí. Verdikt: blokuje pilot s reálnými daty.

**Reakce:** přijímáme věcně **beze zbytku** — a umísťujeme do **větve B** (§0.1). Edge
demonstrátor reálná data nezpracovává, takže GDPR/AI Act čl. 12/14 se ho netýkají; jakmile
by na něj šlo jediné reálné CV, byl by protiprávní — proto **STOP** takového použití.
Ve větvi B je auditní substrát **předpokladem, ne funkcí navíc**: zapojit `decisions` +
append-only `audit_log` (schéma v `migrations/0001_init.sql` existuje, ale **nezapojené**),
perzistenci originálů, a **měřitelný dohled** (minimální čas review, povinný komentář,
randomizované audity shody). DPIA + Annex IV-lite **před** prvním reálným CV.

---

## 4. Alert fatigue jako bezpečnostní hrozba — ✅ přijato + KPI / 🟡 upřesnění FP

**Námitka:** vysoké FP u grafických CV (Canva/InDesign) → personalista si vytvoří mentální
filtr → začne flagy ignorovat → `flag-not-filter` se stane nefunkčním; chybí triáž
„design vs. útok".

**Reakce:** přijímáme **bezpečnostní reframe** i návrh **KPI: dismissal-rate flagů**
(a click-through) jako metriku bezpečnosti, ne jen UX. Vynikající, dosud chybějící nápad.

🟡 Upřesnění (ne popření): detektor v2 **záměrně neflaguje viditelné sidebary/textboxy** —
počítá WCAG kontrast vůči *skutečnému* pozadí (highlight/shd/background), takže tmavý Canva
sidebar se světlým písmem = vysoký kontrast = **není nález**. Flaguje se jen NÍZKÝ kontrast
(text ≈ pozadí). „15–30 % FP" je proto **přiznaný worst-case, ne změřené číslo** — reálné FP
je právě to neuzavřené F0 číslo (cíl ≤ 5–10 %). Závěr ale drží: **bez měření to nevíme**,
a fact-swap bez instrukčního tónu je od designu nerozlišitelný (pojí se s bodem 1.1) →
kalibrace FP na reálných grafických CV je **P1 gate**.

---

## 5. Ekonomika: nezměřený vision fallback — ✅ přijato

**Námitka:** cenotvorba a TCO stojí na podílu vision fallbacku (sken/foto), který je
nezměřený; při 10 % náklady vyskočí 10×; free tier pokryje pak jen ~20–30 CV/den = „demo,
ne pilot". Změřit na ≥ 500 CV před dalšími featurami.

**Reakce:** přijímáme — je to **existenční neznámá**, ne marginální nejistota, a dokumentace
to říká (měří se ve F0, který není uzavřen). Upřesnění: **per-doc cache tohle NEřeší** —
šetří *re-extrakci*, ne cenu *prvního* skenu scan-heavy dávky. Měření podílu vision
povyšujeme na **P1 gate**; naráží na §0.1 (legální zpracování reálných CV → měřit na
anonymizovaném / souhlasném / reprezentativním vzorku, ideálně ve větvi B).

---

## 6. Provoz: timeout Workeru, nedeterminismus 8B, bus factor — ✅ / 🟡

**Async / timeout (posudek 2):** ✅ přijato. Sériové zpracování ~7–16 s/dok. × desítky CV
v jednom requestu naráží na limity invokace Workeru. Streamovaný NDJSON řeší *UX*
(„nezamrzne"), **ne strop délky invokace**. Pro produkční objemy je správná odpověď
**async na pozadí (Queues / Durable Objects / Workflows)** — **P1 gate**.

**Nedeterminismus 8B:** 🟡 upřesnění. Extrakce běží na `temperature: 0` → je *téměř*
deterministická; a **per-doc cache + rescore dnes dělají re-běh identickým** (znovu se
needeuje). Zbytkový jitter je jen u úplně čerstvé extrakce. Jako důvod přejít na silnější/
placený backend (kvalita) to platí; jako „chaos v pořadí" už méně.

**Bus factor:** ✅ přijato. 100% závislost na jednom operátorovi je pro B2B neakceptovatelná
— podmínka pro produktovou větev (záložní operátor / outsourcing), akceptované riziko pro
sólo pilot.

**Live ≠ MVP:** ✅ přijato. Formát JSON exportu a per-doc cache je **záměrně navržen jako
budoucí DB záznam** (snižuje migrační riziko do větve B), ale auth, multi-user a audit-log
jsou reálně nové — „přidání DB" to podceňuje.

---

## 7. Konsolidované brány (z obou posudků)

| # | Brána | Větev | Priorita |
|---|---|---|---|
| **G1** | Held-out sada (3. strana, ~100+100) + externí red-team → naměřit recall/FP | A + B (sdílené jádro) | **P0** |
| **G4** | Dual-path diff (render ↔ textová vrstva) + uzavřít V-PDF-06 | A + B (on-prem) | **P0** |
| **G6** | Kalibrace FP na grafických CV + KPI dismissal-rate flagů | A + B | P1 |
| **G7** | Změřit podíl vision fallbacku na reprezentativním vzorku | A + B | P1 |
| **G5** | Async dávkové zpracování (Queues / DO / Workflows) | A (i B) | P1 |
| **G8** | Silnější backend (Claude / 70B) + řešit bus factor | A + B | P2 |
| **G2** | Perzistence (lokální DB) + `decisions`/`audit_log` + metrika dohledu | **jen B** | P0 *větve B* |
| **G3** | DPIA + Annex IV-lite + GDPR před prvním reálným CV | **jen B** | P0 *větve B* |
| — | **STOP** real-data pilot na edge; komunikovat živou appku jako demonstrátor | průřezově | ihned |

Pořadí pro edge (větev A): **G1 + G4 napřed** (uzavřít gate detekce a díru fact-swapu),
pak G5/G6/G7, pak G8. Compliance (G2/G3) žije ve větvi B a spustí se, až bude na lokální
síti DB.

---

## 8. Kde oponentům ubíráme (poctivě)

Aby reakce nebyla jen souhlasná: tři místa, kde je formulace silnější než realita.

1. **„Kritická díra" (bod 1):** jde o *známý, dokumentovaný, vědomě odložený* vektor
   s *navrženou* mitigací (dual-path diff), ne o skrytou díru v jádře. Závažnost bereme,
   dramatizaci „architektura selhává tam, kde slibuje" mírníme na „vektor otevřený do
   postavení dual-path diffu".
2. **„Spike bez hodnoty":** přestřeluje — viz §2. Spike de-riskoval mechanismus, nikoli
   suploval audit.
3. **„FP 15–30 % → každé třetí CV flagnuté":** to je worst-case admission, ne měření;
   detektor viditelné sidebary záměrně neflaguje. Reálné FP je neuzavřené číslo (G6/G1).

Žádný z těchto tří bodů nemění závěr — jen kalibruje jeho ostrost.

---

## Závěr

Obě oponentury jsou kvalitní a jejich závěr přijímáme: **architektonické jádro je zdravé,
provozní a validační zralost chybí.** Konkrétně:

1. **Bezpečnostně** povyšujeme **dual-path diff na P0** (bod 1 je platný reframe) a držíme
   rozlišení skrytý fact-swap (díra) vs. viditelný self-report (mimo scope).
2. **Regulatorně** přesouváme perzistenci + audit + GDPR do **větve B (lokální DB)**;
   edge zůstává demonstrátor bez reálných dat — a to komunikujeme explicitně.
3. **Validačně** je **G1 (held-out + red-team)** stále brána, která blokuje jakékoli tvrzení
   o odolnosti.
4. **Provozně** přijímáme async dávky, KPI dismissal-rate a měření vision jako gaty.

Další krok podle plánu: napřed **G1 a G4** na sdíleném jádře; compliance-substrát ve větvi
B, až padne lokální DB. Roadmapa je aktualizovaná v [`15-roadmapa.md`](15-roadmapa.md).
