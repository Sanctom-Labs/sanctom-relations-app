-- ===========================================================================
-- V101 — Relations Pro Profile schema
-- ===========================================================================
-- Spec: Relations-Pro-Functional-Spec-v0.2.md §9 (Petra-C, 2026-05-26 PM)
-- Ratified: Knox 2026-05-26 PM
-- Author: Hammer-C
-- Target: sanctom-platform-shared-prod (coordinated with Strata)
--
-- DEPENDENCY PRE-CONDITIONS (must exist on sanctom-platform-shared-prod before applying):
--   • platform.tenant(id)          — TN bootstrap (V001_tenant.sql, PR #38 at b87299b) ✅
--   • contacts.person(id)          — CT Contacts (PR #20 at ba8cce6) ✅ merged
--                                    CONFIRMED by Strata 2026-05-27: canonical schema is
--                                    `contacts` (not `ct`). `ct` does not exist on shared-prod.
--                                    FK below corrected to `contacts.person`. (F-20-class drift)
--   • platform.entity(id)          — F-EN Entity Arch v0.1; NOT yet deployed on shared-prod
--                                    (gated on Entity platform service spec). FK is written
--                                    per spec; will fail until F-EN lands. See §STRATA-NOTE.
--   • platform.fn_set_updated_at() — TN bootstrap V001_tenant.sql ships this ✅
--   • platform.user_can_see_entity_data() — F-EN RLS helper fn; same gate as platform.entity
--   • platform.user_has_entity_role()     — F-EN RLS helper fn; same gate as platform.entity
--   • relations.activity_type ENUM — existing v1.x enum (from sanctom-crm-prod schema);
--                                    must be migrated/created on shared-prod before §9.4 applies
--
-- §STRATA-NOTE — FK dispositions (all closed 2026-05-27, Strata ping):
--   1. RESOLVED: canonical CT schema is `contacts` (not `ct`). FK corrected to contacts.person.
--   2. RESOLVED: F-EN gated — FK commented out, owner_entity_id UUID NOT NULL, app-layer only.
--      TODO ALTER TABLE migration queued at F-EN ship time.
--   3. RESOLVED: cross-instance FK impossible. created_by/updated_by UUID NOT NULL, app-layer only.
-- Drift 8a: GUC name corrected to platform.current_tenant_id() across all 3 RLS policies.
-- Drift 8b/8c: platform.user_can_see_entity_data() + platform.user_has_entity_role() stubs
--   will ship as V002_entity_helpers.sql (Strata stewardship; Option C ratified by Hammer-C).
--
-- SEQUENCING NOTE: §11.1 lists pro_profile before onboarding_template, but
-- pro_profile carries FK to onboarding_template — onboarding_template is
-- created first here (corrected ordering).
--
-- ENUM VALUES NOTE: spec §12.1 AC-PRO-1 says "7 new enums"; DDL defines 8
-- (payout_account_status_enum + onboarding_status_enum also new). All 8 created.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Ensure relations schema exists
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS relations;

-- ---------------------------------------------------------------------------
-- §9.1 — Step 1: 8 new ENUMs
-- ---------------------------------------------------------------------------

CREATE TYPE relations.pro_type_enum AS ENUM (
  'coach', 'therapist', 'mentor', 'trainer', 'tutor', 'healer', 'practitioner',
  'attorney', 'accountant', 'financial_advisor', 'consultant',
  'plumber', 'electrician', 'contractor', 'handyman',
  'other'
);

CREATE TYPE relations.pro_category_enum AS ENUM (
  'healing_arts', 'professional_services', 'trades', 'other'
);

CREATE TYPE relations.billing_model_enum AS ENUM (
  'session_based', 'billable_hours', 'job_based', 'aum_percent',
  'flat_fee', 'retainer', 'hybrid'
);

CREATE TYPE relations.engagement_structure_enum AS ENUM (
  'recurring_sessions', 'case_based', 'annual_plus_adhoc',
  'ongoing_relationship', 'job_to_completion'
);

CREATE TYPE relations.regulatory_tier_enum AS ENUM (
  'none', 'cert_based', 'state_license', 'multi_state_license', 'federal_regulatory'
);

CREATE TYPE relations.pro_stage_enum AS ENUM (
  'prospect', 'contacted', 'screened', 'onboarded', 'active',
  'churn', 'reactivation'
);

CREATE TYPE relations.payout_account_status_enum AS ENUM (
  'unverified', 'pending', 'verified', 'suspended'
);

CREATE TYPE relations.onboarding_status_enum AS ENUM (
  'not_started', 'in_progress', 'paused', 'complete', 'failed'
);

-- ---------------------------------------------------------------------------
-- §9.2 — Step 2: relations.onboarding_template (created BEFORE pro_profile
--         because pro_profile carries FK → onboarding_template.id)
-- ---------------------------------------------------------------------------

CREATE TABLE relations.onboarding_template (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version    TEXT NOT NULL,
  pro_type            relations.pro_type_enum NOT NULL,
  regulatory_tier     relations.regulatory_tier_enum NOT NULL,
  steps               JSONB NOT NULL,
  is_active           BOOL NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at       TIMESTAMPTZ,
  superseded_by_id    UUID REFERENCES relations.onboarding_template(id)
);

-- Partial unique index: only one active template per (pro_type, regulatory_tier).
-- Replaces the table-level UNIQUE constraint in §9.2 which would block multiple
-- historical inactive rows for the same (pro_type, regulatory_tier) pair.
CREATE UNIQUE INDEX onboarding_template_active_unique_idx
  ON relations.onboarding_template (pro_type, regulatory_tier)
  WHERE is_active = true;

-- Lookup index for active template resolution
CREATE INDEX onboarding_template_lookup_idx
  ON relations.onboarding_template (pro_type, regulatory_tier)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- §9.1 — Step 3: relations.pro_profile (26 columns per spec §4.1)
-- ---------------------------------------------------------------------------

CREATE TABLE relations.pro_profile (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Person + tenancy context
  -- Canonical CT schema is `contacts` (confirmed by Strata 2026-05-27 against
  -- services/contacts/migrations/003_create_person_table.sql:10). Spec drift corrected.
  person_id                UUID NOT NULL REFERENCES contacts.person(id) ON DELETE CASCADE,
  tenant_id                UUID NOT NULL REFERENCES platform.tenant(id),
  -- FK-2 DISPOSITION (Strata 2026-05-27, Option B ratified): F-EN Entity service not yet on
  -- shared-prod; FK commented out + apply now. Add FK via ALTER TABLE migration once F-EN lands.
  -- TODO: ALTER TABLE relations.pro_profile ADD CONSTRAINT pro_profile_owner_entity_fk
  --       FOREIGN KEY (owner_entity_id) REFERENCES platform.entity(id);  -- at F-EN ship time
  owner_entity_id          UUID NOT NULL, -- spec: REFERENCES platform.entity(id); F-EN gated: app-layer only

  -- Discriminator + refinement fields
  pro_type                 relations.pro_type_enum NOT NULL,
  pro_category             relations.pro_category_enum NOT NULL,
  billing_model            relations.billing_model_enum NOT NULL,
  engagement_structure     relations.engagement_structure_enum NOT NULL,
  regulatory_tier          relations.regulatory_tier_enum NOT NULL,

  -- Type-specific JSONB fields (per-pro_type schema validated at app layer)
  pro_type_fields          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Universal fields
  specialties              TEXT[] DEFAULT ARRAY[]::TEXT[],
  years_of_experience      INT,
  languages                TEXT[] DEFAULT ARRAY[]::TEXT[],
  capacity_per_period      INT,
  availability_open        BOOL NOT NULL DEFAULT true,
  payout_method            TEXT,
  payout_account_status    relations.payout_account_status_enum NOT NULL DEFAULT 'unverified',

  -- Onboarding state
  onboarding_status        relations.onboarding_status_enum NOT NULL DEFAULT 'not_started',
  onboarding_template_id   UUID REFERENCES relations.onboarding_template(id),

  -- Relationship quality signals (written by Sanctom Pro event sync — read-only in Relations)
  fit_rationale            TEXT,
  utilization_rate         NUMERIC(5,4),
  repeat_client_rate       NUMERIC(5,4),
  nps_score                INT CHECK (nps_score BETWEEN -100 AND 100),
  useful_links             JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Kanban position
  current_stage            relations.pro_stage_enum NOT NULL DEFAULT 'prospect',

  -- Audit trail
  -- created_by/updated_by: AU (auth.users) lives on sanctom-identity-prod, NOT shared-prod.
  -- Cross-instance FKs are not possible in Postgres. FK constraint removed; app layer enforces.
  -- Spec writes REFERENCES auth.users(id) — retained as comment for spec-fidelity traceability.
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id       UUID NOT NULL, -- spec: REFERENCES auth.users(id); cross-instance: app-layer only
  updated_by_user_id       UUID NOT NULL, -- spec: REFERENCES auth.users(id); cross-instance: app-layer only

  -- One pro_profile per person per entity (a person can have multiple profiles
  -- across entities, but only one within a given entity context)
  CONSTRAINT pro_profile_one_per_person_per_entity UNIQUE (person_id, owner_entity_id)
);

-- Indexes
CREATE INDEX pro_profile_tenant_entity_idx
  ON relations.pro_profile (tenant_id, owner_entity_id);
CREATE INDEX pro_profile_pro_type_idx
  ON relations.pro_profile (pro_type);
CREATE INDEX pro_profile_pro_category_idx
  ON relations.pro_profile (pro_category);
CREATE INDEX pro_profile_current_stage_idx
  ON relations.pro_profile (current_stage);
CREATE INDEX pro_profile_engagement_structure_idx
  ON relations.pro_profile (engagement_structure);

-- updated_at trigger (uses shared platform fn_set_updated_at)
CREATE TRIGGER pro_profile_set_updated_at
  BEFORE UPDATE ON relations.pro_profile
  FOR EACH ROW EXECUTE FUNCTION platform.fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- §9.1 RLS — Row-Level Security on relations.pro_profile
-- ---------------------------------------------------------------------------

ALTER TABLE relations.pro_profile ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant-scoped + Entity-context-scoped + entity membership check
CREATE POLICY pro_profile_select_policy ON relations.pro_profile
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()  -- canonical fn (V001_tenant.sql); was: current_setting('app.current_tenant_id')::uuid (wrong GUC name + raw call)
    AND owner_entity_id = current_setting('app.current_entity_id')::uuid
    AND platform.user_can_see_entity_data(
      owner_entity_id,
      current_setting('app.current_user_id')::uuid
    )
  );

-- ALL (INSERT/UPDATE/DELETE): same scope + actor must be Pro-Admin or Org-Admin
CREATE POLICY pro_profile_modify_policy ON relations.pro_profile
  FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()  -- canonical fn (V001_tenant.sql); was: current_setting('app.current_tenant_id')::uuid (wrong GUC name + raw call)
    AND owner_entity_id = current_setting('app.current_entity_id')::uuid
    AND platform.user_has_entity_role(
      owner_entity_id,
      current_setting('app.current_user_id')::uuid,
      ARRAY['org-admin', 'pro-admin']::TEXT[]
    )
  );

