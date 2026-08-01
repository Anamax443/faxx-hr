# HANDOFF — deník stavu: faxx-hr

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

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
