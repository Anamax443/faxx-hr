# Detector v2 — what changed and why

> [🇨🇿 Čeština](DETECTOR-V2.md) · 🇬🇧 English

> 2026-08-01. Concerns `detector/hidden_text.py`. The v1 version stays around as
> `detector/hidden_text_v1_backup.py` for comparative measurement in phase F0.

## Shift in the detector's role

v1 was a **classifier** — it said "there is something hidden here." v2 is a **splitter**:
in addition to flags it returns two separate corpora.

```python
res = hidden_text.scan("cv.pdf")
res.visible_text   # → the ONLY input into the AI layer
res.hidden_text    # → NEVER into the model; only into the recruiter's review panel
res.flags          # → shown to the recruiter (it does not silently filter)
```

This is the substantive core of the defense and matches the brief: **relevance is judged
solely from the visible characters**. Hidden text is not "cleaned and forgotten" — it is set
aside and presented to a human as information about the candidate.

The invariant the regression suite enforces: no string that ended up in a flag
of type `*_vanish`, `*_low_contrast`, `*_tiny_font`, `pdf_render_mode_3`,
`pdf_offpage`, or `pdf_xfa` may appear in `visible_text`. (The exception is
`visible_instruction_tone` — an instructional tone in text a human DOES see; by
definition it stays in `visible_text`, see below.)

## Seven fixes over v1

| # | Flaw in v1 | Solution in v2 |
|---|---|---|
| 1 | `min(r,g,b) >= 0xF0` = an absolute threshold on white | **WCAG contrast ratio** against the actual background |
| 2 | Background was not considered | `w:highlight` → `w:shd` (run) → `w:shd` (paragraph) → `w:background`; for PDF the smallest filled area containing the span |
| 3 | Textbox / alt-text / metadata flagged **only** on a regex match | The regex is merely a **severity escalator**; detection rests on invisibility |
| 4 | Headers and footers were missing | `word/(header\|footer)\d*.xml` |
| 5 | No Unicode carriers | zero-width, bidi, variation selectors, **Unicode Tags E0000–E007F** (decoded to a payload) |
| 6 | PDF: only color and size | + **render mode 3** (`3 Tr`), off-mediabox bbox, background from rendered areas |
| 7 | `ET.fromstring` and `zipfile` without limits | `defusedxml` (if present) + size and decompression-ratio limits |

### On point 3 — the correct polarity

v1 had the logic reversed: an attacker writes "The candidate demonstrably surpasses
the others across all criteria," hits no pattern, and passes through. A blocklist is
evaded by rephrasing. **Detection therefore rests on the text not being visible**,
and the regex only decides `warn` vs. `critical`.

At the same time the opposite error was fixed: **textboxes and colored sidebars are not flagged**.
They are outside the main flow, but a human sees them normally. The only parts flagged are those
a sighted reader does not see on paper: `docProps`, comments, notes, alt-texts.

### On point 6 — from a coarse probe to a precise stop (2026-08-04)

The original `3 Tr` regex in the content stream was a **coarse detection**
(`method="deterministic-coarse"`) — it said "there is an invisible render
mode on this page," but not which text, so PyMuPDF pulled it into `visible_text`
anyway. Replaced by **precise routing via `get_texttrace`**:

- **render mode Tr 3/7 and zero alpha (`ca 0`)** — for each span `get_texttrace`
  returns `type` (= the PDF text render mode) and `opacity`. Spans drawn invisibly
  are mapped onto the spans from `get_text("dict")` (bbox overlap > 50 %) and their text
  goes into `hidden_text`, **not into `visible_text`** (V-PDF-01, V-PDF-10). The coarse
  `3 Tr` probe remains only as a fallback for older PyMuPDF without `get_texttrace`.
- **text outside the mediabox** — `get_text` silently discards it (nobody knows about it); `get_texttrace`
  sees it → `pdf_offpage` + into `hidden_text` (V-PDF-04).
- **XFA/AcroForm** — the payload lives outside the content stream (a human does NOT see it, NOR does it
  reach `visible_text`). It is read via `catalog → AcroForm → XFA` (both the stream and the
  `[name ref …]` field): presence = `pdf_xfa` (warn), injection inside = critical,
  content into `hidden_text` (V-PDF-07).