-- SELECT override: Sanctom-Staff identity_class sees ALL rows across all tenants
CREATE POLICY pro_profile_staff_select_policy ON relations.pro_profile
  FOR SELECT
  USING (
    tenant_id = platform.current_tenant_id()  -- canonical fn (V001_tenant.sql); was: current_setting('app.current_tenant_id')::uuid (wrong GUC name + raw call)
    AND current_setting('app.identity_class', true) = 'staff'
    AND tenant_id = (SELECT id FROM platform.tenant WHERE slug = 'sanctom-labs')
  );

-- ---------------------------------------------------------------------------
-- §9.3 — Step 4: relations.engagement_structure_stage_label
-- ---------------------------------------------------------------------------

CREATE TABLE relations.engagement_structure_stage_label (
  engagement_structure  relations.engagement_structure_enum NOT NULL,
  stage                 relations.pro_stage_enum NOT NULL,
  label                 TEXT NOT NULL,
  display_order         INT NOT NULL,
  PRIMARY KEY (engagement_structure, stage)
);

-- ---------------------------------------------------------------------------
-- §9.4 — Step 5: Extend relations.activity_type ENUM (additive, non-breaking)
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
--       If your migration runner wraps in BEGIN/COMMIT, extract these statements
--       into a separate pre-transaction script or use a DO $$ EXCEPTION handler.
-- ---------------------------------------------------------------------------

ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'session_booked';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'session_completed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'session_cancelled';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'package_purchased';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'package_completed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'case_opened';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'pleading_filed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'motion_filed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'discovery_request';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'deposition_taken';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'case_settled';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'case_closed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'return_prepared';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'return_filed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'extension_filed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'client_review_meeting';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'ad_hoc_consultation';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'portfolio_review';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'rebalance_executed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'quarterly_meeting';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'quote_provided';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'quote_accepted';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'job_scheduled';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'job_started';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'materials_purchased';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'job_completed';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'invoice_sent';
ALTER TYPE relations.activity_type ADD VALUE IF NOT EXISTS 'payment_received';
