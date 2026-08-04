# 8 · Deterministický rubrik a skórování

> Tato kapitola popisuje **jádro fáze F3** — kód, který počítá skóre a pořadí
> kandidátů. Klíčové tvrzení: skóre **nepočítá model, ale pevný vzorec** nad
> strukturovanými fakty z extrakce. Rozebíráme šest typů kritérií i s výpočty,
> proč je gate na minimum let praxe defaultně vypnutý, jak fungují evidence kotvy
> a proč „reprodukovatelné" ještě neznamená „správné". Registr je oponentní:
> ukazujeme i to, co zbývá dokázat.

Zdrojový soubor: [`worker/src/rubric.ts`](../../worker/src/rubric.ts), spotřeba a
editor v [`worker/src/app.ts`](../../worker/src/app.ts).

> **AKTUALIZACE (2026-08-04):** k tvrzení „skóre počítá kód, ne model" přibyly dvě věci, které tuto
> kapitolu posilují. (1) **Pohledové hodnocení** — výsledek lze číst jako stavy `● silná / ◐ částečná /
> ○ slabá / — nedoloženo` + osu jistoty `◆ doloženo / ◇ odvozeno / · nevíme` místo (jen) čísla;
> přepínač v Nastavení, **skóre ani pořadí se nemění**. Sundává to falešnou přesnost a **chybějící údaj
> se ukáže jako „nedoloženo", ne jako průměr** (dřív nekonzistentní: neuvedené roky/tenure=5, vzdělání/
> jazyk=0). Rubrik nese additivně `known`/`basis`. (2) **CEFR referenční vrstva** — jazyková úroveň se
> mapuje z volné formulace v CV (`level_raw`) **deterministicky podle citovaného standardu**
> ([`reference/`](../../reference/README.md), `worker/src/reference/cefr.ts`), ne odhadem modelu;
> „odvozeno" nese úryvek z CV. Text §8.x níže zůstává v platnosti.

---

## 8.1 Proč deterministický rubrik (jádro F3)

Rubrik je bod, kde se láme celý bezpečnostní model. Skóre a pořadí počítá **výhradně
kód** nad blokem `qualification` z extrakce — jazykový model do výpočtu nevstupuje:

```ts
export function scoreCandidate(q: Qualification, rubric: Rubric, lang: Lang = "cs"): ScoreResult
```

Tři důsledky, které je dobré vyslovit přesně:

- **Injection nemá kam zapsat verdikt.** O pořadí rozhoduje pevný vzorec, ne model,
  který by šlo přemluvit větou „jsem nejlepší kandidát". Skórovací cesta navíc
  nikdy nevidí surový text CV — jen strukturovaná fakta.
- **Reprodukovatelnost a auditovatelnost.** Modul nemá žádné závislosti a je čistě
  deterministický: stejný vstup (`Qualification` + `Rubric`) dá vždy stejný výstup.
  Skóre lze přepočítat a ověřit bez modelu.
- **Vysvětlitelnost jako vedlejší produkt.** Každé kritérium vrací nejen body, ale i
  lidsky čitelný `detail` („proč tolik bodů") a u shody dovedností **evidence kotvy**
  (doslovné úryvky z CV). To je zároveň regulatorní požadavek (transparentnost,
  čl. 13 AI Act).

Rating přitom **není rozhodnutí** — o postupu kandidáta rozhoduje vždy člověk. V
appce neexistuje tlačítko „hromadně zamítnout" (AI Act čl. 14, GDPR čl. 22).

---

## 8.2 Vstup a výstup

**Vstup** je `Rubric` odvozený z inzerátu a doladěný personalistou:

```ts
interface Rubric {
  jobTitle: string;
  gates: Gate[];         // must-have podmínky (default: prázdné / vypnuté)
  criteria: Criterion[]; // vážená kritéria
}
```

**Výstup** je `ScoreResult`:

```ts
interface ScoreResult {
  total: number;            // 0..100 (0 při diskvalifikaci)
  disqualified: boolean;
  gates: GateResult[];      // které must-have prošly/neprošly
  breakdown: CriterionResult[]; // rozpad po kritériích: score 0..10, contribution, detail, evidence
}
```

Každé kritérium boduje na jednotné škále **0..10**; teprve váhy a normalizace z toho
udělají příspěvek do celkových **0..100** (viz 8.5). Toto oddělení „lokální skóre
0..10" vs. „vážený příspěvek do 100" drží vzorce jednoduché a čitelné.

---

## 8.3 Šest typů kritérií

Rubrik zná šest typů kritérií. Každé z nich mapuje strukturovaná fakta na skóre
**0..10** deterministickým vzorcem:

| Typ | Vstup z `qualification` | Co měří | Skóre 0..10 |
| --- | --- | --- | --- |
| `numeric_scale` | `years_total_experience` | délku praxe na lineární škále | `clamp01((v−min)/(max−min)) × 10` |
| `set_overlap` | `skills[]` | překryv s požadovanými dovednostmi | `|hit| / |req| × 10` |
| `category_map` | `education[]` | úroveň vzdělání dle mapy | `max` nebo `avg` z namapovaných úrovní |
| `cefr_map` | `languages[]` | jazykovou úroveň (CEFR) | `max(map[úroveň])` pro daný jazyk |
| `tenure` | `experience[].months` | stabilitu (průměrné setrvání) | lineárně mezi `floor` a 24 měsíci |
| `bonus` | `certifications[]` | počet certifikací (bonus) | `min(n × pointsEach, cap)` |

### `numeric_scale` — délka praxe

```text
raw = years_total_experience
raw není číslo   →  score = 5      (neutrální, BEZ penalizace)
jinak            →  score = clamp01((raw − min) / (max − min)) × 10
                    (min ?? 0, max ?? 10)
```

Lineární škála mezi `min` (0 bodů) a `max` (10 bodů). Zásadní je větev „raw není
číslo → 5": chybějící roky se **neutralizují**, nediskvalifikují ani nenulují (viz
8.4.1).

