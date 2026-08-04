# 10 · Regulatorika (EU AI Act + GDPR)

> Tato kapitola je pracovní regulatorní pozice, **ne právní stanovisko**. Konkrétní data
> účinnosti a odklady AI Act jsou pohyblivé — ověřit u aktuálního znění a právního poradce.
> Návrh se na odklad **nespoléhá**; GDPR a antidiskriminace platí bez ohledu na AI Act.
> Pro kritického oponenta je klíčové jedno: níže je stejně pečlivě vypsáno, **co chybí**,
> jako to, co je pokryto. Regulatorika, kde se zamlčují mezery, je horší než žádná.

## 10.1 Klasifikace: nábor je vysoce rizikový, tečka

Nábor a výběr kandidátů spadá pod **Nařízení EU 2024/1689 (AI Act), Annex III, bod 4** —
AI systémy určené k **náboru nebo výběru fyzických osob**, zejména k cílení inzerce,
analýze/filtrování žádostí a hodnocení uchazečů. To je **vysoce rizikový systém**.

Dvě věci, které oponent typicky zkouší napadnout, a proč neobstojí:

1. **„Je to jen decision support, ne rozhodování."** Klasifikace se váže na **účel**, ne na
   míru automatizace. I nástroj, který jen **filtruje nebo hodnotí** žádosti a předává
   výstup člověku, je high-risk. Decision support nábor z Annexu III **nevyjímá**.
2. **„Jsme malý provozovatel / interní pilot."** Klasifikace je nezávislá na velikosti
   provozovatele. Malost = úleva v některých procesních aspektech (proporcionalita QMS),
   **ne** změna rizikové třídy.

### Provider vs. deployer

Rozdělení rolí zásadně mění rozsah povinností:

| Role | Kdo | Povinnosti (zjednodušeně) |
|---|---|---|
| **Provider** | kdo systém vyvíjí / uvádí na trh pod svým jménem | plný QMS, posouzení shody, technická dokumentace (Annex IV), CE, registrace v EU databázi, post-market monitoring |
| **Deployer** | kdo systém provozuje na reálných uchazečích | informování dotčených osob, zajištění lidského dohledu v provozu, monitoring, vstupní data v rámci účelu |

- **Interní pilot faxx-hr:** sólo operátor je **obojím** (provider i deployer) — nejnáročnější
  varianta, kumuluje obě sady povinností.
- **Produkt pro cizí HR:** role se **štěpí** — autor = provider (plná tíha shody), zákaznická
  HR = deployer.

