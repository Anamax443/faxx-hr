# 14 · Omezení, rizika a otevřené otázky

> Tohle je nejdůležitější kapitola pro kritického oponenta a **záměrně píše proti
> vlastnímu produktu**. Cílem není projekt obhájit, ale vyjmenovat, kde je prototyp,
> kde je něco nedoměřené, nezapojené nebo sporné — a kde by nezávislý recenzent našel
> slabé místo dřív než my. Kde tvrdíme „hotové", myslíme hotové; kde je to prototyp,
> říkáme prototyp.

---

## 14.1 Poctivý výčet omezení

### 14.1.1 Free model kolísá (nedeterminismus extrakce)

Default extrakce jede na **Llama 3.1 8B fp8** (Cloudflare Workers AI). Model je rychlý
a se zpřesněným promptem přesný, ale **kolísá**: totožné CV může napříč běhy dát mírně
jiné pořadí kvalifikací nebo vypustit/přidat pole. Skóre samotné je deterministické
(rubrik v kódu), ale **vstup do rubriku — extrahovaná fakta — deterministický není**.

- Mitigace kvality: pro stabilitu 70B fp8-fast, gpt-oss 120B, nebo Claude (kvalitnější,
  ale placené/pomalejší; gpt-oss-120b má latenci 8–303 s, nepoužitelné pro dávku).
- Zásadní: **„reprodukovatelné ≠ správné".** I kdyby extrakce byla plně deterministická,
  neznamená to, že je věcně správná. Rubrik se musí validovat proti historickým
  rozhodnutím personalisty (viz §14.3), ne jen „vypadá to rozumně".

### 14.1.2 Vision / OCR obrázkových CV je best-effort

Sken a fotka CV se čtou přes vision cestu (primárně Cloudflare `toMarkdown` na obrázku,
s retry — občas vrátí prázdno; fallback LLaVA, který hustý text jen hádá). `toMarkdown`
u obrázku navíc vrací **anglický popis**, ne přepis — proto `cleanupOcr` z popisu
rekonstruuje čistý text v původním jazyce.

Poctivě: pro **přesné znění** je nutné vložit text nebo digitální PDF/DOCX. Vision je
záchranná cesta pro ad-hoc sken, ne primární kanál. Kvalita OCR je **nedoměřená** a váže
se přímo na nákladovou neznámou (kapitola 13, §13.5): vision je zároveň nejméně přesná
i nejdražší cesta.

### 14.1.3 Hloubka PDF „proč je text skrytý" je jen on-prem

Na edge (Cloudflare Worker) se injekce v **textové vrstvě** PDF chytne spolehlivě
(`toMarkdown` čte přes ToUnicode i render mode 3 → klasifikátor flagne). Ale **diagnózu
skrytí** — proč je text neviditelný (barva/kontrast, render mode 3, nulová alfa, mimo
mediabox, XFA/AcroForm) — dodává až **on-prem runner** (Python/PyMuPDF, `detector/*.py`).

Důsledek: edge vidí „tady je podezřelý text", ale kompletní forenzní obraz („bílé písmo
1 pt v patičce") vzniká jen tam, kde běží on-prem vrstva. pdf.js/unpdf ve workerd
nefunguje (padá na `_isSameOrigin`), takže tuto hloubku **nelze mít čistě na edge**.

Dříve přiznaná hranice u vektoru **V-PDF-06** (ToUnicode obfuskace, extrakce ≠ displej) je
**UZAVŘENA (2026-08-04):** glyf ↔ ToUnicode diff **on-prem i na edge** zadrží payload do
`hidden_text` (`critical:pdf_tounicode_mismatch`) a stripne z `visible_text`; embedované/subset
fonty se přeskočí (0 FP), regrese 24/24, ověřeno naživo. Zbývá už jen plný render→OCR dual-path
pro display-divergenci MIMO ToUnicode (čeká na OCR engine).

### 14.1.4 Bez sdílené perzistence — jen soubor / localStorage

Appka je **bezstavová**. „Chudá perzistence" znamená:

