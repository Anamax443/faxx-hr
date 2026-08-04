# Architecture — faxx-hr

> [🇨🇿 Čeština](ARCHITECTURE.md) · 🇬🇧 English

## Overview

Autonomous pipeline: CVs flow in by email → sanitization + hidden-text detection →
structured extraction (LLM) → validation in code → deterministic scoring →
recruiter review. **The scoring layer never sees the raw text**, only validated
JSON. Rasterization/OCR runs on-prem in the Czech Republic (GDPR).

## Components

- **CF Email Worker** — email intake (postal-mime), storing the attachment into R2, state into D1. Recycled from `job-watch-mail`. *Does not interpret the content.*
- **R2** — immutable CV originals + intermediate outputs (bitmaps, extracted texts).
- **D1 (SQLite)** — document state, metadata, flags, scores, decisions, audit_log.
- **Conduit gateway → on-prem runner (Beelink)** — PDF rasterization and OCR/vision (path B of the dual-path diff). The only place where the document's visual appearance with personal data leaves the cloud — and it deliberately stays in the Czech Republic.
- **Hidden-text detector (v2)** — deterministic checks (WCAG contrast against the actual background, font < 4pt, render mode 3, off-mediabox; DOCX w:vanish/headers/footers/Unicode carriers; comments/metadata/alt texts only in case of injection). Splits `visible_text`/`hidden_text`. PDF at the edge via **Cloudflare Workers AI `toMarkdown`**, deep detection on-prem (PyMuPDF). See `detector/` + `docs/DETECTOR-V2.md`.
- **Cloudflare Workers AI (edge, free-tier)** — the cheapest layer of the cascade: classification (CV? language?), injection/safety classifier (Llama Guard), embeddings for semantic detection. Escalates to Claude on nuance/Czech/scans.
- **LLM #1 (Haiku 4.5 → Sonnet 5)** — extraction into `schema/extraction.schema.json`, with evidence anchors; Sonnet + vision for hard/scan. *Does not evaluate.*
- **Validation/normalization code** — types, ranges, consistency, canonicalization (YYYY-MM, CEFR).
- **Rubric (code)** — deterministic score over `qualification_json` per `rubric.example.json`. *Does not see identity or sensitive.*
- **LLM #2 (optional)** — soft criteria, separately, never changes the hard score.
- **Review UI (Pages)** — score, breakdown, evidence, flags → the recruiter decides.

## Data flow and states

```
received → sanitized → extracted → normalized → scored → reviewed → decided
                 └──► flags (hidden content / low confidence / borderline score)
                 └──► error (unreadable format, timeout…) — never lost
```

## External dependencies

- **Anthropic Claude API** (Haiku 4.5, Sonnet 5) — extraction/classification; ZDR mode.
- **Cloudflare** (Workers, D1, R2, Pages, Email Routing).
- **On-prem runner** (Beelink) — poppler/PyMuPDF/rasterization; connected via Conduit.
- **Dangerzone** (optional, CDR/sanitization) — on the on-prem runner.

Detailed analysis: [`../DESIGN.en.md`](../DESIGN.en.md). Security: [`THREAT-MODEL.en.md`](THREAT-MODEL.en.md). Regulatory: [`AI-ACT.en.md`](AI-ACT.en.md).
