# BUILD — how to build faxx-hr from scratch

> [🇨🇿 Čeština](BUILD.md) · 🇬🇧 English

> **Readiness test:** can a new person (or me, after swapping PCs) get from JUST this
> document to a running application? If not, add whatever was missing.

## 1. Dependencies

- **Python 3.11+** — hidden-text detector (`detector/`). No dependencies for the demo; PDF scanning optionally via `pip install pymupdf`.
- **Node.js 20+** + `npx wrangler` — Cloudflare Worker (F1+).
- **Cloudflare account** (bass443 per the project standards) — Workers, D1, R2, Email Routing.
- **Anthropic API key** — extraction (Claude Haiku 4.5 / Sonnet 5).
- **On-prem runner** (Beelink) with poppler/PyMuPDF — rasterization + OCR/vision (F1+).

## 2. Getting the code

```
git clone https://github.com/Anamax443/faxx-hr
cd faxx-hr
```

## 3. Configuration and secrets

- Copy `*.example` → the real file and fill it in locally (never into git).
- `ANTHROPIC_API_KEY` → `npx wrangler secret put ANTHROPIC_API_KEY`.
- D1 database: `npx wrangler d1 create faxx-hr` → put the `database_id` into `wrangler.jsonc`.
- R2 bucket: `npx wrangler r2 bucket create faxx-hr-docs`.

## 4. Build / initialization

```
# Detector — works right away, no build:
python detector/demo.py

# D1 schema:
npx wrangler d1 execute faxx-hr --file=migrations/0001_init.sql

# Worker (F1):
cd worker && npm install
```

## 5. Running locally

```
# Detector against a specific file:
python detector/hidden_text.py cesta/k/cv.docx

# Worker dev:
npx wrangler dev

# UI demo — open in a browser:
ui/index.html
```

## 6. Deploying to production

- **Cloud:** `npx wrangler deploy` (Worker + D1/R2 bindings). Push to `main` = deploy (F4: via `.github/workflows`).
- **On-prem runner:** a separate process on the Beelink, reachable through the Conduit gateway. Implementation details = open question (see DESIGN §15).
- **Run verification:** the Worker's health-check endpoint + commit hash in the response.

## 7. Certificates / access / permissions

- Cloudflare API token (least privilege: Workers/D1/R2/Email).
- Anthropic API key — in Cloudflare Secrets, not in git.
- Conduit ↔ Beelink: mutual authentication (design in the separate Conduit documentation).