- JSON export/import výsledku (uložit dávku do souboru, vrátit se k ní),
- autosave relace do `localStorage` (přežije obnovu prohlížeče),
- per-doc cache extrakce (šetří tokeny).

Co **NENÍ**: sdílená databáze, stav kandidáta (osloven / postupuje / odmítnut), historie
dávek napříč zařízeními, audit rozhodnutí. Migrace D1 (`migrations/0001_init.sql`)
**existuje, ale je NEZAPOJENÁ** — appka na ni nesahá. Nahrané soubory refresh nepřežijí
(File objekty nejdou serializovat), takže pro otevírání originálů je nutné je nahrát
znovu. Toto je největší funkční mezera mezi **cílovou architekturou** (e-mail ingest →
R2/D1 → stav dávky) a **realitou** (edge dávkový nástroj bez perzistence).

### 14.1.5 Jednouživatelská důvěra v klientskou cache

Per-doc cache a její sanitizér `asCachedDoc` staví na předpokladu, že **nástroj je
jednouživatelský**: server přijme klientem poslanou extrakci pro nezměněné soubory a
přeskočí ji.

Klíčové rozlišení modelu hrozeb: **útočník je autor CV, ne uživatel appky.** Personalista,
který nástroj obsluhuje, není protivník — nemá motiv falšovat vlastní cache. Proto je
důvěra v cache akceptovatelná *v tomto scope*. **Kdyby se nástroj stal víceuživatelským
nebo víceklientským** (více personalistů, sdílené zadání, cizí vstup do cache), tento
předpoklad **padá** a cache by musela být servrově ověřovaná/podepsaná. Dnes to díra
není; při změně scope by dírou byla.

### 14.1.6 Chybí held-out sada a externí red-team

Regrese detektoru je **24/24** (DOCX 14 + PDF 10 on-prem), ale jde o **ladicí sadu**,
kterou psal autor detektoru — tedy **overfitting risk**. Chybí:

- **HELD-OUT sada** sestavená **někým jiným** než autorem detektoru: ≥ 50 čistých CV
  (z toho ≥ 15 grafických s tmavými sidebary/textboxy = hlavní zdroj false positives),
  ≥ 30 otrávených, min. 10 vektorů včetně **parafrázovaných** injection bez shody
  s blocklistem.
- **Externí red-team** — někdo dostane detektor a má za úkol ho obejít.

Bez těchto dvou věcí **nemáme doložitelné číslo** recall/FP na neznámých datech. Cílový
F0 exit (recall ≥ 98 % na held-out otrávených, FP ≤ 5–10 % na čistých, přesnost extrakce
≥ 90 %) je zatím **cíl, ne naměřený výsledek**. To je nejtvrdší poctivá výhrada celého
projektu: **injection-obrana je empiricky doložená jen na vlastní sadě.**

### 14.1.7 Bus factor / záložní operátor

Provoz je dnes **sólo** (jeden člověk zná stack, on-prem runner i deploy). Pro **pilot**
je to akceptované riziko (operátor riskuje vlastní čas). Pro **produkt** je to reálná
provozní mezera: chybí záložní operátor / outsourcing provozu. Mitigace v návrhu je
zatím **jen konstatování** (jednoduchý stack, BUILD dokumentace) — což oponentura správně
označila za nedostatečné pro produktovou fázi.

### 14.1.8 Rubrik je reprodukovatelný, ne prokazatelně správný

Deterministický rubrik dává **auditovatelné a reprodukovatelné** skóre — stejný vstup
dá stejný výstup, rozpad po kritériích lze doložit. To je regulatorně cenné (čl. 13
transparentnost), ale **není to totéž co správnost**:

- Rubrik váží podle toho, jak ho někdo nastavil (váhy, gates, must-have). Špatně
  nastavené váhy dají reprodukovatelně špatné pořadí.
- „Senior z rozbitého startupu = senior z banky" — holý výskyt dovednosti nezachytí
  kontext. Nuance nesídlí v rubriku, ale v **extrakci** (skill nese `level`, `context`,
  `evidence`), a ta u free modelu kolísá (§14.1.1).