### `set_overlap` — překryv dovedností

```text
req   = normalizované požadované dovednosti
have  = normalizované dovednosti kandidáta
hit   = { r ∈ req | ∃ h ∈ have : h == r  ∨  h obsahuje r  ∨  r obsahuje h }
score = |req| > 0 ? (|hit| / |req|) × 10 : 0
```

Normalizace (`norm`) sundá diakritiku a case, takže „C++" ~ „c++", „Angličtina" ~
„anglictina". Match je **substringový v obou směrech** — „react" matchne „React.js"
i naopak. To je vědomě benevolentní: raději shodu uznat, než ji minout kvůli
formátu. `detail` vypíše i chybějící dovednosti („chybí: …"), takže personalista
vidí, co kandidátovi schází.

> Cena benevolence: substring může dát **falešnou shodu** (požadavek „go" by
> matchnul „mongodb", „django"). Je to známý kompromis; ostřejší tokenizace je
> možné zlepšení, dnes vsázíme na to, že požadavky píše personalista rozumně.

### `category_map` — vzdělání

```text
levels = [ map[norm(level)] pro každé vzdělání ]   (neznámý level → 0)
levels prázdné  →  score = 0  ("bez uvedeného vzdělání")
aggregate=="avg"→  score = průměr(levels)
jinak (default) →  score = max(levels)
```

Mapa `map` přiřazuje každé úrovni body 0..10 (např. `secondary:4, bachelor:7,
master:9, phd:10`). Default agreguje **maximem** (bere nejvyšší dosažené vzdělání);
`avg` je volitelný.

### `cefr_map` — jazyk

```text
want  = c.language (např. "en")
langs = jazyky kandidáta odpovídající want
        (shoda přes normalizaci; "en" chytá i "anglictina"/"english")
pts   = [ map[úroveň.toUpperCase()] ]   (neznámá úroveň → 0)
score = pts prázdné ? 0 : max(pts)
```

Bere nejvyšší úroveň požadovaného jazyka a mapuje ji dle CEFR (např. `B2:7, C1:9,
C2:10, native:10`). Chybějící jazyk = 0.

### `tenure` — stabilita

```text
months = délky pozic, kde je months číslo
months prázdné  →  score = 5   (neutrální)
avg    = průměr(months)
floor  = penaltyBelowMonths ?? 6
score  = clamp01((avg − floor) / (24 − floor)) × 10
```

Interpretace: průměrné setrvání ≤ `floor` měsíců → 0 bodů (job-hopping), ≥ 24 měsíců
→ 10 bodů, mezi lineárně. Chybějící data o délce pozic → neutrálních 5 (netrestá se
za to, co v CV nebylo).

### `bonus` — certifikace

```text
n     = počet certifikací
score = min(n × (pointsEach ?? 2), cap ?? 10)
```

Prostý bonus: každá certifikace přidá body až do stropu. Default 2 body/kus, strop
10.

> Pozn.: `numeric_scale`, `tenure` a `cefr_map` mají jako fallback specifické
> hodnoty (5, 5, 0). Neutrální 5 znamená „nevíme, netrestáme"; 0 u `cefr_map`
> znamená „požadovaný jazyk chybí", což je věcné zjištění, ne chybějící data.
> Rozdíl je záměrný a je vidět v `detail`.

---

## 8.4 Must-have gates

Gates jsou tvrdé podmínky (must-have), které kandidáta buď propustí, nebo
diskvalifikují:

```ts
interface Gate { key: string; field: string; op: ">="|">"|"<="|"<"|"=="; value: number; reason: string }
```

Vyhodnocení má jeden zásadní detail — **benefit of the doubt u chybějícího údaje**:

```ts
const raw = getField(q, g.field);
const v   = isNum(raw) ? raw : null;
// Neznámý údaj NEDISKVALIFIKUJE — vyřadí jen když reálně víme, že je pod limitem.
const passed = v == null ? true : gateEval(v, g.op, g.value);
```

Když `total` skončí na 0 a `disqualified: true`, kandidát se v ranku řadí až za
všechny nediskvalifikované (`rankCandidates`). Diskvalifikace je tedy měkká v tom
smyslu, že kandidát **nezmizí** — jen klesne na konec s vysvětlením, který gate a
proč neprošel (`reason`). Personalista to vidí a rozhoduje sám.

### 8.4.1 Proč je gate na minimum let praxe defaultně VYPNUTÝ

Nejcitlivější rozhodnutí celého rubriku: **gate „minimum let praxe" je ve výchozím
stavu vypnutý** (pole `gates` je defaultně prázdné). Důvod je čistě empirický a
poctivý:

1. **Roky praxe se z CV spolehlivě nevytáhnou.** `years_total_experience` je jedno z
   nejhůř extrahovatelných polí — kandidáti ho často neuvádějí explicitně a jeho
   dopočet z jednotlivých pozic je nespolehlivý. 8B model tu chybuje nejčastěji.
2. **Neznámé ≠ nedostatečné.** Kdyby gate běžel a chybějící roky bral jako „nesplněno",
   diskvalifikoval by kandidáty jen za to, že extrakce roky nenašla — což je chyba
   nástroje, ne kandidáta. To by bylo diskriminační a věcně špatné.
3. **Proto raději neutrální než diskvalifikační.** Neznámé roky se v `numeric_scale`
   bodují neutrální **5/10** (nesnižují ani nezvyšují), a gate na roky je defaultně
   vypnutý. Zapne se **jen tehdy**, když personalista vědomě chce tvrdý filtr a
   akceptuje, že chybějící údaj kandidáta nevyřadí (gate diskvalifikuje jen když
   `v` je *známé číslo* pod limitem).

Tohle je ukázka celkové filozofie: **nástroj netrestá za to, co nevytáhl.** Tvrdé
vyřazení je vyhrazeno pro případy, kdy reálně *víme*, že podmínka není splněna — ne
pro mezery v datech.

---

## 8.5 Normalizace vah a total 0..100

Váhy kritérií se nemusí sčítat přesně na 1 — **normalizují se za běhu**:

```text
wsum          = Σ weight   (nebo 1, když je součet 0)
contribution_i = (weight_i / wsum) × score_i × 10
total          = disqualified ? 0 : Σ contribution_i
                 → zaokrouhleno na 1 desetinné místo, rozsah 0..100
```

Protože `score_i ∈ [0,10]` a `Σ (weight_i / wsum) = 1`, je maximum `total` právě
**100** (všechna kritéria na 10) a minimum 0. Normalizace vahami znamená, že
personalista může váhy zadat v libovolném měřítku (procenta, body 1–5, cokoli) a
poměr mezi nimi zůstane zachován — nemusí hlídat, že součet dá přesně 1. Při
diskvalifikaci se `total` tvrdě nuluje.

**Ilustrativní výpočet.** Rubrik se třemi kritérii, váhy 3 / 2 / 1 (`wsum = 6`):

| Kritérium | Váha | Skóre 0..10 | Příspěvek `(w/wsum)×score×10` |
| --- | --- | --- | --- |
| Dovednosti (`set_overlap`) | 3 | 8,0 | `(3/6)×8×10 = 40,0` |
| Vzdělání (`category_map`) | 2 | 9,0 | `(2/6)×9×10 = 30,0` |
| Certifikace (`bonus`) | 1 | 6,0 | `(1/6)×6×10 = 10,0` |
| **Total** | | | **80,0 / 100** |

Kdyby stejný kandidát neprošel byť jediným gate, `total` by bylo tvrdě 0 a v ranku by
klesl za všechny nediskvalifikované — příspěvky se v tom případě vůbec nesčítají.

---

## 8.6 Rozpad po kritériích s evidencí

Výstup není jen číslo — každý kandidát nese **rozpad po kritériích** (`breakdown`):

```ts
interface CriterionResult {
  key: string; label: string; weight: number;
  score: number;          // 0..10
  contribution: number;   // příspěvek do total (0..100)
  detail: string;         // lidsky čitelně, PROČ tolik bodů
  evidence?: EvidenceItem[]; // doslovné kotvy z CV (u shody dovedností)
}
```

V UI se rozpad zobrazí po kliknutí na „breakdown": u každého kritéria je počet bodů,
`detail` (např. „3/5 klíčových dovedností (chybí: Kubernetes, Terraform)"), a u shody
dovedností navíc evidence kotvy. Diskvalifikovaní mají navíc řádek „Diskvalifikováno:
…" s důvody gate. Rozpad je i v manažerském tiskovém výstupu, takže rozhodnutí je
doložitelné mimo appku.

Pořadí kandidátů určuje `rankCandidates`: nejdřív se rozdělí na nediskvalifikované a
diskvalifikované (ti vždy na konec), uvnitř každé skupiny se řadí podle `total`
sestupně. Řazení je stabilní a deterministické — při shodě skóre zůstává vstupní
pořadí. `detail` a `evidence` u každého kritéria dělají z „pořadí" doložitelný
**rozhodovací podklad**, ne neprůhledné číslo: to je přímé naplnění požadavku na
transparentnost a lidský dohled (AI Act čl. 13 a 14) — personalista vidí *proč* je
kandidát tam, kde je, a rozhoduje sám.

---

## 8.7 Evidence kotvy — grep, ne model

Evidence kotvy jsou nejsilnější vysvětlovací prvek a stojí za přesný popis, protože
právě tady se snadno chybuje představou, že „to vypsal model".

**Kotvy vytváří deterministický grep nad viditelným textem, ne model.** V `app.ts`
se po extrakci pro každou dovednost dohledá doslovný úryvek:

```ts
for (const sk of qual.skills ?? [])
  if (!sk.evidence) { const e = snippetFor(sk.name, visible); if (e) sk.evidence = e; }
```

Funkce `snippetFor` je prostý case-insensitive `indexOf` nad viditelným textem s
oknem ±45 znaků:

```ts
function snippetFor(needle, text, radius = 45) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return null;                        // není v textu → žádná kotva
  return "…" + text.slice(i-radius, i+needle.length+radius).replace(/\s+/g," ").trim() + "…";
}
```

Rubrik pak v `set_overlap` **surfacuje jen ty kotvy, které zároveň matchují bodovaný
požadavek**:

```ts
const evidence = skills
  .filter((sk) => sk.evidence && matchesReq(sk.name))
  .map((sk) => ({ label: sk.name, text: sk.evidence }));
```

Proč je to důležité:

- **Nedá se halucinovat.** Kotva existuje jen tehdy, když se název dovednosti v
  textu doslova vyskytuje (`indexOf ≥ 0`). Model nemá jak úryvek vymyslet — pochází
  z téhož viditelného textu, který prošel extrakcí.
- **Sedí na `qualification`.** Kotva se zobrazí jen u dovednosti, která zároveň
  reálně matchuje požadavek z rubriku. Vysvětlení „proč body za dovednosti" je tedy
  navázané na skutečný text CV, ne na tvrzení modelu.
- **Auditovatelnost.** Personalista (i pozdější auditor) vidí *přesně kde* v CV
  dovednost je. To je konkrétní naplnění požadavku na transparentnost a
  přezkoumatelnost rozhodnutí.

> Limit, který je fér přiznat: kotva je jen textové okno kolem prvního výskytu
> názvu, bez kontextového posouzení. „Python" v sekci zájmů dostane kotvu stejně
> jako „Python" u hlavní role — grep nerozlišuje kontext. Rozlišení
> kontextu/sekce (skill v zájmech ≠ u role) je v kanonickém schématu předvídané
> (`category`/kontext), ale v evidenci zatím nevyužité. Kotva dokládá *výskyt*,
> ne *váhu* výskytu.

---

## 8.8 Editor rubriku

Rubrik není zadrátovaný — personalista ho v appce edituje:

- **Vypínání kritérií.** Jednotlivá kritéria (i gates) lze zapnout/vypnout, takže
  rubrik se přizpůsobí konkrétní pozici (např. u juniorní role vypnout `tenure`).
- **Šablony pozic v `localStorage`.** Nastavené rubriky se ukládají jako šablony
  lokálně v prohlížeči (nástroj je bezstavový, bez DB — „chudá perzistence").
  Šablonu pozice tak lze znovu použít bez opětovného nastavování.
- **Export / Import JSON.** Celý rubrik (i výsledek) jde exportovat a importovat
  jako JSON. To umožňuje sdílet rubrik mezi personalisty, verzovat ho mimo appku a
  reprodukovat hodnocení jinde.

> Poctivě: `localStorage` a JSON export je „chudá perzistence" — přežije refresh
> prohlížeče, ale není to sdílená DB se stavem dávky ani audit trail. Plná
> perzistence (D1/R2, stav kandidáta osloven/postupuje/odmítnut, append-only audit
> log) je backlog, ne hotová vlastnost. Kdo rubrik píše (personalista se šablonou
> vs. správce) a jak se schvaluje, je rovněž otevřená otázka fáze F3.

---

## 8.9 Přepočet bez AI (rescore)

Zásadní vlastnost pro provoz i pro determinismus: **přepočet skóre neběží přes AI.**
Když personalista změní gate, váhy nebo požadované dovednosti a znovu spustí
hodnocení nad stejnými soubory (endpoint `/api/rescore`), skóre se pouze
**přepočítá** z už extrahovaných dat — nová extrakce (drahá AI) se neopakuje.

Důsledky:

- **Okamžité a zdarma.** Ladění vah je interaktivní; nespotřebovává neurony ani
  nečeká na model.
- **Nová extrakce jen při skutečné změně.** Extrakce se spustí, jen když se změní
  *soubory*, *model* nebo *instrukce* (per-dokument cache extrakce, klíčovaná
  obsahem). Nezměněné soubory se znovu neextrahují.
- **Determinismus rescoringu je úplný.** Na rozdíl od extrakce (kde 8B kolísá) je
  přepočet nad daným extrahovaným JSON bit-deterministický — stejná data + stejný
  rubrik = stejné skóre, vždy.

---

## 8.10 Reprodukovatelnost — a poctivě „reprodukovatelné ≠ správné"

Rubrik je reprodukovatelný a auditovatelný: bez závislostí, čistě funkční, `total`
zaokrouhlený, rozpad doložený kotvami. Pro daný `Qualification` + `Rubric` dá vždy
stejný výsledek. To je regulatorně cenné — rozhodovací podklad je přezkoumatelný.

**Ale reprodukovatelné ≠ správné.** Tohle je nejdůležitější věta celé kapitoly pro
kritického oponenta:

- **Reprodukovatelnost** říká jen, že *stejný vstup dá stejný výstup*. Neříká nic o
  tom, zda *váhy a vzorce odpovídají tomu, jak by dobrý personalista skutečně
  hodnotil*. Rubrik, který konzistentně preferuje špatné kandidáty, je pořád
  dokonale reprodukovatelný.
- **Validace vah proti realitě zatím chybí.** Rubrik se má kalibrovat proti
  **historickým rozhodnutím personalisty** — porovnat pořadí z rubriku s tím, koho
  personalista v minulosti reálně posunul dál, a váhy podle toho doladit. Tahle
  validace **není hotová**; dnešní váhy jsou „vypadají rozumně", ne „empiricky
  kalibrované".
- **Determinismus je až za extrakcí.** Jak bylo řečeno v 7.8.2, vstup do rubriku
  (extrahovaná fakta) není bit-deterministický, když ho plní 8B. „Reprodukovatelné
  skóre" tedy platí pro daný extrahovaný JSON, ne nutně pro dvojí extrakci téhož
  souboru.

Otevřené body fáze F3, které oponentura nemá zastírat:

1. **Kalibrace vah** proti historickým rozhodnutím personalisty (zbývá).
2. **Governance rubriku** — kdo ho píše, kdo schvaluje, jak se aktualizuje ze
   zpětné vazby pilotu.
3. **Substring match** v `set_overlap` může dávat falešné shody (ostřejší
   tokenizace = možné zlepšení).
4. **Evidence kotva** dokládá výskyt, ne kontext/váhu výskytu.
5. **Plná perzistence a audit trail** (D1/R2, stav kandidáta) je backlog; dnes jen
   `localStorage` + JSON export.

Rubrik je tedy solidní, deterministické a vysvětlitelné **jádro** — ale jádro, jehož
*správnost* (na rozdíl od *konzistence*) je teprve třeba doložit měřením proti
realitě. To je poctivý stav F3: ověřený mechanismus, nedoměřená kalibrace.
