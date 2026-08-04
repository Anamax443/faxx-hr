# AI Act & GDPR — regulatorní pozice faxx-hr

> 🇨🇿 Čeština · [🇬🇧 English](AI-ACT.en.md)

> Orientační pracovní přehled, ne právní stanovisko. Konkrétní data účinnosti a
> odklady AI Act jsou pohyblivé — ověřit u aktuálního znění / právního poradce.
> Návrh se na odklad nespoléhá. GDPR a antidiskriminace platí bez ohledu na AI Act.

## Klasifikace

Nábor a výběr kandidátů = **Nařízení EU 2024/1689 (AI Act), Annex III, bod 4 =
vysoce rizikový systém** — bez ohledu na velikost provozovatele. Klasifikace se
váže na účel, ne na míru automatizace: i decision support je high-risk.

**Provider vs. deployer:** u interního pilotu je sólo operátor obojím (nejnáročnější
varianta). U produktu pro cizí HR se role štěpí (provider = plný QMS, posouzení
shody, CE, registrace; deployer = informování dotčených, dohled v provozu).

## Mapování povinností (čl. 9–15) na návrh

| Článek | Povinnost | Prvek faxx-hr | Stav |
|---|---|---|---|
| 9 | Systém řízení rizik | Oddělení extrakce/hodnocení, rubrik jako mitigace | částečně (chybí formální proces) |
| 10 | Data governance / bias | Split identity/qualification/sensitive; sensitive se neskóruje | z větší části |
| 11 + Annex IV | Technická dokumentace | Architektura, rubrik, audit — jako podklad | chybí samostatný dokument |
| 12 | Automatické logy | `audit_log` append-only | splněno |
| 13 | Transparentnost k provozovateli | Evidence kotvy, review UI | z větší části |
| 14 | Lidský dohled | Decision support + `decisions` (záznam lidského rozhodnutí) | splněno návrhem |
| 15 | Přesnost, robustnost, kyberbezpečnost | Deterministický rubrik + bezpečnostní vrstva proti injection | částečně (chybí pen-test) |
| 50 | Transparentnost k uživateli | Informovat uchazeče o AI-asistovaném hodnocení | chybí formálně |

## GDPR

- **Čl. 22** (lidský zásah) → decision support; přezkum musí být **skutečný** (funkce > název — relabeling na „search tool" NENÍ spolehlivý štít). Měřitelné mechanismy: min. čas review, povinný komentář u rozhodnutí, randomizované audity shody. UX: vést „splňuje X z Y podmínek + evidence", ne jediné „85 %".
- **Čl. 35 (DPIA)** — u profilování uchazečů prakticky povinná. **Před zpracováním reálných CV** (před pilotem, ne až F4); smí běžet souběžně s F0 na syntetických/souhlasných vzorcích. Sdílí obsah s Annexem IV.
- **Minimalizace + retence** (`retention_days` per zadání), právní tituly (čl. 6 opatření před smlouvou), práva subjektu (přístup, výmaz, vysvětlení).

## Antidiskriminace

Chráněné znaky se do skórování nedostanou (datově vynuceno). Reziduální riziko:
proxy (jméno školy, mezera v kariéře). Mitigace: periodické testování férovosti +
explicitní instrukce nezohledňovat korelující signály.

## NIS2 + CRA (laťka provozovatele)

Řízení přístupu, logování + integrita (hašové řetězení audit_logu), incident response,
SBOM + řízení zranitelností, bezpečné aktualizace.

## Praktický princip

**Nikdy automatické zamítnutí.** Aplikace = decision support. Stavět podle standardu
high-risk už teď; případný odklad = rezerva na dokumentaci, ne důvod odkládat návrh.
