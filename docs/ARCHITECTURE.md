# Architektura — faxx-hr

## Přehled

Autonomní pipeline: CV natečou e-mailem → sanitizace + detekce skrytého textu →
strukturovaná extrakce (LLM) → validace kódem → deterministické skórování →
review personalisty. **Skórovací vrstva nikdy nevidí surový text**, jen validovaný
JSON. Rasterizace/OCR běží on-prem v ČR (GDPR).

## Komponenty

- **CF Email Worker** — příjem e-mailu (postal-mime), uložení přílohy do R2, stav do D1. Recyklace z `job-watch-mail`. *Neinterpretuje obsah.*
- **R2** — immutable originály CV + mezivýstupy (bitmapy, extrahované texty).
- **D1 (SQLite)** — stav dokumentu, metadata, flags, scores, decisions, audit_log.
- **Conduit gateway → on-prem runner (Beelink)** — rasterizace PDF a OCR/vision (cesta B dual-path diffu). Jediné místo, kde vizuální podoba dokumentu s osobními údaji opouští cloud — a záměrně zůstává v ČR.
- **Detektor skrytého textu** — deterministické kontroly (delta E, font < 4pt, render mode 3, off-mediabox, opacity; DOCX w:vanish/komentáře/metadata/alt-text) + sémantika (PhantomLint princip + Haiku klasifikátor). Viz `detector/`.
- **Cloudflare Workers AI (edge, free-tier)** — nejlevnější vrstva kaskády: klasifikace (CV? jazyk?), injection/safety klasifikátor (Llama Guard), embeddings pro sémantickou detekci. Eskaluje na Claude u nuance/češtiny/skenů.
- **LLM #1 (Haiku 4.5 → Sonnet 5)** — extrakce do `schema/extraction.schema.json`, s evidence kotvami; Sonnet + vision na hard/sken. *Nehodnotí.*
- **Validační/normalizační kód** — typy, rozsahy, konzistence, kanonizace (YYYY-MM, CEFR).
- **Rubrik (kód)** — deterministické skóre nad `qualification_json` dle `rubric.example.json`. *Nevidí identity ani sensitive.*
- **LLM #2 (volitelně)** — měkká kritéria, oddělně, nikdy nemění tvrdé skóre.
- **Review UI (Pages)** — skóre, breakdown, evidence, flagy → rozhoduje personalista.

## Datový tok a stavy

```
received → sanitized → extracted → normalized → scored → reviewed → decided
                 └──► flags (skrytý obsah / nízká confidence / hraniční skóre)
                 └──► error (nečitelný formát, timeout…) — nikdy se neztratí
```

## Externí závislosti

- **Anthropic Claude API** (Haiku 4.5, Sonnet 5) — extrakce/klasifikace; režim ZDR.
- **Cloudflare** (Workers, D1, R2, Pages, Email Routing).
- **On-prem runner** (Beelink) — poppler/PyMuPDF/rasterizace; propojení přes Conduit.
- **Dangerzone** (volitelně, CDR/sanitizace) — na on-prem runneru.

Detailní rozbor: [`../DESIGN.md`](../DESIGN.md). Bezpečnost: [`THREAT-MODEL.md`](THREAT-MODEL.md). Regulatorika: [`AI-ACT.md`](AI-ACT.md).
