# 11 · Implementace a nasazení

> Kapitola popisuje **skutečně existující kód** (`worker/src/*.ts`, `detector/*.py`),
> ne cílovou architekturu z [`DESIGN.md`](../../DESIGN.md). Kde je něco jen prototyp,
> nezapojené nebo obejité kvůli omezení runtime, je to v textu **explicitně** označeno.
> Registr je psán pro kritického oponenta, který hledá slabá místa — proto se nezamlčuje,
> co chybí.

---

## 11.1 Runtime: Cloudflare Workers na edge

Aplikace běží jako **Cloudflare Worker** — kód v TypeScriptu se bundluje (esbuild uvnitř
wrangleru) do jediného modulu, který se nasadí do V8 isolatu na edge (`workerd`), ne do
Node.js procesu. To je zásadní architektonické rozhodnutí s důsledky, které prostupují
celou implementaci a které oponent musí brát v úvahu:

- **Žádný perzistentní filesystém, žádný dlouhoběžící proces.** Worker je funkce
  `fetch(req, env)`, která žije po dobu requestu. Odtud plyne celý model „chudé
  perzistence" (§11.4) — bez připojené databáze nemá kam ukládat stav mezi requesty.
- **Omezený CPU-čas a paměť na request.** Dávkové zpracování mnoha CV proti limitům
  Workeru je otevřené riziko (viz [`DESIGN.md`](../../DESIGN.md) §11, „velké dávky vs.
  limity CPU/času") — dnes se mírní tím, že extrakce běží sekvenčně a streamovaně
  (§11.3), ale strop nasazení pro opravdu velké dávky **není změřen**.
- **workerd ≠ Node.** Několik knihoven, které v Node fungují, ve `workerd` padá. To není
  teorie, ale zdokumentované zkušenosti z vývoje:
  - `pdf.js` / `unpdf` padá při evalu modulu na `_isSameOrigin` — i s `nodejs_compat`
    a stuby. Proto se PDF na edge **nečte přes pdf.js**, ale přes Cloudflare Workers AI
    `toMarkdown` (běží na CF infrastruktuře) + ruční `fflate` FlateDecode fallback.
  - `DecompressionStream` dekompresi ZIP/Flate streamů ve `workerd` tiše shazoval
    (v Node fungoval) → přešlo se na `fflate` `unzlibSync`.

> **Poučení pro oponenta:** „běží to na edge" tu neznamená pohodlí, ale řadu tvrdých
> omezení, kolem kterých je kód postavený. Hloubková PDF diagnostika (proč je text
> skrytý — barva, render mode, XFA) se **záměrně** deleguje na on-prem runner
> (`detector/*.py`, PyMuPDF), protože na edge není k dispozici (§11.2).

AI je na platformě dostupné přes **AI binding** (`"ai": { "binding": "AI" }` ve
`wrangler.app.jsonc`) — Worker volá Cloudflare Workers AI (default `@cf/meta/`
`llama-3.1-8b-instruct-fp8`) bez odchozího HTTP na cizí API. Přepnutí na Claude je
připravené jako volba, ale **vyžaduje API klíč, který zatím není nastaven** — health i
evaluate na `claude*` modelu vrací řízenou chybu „vyžaduje API klíč", ne pád.

Volání modelu je z pohledu runtime **subrequest** a naráží na dvě omezení, která oponent
musí započítat do provozní úvahy:

- **Denní rozpočet neuronů.** Free Workers AI má **10 000 neuronů/den** (reset půlnoc
  UTC). Vyčerpání → chyba `4006` → extrakce/derive/OCR selžou. Appka to **hlásí**
  (stavová lišta z `/api/health` + červený banner ve výsledcích s `extract_error`)
  místo tichých prázdných výsledků. `/api/rescore`, cache a import kvótu **nežerou**.
  Reálný provoz = Workers Paid nebo Claude — dnešní stav je pilotní.
- **Latence a sériovost.** Model běží řádově sekundy na CV (8B ~7–16 s), takže dávka je
  z podstaty sériová a streamovaná (§11.3). Strop pro opravdu velké dávky vůči CPU/času
  Workeru **není změřen** — je to explicitní backlog položka, ne vyřešená věc.

---

## 11.2 Moduly `worker/src` + on-prem detektor

Kód je rozdělený tak, aby **skórovací cesta nikdy neviděla surový text CV** (klíčový
invariant celého projektu). Oddělení modulů kopíruje hranice důvěry:

| Modul | Odpovědnost | Hranice důvěry |
|---|---|---|
| `app.ts` | Appka (HTML stránka + inline JS), routování endpointů, i18n, seskupení dokumentů do kandidáta-osoby, orchestrace detekce→extrakce→rubrik | Vstupní bod; drží invariant „hidden nejde do AI" |
| `detect.ts` | Viditelný/skrytý split + vlajkování (DOCX plná v2, PDF přes `toMarkdown` + `fflate` fallback); sdílí s `upload.ts` | Rozhoduje, co je *viditelný text* (jediný vstup do LLM #1) |
| `extract.ts` | LLM #1 extrakce do **pevného JSON schématu** + robustní `aiJson` (snese `response_format`, OpenAI `choices[].message.content` i CF `response`); soft validace polí | Model dostává text jako **data**, ne pokyny; schéma nemá pole „skóre" |
| `rubric.ts` | **Deterministický** skórovací engine — 6 typů kritérií, must-have gates, evidence kotvy, total 0..100 | Skóre vzniká **v kódu**, ne v modelu |
| `upload.ts` | F0 demo detektoru (stránka + `/scan`), zeštíhlené na `detect.ts` | Veřejné demo, bez skórování |
| `detector/hidden_text.py` (v2) | On-prem hloubková detekce PROČ je PDF text skrytý (barva/render mode 3/nulová alfa/off-mediabox/XFA) přes PyMuPDF | Běží mimo edge; doplňuje diagnózu, kterou edge neumí |
| `detector/adversarial_pdf.py`, `boundary_matrix.py`, `test_vectors.py` | Generátory vektorů + regresní/coverage běhy | Testovací infrastruktura, ne runtime |

Šest typů kritérií rubriku je **natvrdo** (ověřené, bezpečné): `numeric_scale`,
`set_overlap`, `category_map`, `cefr_map`, `tenure`, `bonus`. Editor v Nastavení je
**vyřazuje a konfiguruje váhy, nepřidává nové typy** — vědomé omezení attack surface.
Detail scoringového enginu je v [`rubric.ts`](../../worker/src/rubric.ts)
(`scoreCandidate`, `buildRubric`).

### Detekční jádro (`detect.ts`) — co je „viditelný text"

`detect.ts` je zdroj pravdy pro **viditelný/skrytý split**. Rozhoduje, který text smí
vstoupit do LLM #1. DOCX detekce je plná **v2** portovaná z on-prem detektoru:

- **WCAG kontrast** textu vůči **skutečnému pozadí** (z `highlight`/`shd`/`background`),
  ne naivní `min(r,g,b) ≥ 0xF0` — zachytí i #FEFEFE i #E8E8E8 na bílé.
- `w:vanish`, **mikropísmo** (< 4 pt), **hlavičky/patičky**, komentáře/poznámky,
  **metadata a alt-texty** (flagují se jen při injekci, jinak by měl každý reálný Word
  doc dva falešné nálezy — vědomé řešení alert fatigue).
- **Unicode nosiče:** zero-width znaky, bidi, Tags blok E0000+.
- **Textboxy/sidebary se NEflagují** (jsou viditelné → jinak FP na grafických CV).
- **Regex jen eskaluje severity** — parafrázovaná injekce bez shody slovníku projde přes
  kontrast (v1 ji propouštěla).

PDF na edge se čte přes `toMarkdown` (embedded/CID fonty z Word exportu vč. skrytého
textu) + `fflate` FlateDecode fallback ve sjednocení; injekce se hledá nad **veškerým**
extrahovaným textem. Politika je jednotná: **flag se zobrazí** (severity info/warn/
critical), netiše se nefiltruje. Ve viditelném textu se hlásí jen manipulace **směřovaná
na AI** (`visible_instruction_tone`, warn) — legitimní „jsem ideální kandidát" **není**
kritický nález.

### Extrakce (`extract.ts`) — robustní parsování a soft validace

LLM #1 dostává **jen viditelný text + schéma**, nikdy zadání ani kritéria (least
privilege pro model). `aiJson` je odolný parser, který snese tři různé tvary odpovědi
(`response_format`, OpenAI `choices[].message.content` i CF `response`) — modely se
v tomto liší a bez toho by extrakce padala náhodně.

Validace polí je **„soft" (field-level)**, ne whole-doc ERROR: neznámé klíče se zahodí
(bezpečnostní přínos zůstává), typy se koercují, sporné/chybějící pole → *flag k review*.
Důvod je provozní: drift LLM by při tvrdém ERROR shazoval použitelnost (1/10 selhání =
nepoužitelné). Extrakce navíc **klasifikuje druh dokumentu** (cv / cover_letter /
job_posting / other) → ne-uchazečské dokumenty (nahraný inzerát mezi CV, cizí soubor)
se v UI i tiskovém výstupu skryjí; při nejasnosti se bere jako CV (neschovávat reálné
uchazeče).

### Evidence kotvy a manažerský výstup

Rozpad kritéria **Shoda dovedností** ukazuje u každé matchnuté dovednosti **doslovný
úryvek z viditelného textu CV** („🔎 doloženo v CV"). Kotva se bere **deterministicky
z textu** (`snippetFor` grepne název dovednosti v `allVisible`), **nikdy od modelu** →
nedá se halucinovat. Sedí na `qualification.skills[].evidence`, takže přežije export/
import i přepočet bez AI. To je zároveň regulatorní přínos — **vysvětlitelnost** je
požadavek AI Act (transparentnost).

Manažerský tiskový výstup (`buildReport`) generuje samostatné light HTML s pořadím,
kontakty, skóre, rozpadem a **poznámkou o lidském dohledu** (Tisk/PDF v novém okně +
Stáhnout HLTML). Appka nemá tlačítko „hromadně zamítnout" — rating ≠ rozhodnutí, postup
kandidáta dělá vždy člověk.

### Gate praxe: defaultně VYPNUTÝ (HR zásada)

Gate na minimální roky praxe je **defaultně vypnutý**, protože roky se z CV spolehlivě
nevytáhnou. Odvození z inzerátu už gate **nenastavuje** (`minYears = 0`, zmíněné roky
jen `requestedYears` v hlášce). V rubriku: **neznámé** roky (`null`) = neutrální 5/10
místo 0; gate **nediskvalifikuje** při neznámých rocích — jen když reálně víme, že je
kandidát pod limitem. Je to vědomé zmírnění, aby se falešně nevyřazovali reální uchazeči.

> **Slabé místo, které oponent najde:** `detect.ts` (edge) a `hidden_text.py` (on-prem)
> jsou **dvě nezávislé implementace** téže logiky v různých jazycích. Sdílejí koncept,
> ne kód. Riziko rozjetí (drift) mezi vrstvami je reálné a jistí ho jen regresní sady
> (kap. 12), ne společný zdroj pravdy.

---

## 11.3 Endpointy a streamovaný průběh

Veškerá logika appky je za pěti endpointy jednoho Workeru (`app.ts`, `export default {
fetch }`). Nejde o REST nad databází — je to bezstavová výpočetní služba:

| Endpoint | Metoda | Co dělá | Volá AI? |
|---|---|---|---|
| `/` | GET | HTML stránka appky (`cache-control: no-store`) | ne |
| `/api/evaluate` | POST | Hlavní hodnocení: multipart (nahrané CV) **i** JSON (už extrahovaná data / cache). `?stream=1` → NDJSON průběh | ano (extrakce), pokud není vše z cache |
| `/api/rescore` | POST | Přepočet skóre nad **už extrahovanými daty** + novými požadavky | **ne** (0 tokenů) |
| `/api/derive` | POST | Odvození požadavků (jobTitle/minYears/requiredSkills) z textu inzerátu | ano |
| `/api/extract-text` | POST | Vytáhne viditelný text z TXT/PDF/DOCX/obrázku (OCR) | ano jen u obrázků |
| `/api/health` | GET | Ping modelu (`max_tokens:1`) + otisk verze (commit, build) | ano (1 token) |

**Streamovaný průběh (`/api/evaluate?stream=1`).** Dávka CV se hodnotí sekvenčně; každé
extrahované CV trvá jednotky až desítky sekund (free 8B ~7–16 s/CV; 70B ~65 s;
gpt-oss-120b až stovky sekund = nepoužitelné). Bez zpětné vazby by appka vypadala
„zamrzle". Řešení je `TransformStream` + writer, který po každém kandidátovi posílá
řádek NDJSON:

```
{ "type":"start",    "total":3, "names":[...], "model":"…" }
{ "type":"progress", "index":1, "total":3, "name":"Anna", "total_score":74.6, ... }
{ "type":"progress", "index":2, "total":3, "name":"Jan (injection)", ... }
{ "type":"done",     "result": { ranking: [...] } }
```

Klient renderuje progress bar a kandidáti naskakují ⏳→✓/⛔. Když stream selže, je
fallback na klasickou JSON odpověď (`evaluate()` bez streamu). Rozdělení `scoreOne` (jeden
kandidát) vs. `rankResults` (seřazení + finální výstup) je právě kvůli tomu, aby šlo
posílat průběžný stav.

**Kandidát = OSOBA, ne soubor.** `groupByPerson`/`personKey` seskupí víc dokumentů podle
jména ze souboru; hodnocení vzniká z **extrakce po dokumentech + merge** (`roky = max`,
dovednosti/certifikáty = sjednocení). To řeší dřívější chybu, kdy spojení textů mátlo
slabší 8B model. Kontakty (e-mail/telefon) se berou **jen regexem z textu per dokument**
(model je halucinoval) a slouží jen k zobrazení — **do skórování nevstupují**
(antidiskriminace).

**Přepočet bez AI (`/api/rescore`) a signatura běhu.** Změna gate/vah/dovedností **nespouští
extrakci**. Klient si drží `evalSig` (podpis = soubory + model + visionMethod + systémový
prompt); dokud se změní **jen** požadavky, appka přepne na `/api/rescore` — server pošle už
extrahovaná data (`rankResults` nese `qualification`) a jen znovu spustí deterministický
rubrik (~130 ms, 0 tokenů). Změna souborů/modelu/promptu = plná extrakce. To je přímý
důsledek toho, že skóre je deterministické a nezávislé na modelu.

**OCR obrázků a screenshotů (`/api/extract-text`).** Printscreen inzerátu jde vložit přes
**Ctrl+V** nebo drag&drop. Vision je best-effort: primárně Cloudflare `toMarkdown`
(s retry — občas vrátí prázdno), `toMarkdown` u obrázku ale vrací **anglický popis**, ne
přepis → `cleanupOcr` z popisu zrekonstruuje čistý text v původním jazyce (prompt drží
češtinu, nepřekládá termíny). LLaVA je jen fallback (hustý text jen hádá). Pro přesné
znění appka **doporučuje vložit text nebo PDF/DOCX** — a říká to uživateli v hlášce.

---

## 11.4 Chudá perzistence — záměrně BEZ databáze

Appka je **bezstavová**. Migrace D1 [`migrations/0001_init.sql`](../../migrations/0001_init.sql)
v repu **existuje, ale je NEZAPOJENÁ** — plná perzistence dávek se stavem kandidáta
(osloven / postupuje / odmítnut), audit log a decisions jsou **backlog**, ne hotová věc.
Místo databáze appka používá tři vrstvy „chudé perzistence", každou s jasně vymezeným
účelem:

### JSON export / import výsledku
Tlačítko „💾 Uložit (JSON)" serializuje dávku do formátu
`{app, kind:'evaluation', version:1, savedAt, lang, model, requirements, result}` a
„📂 Načíst" ji vrátí zpět — bez databáze se personalista vrátí k hotové dávce. **Formát
je záměrně navržen jako budoucí D1 záznam:** až přijde perzistence, jen se vymění úložiště,
schéma zůstane. Nad importovanou dávkou funguje i přepočet bez AI (`rescoreNow`), takže
lze měnit váhy/gate i po zavření prohlížeče a bez nahraných originálů.

### Autosave relace do `localStorage` (přežije refresh)
Rozpracovaná relace (inzerát + požadavky + **poslední výsledek** s rankingem, rozpadem,
evidencí) se automaticky ukládá do `localStorage` (`faxx_session`) při změně formuláře a
po každém vyhodnocení/přepočtu/importu. Po **obnově prohlížeče** ji `restoreSession()`
sama natáhne (hláška „↩︎ Obnovena poslední relace" + odkaz *Vymazat relaci*).

> **Poctivě o hranici:** nahrané **soubory refresh nepřežijí** — `File` objekty nejdou
> serializovat. Ranking, skóre, kontakty, nálezy a evidence jsou plně obnovené, ale pro
> otevření originálních dokumentů je nutné je nahrát znovu. Zápis je „best-effort":
> při vyčerpané kvótě `localStorage` selže tiše.

### Per-dokument CACHE extrakce (šetří AI tokeny)
Nejdůležitější optimalizace nákladů. Už extrahované dokumenty se při dalším „Vyhodnotit"
**znovu neextrahují**. Klient si po každém běhu uloží per-doc extrakci (`docExtracts`) do
`docCache` pod klíčem `jméno + velikost + model + vision + hash(prompt)`; příště pošle
u nezměněných souborů `cached` a nahraje jen nové → server u cached větve **přeskočí
detekci i extrakci (0 volání AI)**. Kontakty i evidence kotvy jsou refaktorované na
per-dokument, aby seděly na cachovanou `qualification`. `docExtracts` se **neukládá** do
autosave ani exportu (`slimResult`) — patří jen do klientské cache.

> **Důležitá poznámka k ekonomice:** účtování Workers AI je na **vygenerovaných** tokenech,
> takže trimy `max_tokens`/ping jsou spíš kosmetika. Identické spuštění i změna
> vah/gate/jazyka jedou přes `/api/rescore` **bez AI**. Jediná reálná úspora tokenů je
> právě per-doc cache (bez ní se při přidání jednoho CV re-extrahovala celá dávka).
> Nástroj je jednouživatelský, takže „důvěra ve vlastní cache" je přijatelná — server
> cachovaná data jen sanitizuje (`asCachedDoc`), neověřuje kryptograficky.

**Co tím oponent musí vidět:** bez DB dnes **neexistuje** auditní stopa, historie
rozhodnutí ani sdílení dávky mezi uživateli/PC (kromě ručního JSON exportu). Pro
regulatorně relevantní nasazení (AI Act čl. 12 „záznamy", GDPR) je to **nedostatek, ne
feature** — chudá perzistence je most k pilotu, ne cílový stav.

---

## 11.5 Dvojjazyčnost (CS/EN) a světlý/tmavý motiv

Appka je plně **dvojjazyčná** a má přepínač **světlý/tmavý motiv**. Oboje je v horní liště
a volba se ukládá v prohlížeči (`faxx_lang`, `faxx_theme`).

- **Bez bliknutí.** Brzký inline skript v `<head>` nastaví `data-lang`/`data-theme` na
  `<html>` ještě před vykreslením. Motiv = přepis CSS proměnných přes
  `:root[data-theme=light]`.
- **Statické UI** = slovník `EN` + atributy `data-i18n` / `-html` / `-ph` / `-title`;
  čeština je SSR default, `applyI18n` cachuje originál a překlápí.
- **Server generuje lokalizované řetezce.** Parametr `lang` je protažen do **všech**
  endpointů (`/api/evaluate`, `/api/rescore`, `/api/derive`, `/api/extract-text`,
  `/api/health`). Lokalizují se: popisky kritérií a důvod gate (`buildRubric`), detaily
  rozpadu (`rubric.ts`), poznámky a labely nálezů (`detect.ts` — `scanDocx`/`scanDocument`
  mají parametr `lang` s defaultem „cs", takže `upload.ts` beze změny), hlášky appky i
  manažerský tiskový výstup.
- **Přepnutí jazyka nad hotovou dávkou** spustí tichý **rescore bez AI**, aby se přeložil
  i rozpad kritérií a detaily nálezů — ne jen statické popisky.

Dokumentace v appce (11 sekcí) je přeložená přepínáním dvou statických bloků
`.lang-cs`/`.lang-en` čistě přes CSS (bez duplicitních kotev).

---

## 11.6 Otisk verze (commit + build v liště)

Každé nasazení injektuje přes `wrangler --define` do bundlu **krátký commit hash,
plný hash a čas buildu** (`__COMMIT__`, `__COMMIT_FULL__`, `__BUILT__`). Běžící appka je
ukazuje ve stavové liště (a upload demo v hlavičce i patičce). `/api/health` je vrací i
strojově. Účel je provozní ověřitelnost: operátor si **vždy** ověří, z jaké verze appka
běží — což je i projektová zásada „po nasazení uvést živý commit hash".

```
node scripts/deploy-app.mjs
# → --define __COMMIT__:"<sha>[+dirty]" __COMMIT_FULL__:"<full>" __BUILT__:"<ISO> UTC"
```

Skript navíc přidá `+dirty`, když je pracovní strom rozpracovaný — takže z otisku pozná
i to, že se nasazovalo z necommitnutého stavu.

> **Pozor na cache:** `GET /` má sice `cache-control: no-store`, ale edge/prohlížeč
> stránku chvíli drží → po deployi je nutné Ctrl+F5, jinak se v hlavičce ukazuje starý
> commit. `POST` endpointy se necachují.

---

## 11.7 Nasazení: ručně, BEZ CI

Nasazení je **ruční** a **outward-facing**, takže v tomto projektu čeká na svolení
(HANDOFF důsledně vede „NENASAZENO — čeká svolení"). To je odchylka od
[`DESIGN.md`](../../DESIGN.md) / [`BUILD.md`](../BUILD.md), které v cílovém stavu (F4)
počítají s „push na `main` = deploy přes `.github/workflows`" — **žádné takové CI dnes
neexistuje**, deploy dělá výhradně skript spuštěný člověkem.

Deploy skripty (cross-platform, Node):

- `scripts/deploy-app.mjs` (`npm run deploy:app`) → `wrangler deploy -c wrangler.app.jsonc`
  s otiskem verze. Preferuje lokální `node_modules/wrangler`, jinak `npx wrangler@latest`.
- `scripts/deploy-upload.mjs` (`npm run deploy:upload`) → totéž pro F0 demo detektoru.

Repo má **čtyři** wrangler konfigurace pro čtyři účely: `wrangler.app.jsonc` (hodnoticí
appka), `wrangler.upload.jsonc` (F0 demo), `wrangler.spike.jsonc` (verify-core spike),
`wrangler.jsonc` (výchozí). Účet je **bass443** dle projektových standardů; příslušné
tokeny a `account_id` **nejsou** v této dokumentaci (jde do public repa).

**Edge propagace.** Po `wrangler deploy` se nový bundl propaguje do edge sítě Cloudflare;
kombinovaně s browser cache stránky je proto po deployi potřeba hard-refresh (§11.6). Živé
URL: `https://faxx-hr-app.bass443.workers.dev` (appka) a
`https://faxx-hr-upload.bass443.workers.dev` (demo).

**On-prem runner.** Realizace on-prem runneru (Beelink / EU VPS za Conduit gateway) pro
hloubkovou PDF detekci a OCR skenů je **otevřená otázka** ([`DESIGN.md`](../../DESIGN.md)
§15). Dnes se `detector/*.py` spouští ručně lokálně — nasazený produkční runner
neexistuje.

---

## 11.8 Testovací přístup

Bez klasické CI se kvalita drží kombinací **rychlých, opakovatelných kontrol**, které se
pouští před každým (ne)nasazením. Nejde o formální test-suite s coverage reportem — je to
sada disciplinovaných ověření, jejichž běh je zaznamenaný v HANDOFF u každé změny:

| Technika | Co ověřuje | Nástroj |
|---|---|---|
| **Dry-run build** | Bundl se přeloží a vejde do limitu (typicky ~170–190 KiB) | `wrangler deploy --dry-run` |
| **Syntax-check inline skriptů** | Dva velké inline `<script>` v `PAGE` jsou syntakticky platné (nejsou pod TS kontrolou) | `node --check` nad vyříznutým skriptem |
| **jsdom runtime testy** | Chování UI: přepínání jazyka/motivu, on/off kritérií, save/load šablon i relace, inkrementální cache (1. běh `cv=2/cached=0`, po přidání souboru `cv=1/cached=2`), round-trip export/import | jsdom (instalovaný `--no-save`, **mimo repo**) |
| **esbuild unit test rubriku** | Deterministika skórování: `scoreCandidate` dá očekávané body, filtr vypnutých kritérií normalizuje váhy, evidence kotvy sedí | esbuild bundle testovacího vstupu |
| **wrangler dev cached-path bez AI** | `/api/evaluate` s `cached` dokumentem (bez souborů) proběhne s `extract_ms=0` a vrátí `docExtracts` — tj. cache větev opravdu nevolá AI | `wrangler dev` (lokálně) |
| **wrangler dev s reálným Workers AI** | Konec-konec běh přes reálný free model (může účtovat) — ranking sedí s ručním ground-truth, injection má nulový vliv | `wrangler dev` (bass443) |

Nad tím stojí **on-prem regresní sady** (`detector/test_vectors.py` 24/24 a
`boundary_matrix.py`), kterým se věnuje kapitola 12 — ty měří detektor, ne appku.

> **Poctivě o mezerách testování:**
> - jsdom testy běží proti **náhradě DOM**, ne skutečnému prohlížeči → neodhalí rozdíly
>   renderu / reálné cache / edge specifik.
> - Inline skripty **nejsou pod TypeScriptem** — jen `node --check` (syntax), ne typová
>   kontrola. Logická chyba v UI JS se chytí až v jsdom nebo živě.
> - **Neexistuje** automatizovaný end-to-end test proti nasazené produkci ani měření
>   výkonu na velkých dávkách proti limitům Workeru.
> - `wrangler dev` s AI bindingem jde na **reálný** Workers AI (může spotřebovat neurony /
>   účtovat), takže se nepouští v každém cyklu.
> - Dvě už-nasazené chyby (`rankResults` zahazoval `evidence`; `scoreOne` nepředával
>   `system`) prošly právě proto, že tato ověření nejsou souvislý CI gate — jsou to
>   ruční, byť disciplinované kontroly. To je reálné riziko regrese, které oponent
>   správně vytkne a které řeší až budoucí CI.
