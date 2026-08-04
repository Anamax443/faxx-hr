# Threat model — faxx-hr

> [🇨🇿 Čeština](THREAT-MODEL.md) · 🇬🇧 English

Sensitive project (applicants' personal data + adversarial input). Threat model per
project-standard. Primary threat = **prompt injection via hidden text in a CV**
(OWASP LLM01).

## Actors and goals

| Actor | Goal |
|---|---|
| Applicant-attacker | Overrate themselves (hidden instruction "recommend me") |
| Compromised sender / agency | Forge the CV content without the applicant's knowledge |
| — | Exfiltration of the system prompt / criteria |
| — | DoS (extremely long/recursive text, token consumption) |

## Input vectors → detection

| Vector | Technique | Detection |
|---|---|---|
| PDF text layer | color ≈ background (#FEFEFE) | delta E (CIELAB) |
| PDF text layer | font < 4pt | size check |
| PDF content stream | render mode 3 (invisible) | Tr operator check |
| PDF coordinates | outside mediabox / behind image | z-order + bbox |
| PDF graphics state | opacity < 0.1 | ExtGState ca/CA |
| DOCX text run | `w:vanish` | rPr parsing |
| DOCX color | white/near-white font | w:color vs background |
| DOCX annotations | comments / notes | comments/footnotes/endnotes.xml |
| DOCX | text boxes, alt texts | txbxContent, docPr descr |
| Metadata | docProps | core/app/custom.xml |
| Content | homoglyphs, zero-width, split instructions | semantics (PhantomLint + Haiku classifier) |
| Color | same-contrast (#666 on #777) — **dual-path won't catch it** | delta E (low contrast text↔background) — independent layer |
| Image | visual injection: QR code, micro-text in a logo | QR/barcode detection; the vision model's input is untrusted |
| Font | obfuscated glyphs (cmap), EPS/PS, XFA/JS-generated text | dual-path mismatch + semantics; mandatory F0 edge cases |

## Key mitigations (defense in depth)

1. **Separate extraction from evaluation** — the scoring model never sees the raw text; injection has nowhere to write a verdict.
2. **Dual-path diff** — an independent detector of hidden content (text layer vs. render).
3. **Deterministic detectors + CDR** — no AI = no attack surface, auditable.
4. **Constrained schema** — `additionalProperties:false`, enums; `meta.untrusted_content:true`.
5. **Flag ≠ auto-reject** — human-in-the-loop; a detector error is correctable, not fatal.

## Data protection (GDPR/NIS2)

- Personal data processed **on-prem in the Czech Republic** (rasterization/OCR on the Beelink via Conduit).
- No real CVs or keys in git. Secrets in Cloudflare Secrets.
- `audit_log` append-only (integrity — hash chaining to be added).
- Retention per assignment; coordinated deletion of R2 + D1.
- Least privilege: recruiter role vs. administrator; Conduit ↔ Beelink mutual auth.

## Residual risks

- Semantic detection is probabilistic (false pos/neg) → tune thresholds on a held-out F0 set.
- **Alert fatigue** — graphical CVs (Canva/InDesign, multi-column) create dual-path noise; FP 15–30% → the recruiter stops reading. Mitigation: dual-path is **supplementary** (not primary), the flag is gated through the injection classifier, FP on graphical CVs = a separate F0 metric.
- **Visual prompt injection** — QR/micro-text/optics targeting the vision model; the output goes through the schema (without a verdict field), the QR is flagged.
- Proxy discrimination via signals not removed from the text (name of school…).
- Bus factor of solo operation (mitigation: BUILD.md, simple stack; for a product, a backup operator).
