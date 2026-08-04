# Response to the external review of the faxx-hr proposal

> [🇨🇿 Čeština](OPONENTURA-RESPONSE.md) · 🇬🇧 English

The v0.1 proposal drew **two independent external reviews**. This document is the
consolidated response — point by point, with a verdict and a pointer to where the change landed.
Both reviews were substantive and moved the design forward; nothing is being swept under the rug.

- **O1** — role: technical guarantor / investor / regulatory advisor (aims at F0 methodology, the rubric, regulation, bus factor).
- **O2** — role: AI Collaborator (aims at operations/scaling, alert fatigue, strict JSON, business model).

Verdicts: **✅ Accepted** · **🔶 Accepted with a scoping clarification** · **⚖️ Contested — operator / lawyer decision**.

---

## 0. Where both reviews agree (taken as binding)

1. **F0 needs tougher criteria** — a separate held-out set (not overfitting to known attacks), an external red team, measuring more than recall/FP.
2. **Validate the market before F1** — ask ~10 CZ HR managers: do they pay for protection against injection, or do they simply want a working parser? The product's value stands or falls on the answer.
3. **Address regulation early**, not as late as F4 — DPIA and Annex IV before processing real CVs.
4. **Operations / bus factor is underestimated** for the product phase.

These four points are folded into F0/the roadmap (see DESIGN §13, §15).

---

## 1. Security and the dual-path diff

