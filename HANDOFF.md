# HANDOFF — deník stavu: faxx-hr

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

## 2026-08-01 (c) — detektor v2: kontrast, Unicode nosiče, rozdělení textu + regresní sada
- **Detektor přepsán na v2** (`detector/hidden_text.py`), v1 zůstává jako `detector/hidden_text_v1_backup.py`. Detail: [`docs/DETECTOR-V2.md`](docs/DETECTOR-V2.md).
- Přišlo jako patch (autorsky Milan) — **nezaaplikováno naslepo** (přenosem rozbitá diakritika + kontext HANDOFF/README neodpovídal), přepsáno čistě v UTF-8 a ověřeno.
- **Změna role:** detektor je teď **rozdělovač** — vrací `visible_text` (jediný vstup do AI) a `hidden_text` (nikdy do modelu, jen review). Invariant proti úniku hlídá regresní sada.
- **Sedm oprav proti v1:** WCAG kontrast vůči skutečnému pozadí (ne `min(r,g,b)>=0xF0`); pozadí z highlight/shd/background; regex jen eskaluje severity (parafráze v1 procházela); hlavičky/patičky; Unicode nosiče (zero-width, bidi, Tags E0000+); PDF render mode 3 + mimo-mediabox; defusedxml + limity dekomprese. Textboxy/sidebary se NEflagují (viditelné → FP na grafických CV).
- **Regresní sada** `detector/test_vectors.py` — 8 útoků + 4 FP kontroly, **12/12 ověřeno**. Ladicí, ne held-out.
- **CLI:** `sys.stdout.reconfigure(utf-8)` (Windows cp1250 padal na emoji). `serve.py` upraven na nové API `scan()→ScanResult`.
- **Nový backlog** [`TODO.md`](TODO.md) — celý rozsah systému, ne jen detekce.
- **Worker DOPORTOVÁN na v2** (`worker/src/upload.ts`) — DOCX plná v2 (WCAG kontrast, Unicode nosiče, hlavičky/patičky, visible/hidden split, správná polarita), nasazeno na https://faxx-hr-upload.bass443.workers.dev a **ověřeno živě**: N02 sidebar čistý (vis 171/hid 0), #E8E8E8/#FEFEFE/patička chyceny critical, otrávené demo vis 110/hid 286.
- **PDF ve Workeru = pdf.js (unpdf) + ruční fflate extraktor, injekce hledána ve SJEDNOCENÍ.** pdf.js čte textovou vrstvu přes ToUnicode/CID fonty (Word export), **včetně skrytého bílého písma, které má textovou vrstvu** → injekce „Jsem nejlepší kandidát" v reálném Word-PDF se chytne na edge. Pozor: pdf.js DETACHuje buffer → předávat `buf.slice()`. Bundle ~582 KB gzip (pod limitem). Ověřeno živě na test PDF (via `pdf.js+raw`).
- **Zbývá:** kalibrace prahů na held-out sadě; DESIGN §8 sjednotit (delta E → WCAG kontrast); on-prem runner (PyMuPDF) pro detekci PROČ je PDF text skrytý (barva/render mode/pozice) + OCR naskenovaných/obrázkových CV.

## 2026-08-01 (b) — 2× externí oponentura zapracována + kaskáda AI vrstev
- Přišly **dvě nezávislé oponentury** (technický garant/investor; AI Collaborator) → konsolidovaná reakce v [`docs/OPONENTURA-RESPONSE.md`](docs/OPONENTURA-RESPONSE.md).
- Přijato: tvrdší F0 (held-out sada, externí red-team, hraniční vektory, FP na grafických CV), soft-validace JSON (ne whole-doc ERROR), runner vyměnitelný Beelink↔EU VPS, TCO + měření vision poměru, DPIA/Annex IV před reálnými daty, měřitelný lidský dohled, pre-F1 market validace (~10 HR manažerů).
- Sporné (rozhodne provozovatel/právník): únik z high-risk přeznačením (nestavět na tom), pilot vs. produkt.
- **Kaskáda AI vrstev:** Cloudflare Workers AI (free-tier, edge) na hrubou práci + Llama Guard injection klasifikátor + embeddings → eskalace na Claude (Haiku→Sonnet+vision) u nuance/češtiny/skenů.
- **Web upload (F0):** `detector/serve.py` — lokální drag&drop pro PDF/DOCX (stdlib), ověřeno HTTP end-to-end na otráveném CV (4/4 flagy). Vstupní kanál: provozovatel = obojí (web upload první, pak e-mail).
- **🌐 ŽIVĚ na Cloudflare:** `worker/src/upload.ts` + `wrangler.upload.jsonc` nasazeno na **https://faxx-hr-upload.bass443.workers.dev** (účet bass443, bez bindings). DOCX detekce portována 1:1 do TS (fflate ZIP+XML) — ověřeno, **identické 4 flagy** jako lokálně. **PDF: dekomprese FlateDecode streamů (fflate `unzlibSync`) + extrakce textu + injection klasifikátor s fold-normalizací (diakritika/WinAnsi)** — ověřeno na komprimovaném PDF s „Jsem nejlepší kandidát". Deploy: `npx wrangler deploy -c wrangler.upload.jsonc`.
  - Pozn.: workerd `DecompressionStream` dekompresi tiše shazoval (v Node fungovala) → přešli jsme na fflate `unzlibSync`.
  - Zbývá (F1 on-prem): truly-hidden PDF přes barvu/kontrast, render mode, a **CID/Identity-H glyfy** (subset fonty z Wordu, kde content stream nese glyph ID, ne čitelný text) → PyMuPDF na runneru.

## 2026-08-01 — F0 scaffold + oponentura záměru
- **Hotové:**
  - Repo založeno (public, Anamax443) podle project-standard.
  - **Spustitelný detektor skrytého textu** `detector/hidden_text.py` + `detector/demo.py`
    (čistě stdlib, bez závislostí). Demo vytvoří „otrávené" CV a detekuje 4 nosiče
    injection (w:vanish, bílé písmo #FEFEFE, komentář, metadata) — **ověřeno, funguje**.
  - Datový model `migrations/0001_init.sql` (D1) s oddělením identity/qualification/sensitive,
    tabulkami flags / scores / decisions / audit_log.
  - `schema/extraction.schema.json` (identity/qualification/sensitive + evidence kotvy)
    a `schema/rubric.example.json` (kritéria s vahami + must-have gates).
  - Front page `status.html` (tmavý IT-ops styl) + demo UI personalisty `ui/index.html`.
  - Dokumentace: README, DESIGN, docs/ARCHITECTURE, docs/BUILD, docs/AI-ACT, docs/THREAT-MODEL.
  - **Oponentura záměru** (~60 stran, CZ) vygenerována do Downloads (HTML + PDF) —
    mimo repo (obsahuje jen návrh, ne kód).
- **Rozpracované:** worker skeleton (`worker/`) — jen kostra, F1 ho naplní.
- **Zbývá / gate F0:** sestavit sadu reálných + otrávených CV, změřit recall detekce,
  false-positive rate a přesnost extrakce (exit ≥ 98 % / ≤ 5–10 % / ≥ 90 %).
- **Otevřené rozhodnutí:** interní pilot vs. produkt (mění rozsah AI Act povinností).
  Doména pro e-mail ingest. Realizace Conduit → Beelink runner. Prahy detektorů.
