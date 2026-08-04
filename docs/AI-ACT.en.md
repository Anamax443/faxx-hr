# AI Act & GDPR — regulatory position of faxx-hr

> [🇨🇿 Čeština](AI-ACT.md) · 🇬🇧 English

> Indicative working overview, not a legal opinion. The specific effective dates and
> deferrals of the AI Act are in flux — verify against the current wording / with a
> legal advisor. The design does not rely on any deferral. GDPR and anti-discrimination
> law apply regardless of the AI Act.

## Classification

Recruitment and candidate selection = **EU Regulation 2024/1689 (AI Act), Annex III, point 4 =
high-risk system** — regardless of the operator's size. The classification is tied to
the purpose, not the degree of automation: even decision support is high-risk.

**Provider vs. deployer:** for an internal pilot, the solo operator is both (the most
demanding variant). For a product aimed at someone else's HR, the roles split
(provider = full QMS, conformity assessment, CE, registration; deployer = informing
affected persons, oversight in operation).

## Mapping of obligations (Art. 9–15) onto the design

| Article | Obligation | faxx-hr element | Status |
|---|---|---|---|
| 9 | Risk management system | Separation of extraction/evaluation, rubric as mitigation | partial (formal process missing) |
| 10 | Data governance / bias | Split of identity/qualification/sensitive; sensitive is not scored | largely |
| 11 + Annex IV | Technical documentation | Architecture, rubric, audit — as supporting material | standalone document missing |
| 12 | Automatic logs | `audit_log` append-only | met |
| 13 | Transparency toward the operator | Evidence anchors, review UI | largely |
| 14 | Human oversight | Decision support + `decisions` (record of the human decision) | met by design |
| 15 | Accuracy, robustness, cybersecurity | Deterministic rubric + security layer against injection | partial (pen-test missing) |
| 50 | Transparency toward the user | Inform applicants about AI-assisted evaluation | formally missing |

## GDPR

- **Art. 22** (human intervention) → decision support; the review must be **genuine**
  (function > name — relabeling to a "search tool" is NOT a reliable shield). Measurable
  mechanisms: minimum review time, a mandatory comment on the decision, randomized
  conformity audits. UX: present "meets X of Y conditions + evidence", not a single "85%".
- **Art. 35 (DPIA)** — for profiling of applicants it is practically mandatory. **Before
  processing real CVs** (before the pilot, not only at F4); it may run in parallel with F0
  on synthetic / consented samples. Shares content with Annex IV.
- **Minimization + retention** (`retention_days` per assignment), legal bases (Art. 6
  pre-contractual measures), data subject rights (access, erasure, explanation).

## Anti-discrimination

Protected characteristics do not reach scoring (enforced at the data level). Residual risk:
proxies (name of school, career gap). Mitigation: periodic fairness testing +
explicit instruction not to take correlating signals into account.

## NIS2 + CRA (the operator's bar)

Access control, logging + integrity (hash chaining of the audit_log), incident response,
SBOM + vulnerability management, secure updates.

## Practical principle

**Never an automatic rejection.** The application = decision support. Build to the high-risk
standard already now; any deferral = a buffer for documentation, not a reason to postpone
the design.
