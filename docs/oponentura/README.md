# faxx-hr — Dokumentace pro oponenturu

> Technicko-regulatorní dokumentace projektu **faxx-hr** (pracovní název) — HR nástroj
> pro hodnocení životopisů proti pracovnímu inzerátu s obranou proti prompt injection.
> Určeno **kritickému oponentovi** (technický garant / investor / regulatorní posudek).
>
> **Verze dokumentu:** 2026-08-04 · odpovídá stavu repozitáře na commitu `27a110a` (main).
> **Jazyk:** čeština. **Rozsah:** ~100 stran (17 kapitol).

---

## Účel a jak číst

Tento dokument shrnuje **záměr, návrh, implementaci, bezpečnostní model, regulatorní
analýzu a poctivé vyhodnocení** projektu faxx-hr tak, aby ho mohl nezávislý oponent
kriticky posoudit. Klade důraz na:

- **jak to funguje a proč** (architektura, detekce skrytého obsahu, extrakce, deterministické skórování),
- **je to bezpečné a právně obhajitelné** (threat model, EU AI Act, GDPR),
- **kde jsou slabá místa** (co je jen prototyp, co je nedoměřené, co zbývá) — dokument
  je záměrně **poctivý o limitech**, netvrdí hotové, co je rozpracované.

Doporučené pořadí čtení pro oponenta: kapitoly 1–4 (rámec a princip) → 5–8 (jádro) →
9–10 (bezpečnost a regulatorika) → 11–12 (implementace a co je skutečně ověřené) →
13–16 (náklady, rizika, roadmapa, odpovědi na námitky) → 17 (přílohy).

> **Poznámka k rozsahu:** faxx-hr je **pracovní verze / pilot v přípravě**, ne hotový
> certifikovaný produkt. Klíčová vstupní brána (F0 — benchmark detekce na nezávislé
> held-out sadě) zatím **není uzavřená**; viz kapitola 12.

---

## Celý dokument v jednom souboru

📄 **[OPONENTURA-FULL.md](OPONENTURA-FULL.md)** — všech 17 kapitol v jednom souvislém dokumentu
(~100 stran) s obsahem a page-break pro tisk do PDF (otevři → Tisk → Uložit jako PDF).
Níže je rozpad po jednotlivých kapitolách.

## Obsah (po kapitolách)

| # | Kapitola | Soubor |
|---|----------|--------|
| 1 | Úvod a manažerské shrnutí | [01-uvod.md](01-uvod.md) |
| 2 | Problém a hrozba (prompt injection v CV) | [02-problem.md](02-problem.md) |
| 3 | Cíle, scope a požadavky | [03-cile-scope.md](03-cile-scope.md) |
| 4 | Klíčový návrhový princip (oddělení extrakce od hodnocení) | [04-princip.md](04-princip.md) |
| 5 | Architektura systému | [05-architektura.md](05-architektura.md) |
| 6 | Detekce skrytého obsahu | [06-detekce.md](06-detekce.md) |
| 7 | Extrakce a strukturovaná data | [07-extrakce.md](07-extrakce.md) |
| 8 | Deterministický rubrik a skórování | [08-rubrik.md](08-rubrik.md) |
| 9 | Bezpečnostní model a threat model | [09-threat-model.md](09-threat-model.md) |
| 10 | Regulatorika (EU AI Act + GDPR) | [10-regulatorika.md](10-regulatorika.md) |
| 11 | Implementace a nasazení | [11-implementace.md](11-implementace.md) |
| 12 | Vyhodnocení a validace | [12-validace.md](12-validace.md) |
| 13 | Náklady a provoz | [13-naklady.md](13-naklady.md) |
| 14 | Omezení, rizika a otevřené otázky | [14-omezeni.md](14-omezeni.md) |
| 15 | Roadmapa | [15-roadmapa.md](15-roadmapa.md) |
| 16 | Anticipované námitky a diskuse | [16-oponentura-diskuse.md](16-oponentura-diskuse.md) |
| 17 | Přílohy | [17-prilohy.md](17-prilohy.md) |

---

## Klíčový invariant (shrnutí)

Skórovací cesta **nikdy nevidí surový text CV**. Pipeline: **detekce** (viditelný/skrytý
split + vlajkování skrytého obsahu) → **LLM #1** (jen viditelný text → pevné JSON schéma
bez pole „skóre") → **deterministický rubrik** v kódu (skóre + pořadí). Rating je **podpora
rozhodnutí, ne automat** — postup kandidáta dělá vždy člověk (EU AI Act čl. 14, GDPR čl. 22).

## Zdroje pravdy v repozitáři

Tato dokumentace je syntézou pracovních dokumentů projektu; při rozporu mají přednost
zdrojové soubory a kód: [`../../DESIGN.md`](../../DESIGN.md), [`../../HANDOFF.md`](../../HANDOFF.md),
[`../AI-ACT.md`](../AI-ACT.md), [`../THREAT-MODEL.md`](../THREAT-MODEL.md),
[`../DETECTOR-V2.md`](../DETECTOR-V2.md), [`../PDF-BOUNDARY-MATRIX.md`](../PDF-BOUNDARY-MATRIX.md),
[`../../worker/src/`](../../worker/src/), [`../../detector/`](../../detector/), [`../../schema/`](../../schema/).

> Dokument neobsahuje žádné tajnosti (API klíče, hesla, tokeny, credentials) — repozitář je veřejný.
