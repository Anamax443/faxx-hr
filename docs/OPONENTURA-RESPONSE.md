# Reakce na oponentury záměru faxx-hr

> 🇨🇿 Čeština · [🇬🇧 English](OPONENTURA-RESPONSE.en.md)

Ke záměru v0.1 přišly **dvě nezávislé externí oponentury**. Tento dokument je
konsolidovaná reakce — bod po bodu, s verdiktem a s odkazem, kam se změna promítla.
Obě oponentury byly věcné a posunuly návrh; nic se nezametá.

- **O1** — role technický garant / investor / regulatorní poradce (míří na F0 metodiku, rubrik, regulatoriku, bus factor).
- **O2** — role AI Collaborator (míří na provoz/škálování, alert fatigue, strict JSON, obchodní model).

Verdikty: **✅ Přijato** · **🔶 Přijato s upřesněním rozsahu** · **⚖️ Sporné — rozhodnutí provozovatele / právníka**.

---

## 0. Kde se obě oponentury shodují (bereme jako závazné)

1. **F0 potřebuje tvrdší kritéria** — oddělená held-out sada (ne overfitting na známé útoky), externí red-team, měřit víc než recall/FP.
2. **Před F1 ověřit trh** — zeptat se ~10 CZ HR manažerů: platí si za ochranu proti injection, nebo chtějí prostě funkční parser? Hodnota produktu stojí a padá s odpovědí.
3. **Regulatoriku řešit brzy**, ne až F4 — DPIA a Annex IV před zpracováním reálných CV.
4. **Provoz / bus factor je podceněný** pro produktovou fázi.

Tyto čtyři body jsou promítnuty do F0/roadmapy (viz DESIGN §13, §15).

---

## 1. Bezpečnost a dual-path diff

