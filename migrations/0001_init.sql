-- faxx-hr — D1 (SQLite) init migrace
-- Klíčové rozhodnutí zabudované ve schématu:
--   * scores se počítá JEN z extractions.qualification_json,
--     nikdy nevidí extractions.identity_json;
--   * chráněné atributy nemají vlastní sloupce — jen se flaguje jejich přítomnost;
--   * audit_log a decisions tvoří důkazní vrstvu pro AI Act (čl. 12, 14) + GDPR (čl. 22).

PRAGMA foreign_keys = ON;

-- Zadání + rubrik (váhy nastavuje personalista, ne model)
CREATE TABLE job_requirements (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT,
  rubric_json    TEXT NOT NULL,                  -- {criteria:[{key,weight,type,rule}], must_have_gates:[...]}
  rubric_version INTEGER NOT NULL DEFAULT 1,
  retention_days INTEGER NOT NULL DEFAULT 180,   -- GDPR retence, per zadání
  status         TEXT NOT NULL DEFAULT 'open',   -- open | closed
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- Osoba = identita. Scoring path sem NIKDY nesahá.
CREATE TABLE candidates (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES job_requirements(id),
  source_email TEXT,                             -- adresa, ze které CV dorazilo
  status       TEXT NOT NULL DEFAULT 'received', -- received|sanitized|extracted|normalized|scored|reviewed|decided|error
  created_at   TEXT NOT NULL
);

-- Ingestované soubory (originál je immutable v R2)
CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id),
  r2_key        TEXT NOT NULL,
  original_name TEXT,
  mime_type     TEXT,
  sha256        TEXT NOT NULL,                   -- integrita + dedup
  size_bytes    INTEGER,
  page_count    INTEGER,
  received_at   TEXT NOT NULL
);

-- Strukturovaná extrakce. Dvě oddělené JSON kolony = dva světy.
CREATE TABLE extractions (
  id                 TEXT PRIMARY KEY,
  document_id        TEXT NOT NULL REFERENCES documents(id),
  candidate_id       TEXT NOT NULL REFERENCES candidates(id),
  schema_version     TEXT NOT NULL,
  qualification_json TEXT NOT NULL,              -- POUZE tohle jde do scoringu
  identity_json      TEXT NOT NULL,              -- jméno, kontakt — jen pro personalistu
  dual_path_status   TEXT NOT NULL,              -- match | mismatch | text_only | render_only
  model              TEXT NOT NULL,
  model_version      TEXT,
  extracted_at       TEXT NOT NULL
);

-- Detekce skrytého obsahu / injection. Zobrazuje se, netiše nefiltruje.
CREATE TABLE flags (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  type         TEXT NOT NULL,                    -- hidden_text|invisible_render_mode|tiny_font|low_contrast|
                                                 -- offscreen|docx_vanish|dual_path_mismatch|
                                                 -- injection_classifier|sensitive_attribute_present
  severity     TEXT NOT NULL,                    -- info | warn | critical
  method       TEXT NOT NULL,                    -- deterministic | llm
  evidence     TEXT,                             -- skutečně nalezený skrytý text
  detail_json  TEXT,                             -- {page,bbox,color,font_size,delta_e,...}
  detected_at  TEXT NOT NULL
);

-- Deterministické skóre. computed_by je vždy verze kódu, ne model.
CREATE TABLE scores (
  id             TEXT PRIMARY KEY,
  candidate_id   TEXT NOT NULL REFERENCES candidates(id),
  job_id         TEXT NOT NULL REFERENCES job_requirements(id),
  rubric_version INTEGER NOT NULL,
  total_score    REAL NOT NULL,
  breakdown_json TEXT NOT NULL,                  -- {criterion_key: {score, weight, evidence_ref}}
  soft_llm_json  TEXT,                           -- volitelná měkká kritéria (LLM#2), oddělně
  computed_by    TEXT NOT NULL,                  -- 'rubric@v1.2.0'
  computed_at    TEXT NOT NULL
);

-- Lidské rozhodnutí = důkaz human oversight (AI Act čl. 14 + GDPR čl. 22).
CREATE TABLE decisions (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  job_id       TEXT NOT NULL REFERENCES job_requirements(id),
  reviewer     TEXT NOT NULL,
  decision     TEXT NOT NULL,                    -- advance | reject | hold
  rationale    TEXT,                             -- vlastní zdůvodnění personalisty
  score_shown  REAL,                             -- jaké skóre viděl v okamžiku rozhodnutí
  overrode_ai  INTEGER NOT NULL DEFAULT 0,       -- šel proti návrhu systému?
  decided_at   TEXT NOT NULL
);

-- Immutable audit. Append-only, každá akce systému i člověka.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,                     -- candidate|document|extraction|score|decision
  entity_id   TEXT NOT NULL,
  actor       TEXT NOT NULL,                     -- user:mtrnka | system:extract | system:score
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  at          TEXT NOT NULL
);

CREATE INDEX idx_candidates_job ON candidates(job_id, status);
CREATE INDEX idx_documents_cand ON documents(candidate_id);
CREATE INDEX idx_extractions_cand ON extractions(candidate_id);
CREATE INDEX idx_flags_cand     ON flags(candidate_id, severity);
CREATE INDEX idx_scores_cand    ON scores(candidate_id);
CREATE INDEX idx_decisions_cand ON decisions(candidate_id);
CREATE INDEX idx_audit_entity   ON audit_log(entity_type, entity_id);