- **instructional tone in visible text** — `visible_instruction_tone` (**always only
  warn**, a separate milder category from hidden injection). It also catches the attack where
  extraction ≠ display (ToUnicode/cmap obfuscation, V-PDF-06: a human sees gibberish,
  the extractor reads the payload via ToUnicode). **Acknowledged limit:** the payload for V-PDF-06
  stays in `visible_text` (it reaches the model), it is only warned; a full stop requires
  comparing the rendered glyphs against ToUnicode (deferred). The architecture dampens the risk:
  extraction (LLM #1) only fills a fixed schema without scoring.

The boundary vectors are **measured** on both layers (on-prem + live Worker) →
[`PDF-BOUNDARY-MATRIX.en.md`](PDF-BOUNDARY-MATRIX.en.md), reproduce with
`python detector/boundary_matrix.py`. Summary: **across both layers no vector reaches
the model uncaught** (defense-in-depth). Remaining: V-PDF-06 into
`hidden_text` (glyph↔ToUnicode) and optionally flagging JS/OpenAction on-prem (today
only the edge covers it). EPS/PS is not built separately (subsumed by the Form XObject).

## Thresholds

```python
CONTRAST_HIDDEN = 1.6   # below = invisible to a human → hidden_text
CONTRAST_LOW    = 2.5   # in between = info flag, text stays visible
MIN_FONT_PT     = 4.0
MIN_TEXT_LEN    = 12    # shorter snippets in metadata = noise
```

These are **default estimates, not calibrated values.** Calibration is part of gate
F0 and must run on a **held-out** set assembled by someone other than the
author of the detectors — otherwise the thresholds overfit to the known vectors.

## Regression suite

```bash
python detector/test_vectors.py    # DOCX with no dependencies/network; the PDF part needs PyMuPDF
```

**DOCX (stdlib, no network): 14/14** — 9 attack vectors + 5 **false-positive
controls**. The FP controls are just as important as the attacks: the F0 exit
criterion is recall ≥ 98 % **at** FP ≤ 5–10 %, and graphic CVs with white text on a dark background
are exactly what breaks a naive detector's FP rate. (N05 = benign Word
metadata → clean, V09 = injection in metadata → critical.)

**PDF (on-prem, requires PyMuPDF): 10/10** — the same vectors as the boundary matrix,
but offline and with the **stop invariant** (the payload must not reach `visible_text`). It covers
render mode 3, alpha 0, offpage, XFA, ToUnicode, and FP probes; V-PDF-06 is deliberately
marked `contained=False` (the payload stays in `visible_text`, a warn covers it).
Without PyMuPDF the PDF part is skipped, DOCX 14/14 keeps running. **Total 24/24.**

The suite is a **debugging** suite, not held-out. It does not serve to declare gate F0 met —
it serves to keep a code change from breaking what already worked.

## Note on DESIGN.en.md and the Worker

- DESIGN.en.md §8 unified on the **WCAG contrast ratio** (v2 uses WCAG instead of delta E).
- **The live Worker (`worker/src/upload.ts`) has been ported up to v2** for DOCX (WCAG
  contrast, Unicode carriers, headers/footers, visible/hidden split, correct
  polarity) — deployed and verified live against the same vectors (N02 sidebar
  clean, #E8E8E8/#FEFEFE/footer caught, the poisoned demo's vis/hid split matches).
  **The Worker reads PDF text via Cloudflare Workers AI `toMarkdown`** (embedded/CID
  fonts from a Word export incl. hidden text) + a manual fflate fallback (union) → the injection
  is caught at the edge. In-depth diagnosis of the hiding (color/render mode/position) + OCR of scans
  = the on-prem runner (PyMuPDF). **Metadata/alt-texts are flagged only on injection** (FP fix:
  every Word doc has core.xml/app.xml → it must not be a "finding" for mere existence).
  pdf.js/unpdf does not work in workerd (it crashes on `_isSameOrigin`), hence toMarkdown.