| # | Námitka | Verdikt | Reakce / změna |
|---|---|---|---|
| O2 1.1 | **Same-contrast bypass** (#666 na #777) — dual-path nezaznamená rozdíl, oba parsery čtou stejně | 🔶 | Správně, že *dual-path* to nechytí. Ale chytí to **deterministický kontrastní detektor (delta E)** — nízký kontrast text↔pozadí je flag bez ohledu na shodu cest. Dual-path a delta-E jsou **nezávislé** vrstvy; tohle je přesně případ, kdy dual-path selže a delta-E zabere. Doplněno do THREAT-MODEL. |
| O2 1.1 | **Alert fatigue** — grafická CV (Canva/InDesign, vícesloupce, text v křivkách) → 15–30 % false-positive → personalista vypne varování | ✅ | Nejsilnější praktická námitka obou oponentur. Změna: (a) dual-path **není primární** detektor (ten je low-FP deterministický: vanish/render-mode/delta-E), je *doplňkový*; (b) rozdíl A\B se **nefláguje syrově** — protéká přes injection klasifikátor a fuzzy zarovnání, flag jen když je text v A instrukčního charakteru a chybí v B; (c) **FP na reálných grafických CV je samostatná F0 metrika** s exit prahem. |
| O2 1.2 | **Visual prompt injection** — QR kód, mikro-text v logu, optické triky na vision model v cestě B | ✅ | Nový vektor, přidán do THREAT-MODEL. Vstup vision modelu je taky nedůvěryhodný. Mitigace: výstup cesty B jde stejným schématem (nemá pole na verdikt), + detekce/flag QR/čárových kódů, + cesta B slouží k detekci a extrakci, ne k rozhodování. |
| O1 1.2 | **EPS/PS objekty, obfuskované glyfy (cmap), XFA/JS-generovaný text** | ✅ | Přidáno jako povinné F0 hraniční testovací případy (DESIGN §13). Obfuskovaný glyf → dual-path mismatch s příčinou „font/cmap", klasifikace přes sémantickou vrstvu. |
| O1 1.1 | **Overfitting detektorů** — kdo sestavuje otrávenou sadu | ✅ | F0: oddělit autora detektorů od autora útoků; held-out sada; externí red-team (DESIGN §13, §15). |

## 2. Provoz — „Conduit" a on-prem runner

| # | Námitka | Verdikt | Reakce / změna |
|---|---|---|---|
| O2 2.1 | **Beelink jako SPOF / sysadmin trap / kapacitní strop** pro B2B SaaS | 🔶 | Věcně správné **pro produkt s SLA a platícími klienty**. Upřesnění rozsahu: současný scope je **interní pilot** (jeden uživatel, bez SLA) — tam je Beelink nejlevnější a plní i tu nejpřísnější variantu (data v ČR). Klíč: **runner je za Conduit rozhraním schválně vyměnitelný** — pilot = Beelink, produkt = **EU cloud VPS (Hetzner eu-central / Finsko)**, bez změny architektury. GDPR vyžaduje EU, ne ČR — „ČR" byla silnější preference, ne povinnost. Rozhodnutí padne na bráně pilot→produkt. Promítnuto do DESIGN §10. |
| O1 7 | **Bus factor jedna** — mitigace je jen konstatování | 🔶 | Pro pilot akceptované riziko (operátor riskuje vlastní čas). Pro produkt: backup operátor / outsourcing provozu → podmínka produktové fáze (DESIGN §15, ne pilotu). |

## 3. Extrakce, JSON, rubrik

| # | Námitka | Verdikt | Reakce / změna |
|---|---|---|---|
| O2 3.1 | **Křehkost `additionalProperties:false`** — drift v 1 poli → celé CV do ERROR → 1/10 selže → nepoužitelné | ✅ | Reálné riziko. Změna: validace je **field-level „soft" s repair passem** — neznámé klíče se *zahodí* (bezpečnostní přínos zůstává, verdikt-pole stejně neexistuje), typy se koercují, chybějící/sporné pole → *flag k review*, ne ERROR celého dokumentu. ERROR jen u neobnovitelného (nečitelný soubor). Promítnuto do DESIGN §7. |
| O2 3.2 | **Deterministický rubrik = slepý Excel** — senior z rozbitého startupu = senior z banky; „Python" v zájmech = „Python" u hlavního architekta | 🔶 | Částečně. Nuance nesídlí v rubriku, ale v **extrakci**: skill nese `level`, `category`, `evidence` a nově **kontext/sekci** → „Python v zájmech" se extrahuje jako `level:basic, context:interest`, ne jako architektův. Rubrik váží podle level+evidence, ne podle holého výskytu. Pro „reálnou kvalitu" (banka vs. startup) slouží **volitelný LLM#2 na měkká kritéria**, zobrazený personalistovi *odděleně* od tvrdého skóre. Determinismus držíme kvůli auditovatelnosti; inteligenci dodává extrakce + LLM#2. Doplněn skill `context` (DESIGN §7). |
| O1 3 | **Rubrik popsán nejméně, chybí plán validace; deterministický ≠ správný** | ✅ | Přijato: rubrik se validuje proti historickým rozhodnutím personalisty (shoda/kalibrace), ne „vypadá rozumně". Kdo píše a jak se aktualizuje = součást F3 (DESIGN §9). |

## 4. Regulatorika — a jeden spor mezi oponenturami

**Zde si O1 a O2 protiřečí a je nutné zaujmout postoj.**

- **O2 4.1** doporučuje *strategický únik z high-risk*: přeznačit produkt na „Data Structuring / Search tool", zrušit skóre, ukazovat jen „splňuje 3 z 5 podmínek", a tím vypadnout z Annexu III.
- **O1 5.3** varuje přesně opačně: čl. 22 GDPR i Annex III se řídí **funkcí, ne názvem** — když člověk jen odklikne návrh, je to *de facto* automatizované rozhodnutí bez ohledu na label.

**Můj postoj (⚖️):** O1 má v jádru pravdu — **relabeling není spolehlivý právní štít**. Nástroj, který pro účely náboru strukturuje CV a ukazuje „splňuje 3 z 5", je stále vstup do hodnocení/filtrování uchazečů; regulátor hodnotí použití, ne marketingový popis. Sázet compliance strategii na reklasifikaci je stejně riskantní jako sázet na odklad účinnosti (před čímž varovala O1).

**Co z toho beru (a je to shodou okolností i lepší produkt):**
1. **UX posun ANO** — nevést jediným „Match 85 %", ale **„splňuje X z Y podmínek + evidence"** a nechat člověka vážit. Snižuje to riziko a je to lepší rozhraní bez ohledu na právo. (Promítnuto: demo `ui/index.html` už vede skóre spolu s breakdownem a evidencí; doplní se prezentace „X z Y podmínek" nad procento.)
2. **Reklasifikaci NEbrat jako plán**, ale jako případný bonus po posouzení právníkem.
3. **Připravit minimální životaschopnou compliance** (DPIA + Annex IV-lite) **před reálnými daty** — což je i O1 doporučení.

| # | Námitka | Verdikt | Reakce |
|---|---|---|---|
| O1 5.1/5.2 | Annex IV a DPIA chybí, jsou povinné před nasazením | ✅ | Přesun z F4 na **před zpracování reálných CV** (pilot). DPIA smí běžet souběžně s F0, pokud F0 jede na syntetických/souhlasných vzorcích. (DESIGN §15, AI-ACT.md) |
| O1 5.3 | čl. 22 řešen jen formálně — „gumové razítko" | ✅ | Doplnit **měřitelné** mechanismy reálného dohledu: minimální čas review, povinný komentář u rozhodnutí, randomizované audity shody s nezávislým posudkem. (AI-ACT.md) |
| O2 4.1 | Únik z high-risk přeznačením | ⚖️ | Viz výše — UX ano, právní štít ne. Rozhodnout s právníkem. |

## 5. Ekonomika a obchod

| # | Námitka | Verdikt | Reakce |
|---|---|---|---|
| O2 5.1 | 1,5–3,5 Kč/CV; 5000 CV ≈ 10–17,5k Kč/měs variabilní; stravitelnost pro CZ SMB | ✅ | Konzistentní s odhadem v oponentuře (§8.4: ~0,7–3,7 Kč/CV). Kaskáda (Workers AI free-tier hrubá práce) snižuje spodní hranici. Skutečnou cenu/CV a **podíl vision fallbacku měřit ve F0**; ekonomika jako **TCO/rok** vč. času provozovatele. (DESIGN §11) |
| O1 4 | Odhady jsou jen řádové; chybí TCO a podíl vision | ✅ | Viz výše — TCO + měření vision poměru ve F0. |
| O1 6 / O2 verdikt | Rešerše není systematická; ověřit trh na reálných HR | 🔶 | Systematický přehled komerčních ATS = relevantní pro **produktové** go/no-go, ne pro pilot (uzavřený SaaS stejně padá na on-prem+čeština+auditovatelnost, kterou operátor kontroluje). Přidán **pre-F1 krok: pohovory s ~10 CZ HR manažery** (DESIGN §13). |

---

## Souhrn změn promítnutých do návrhu

- **DESIGN §7** — soft/field-level validace (ne whole-doc ERROR) + skill `context/sekce`.
- **DESIGN §8** — dual-path jako doplňkový, gated přes injection klasifikátor; delta-E na same-contrast.
- **DESIGN §10** — runner vyměnitelný za Conduit: Beelink (pilot) ↔ EU cloud VPS/Hetzner (produkt).
- **DESIGN §11** — TCO + měření vision poměru.
- **DESIGN §13** — F0 tvrdší: held-out sada, externí red-team, hraniční vektory, FP na grafických CV; pre-F1 market validace.
- **DESIGN §15** — otevřené otázky: OCR engine, rubrik validace, DPIA/Annex IV před daty, bus factor produktu.
- **docs/AI-ACT.md** — DPIA/Annex IV před reálnými daty; měřitelný lidský dohled; poznámka k reklasifikaci.
- **docs/THREAT-MODEL.md** — same-contrast, alert fatigue/grafická CV, visual injection (QR/mikro-text), strict-JSON.

## Co zůstává jako rozhodnutí provozovatele

1. **Interní pilot vs. produkt** — určuje runner (Beelink/VPS), bus-factor mitigaci i hloubku compliance.
2. **Reklasifikace mimo high-risk** — jen po právním posouzení; nestavět na tom.
3. **Hodnotová teze** — po market validaci: „ochrana proti injection" vs. „prostě bezpečný parser CV do tabulky".