- **Chybí validace proti historickým rozhodnutím** personalisty (shoda / kalibrace).
  Dokud rubrik neproběhne touto validací, je „rozumně vypadající", ne „doloženě
  správný". To je klíčová věta, kterou napříč dokumentací opakujeme: **reprodukovatelné
  ≠ správné.**

### 14.1.9 Další reziduální rizika z modelu hrozeb

Kromě primární hrozby (prompt injection skrytým textem) drží model hrozeb i sekundární
rizika, na která nemáme dnes plnou obranu:

- **DoS / spotřeba tokenů** — extrémně dlouhý nebo rekurzivní text v CV může spotřebovat
  neurony/tokeny a v součtu vyčerpat kvótu (4006). Limity velikosti (per-file 8 MB,
  dávka 10 MB) tlumí objem, ale ne vnitřní délku textu jednoho dokumentu.
- **Exfiltrace systémového promptu / kritérií** — injekce cílená na vytažení
  systémového promptu nebo skórovacích kritérií. Tlumí to **least privilege**: LLM #1
  nedostává zadání ani kritéria, jen text + schéma. Není to ale formálně otestované.
- **Visual prompt injection** — QR kód, mikro-text v logu, optické triky na vision model
  v cestě B. Vstup vision modelu je taky nedůvěryhodný. Výstup jde stejným schématem
  (bez pole na verdikt), ale detekce QR/čárových kódů je **backlog**, ne hotová.
- **Same-contrast bypass** (#666 na #777) — dual-path diff to nechytí (oba parsery čtou
  stejně); chytá to deterministický kontrastní detektor (WCAG poměr) jako nezávislá
  vrstva. Dual-path ale **zatím neexistuje** (F1), takže dnes jistí jen kontrast.

