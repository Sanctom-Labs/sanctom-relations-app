-- ===========================================================================
-- V102 — Relations non-Pro role profiles schema
-- ===========================================================================
-- Spec: Relations-Functional-Spec-v0.2.md §7 (Petra-C, 2026-05-26 PM)
-- Ratified: Knox 2026-05-26 PM
-- Author: Hammer-C
-- Depends on: V101_relations_pro_profile.sql (relations schema + platform.fn_set_updated_at)
-- Target: sanctom-platform-shared-prod (relations.* schema)
--
-- DEPENDENCY PRE-CONDITIONS (same as V101 — see V101 §STRATA-NOTE for disposition):
--   • ct.person(id)          — CT Contacts service on shared-prod (PR #20 at ba8cce6)
--   • platform.tenant(id)    — TN bootstrap V001_tenant.sql ✅
--   • platform.entity(id)    — F-EN Entity service (not yet on shared-prod; FK is present)
--   • platform.fn_set_updated_at() — TN bootstrap V001_tenant.sql ✅
--   • relations.activity     — existing v1.x activity table (rebrand of crm.activity)
--
-- FK POLICY (same as V101):
--   • ct.person — used in place of spec's contacts.person
--   • platform.entity — present per spec; apply after F-EN lands (or Strata disposition)
--   • auth.user (user_id / created_by / updated_by) — cross-instance; FK REMOVED;
--     app-layer enforcement only (comments retained for spec-fidelity)
--
-- ENUMS: 7 new enums (investor_stage, investor_fit_score, investor_priority,
--        member_stage, member_subscription_status, candidate_stage, role_context)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §7.1 — 7 new ENUMs
-- ---------------------------------------------------------------------------

CREATE TYPE relations.investor_stage_enum AS ENUM (
  'prospect', 'contacted', 'responded', 'meeting_scheduled',
  'meeting_held', 'diligence', 'committed', 'passed'
);

CREATE TYPE relations.investor_fit_score_enum AS ENUM (
  'high', 'medium_high', 'medium', 'low'
);

CREATE TYPE relations.investor_priority_enum AS ENUM (
  'urgent', 'high', 'medium', 'low'
);

CREATE TYPE relations.member_stage_enum AS ENUM (
  'prospect', 'trial', 'paying', 'churned',
  'reactivation', 'winback'
);

CREATE TYPE relations.member_subscription_status_enum AS ENUM (
  'trial', 'active', 'paused', 'churned', 'reactivation_pending'
);

CREATE TYPE relations.candidate_stage_enum AS ENUM (
  'applied', 'screened', 'interviewed', 'offered', 'hired', 'rejected'
);

CREATE TYPE relations.role_context_enum AS ENUM (
  'investor', 'pro', 'member', 'candidate', 'employee', 'cross_role'
);

-- ---------------------------------------------------------------------------
-- §7.2 — relations.investor_profile
-- Full-featured: 8-stage pipeline · fit/priority scoring · Sanctom-Staff-only
-- ---------------------------------------------------------------------------

CREATE TABLE relations.investor_profile (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Spec: REFERENCES contacts.person(id) — actual schema on shared-prod: ct.person
  person_id            UUID NOT NULL REFERENCES ct.person(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES platform.tenant(id),
  -- Spec: REFERENCES platform.entity(id) — F-EN gate; see §STRATA-NOTE in V101
  owner_entity_id      UUID NOT NULL REFERENCES platform.entity(id),

  stage                relations.investor_stage_enum NOT NULL DEFAULT 'prospect',
  fit_score            relations.investor_fit_score_enum,
  priority             relations.investor_priority_enum,
  check_size_min_usd   BIGINT,
  check_size_max_usd   BIGINT,
  investment_focus     TEXT[] DEFAULT ARRAY[]::TEXT[],
  stage_preference     TEXT,
  portfolio_cos        TEXT[] DEFAULT ARRAY[]::TEXT[],
  fit_rationale        TEXT,
  outreach_approach    TEXT,
  suggested_hook       TEXT,
  warm_intro_path      TEXT,
  rec_timing           TEXT,
  knox_notes           TEXT,
  next_action          TEXT,
  useful_links         JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auth.users cross-instance: FK removed; app-layer enforcement
  created_by_user_id   UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  updated_by_user_id   UUID NOT NULL, -- spec: REFERENCES auth.user(id)

  CONSTRAINT investor_profile_one_per_person UNIQUE (person_id, owner_entity_id)
);

CREATE INDEX investor_profile_tenant_idx ON relations.investor_profile (tenant_id);
CREATE INDEX investor_profile_stage_idx ON relations.investor_profile (stage);
CREATE INDEX investor_profile_priority_fit_idx ON relations.investor_profile (priority, fit_score);

CREATE TRIGGER investor_profile_set_updated_at
  BEFORE UPDATE ON relations.investor_profile
  FOR EACH ROW EXECUTE FUNCTION platform.fn_set_updated_at();

ALTER TABLE relations.investor_profile ENABLE ROW LEVEL SECURITY;

-- Sanctom-Staff-only: investor data is strictly internal
CREATE POLICY investor_profile_staff_only ON relations.investor_profile
  FOR ALL
  USING (
    tenant_id = (SELECT id FROM platform.tenant WHERE slug = 'sanctom-labs')
    AND current_setting('app.identity_class', true) = 'staff'
  );

-- ---------------------------------------------------------------------------
-- §7.3 — relations.member_profile
-- Volume-optimized: 8 faceted-filter indexes · 10k+ row scale · Sanctom-Staff-only
-- ---------------------------------------------------------------------------

CREATE TABLE relations.member_profile (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Spec: REFERENCES contacts.person(id) — actual schema on shared-prod: ct.person
  person_id                   UUID NOT NULL REFERENCES ct.person(id) ON DELETE CASCADE,
  tenant_id                   UUID NOT NULL REFERENCES platform.tenant(id),
  -- Spec: REFERENCES platform.entity(id) — F-EN gate; see §STRATA-NOTE in V101
  owner_entity_id             UUID NOT NULL REFERENCES platform.entity(id),

  -- Lifecycle & onboarding
  signup_date                 TIMESTAMPTZ,
  first_session_date          TIMESTAMPTZ,
  onboarding_completion_date  TIMESTAMPTZ,
  subscription_status         relations.member_subscription_status_enum NOT NULL DEFAULT 'trial',
  subscription_tier           TEXT,

  -- Revenue signals (written by billing system / Billpay agent)
  ltv_cents                   BIGINT NOT NULL DEFAULT 0,
  arpu_cents                  INTEGER NOT NULL DEFAULT 0,

  -- Segmentation (written by Tapestry / Cohort agents)
  cohort                      TEXT,
  segment                     TEXT,

  -- Risk signals (written by Retain agent)
  churn_risk_score            NUMERIC(3,2) CHECK (churn_risk_score BETWEEN 0 AND 1),
  last_activity_date          TIMESTAMPTZ,

  -- Coach cross-link (Pro identity-class coach matched to this member)
  -- Spec: REFERENCES contacts.person(id) — actual schema: ct.person
  coach_match_id              UUID REFERENCES ct.person(id),

  current_stage               relations.member_stage_enum NOT NULL DEFAULT 'prospect',
  useful_links                JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auth.users cross-instance: FK removed; app-layer enforcement
  created_by_user_id          UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  updated_by_user_id          UUID NOT NULL, -- spec: REFERENCES auth.user(id)

  CONSTRAINT member_profile_one_per_person UNIQUE (person_id, owner_entity_id)
);

-- 8-axis faceted-filter indexes (§3.4 Volume handling)
-- Optimized for the 4-axis filter pattern on 10k+ rows — no full-table scans
CREATE INDEX member_profile_tenant_idx ON relations.member_profile (tenant_id);
CREATE INDEX member_profile_subscription_status_idx ON relations.member_profile (subscription_status);
CREATE INDEX member_profile_cohort_idx ON relations.member_profile (cohort);
CREATE INDEX member_profile_churn_risk_idx ON relations.member_profile (churn_risk_score DESC NULLS LAST);
CREATE INDEX member_profile_last_activity_idx ON relations.member_profile (last_activity_date DESC NULLS LAST);
CREATE INDEX member_profile_segment_idx ON relations.member_profile (segment);
CREATE INDEX member_profile_current_stage_idx ON relations.member_profile (current_stage);
CREATE INDEX member_profile_coach_match_idx ON relations.member_profile (coach_match_id) WHERE coach_match_id IS NOT NULL;

CREATE TRIGGER member_profile_set_updated_at
  BEFORE UPDATE ON relations.member_profile
  FOR EACH ROW EXECUTE FUNCTION platform.fn_set_updated_at();

ALTER TABLE relations.member_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_profile_staff_only ON relations.member_profile
  FOR ALL
  USING (
    tenant_id = (SELECT id FROM platform.tenant WHERE slug = 'sanctom-labs')
    AND current_setting('app.identity_class', true) = 'staff'
  );

-- ---------------------------------------------------------------------------
-- §7.4 — relations.candidate_profile (stub — minimal v0.2 scope per Brief §3.4)
-- ---------------------------------------------------------------------------

CREATE TABLE relations.candidate_profile (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Spec: REFERENCES contacts.person(id) — actual schema on shared-prod: ct.person
  person_id            UUID NOT NULL REFERENCES ct.person(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES platform.tenant(id),
  -- Spec: REFERENCES platform.entity(id) — F-EN gate; see §STRATA-NOTE in V101
  owner_entity_id      UUID NOT NULL REFERENCES platform.entity(id),
  current_stage        relations.candidate_stage_enum NOT NULL DEFAULT 'applied',
  role_applied_for     TEXT,
  application_source   TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auth.users cross-instance: FK removed; app-layer enforcement
  created_by_user_id   UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  updated_by_user_id   UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  CONSTRAINT candidate_profile_one_per_person UNIQUE (person_id, owner_entity_id)
);

CREATE INDEX candidate_profile_tenant_idx ON relations.candidate_profile (tenant_id);
CREATE INDEX candidate_profile_stage_idx ON relations.candidate_profile (current_stage);

CREATE TRIGGER candidate_profile_set_updated_at
  BEFORE UPDATE ON relations.candidate_profile
  FOR EACH ROW EXECUTE FUNCTION platform.fn_set_updated_at();

ALTER TABLE relations.candidate_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_profile_staff_only ON relations.candidate_profile
  FOR ALL USING (
    tenant_id = (SELECT id FROM platform.tenant WHERE slug = 'sanctom-labs')
    AND current_setting('app.identity_class', true) = 'staff'
  );

-- ---------------------------------------------------------------------------
-- §7.5 — relations.employee_profile (stub — minimal v0.2 scope per Brief §3.5)
-- ---------------------------------------------------------------------------

CREATE TABLE relations.employee_profile (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Spec: REFERENCES contacts.person(id) — actual schema on shared-prod: ct.person
  person_id            UUID NOT NULL REFERENCES ct.person(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES platform.tenant(id),
  -- Spec: REFERENCES platform.entity(id) — F-EN gate; see §STRATA-NOTE in V101
  owner_entity_id      UUID NOT NULL REFERENCES platform.entity(id),
  deel_employee_id     TEXT,
  employment_type      TEXT,
  start_date           DATE,
  end_date             DATE,
  cross_role_links     JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auth.users cross-instance: FK removed; app-layer enforcement
  created_by_user_id   UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  updated_by_user_id   UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  CONSTRAINT employee_profile_one_per_person UNIQUE (person_id, owner_entity_id)
);

CREATE INDEX employee_profile_tenant_idx ON relations.employee_profile (tenant_id);
CREATE INDEX employee_profile_employment_type_idx ON relations.employee_profile (employment_type);

CREATE TRIGGER employee_profile_set_updated_at
  BEFORE UPDATE ON relations.employee_profile
  FOR EACH ROW EXECUTE FUNCTION platform.fn_set_updated_at();

ALTER TABLE relations.employee_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_profile_staff_only ON relations.employee_profile
  FOR ALL USING (
    tenant_id = (SELECT id FROM platform.tenant WHERE slug = 'sanctom-labs')
    AND current_setting('app.identity_class', true) = 'staff'
  );

-- ---------------------------------------------------------------------------
-- §7.6 — relations.saved_filter (per-user; all identity classes)
-- ---------------------------------------------------------------------------

CREATE TABLE relations.saved_filter (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- auth.users cross-instance: FK removed; app-layer enforcement
  user_id         UUID NOT NULL, -- spec: REFERENCES auth.user(id)
  tenant_id       UUID NOT NULL REFERENCES platform.tenant(id),
  name            TEXT NOT NULL,
  filter_json     JSONB NOT NULL,
  pinned          BOOL NOT NULL DEFAULT false,
  display_order   INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT saved_filter_user_name_unique UNIQUE (user_id, name)
);

CREATE INDEX saved_filter_user_idx ON relations.saved_filter (user_id);
CREATE INDEX saved_filter_pinned_idx ON relations.saved_filter (user_id, display_order) WHERE pinned = true;

ALTER TABLE relations.saved_filter ENABLE ROW LEVEL SECURITY;

-- Per-user isolation: user sees only their own saved filters within their current tenant
CREATE POLICY saved_filter_owner_only ON relations.saved_filter
  FOR ALL USING (user_id = current_setting('app.current_user_id')::uuid AND tenant_id = platform.current_tenant_id());

-- ---------------------------------------------------------------------------
-- §7.7 — Extend relations.activity with role_context column
-- NOTE: relations.activity is the v1.x rebrand of crm.activity (existing table).
--       ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent + non-breaking.
-- ---------------------------------------------------------------------------

ALTER TABLE relations.activity
  ADD COLUMN IF NOT EXISTS role_context relations.role_context_enum;

CREATE INDEX activity_role_context_idx
  ON relations.activity (role_context)
  WHERE role_context IS NOT NULL;