| # | Objection | Verdict | Response / change |
|---|---|---|---|
| O2 1.1 | **Same-contrast bypass** (#666 on #777) — dual-path notices no difference, both parsers read the same | 🔶 | Correct that *dual-path* does not catch it. But the **deterministic contrast detector (delta E)** does — low-contrast text↔background is a flag regardless of path agreement. Dual-path and delta-E are **independent** layers; this is exactly the case where dual-path fails and delta-E kicks in. Added to THREAT-MODEL. |
| O2 1.1 | **Alert fatigue** — graphic CVs (Canva/InDesign, multi-column, text as curves) → 15–30 % false positives → the recruiter turns the warnings off | ✅ | The strongest practical objection from either review. Change: (a) dual-path is **not the primary** detector (the primary one is low-FP deterministic: vanish/render-mode/delta-E), it is *supplementary*; (b) the A\B difference is **not flagged raw** — it flows through the injection classifier and fuzzy alignment, flagged only when the text in A is of an instructional character and is missing from B; (c) **FP on real graphic CVs is a separate F0 metric** with an exit threshold. |
| O2 1.2 | **Visual prompt injection** — QR code, micro-text in a logo, optical tricks on the vision model in path B | ✅ | A new vector, added to THREAT-MODEL. The vision model's input is untrusted too. Mitigation: path B's output goes through the same schema (it has no field for a verdict), + detection/flagging of QR/barcodes, + path B serves detection and extraction, not decision-making. |
| O1 1.2 | **EPS/PS objects, obfuscated glyphs (cmap), XFA/JS-generated text** | ✅ | Added as mandatory F0 boundary test cases (DESIGN §13). Obfuscated glyph → dual-path mismatch with the cause "font/cmap," classification via the semantic layer. |
| O1 1.1 | **Detector overfitting** — who assembles the poisoned set | ✅ | F0: separate the detector author from the attack author; held-out set; external red team (DESIGN §13, §15). |

## 2. Operations — "Conduit" and the on-prem runner

| # | Objection | Verdict | Response / change |
|---|---|---|---|
| O2 2.1 | **Beelink as SPOF / sysadmin trap / capacity ceiling** for B2B SaaS | 🔶 | Substantively correct **for a product with an SLA and paying clients**. Scoping clarification: the current scope is an **internal pilot** (one user, no SLA) — there the Beelink is the cheapest and even satisfies the strictest variant (data in the CR). The key: **the runner is deliberately swappable behind the Conduit interface** — pilot = Beelink, product = **EU cloud VPS (Hetzner eu-central / Finland)**, with no change to the architecture. GDPR requires the EU, not the CR — "CR" was a stronger preference, not an obligation. The decision falls at the pilot→product gate. Folded into DESIGN §10. |
| O1 7 | **Bus factor of one** — the mitigation is just an acknowledgment | 🔶 | For the pilot, an accepted risk (the operator risks their own time). For the product: a backup operator / outsourced operations → a condition of the product phase (DESIGN §15, not the pilot). |

## 3. Extraction, JSON, the rubric

| # | Objection | Verdict | Response / change |
|---|---|---|---|
| O2 3.1 | **Fragility of `additionalProperties:false`** — drift in 1 field → the whole CV into ERROR → 1 in 10 fails → unusable | ✅ | A real risk. Change: validation is **field-level "soft" with a repair pass** — unknown keys are *dropped* (the security benefit remains, the verdict field does not exist anyway), types are coerced, a missing/dubious field → a *flag for review*, not an ERROR of the whole document. ERROR only for the unrecoverable (an unreadable file). Folded into DESIGN §7. |
| O2 3.2 | **Deterministic rubric = a blind Excel** — a senior from a broken startup = a senior from a bank; "Python" in hobbies = "Python" for a lead architect | 🔶 | Partly. The nuance does not sit in the rubric, but in the **extraction**: a skill carries `level`, `category`, `evidence` and now also **context/section** → "Python in hobbies" is extracted as `level:basic, context:interest`, not as the architect's. The rubric weights by level+evidence, not by bare occurrence. For "real quality" (bank vs. startup) there is an **optional LLM#2 for soft criteria**, shown to the recruiter *separately* from the hard score. We keep determinism for auditability; the intelligence is supplied by extraction + LLM#2. Added a skill `context` (DESIGN §7). |
| O1 3 | **The rubric is described least, a validation plan is missing; deterministic ≠ correct** | ✅ | Accepted: the rubric is validated against the recruiter's historical decisions (agreement/calibration), not "looks reasonable." Who writes it and how it is updated = part of F3 (DESIGN §9). |

## 4. Regulation — and one dispute between the reviews

**Here O1 and O2 contradict each other and a position has to be taken.**

- **O2 4.1** recommends a *strategic escape from high-risk*: relabel the product as a "Data Structuring / Search tool," drop the score, show only "meets 3 of 5 conditions," and thereby fall out of Annex III.
- **O1 5.3** warns of exactly the opposite: both GDPR Art. 22 and Annex III are governed by **function, not name** — when a human just clicks through a proposal, it is *de facto* an automated decision regardless of the label.

**My position (⚖️):** O1 is right at its core — **relabeling is not a reliable legal shield**. A tool that, for recruitment purposes, structures a CV and shows "meets 3 of 5" is still an input into the evaluation/filtering of candidates; the regulator judges the use, not the marketing description. Betting the compliance strategy on reclassification is as risky as betting on a delay in the regulation taking effect (which O1 warned against).

**What I take from it (and it happens to be a better product too):**
1. **A UX shift YES** — do not lead with a single "Match 85 %," but with **"meets X of Y conditions + evidence"** and let the human weigh it. That lowers the risk and is a better interface regardless of the law. (Folded in: the `ui/index.html` demo already leads the score together with a breakdown and evidence; a "X of Y conditions" presentation above the percentage will be added.)
2. **Do NOT treat reclassification as a plan**, but as a possible bonus after a lawyer's assessment.
3. **Prepare a minimum viable compliance** (DPIA + Annex IV-lite) **before real data** — which is also O1's recommendation.

| # | Objection | Verdict | Response |
|---|---|---|---|
| O1 5.1/5.2 | Annex IV and DPIA are missing, they are mandatory before deployment | ✅ | Moved from F4 to **before processing real CVs** (the pilot). The DPIA may run in parallel with F0, provided F0 runs on synthetic/consented samples. (DESIGN §15, AI-ACT.en.md) |
| O1 5.3 | Art. 22 addressed only formally — a "rubber stamp" | ✅ | Add **measurable** mechanisms of real oversight: a minimum review time, a mandatory comment on the decision, randomized audits of agreement with an independent assessment. (AI-ACT.en.md) |
| O2 4.1 | Escape from high-risk by relabeling | ⚖️ | See above — UX yes, legal shield no. Decide with a lawyer. |

## 5. Economics and business

| # | Objection | Verdict | Response |
|---|---|---|---|
| O2 5.1 | CZK 1.5–3.5/CV; 5000 CVs ≈ CZK 10–17.5k/month variable; digestibility for CZ SMB | ✅ | Consistent with the estimate in the review (§8.4: ~CZK 0.7–3.7/CV). The cascade (Workers AI free-tier doing the rough work) lowers the bottom bound. Measure the real cost/CV and the **share of the vision fallback in F0**; the economics as **TCO/year** including the operator's time. (DESIGN §11) |
| O1 4 | The estimates are only order-of-magnitude; TCO and the vision share are missing | ✅ | See above — TCO + measuring the vision ratio in F0. |
| O1 6 / O2 verdict | The survey is not systematic; validate the market on real HR | 🔶 | A systematic overview of commercial ATS = relevant for the **product** go/no-go, not for the pilot (a closed SaaS falls anyway on on-prem+Czech+auditability, which the operator controls). Added a **pre-F1 step: interviews with ~10 CZ HR managers** (DESIGN §13). |

---

## Summary of changes folded into the design

- **DESIGN §7** — soft/field-level validation (not whole-doc ERROR) + skill `context/section`.
- **DESIGN §8** — dual-path as supplementary, gated through the injection classifier; delta-E on same-contrast.
- **DESIGN §10** — runner swappable behind Conduit: Beelink (pilot) ↔ EU cloud VPS/Hetzner (product).
- **DESIGN §11** — TCO + measuring the vision ratio.
- **DESIGN §13** — F0 tougher: held-out set, external red team, boundary vectors, FP on graphic CVs; pre-F1 market validation.
- **DESIGN §15** — open questions: OCR engine, rubric validation, DPIA/Annex IV before data, product bus factor.
- **docs/AI-ACT.en.md** — DPIA/Annex IV before real data; measurable human oversight; a note on reclassification.
- **docs/THREAT-MODEL.en.md** — same-contrast, alert fatigue/graphic CVs, visual injection (QR/micro-text), strict-JSON.

## What remains an operator decision

1. **Internal pilot vs. product** — determines the runner (Beelink/VPS), the bus-factor mitigation, and the depth of compliance.
2. **Reclassification out of high-risk** — only after a legal assessment; do not build on it.
3. **The value thesis** — after market validation: "protection against injection" vs. "simply a safe CV parser into a table."