Tato rizika nejsou „vyřešená" — jsou **zmapovaná a částečně tlumená architekturou**
(oddělení extrakce od hodnocení, pevné schéma bez pole „skóre"). Poctivě: jistota u nich
stojí a padá s F0 held-out sadou a red-teamem (§14.1.6), který má právě tyto obcházecí
techniky zkusit.

### 14.1.10 Rozdíl mezi „postaveno + ověřeno" a „nasazeno"

Poctivá provozní výhrada: řada funkcí je **postavená a ověřená (dry-run build, jsdom,
wrangler dev), ale NENASAZENÁ** — čeká na svolení k deploji (deploy je outward-facing,
ruční, bez CI). Živá appka (`faxx-hr.maxferit.cz`) tak může běžet **starší
verzi**, než je v repu. Konkrétně čekají na nasazení mimo jiné: per-doc cache extrakce,
opravy dvou chyb v už-nasazeném kódu (evidence kotvy se nedostávaly ke klientovi;
editovatelný systémový prompt se ignoroval), autosave relace a editor rubriku.

Důsledek pro oponenta: **při hodnocení živé instance ověřit otisk verze** (commit + čas
buildu v hlavičce/patičce) — funkce popsané jako hotové v repu nemusí být na živé URL,
dokud neproběhne `npm run deploy:app`. To není skrytá vada, ale vědomý provozní model
(deploy jen s explicitním svolením) — je ale nutné ho znát, aby „hotové v kódu"
neznamenalo automaticky „hotové živě".

---

## 14.2 Sporná rozhodnutí (rozhodne provozovatel / právník)

Tato rozhodnutí **nejsou technická** a nemá je uzavírat autor nástroje. Uvádíme svůj
postoj, ale explicitně je necháváme otevřená.

### 14.2.1 Přeznačení z high-risk — NESTAVĚT na tom

Jedna z oponentur navrhla *strategický únik z high-risk*: přeznačit produkt na „Data
Structuring / Search tool", zrušit skóre, ukazovat jen „splňuje 3 z 5 podmínek" a tím
vypadnout z Annexu III AI Act.

**Náš postoj (⚖️):** relabeling **není spolehlivý právní štít**. AI Act i čl. 22 GDPR se
řídí **funkcí, ne názvem** — když člověk odklikne návrh při náboru, jde *de facto*
o vstup do hodnocení uchazečů bez ohledu na marketingový popis. Regulátor hodnotí použití.

Co z toho **bereme** (a je to i lepší produkt): UX posun ANO — vést „splňuje X z Y
podmínek + evidence" místo jediného „Match 85 %". Co **nebereme**: reklasifikaci jako
compliance strategii. Rozhodnutí patří právníkovi; **nestavíme na něm** architekturu.

### 14.2.2 Pilot vs. produkt

Zásadní nerozhodnutá otázka, která **mění rozsah všeho ostatního**:

| Aspekt | Interní pilot | Produkt pro cizí HR |
|---|---|---|
| AI Act role | operátor = provider i deployer (nejnáročnější) | role se štěpí (provider = QMS/CE/registrace) |
| Runner | Beelink (ČR, nejlevnější) | EU cloud VPS (Hetzner), SLA |
| Bus factor | akceptované riziko | podmínka: záložní operátor |
| Compliance hloubka | DPIA + Annex IV-lite před daty | plná dokumentace |
| Systematická rešerše ATS | nepovinná | go/no-go vstup |

Dokud se pilot/produkt nerozhodne, **nelze uzavřít rozsah AI Act povinností**. Toto je
vědomě otevřené a je to rozhodnutí provozovatele, ne technický detail.

---

## 14.3 Otevřené otázky

Věci, na které dnes **nemáme odpověď** a které blokují nebo ovlivňují další kroky:

1. **Doména pro e-mail ingest** — *NEROZHODNUTO*. Blokuje spuštění e-mailového kanálu
   (dnes je vstup jen web upload dávky). Recyklace `job-watch-mail` je možnost, ne
   rozhodnutí.
2. **Prahy detektorů** (kontrast/WCAG poměr, opacity, min. font) — mají se **kalibrovat
   empiricky na held-out F0 sadě**, kterou zatím nemáme (§14.1.6). Dnešní prahy jsou
   z ladicí sady.
3. **Kdo píše rubrik a jak se validuje** — personalista se šablonou vs. správce?
   Rubrik se má validovat proti **historickým rozhodnutím** personalisty (shoda /
   kalibrace vah), ne „vypadá rozumně". Nevyřešeno; součást F3.
4. **DPIA + Annex IV timing** — má běžet **před zpracováním prvních reálných CV** (před
   pilotem, ne až F4); smí běžet souběžně s F0 na syntetických/souhlasných vzorcích.
   Zatím nezpracováno.
5. **Gate (min. roky praxe)** — dnes **defaultně VYPNUTÝ**, protože roky se z CV
   spolehlivě nevytáhnou; neznámé roky = neutrální 5/10, **NEdiskvalifikují**. Otevřené,
   zda a jak vůbec roky do skórování pouštět.
6. **Test na proxy diskriminaci** — koreluje rating se zástupnými znaky (jméno školy,
   mezera v kariéře) pro pohlaví/věk/původ? Chráněné atributy se do hodnot neextrahují
   (`meta.sensitive_attributes_detected` jen hlásí přítomnost), ale **reziduální proxy
   riziko není otestované**.

---

## 14.4 Tabulka: riziko → dopad → mitigace / stav

| Riziko | Dopad | Mitigace / stav |
|---|---|---|
| Free 8B model kolísá | Mírně jiné pořadí u téhož CV; extrakce nestabilní | Volitelně 70B / Claude pro stabilitu; skóre samo deterministické. **Trvalé omezení free tier.** |
| Vision OCR best-effort | Sken/foto CV nepřesně přečteno | Pro přesnost vložit text/PDF; vision = záchrana. **Nedoměřeno.** |
| PDF „proč skryté" jen on-prem | Edge chytí injekci, ale ne plnou diagnózu skrytí | On-prem runner (PyMuPDF). Edge zádrž textové vrstvy funguje. **V-PDF-06 (ToUnicode) uzavřen on-prem i edge (glyf↔ToUnicode → hidden_text).** |
| Bez sdílené perzistence | Není stav kandidáta, historie, audit | JSON/localStorage/cache. **D1 migrace existuje, NEZAPOJENÁ.** |
| Důvěra v klientskou cache | Padá při víceuživatelském scope | OK pro jednouživatelský nástroj (útočník = CV). **Podmíněno scope.** |
| Chybí held-out + red-team | Recall/FP na neznámých datech nedoložené | **CHYBÍ. Blokuje F0 exit.** Overfitting risk na vlastní sadě. |
| Bus factor sólo | Výpadek operátora = výpadek provozu | Jednoduchý stack + BUILD docs. **Pro produkt nedostatečné — jen konstatování.** |
| Přeznačení z high-risk | Falešný pocit compliance | **NESTAVĚT na tom.** UX „X z Y" ano, právní štít ne — rozhodne právník. |
| Pilot vs. produkt nerozhodnuto | Neurčitý rozsah AI Act povinností | **Rozhodnutí provozovatele.** Mění runner, bus factor, compliance. |
| DPIA / Annex IV chybí | Riziko při reálných datech | **Před pilotem, ne až F4.** Zatím nezpracováno. |
| Proxy diskriminace | Rating může korelovat se zástupnými znaky | Chráněné atributy se neskórují; **test proxy diskriminace zatím neproběhl.** |
| Alert fatigue na grafických CV | Personalista vypne varování | Detektor low-FP (vanish/render/kontrast), flag gated přes klasifikátor; FP na grafických CV = **samostatná F0 metrika (nedoměřená).** |
| DoS / spotřeba tokenů | Extrémně dlouhý text vyčerpá kvótu | Limity velikosti (8/10 MB) tlumí objem, ne vnitřní délku. **Neotestováno.** |
| Exfiltrace systémového promptu / kritérií | Injekce vytáhne kritéria | Least privilege (LLM #1 nedostává zadání). **Neotestováno formálně.** |
| Visual prompt injection (QR, mikro-text) | Optický útok na vision model | Výstup jde schématem bez verdiktu; detekce QR = **backlog.** |
| Vyčerpání free kvóty (4006) | Nelze přijímat nová CV daný den | Appka to **hlásí**; skóre/rescore/cache/import běží dál. Reset UTC půlnoc; produkce = Workers Paid/Claude. |

---

## 14.5 Co explicitně netvrdíme

Aby nevznikl mylný dojem „hotového produktu", shrnujeme, co **není** hotové:

- **Není** e-mail ingest (jen web upload dávky).
- **Není** perzistence dávek se stavem kandidáta (D1 migrace nezapojená).
- **Není** dual-path diff (textová vrstva vs. render → OCR) ani sémantická vrstva nad
  `hidden_text` (embeddings) — to je prohloubení diferenciátoru, backlog.
- **Není** Claude backend (chybí klíč) — architektura přepínatelného backendu připravená.
- **Není** held-out sada, externí red-team, ani kalibrace prahů na neznámých datech.
- **Není** DPIA / Annex IV.
- **Není** doměřený podíl vision fallbacku (klíčová nákladová neznámá).

**Je** hotové a ověřené: jádro detekce → extrakce → deterministický rubrik s invariantem
zádrže (skrytý text nesmí do `visible_text`), živá dávková appka (ranking, rozpad po
kritériích, evidence kotvy z textu, editor rubriku, CS/EN + motiv, tiskový výstup,
JSON export/import, autosave), regrese 24/24 na ladicí sadě a **empiricky doložená
injection-obrana** (verify-core spike: model ignoroval „ohodnoť 100/100" ve viditelném
textu, schéma nemá pole, kam by injection zapsala).

> **Souhrn pro oponenta:** projekt má **ověřené jádro** a **poctivě otevřený zbytek**.
> Největší nedoměřené místo je **F0 gate** (held-out sada + red-team + vision podíl) —
> dokud neproběhne, je nástroj *funkční prototyp s doloženým principem*, ne *doložený
> produkt*. To rozlišení držíme napříč celou dokumentací.
