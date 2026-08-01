# BUILD — jak postavit faxx-hr od nuly

> **Test hotovosti:** dostane se nový člověk (nebo já po výměně PC) JEN z tohoto dokumentu
> k běžící aplikaci? Když ne, doplň, co chybělo.

## 1. Závislosti

- **Python 3.11+** — detektor skrytého textu (`detector/`). Bez závislostí pro demo; PDF sken volitelně `pip install pymupdf`.
- **Node.js 20+** + `npx wrangler` — Cloudflare Worker (F1+).
- **Cloudflare účet** (bass443 dle projektových standardů) — Workers, D1, R2, Email Routing.
- **Anthropic API klíč** — extrakce (Claude Haiku 4.5 / Sonnet 5).
- **On-prem runner** (Beelink) s poppler/PyMuPDF — rasterizace + OCR/vision (F1+).

## 2. Získání kódu

```
git clone https://github.com/Anamax443/faxx-hr
cd faxx-hr
```

## 3. Konfigurace a secrety

- Zkopíruj `*.example` → reálný soubor a vyplň lokálně (nikdy do gitu).
- `ANTHROPIC_API_KEY` → `npx wrangler secret put ANTHROPIC_API_KEY`.
- D1 databáze: `npx wrangler d1 create faxx-hr` → `database_id` do `wrangler.jsonc`.
- R2 bucket: `npx wrangler r2 bucket create faxx-hr-docs`.

## 4. Build / inicializace

```
# Detektor — hned funkční, bez buildu:
python detector/demo.py

# D1 schéma:
npx wrangler d1 execute faxx-hr --file=migrations/0001_init.sql

# Worker (F1):
cd worker && npm install
```

## 5. Spuštění lokálně

```
# Detektor nad konkrétním souborem:
python detector/hidden_text.py cesta/k/cv.docx

# Worker dev:
npx wrangler dev

# UI demo — otevři v prohlížeči:
ui/index.html
```

## 6. Nasazení do produkce

- **Cloud:** `npx wrangler deploy` (Worker + bindings D1/R2). Push na `main` = deploy (F4: přes `.github/workflows`).
- **On-prem runner:** samostatný proces na Beelinku, dosažitelný přes Conduit gateway. Detail realizace = otevřená otázka (viz DESIGN §15).
- **Ověření běhu:** health-check endpoint Workeru + commit hash v odpovědi.

## 7. Certifikáty / přístupy / práva

- Cloudflare API token (least privilege: Workers/D1/R2/Email).
- Anthropic API klíč — v Cloudflare Secrets, ne v gitu.
- Conduit ↔ Beelink: vzájemná autentizace (návrh v samostatné dokumentaci Conduitu).