Praktický důsledek pro oponenta: **rozsah povinností se s fází mění řádově.** Interní pilot
na malém vzorku souhlasných/syntetických CV je jiná regulatorní zátěž než produkt nabízený
cizím personalistům. Návrh to reflektuje tím, že **pilot a produkt drží oddělené** (otevřená
otázka DESIGN „kdy certifikovat") a nepředstírá, že prototyp splňuje povinnosti providera
uvádějícího systém na trh. To je legitimní **fázování**, ne obcházení — dokud nejde o reálné
uchazeče cizích firem, kumulují se povinnosti deployera nad vlastními daty, ne plný compliance
balík providera. Přechod mezi fázemi je ale **skokový** a musí být vědomý, ne plíživý.

> **Zásadní princip, který se táhne celou kapitolou:** *NESTAVĚT únik z high-risk přeznačením.*
> Pokusy „říct tomu vyhledávací nástroj / statistiku / asistenta" a tím se vyvázat z Annexu III
> jsou v návrhu **explicitně zamítnuté** (viz rozhodovací log DESIGN). Relabeling není
> spolehlivý štít ani vůči AI Act, ani vůči GDPR čl. 22. Bezpečnější a jediná obhajitelná
> cesta je **stavět podle standardu high-risk už teď** a případný legislativní odklad brát
> jako rezervu na dokumentaci, ne jako důvod odkládat návrh.

## 10.2 Mapování povinností AI Act (čl. 9–15) na faxx-hr

Tabulka mapuje jednotlivé články na konkrétní prvek návrhu a **poctivě** označuje stav.
Stavy: **splněno návrhem** (mechanismus existuje) / **částečně** / **chybí**. „Splněno
návrhem" ≠ „ověřeno v produkci" — u prototypu jde o architektonický předpoklad.

| Článek | Povinnost | Prvek faxx-hr | Stav | Co konkrétně chybí |
|---|---|---|---|---|
| **9** | Systém řízení rizik (kontinuální proces po celý životní cyklus) | Oddělení extrakce/hodnocení; deterministický rubrik jako mitigace; threat model | **částečně** | Formalizovaný, dokumentovaný RM proces (identifikace/odhad/mitigace/reziduum) jako živý dokument, ne jen kapitola |
| **10** | Data governance / kvalita dat / bias | Split identity/qualification/sensitive; sensitive se **neskóruje**; `meta.sensitive_attributes_detected` | **z větší části** | Doložení reprezentativnosti a bias-auditu na reálné/souhlasné sadě; kalibrace rubriku proti historickým rozhodnutím |
| **11 + Annex IV** | Technická dokumentace | Architektura, rubrik, schéma, audit — jako podklad | **chybí samostatný dokument** | Sestavit **Annex IV-lite PŘED reálnými CV** (viz 10.7) |
| **12** | Automatické záznamy (logy) po dobu života | `audit_log` **append-only**; `model`/`model_version` u každé extrakce; `cost_czk`/tokeny | **splněno návrhem** | Hašové řetězení (integrita) k doplnění; retenční politika logů |
| **13** | Transparentnost vůči provozovateli (srozumitelnost výstupu) | Evidence kotvy (doslovný úryvek z CV), review UI, rozpad po kritériích | **z větší části** | Návod k použití (instructions for use) jako formální artefakt; popis limitů přesnosti |
| **14** | **Lidský dohled** | Decision support; `decisions` (záznam lidského rozhodnutí); žádné auto-zamítnutí | **splněno návrhem** | **Měřitelnost** dohledu (viz 10.3 a 10.7) — dnes není metrika |
| **15** | Přesnost, robustnost, kyberbezpečnost | Deterministický rubrik (reprodukovatelnost) + třívrstvá obrana proti injection | **částečně** | Externí **pen-test / red-team**; deklarované metriky přesnosti (held-out F0: recall ≥98 %, FP ≤5–10 %, extrakce ≥90 %) zatím **nenaměřené** |
| **50** | Transparentnost vůči uživateli (informovat o AI interakci) | — | **chybí formálně** | Informovat **uchazeče**, že hodnocení je AI-asistované (viz 10.6) |

### Poznámky k jednotlivým článkům

**Čl. 9 (řízení rizik).** faxx-hr má věcné mitigace (celá kap. 9), ale řízení rizik dle
AI Act je **proces**, ne stav — musí být zaznamenaný, opakovaně revidovaný a provázaný na
post-market data. Dnes je to kapitola v dokumentaci, ne živý registr rizik. To je reálná
mezera pro produkční fázi.

**Čl. 10 (data governance).** Nejsilnější strukturální prvek: chráněné atributy se
**datově** nedostanou do skórování (viz 10.4). Slabina není v návrhu split, ale v **doložení**
— že extrakce je přesná a rubrik nekoreluje s chráněnými znaky přes proxy — což vyžaduje data
a měření, která zatím nejsou.

**Čl. 12 (logy) — splněno návrhem.** `audit_log` je append-only a loguje se model/verze/
náklady. Reálná D1 perzistence je ale backlog (živá appka je bezstavová), takže „automatické
záznamy po celou dobu života systému" jsou dnes vlastnost návrhu, ne běhu.

**Čl. 14 (lidský dohled) — nejdůležitější a nejcitlivější.** Rozvedeno v 10.3.

**Čl. 15 (přesnost/robustnost/kyberbezpečnost).** Reprodukovatelnost skóre je dána
determinismem rubriku. Robustnost proti injection je doložena verify-core spikem, ale
**ne held-out sadou ani externím red-teamem** — a přesně to čl. 15 pro high-risk vyžaduje.
Deklarovaná exit kritéria F0 jsou správná; problém je, že jsou zatím **cíle, ne výsledky**.
Čl. 15 navíc vyžaduje, aby úrovně přesnosti byly **deklarované v návodu k použití** — tedy
provozovatel musí předem vědět, jak spolehlivý výstup dostává. Deklarovat lze až naměřené
hodnoty; dokud held-out sada nedoběhne, nelze tuto povinnost splnit poctivě (číslo bez měření
by bylo horší než přiznané „neměřeno").

### Životní cyklus a post-market monitoring

AI Act nekončí uvedením do provozu. High-risk systém vyžaduje **post-market monitoring** —
sledování reálného chování, hlášení závažných incidentů, zpětnou vazbu do řízení rizik (čl. 9).
Pro faxx-hr to konkrétně znamená: sledovat míru falešných poplachů detektoru na reálném
provozu, drift extrakce mezi verzemi modelu (`model_version` se loguje právě proto), a podíl
odchylek lidského rozhodnutí od ratingu (viz 10.3). Dnes je toto **koncept navázaný na logy**,
ne běžící proces — logika je v návrhu, ale bez zapojené perzistence a metrik ji nelze provozovat.

## 10.3 Lidský dohled (čl. 14) — jádro celé regulatorní obhajoby

Lidský dohled je pilíř, na kterém stojí legalita celé aplikace. Návrhový princip:

> **Rating ≠ rozhodnutí. Postup kandidáta dělá VŽDY člověk. Žádné tlačítko „hromadně
> zamítnout".** Skóre je vstup pro personalistu, ne verdikt systému.

To ale samo o sobě **nestačí**. Regulátor i GDPR čl. 22 (viz 10.5) vyžadují, aby přezkum byl
**skutečný**, ne formální „člověk klikl OK". Funkce > název: nazvat to „decision support"
a dát personalistovi tlačítko, které jen odklepne pořadí systému, **není** lidský dohled.

Návrh proto počítá s **měřitelnými** mechanismy skutečného dohledu:

- Vést „**splňuje X z Y podmínek + evidence**", ne jediné neprůhledné „85 %". Personalista
  vidí, **proč** — a může nesouhlasit s konkrétním kritériem.
- Povinný **komentář u rozhodnutí** (zvlášť u odchylky od pořadí systému).
- Minimální **čas review** (obrana proti odklepávání).
- **Randomizované audity shody** rozhodnutí s ratingem.
- `decisions` tabulka = **záznam lidského rozhodnutí** jako důkaz oversightu.

**Poctivě k mezeře:** klíčová **metrika měřitelného dohledu — podíl případů, kdy se lidské
rozhodnutí odchýlí od ratingu** — dnes **není implementovaná ani měřená**. Bez ní nelze
doložit, že dohled je skutečný a ne razítkovací. To je jedna ze dvou nejdůležitějších
chybějících věcí (druhá je DPIA + Annex IV — viz 10.7). Pokud by se odchylka blížila nule,
byl by to **signál**, že personalista jen potvrzuje systém — tj. že se „lidský dohled" stal
fasádou a fakticky jde o automatizované rozhodování se všemi důsledky.

Čl. 14 rozlišuje několik režimů dohledu — zjednodušeně **human-in-the-loop** (člověk schvaluje
každý výstup), **human-on-the-loop** (člověk monitoruje a může zasáhnout) a **human-in-command**
(člověk může systém kdykoli vypnout / přepsat). faxx-hr míří na **human-in-the-loop** u
finálního rozhodnutí o kandidátovi (žádný postup bez člověka) a přitom drží podmínky pro
**smysluplný** zásah, které čl. 14 explicitně jmenuje: dohlížející musí (a) **rozumět
schopnostem a mezím** systému, (b) být si vědom **rizika automation bias** (přehnané důvěry ve
výstup stroje), (c) umět výstup **správně interpretovat** a (d) **nezasáhnout / rozhodnout jinak**.
Evidence kotvy a rozpad po kritériích slouží bodu (c); povinný komentář a měřená odchylka
bodu (d); informace o kolísání free 8B modelu a o limitech extrakce bodu (a) a (b). Slabé místo
zůstává (b): bez metriky odchylek nelze automation bias **detekovat**, natož mu bránit.

## 10.4 Antidiskriminace: chráněné atributy mimo skórování + proxy test

### Datové vynucení

Chráněné znaky (věk, foto, pohlaví, národnost, zdravotní stav…) se **neextrahují do hodnot**.
Extrakční schéma je nese jen jako **příznak přítomnosti** — `meta.sensitive_attributes_detected`
hlásí, že v CV byly, ale **nedává je jako data do skórování**. Rubrik navíc vidí jen
`qualification_json`, **ne** `identity_json` ani sensitive blok. Identita tedy **nevstupuje
do skórování** — není to instrukce modelu „nekoukej na věk", je to **datová nemožnost**:
skórovací funkce ta pole na vstupu nemá.

To je silnější než promptová instrukce (kterou lze obejít) — je to strukturální oddělení.

### Reziduální riziko: proxy diskriminace

Datové oddělení chráněných znaků **neřeší proxy** — signály ve viditelném textu, které
**korelují** s chráněným znakem, aniž jsou jím: název školy (proxy pro socioekonomický status/
region), kariérní mezera (proxy pro rodičovství/zdraví), formulace/jméno (proxy pro původ/
pohlaví), rok maturity (proxy pro věk). Rubrik může přes takový signál nepřímo diskriminovat,
i když chráněný znak formálně nevidí.

**Mitigace (deklarovaná, netestovaná):**

- Periodické **testování férovosti** — měřit, zda skóre nekoreluje s chráněnými znaky napříč
  reprezentativním vzorkem (např. rozdíl v rozdělení skóre podle pohlaví/věku při jinak
  srovnatelné kvalifikaci).
- Explicitní **instrukce nezohledňovat** korelující signály (název školy…) tam, kde extrakce/
  měkká kritéria zapojují model.
- **Test proxy-diskriminace** jako opakovaná procedura, ne jednorázová.

**Jak by test proxy-diskriminace věcně vypadal** (aby nešlo o prázdnou deklaraci): sestavit
sadu párů/skupin CV, které se liší jen v proxy signálu (jinak srovnatelná kvalifikace), a
měřit, zda se rozdělení skóre statisticky liší podle skupiny — analogie **adverse impact
ratio** / pravidla čtyř pětin z antidiskriminační praxe. Alternativně: nechat rubrik projet
CV se „začerněnými" proxy signály a bez nich a sledovat, zda a jak se pořadí mění. Obojí
vyžaduje reprezentativní data a definici metriky předem. Důležitý caveat: **odstranit proxy
úplně nelze** (kvalifikace sama koreluje s ledasčím) — cílem je proxy **měřit, zdokumentovat
a držet pod kontrolou**, ne tvrdit nulovou korelaci.

> **Poctivě:** test proxy-diskriminace je **koncept, ne běžící kontrola**. Vyžaduje data,
> metriku a proces, které zatím nejsou. Bez něj je tvrzení „nediskriminujeme" podložené jen
> tím, že chráněné znaky nejsou přímý vstup — což proti proxy nestačí. Toto je nutné mít
> hotové před nasazením na reálné uchazeče.

## 10.5 GDPR

### Čl. 22 — žádné plně automatizované rozhodnutí

GDPR čl. 22 dává subjektu právo nebýt předmětem rozhodnutí založeného **výhradně** na
automatizovaném zpracování s právním nebo obdobně významným účinkem. Odmítnutí v náboru
takový účinek má. Návrh se s tím vypořádává **decision support** modelem: rozhoduje člověk
(kap. 10.3), systém jen podkládá.

**Kritický háček** (a proč se to prolíná s čl. 14): čl. 22 se **nevyhne relabelingem**.
Přejmenovat aplikaci na „search tool" a nechat personalistu jen odklepávat pořadí = de facto
automatizované rozhodnutí s formální lidskou pečetí → **NENÍ spolehlivý štít**. Ochrana čl. 22
stojí a padá s tím, že lidský zásah je **skutečný a smysluplný** (proto ta metrika odchylek
z 10.3). GDPR tu a AI Act čl. 14 míří na totéž jádro z dvou směrů.

### Čl. 35 — DPIA (posouzení vlivu na ochranu osobních údajů)

U **profilování uchazečů** je DPIA prakticky **povinná** (systematické rozsáhlé hodnocení
osobních aspektů). Návrhová pozice:

- DPIA musí být hotová **před zpracováním reálných CV** — tj. **před pilotem, ne až ve fázi
  F4**. Smí běžet **souběžně s F0** na syntetických/souhlasných vzorcích.
- DPIA **sdílí obsah s Annexem IV** (technická dokumentace) — dělat je koordinovaně.

Co má DPIA pro faxx-hr věcně obsáhnout (aby nešlo o formalitu): (1) **systematický popis
zpracování** — jaké kategorie osobních údajů se z CV berou, jaké se záměrně **neberou**
(chráněné znaky jen jako příznak), tok dat cloud ↔ on-prem, retence; (2) **posouzení
nezbytnosti a proporcionality** vůči účelu (výběr kandidáta); (3) **rizika pro práva a
svobody** subjektů — chybná extrakce vedoucí k neférovému hodnocení, proxy diskriminace,
automation bias personalisty, únik dat; (4) **opatření** — třívrstvá obrana (kap. 9), datové
oddělení identity, lidský dohled, on-prem ČR, šifrování/přístupová práva. Řada těchto vstupů
už existuje rozptýlená v DESIGN/THREAT-MODEL/AI-ACT; DPIA je má **sesbírat a formalizovat**,
ne vymýšlet od nuly — proto sdílení obsahu s Annexem IV.

**Poctivě:** DPIA dnes **neexistuje** jako dokument. Je to blokující položka před reálnými
daty, ne „nice to have" na konec. Podklady jsou, sestavení chybí. Viz 10.7.

### Minimalizace, právní tituly, retence, práva subjektu

- **Minimalizace:** extrahuje se jen to, co rubrik potřebuje; chráněné znaky jen jako příznak.
- **Právní titul:** čl. 6 — opatření před uzavřením smlouvy (uchazeč sám žádá o pozici);
  u chráněných kategorií pozor na čl. 9.
- **Retence:** `retention_days` **per zadání** — CV se nedrží déle, než je účel výběru.
  Retence musí být **odůvodněná účelem** (délka výběrového řízení + přiměřená lhůta na
  případný spor), ne „ať to tu je". Neúspěšné uchazeče je typicky nutné vymazat dřív než
  přijaté; delší držení „pro budoucí příležitosti" vyžaduje **samostatný souhlas**.
- **Mazání:** **koordinované mazání R2 + D1** (originál i odvozená data — extrahovaný text,
  bitmapy, skóre, flagy) po uplynutí retence nebo na žádost. Háček, který oponent hledá:
  mazání musí zasáhnout **všechny kopie** včetně mezivýstupů a logů odvozených z osobních
  údajů — ne jen „hlavní" záznam. Audit log může kvůli integritě přežít, ale pak nesmí
  obsahovat osobní data subjektu (jen pseudonymní reference). Pozn.: R2/D1 perzistence je
  backlog → dnes je retence/mazání vlastnost **návrhu**, ne běhu (živá appka je bezstavová,
  data žijí v prohlížeči personalisty a v jeho localStorage/JSON exportu — což samo je
  GDPR-relevantní úložiště na straně provozovatele, i když ne na serveru).
- **Práva subjektu:** přístup, výmaz, **vysvětlení** (evidence kotvy + rozpad po kritériích
  jsou přímo použitelné jako podklad vysvětlení, což je vedlejší přínos vysvětlitelné
  architektury).

### ZDR u Claude

Až se zapojí Claude backend (dnes běží Cloudflare Workers AI, Claude vyžaduje klíč a **není**),
platí: Claude API **z principu netrénuje** na datech zákazníka a **Zero Data Retention** je
**org nastavení** Anthropic. To je relevantní pro GDPR (žádné sekundární zpracování osobních
údajů poskytovatelem modelu) i pro data governance. Dnes je AI cesta na Workers AI (edge, CF);
tvrzení o ZDR se váže výhradně na Claude a nabude platnosti až s jeho zapojením.

## 10.6 Transparentnost vůči uchazeči (čl. 50 + GDPR informační povinnost)

Dvě transparentnostní povinnosti míří na **uchazeče** (ne provozovatele):

- **AI Act čl. 50** — informovat, že jde o AI systém / AI-asistované hodnocení.
- **GDPR čl. 13/14** — informovat o zpracování, jeho účelu, logice, retenci a právech.

**Poctivě: obojí dnes chybí formálně.** Návrh to zná (v mapování označeno „chybí formálně"),
ale konkrétní informační text pro uchazeče (že jeho CV posuzuje AI-asistovaný nástroj, s jakou
logikou, jak dlouho se drží, jaká má práva) není součástí živé appky ani dokumentace. Je to
nutná položka před reálnými uchazeči — technicky triviální, regulatorně povinná.

## 10.7 Poctivě: co CHYBÍ (a co je blokující před reálnými CV)

Shrnutí regulatorních mezer, oddělené na **blokující před reálnými daty** a **před produktem**.
Toto je pro oponenta nejcennější část kapitoly.

### Blokující PŘED zpracováním reálných CV (před pilotem)

1. **DPIA (GDPR čl. 35)** — neexistuje. Musí být před reálnými daty; smí běžet souběžně s F0
   na syntetických/souhlasných vzorcích. **Nejvyšší priorita.**
2. **Annex IV-lite (technická dokumentace AI Act)** — neexistuje jako samostatný dokument.
   Podklady jsou (architektura, rubrik, threat model), ale nejsou sestavené do formátu Annex IV.
   Annex IV žádá mj.: **obecný popis** systému a účelu, **detailní popis prvků** a vývojového
   procesu, **monitoring/kontrolu** a očekávané chování, **řízení rizik** (čl. 9), **změny**
   v čase, seznam **norem**, **prohlášení o shodě** a popis **post-market** plánu. Většina
   vstupů existuje rozptýlená napříč DESIGN/ARCHITECTURE/THREAT-MODEL/AI-ACT — chybí **sesbírání
   do jednoho auditovatelného artefaktu**. „-lite" = přiměřeně fázi pilotu, ne plný providerský
   balík. Sdílí obsah s DPIA → dělat koordinovaně. **Nejvyšší priorita.**
3. **Měřitelný lidský dohled — metrika odchylek** rozhodnutí od ratingu. Neimplementováno.
   Bez ní nelze doložit skutečnost dohledu (čl. 14 + GDPR čl. 22).
4. **Test proxy-diskriminace** jako běžící procedura, ne koncept (čl. 10 / antidiskriminace).
5. **Informační text pro uchazeče** (čl. 50 + GDPR čl. 13/14).
6. **Doměřená robustnost/přesnost** — held-out F0 sada (sestavená **někým jiným než autorem
   detektoru**) + externí red-team → exit: recall ≥98 % na otrávených, FP ≤5–10 % na čistých,
   přesnost extrakce ≥90 %. Dnes jen ladicí sada (24/24), **ne held-out**. Čl. 15 to vyžaduje.

### Blokující PŘED produktem (pro cizí HR)

7. **Formalizovaný proces řízení rizik** (čl. 9) jako živý registr.
8. **Posouzení shody + CE + registrace** v roli provider (čl. 11 + navazující).
9. **Externí pen-test / red-team** (čl. 15, kyberbezpečnost).
10. **Hašové řetězení audit_logu** (integrita záznamů) + retenční politika logů.
11. **Reálná D1/R2 perzistence** s koordinovaným mazáním (dnes bezstavové → retence/mazání
    jen v návrhu).
12. **Kalibrace rubriku proti historickým rozhodnutím** personalisty (reprodukovatelné ≠
    správné — čl. 10 kvalita dat).

### Co je naopak reálně silné (aby tabulka nevyzněla jen negativně)

- Chráněné atributy **datově** mimo skórování — strukturální, ne promptová antidiskriminace.
- Decision support jako **architektura**, ne slib — schéma bez verdikt-pole + deterministický
  rubrik znamenají, že „auto-zamítnutí" nemá kde vzniknout.
- Vysvětlitelnost (evidence kotvy + rozpad) je **vestavěná**, ne dolepená — přímo použitelná
  pro právo na vysvětlení i pro transparentnost.
- Regulatorní pozice je **konzervativní správným směrem**: stavět jako high-risk už teď,
  odklad brát jako rezervu.

## 10.8 Sousední rámce (laťka provozovatele): NIS2 + CRA

Pro úplnost, mimo AI Act a GDPR: provoz nástroje s osobními daty naráží na **NIS2** a **CRA**.
Návrhová laťka: řízení přístupu (role personalista/správce), logování + integrita (hašové
řetězení audit_logu — k doplnění), incident response, **SBOM** + řízení zranitelností, bezpečné
aktualizace. Toto je backlog pro produkční fázi, ne pro pilot — ale patří do rozvahy, aby se
na to nezapomnělo pod tíhou AI Act. Zda NIS2 na konkrétního provozovatele **dopadá** (závisí
na sektoru a velikosti subjektu), je samostatná právní otázka; návrh laťku drží spíš jako
dobrou praxi než jako doložený závazek — a nepředstírá, že ji dnes plní (append-only ano,
hašové řetězení a SBOM zatím ne).

Jemné, ale pro oponenta podstatné rozlišení napříč celou kapitolou: **„splněno návrhem"
znamená, že mechanismus je v architektuře, ne že běží na produkci s reálnými daty a je
doložený.** Živá appka je bezstavová (bez D1/R2), takže vše, co se opírá o perzistenci —
audit logy po dobu života systému (čl. 12), retence a mazání (GDPR), post-market monitoring
(čl. 9) — je dnes **návrh, ne provoz**. To není v rozporu s regulatorní pozicí; je to poctivé
přiznání, ve které fázi zralosti se jednotlivé povinnosti reálně plní. Kdo by z tabulek v 10.2
vyčetl „hotovo", přečetl by je proti záměru této kapitoly.

## 10.9 Praktický princip (shrnutí)

> **Nikdy automatické zamítnutí.** Aplikace = decision support. Stavět podle standardu
> high-risk **už teď**. Případný legislativní odklad AI Act = rezerva na dokumentaci, **ne**
> důvod odkládat návrh. GDPR a antidiskriminace platí nezávisle na AI Act. A především:
> **NESTAVĚT únik z high-risk přeznačením** — relabeling na „search tool"/„statistiku"
> neobstojí ani u AI Act, ani u GDPR čl. 22. Jediná obhajitelná cesta je vzít vysoké riziko
> jako fakt a plnit ho, včetně poctivého seznamu toho, co ještě chybí.

> **Vyznění kapitoly.** faxx-hr má **správně nastavenou regulatorní osu** (high-risk bez
> výmluv, decision support jako architektura, antidiskriminace datově vynucená) a několik
> reálně silných strukturálních prvků. Zároveň má **konkrétní, pojmenované a poctivě
> přiznané mezery** — z nichž DPIA, Annex IV-lite, metrika lidského dohledu a doměřená
> robustnost jsou **blokující před reálnými CV**. Kdo by kapitolu četl jako „compliance
> hotová", četl by ji špatně; kdo ji čte jako „obhajitelná trajektorie s jasným seznamem, co
> dodělat před pilotem", čte ji správně.
