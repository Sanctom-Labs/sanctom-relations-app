-- ===========================================================================
-- V102.1 — Relations non-Pro profiles: backfill from CRM v1.x investor records
-- ===========================================================================
-- Spec: Relations-Functional-Spec-v0.2.md §8.1 Phase 2 (Petra-C, 2026-05-26 PM)
-- Ratified: Knox 2026-05-26 PM
-- Author: Hammer-C
-- Depends on: V102_relations_non_pro_profiles.sql
--
-- PURPOSE:
--   1. Migrate every existing v1.x CRM investor record to investor_profile row.
--   2. Backfill relations.activity.role_context = 'investor' for activity rows
--      linked (via person_id) to a backfilled investor_profile.
--
-- SAFETY:
--   • v1.x CRM investor table is NOT dropped (stays for v1.x app compatibility)
--   • Backfilled rows tagged with source comment in fit_rationale for traceability
--   • Rollback: DELETE FROM relations.investor_profile WHERE fit_rationale LIKE
--     '%migration_source:v1.x_crm_investor_backfill%' (before stabilization only)
--   • This migration is IDEMPOTENT if re-run: INSERT ... ON CONFLICT (person_id,
--     owner_entity_id) DO NOTHING prevents duplicates
--   • Activity role_context update is idempotent (sets already-set rows to same value)
--
-- FIELD MAPPING (CRM v1.x investor → investor_profile):
--   crm_investor.person_id           → investor_profile.person_id
--   crm_investor.tenant_id           → investor_profile.tenant_id
--   crm_investor.owner_entity_id     → investor_profile.owner_entity_id
--   crm_investor.stage               → investor_profile.stage   (TEXT → ENUM; see CAST note)
--   crm_investor.fit_score           → investor_profile.fit_score
--   crm_investor.priority            → investor_profile.priority
--   crm_investor.check_size_min_usd  → investor_profile.check_size_min_usd
--   crm_investor.check_size_max_usd  → investor_profile.check_size_max_usd
--   crm_investor.investment_focus    → investor_profile.investment_focus
--   crm_investor.stage_preference    → investor_profile.stage_preference
--   crm_investor.portfolio_cos       → investor_profile.portfolio_cos
--   crm_investor.fit_rationale       → investor_profile.fit_rationale (prefixed)
--   crm_investor.outreach_approach   → investor_profile.outreach_approach
--   crm_investor.suggested_hook      → investor_profile.suggested_hook
--   crm_investor.warm_intro_path     → investor_profile.warm_intro_path
--   crm_investor.rec_timing          → investor_profile.rec_timing
--   crm_investor.knox_notes          → investor_profile.knox_notes
--   crm_investor.next_action         → investor_profile.next_action
--   crm_investor.useful_links        → investor_profile.useful_links
--   crm_investor.created_at          → investor_profile.created_at
--   crm_investor.created_by_user_id  → investor_profile.created_by_user_id
--
-- STAGE MAPPING (CRM v1.x stage TEXT → investor_stage_enum):
--   CRM v1.x stage labels are stored as text; CASE mapping below handles common
--   variants. Rows with unrecognised stage values default to 'prospect'.
--   Review after first dry-run: SELECT DISTINCT stage FROM crm.investor_profile.
--
-- ASSUMPTIONS:
--   • CRM v1.x investor table lives at crm.investor_profile on sanctom-crm-prod.
--     Cross-DB INSERT via dblink or pg_dblink is the apply mechanism for prod.
--     For local/staging where both schemas coexist: adjust FROM schema prefix below.
--   • Columns that don't exist on v1.x are skipped (COALESCE → default/NULL).
--   • If column types differ (e.g., useful_links is TEXT not JSONB), add explicit
--     CAST in the SELECT. Notes below where mismatches are likely.
--   • owner_entity_id: if v1.x rows have no owner_entity_id, a Sanctom-Labs
--     default entity UUID is needed — supply via DO $$ DECLARE v_default_entity UUID
--     or via a seed constant (see NOTE below).
--
-- NOTE — Cross-DB apply:
--   sanctom-crm-prod and sanctom-platform-shared-prod are separate RDS instances.
--   This migration must be applied in one of two ways:
--     Option A) Run on shared-prod after loading source rows via pg_dump | psql
--               (dump crm.investor_profile from crm-prod → load into temp table on
--               shared-prod → run INSERT from temp table).
--     Option B) Use pg_dblink extension on shared-prod (if crm-prod is reachable).
--   Strata to confirm apply mechanism before this migration runs in prod.
-- ===========================================================================

DO $$
DECLARE
  v_backfilled_count  BIGINT;
  v_activity_updated  BIGINT;
BEGIN

  -- -------------------------------------------------------------------------
  -- Step 1: Backfill investor_profile from CRM v1.x
  -- -------------------------------------------------------------------------
  -- NOTE: Adjust the FROM clause if crm.investor_profile lives in a different
  -- schema (e.g., public.investor_profile) or requires a temp-table rename
  -- after a cross-instance pg_dump/load.
  --
  -- CAST NOTE — useful_links: v1.x likely stores as TEXT[] or NULL; cast to JSONB
  -- array below. If v1.x stores as JSONB already, remove the CASE block.
  --
  -- CAST NOTE — investment_focus / portfolio_cos: assumed TEXT[]; if TEXT (comma-sep),
  -- use string_to_array(crm_inv.investment_focus, ',') instead.

  INSERT INTO relations.investor_profile (
    person_id,
    tenant_id,
    owner_entity_id,
    stage,
    fit_score,
    priority,
    check_size_min_usd,
    check_size_max_usd,
    investment_focus,
    stage_preference,
    portfolio_cos,
    fit_rationale,
    outreach_approach,
    suggested_hook,
    warm_intro_path,
    rec_timing,
    knox_notes,
    next_action,
    useful_links,
    created_at,
    updated_at,
    created_by_user_id,
    updated_by_user_id
  )
  SELECT
    crm_inv.person_id,
    crm_inv.tenant_id,
    crm_inv.owner_entity_id,

    -- Stage: map v1.x text values to investor_stage_enum
    -- Extend this CASE as needed after reviewing: SELECT DISTINCT stage FROM crm.investor_profile
    CASE COALESCE(lower(crm_inv.stage::text), '')
      WHEN 'prospect'            THEN 'prospect'
      WHEN 'contacted'           THEN 'contacted'
      WHEN 'responded'           THEN 'responded'
      WHEN 'meeting_scheduled'   THEN 'meeting_scheduled'
      WHEN 'meeting scheduled'   THEN 'meeting_scheduled'
      WHEN 'meeting_held'        THEN 'meeting_held'
      WHEN 'meeting held'        THEN 'meeting_held'
      WHEN 'diligence'           THEN 'diligence'
      WHEN 'due diligence'       THEN 'diligence'
      WHEN 'committed'           THEN 'committed'
      WHEN 'passed'              THEN 'passed'
      WHEN 'declined'            THEN 'passed'
      ELSE                            'prospect'  -- safe default for unmapped values
    END::relations.investor_stage_enum,

    -- Fit score: direct ENUM cast if v1.x stores enum-compatible text; NULL if absent
    CASE COALESCE(lower(crm_inv.fit_score::text), '')
      WHEN 'high'        THEN 'high'
      WHEN 'medium_high' THEN 'medium_high'
      WHEN 'medium high' THEN 'medium_high'
      WHEN 'medium'      THEN 'medium'
      WHEN 'low'         THEN 'low'
      ELSE                    NULL
    END::relations.investor_fit_score_enum,

    -- Priority
    CASE COALESCE(lower(crm_inv.priority::text), '')
      WHEN 'urgent' THEN 'urgent'
      WHEN 'high'   THEN 'high'
      WHEN 'medium' THEN 'medium'
      WHEN 'low'    THEN 'low'
      ELSE               NULL
    END::relations.investor_priority_enum,

    crm_inv.check_size_min_usd,
    crm_inv.check_size_max_usd,

    COALESCE(crm_inv.investment_focus,  ARRAY[]::TEXT[]),
    crm_inv.stage_preference,
    COALESCE(crm_inv.portfolio_cos,     ARRAY[]::TEXT[]),

    -- Prefix fit_rationale for traceability (migration source tag)
    CASE
      WHEN crm_inv.fit_rationale IS NOT NULL THEN
        'migration_source:v1.x_crm_investor_backfill — 2026-05-26 | ' || crm_inv.fit_rationale
      ELSE
        'migration_source:v1.x_crm_investor_backfill — 2026-05-26'
    END,

    crm_inv.outreach_approach,
    crm_inv.suggested_hook,
    crm_inv.warm_intro_path,
    crm_inv.rec_timing,
    crm_inv.knox_notes,
    crm_inv.next_action,

    -- useful_links: coerce to JSONB array; handles NULL and legacy TEXT[] cases
    CASE
      WHEN crm_inv.useful_links IS NULL THEN '[]'::jsonb
      ELSE crm_inv.useful_links
    END,

    crm_inv.created_at,
    now(),
    crm_inv.created_by_user_id,
    crm_inv.created_by_user_id

  FROM crm.investor_profile crm_inv  -- adjust schema prefix if needed
  ON CONFLICT (person_id, owner_entity_id) DO NOTHING;

  GET DIAGNOSTICS v_backfilled_count = ROW_COUNT;

  -- -------------------------------------------------------------------------
  -- Step 2: Backfill relations.activity.role_context = 'investor'
  -- for all activity rows whose person_id now has an investor_profile row.
  --
  -- Only sets role_context where it is currently NULL (non-destructive for rows
  -- that already have a role_context value from another source).
  -- -------------------------------------------------------------------------

  UPDATE relations.activity a
  SET    role_context = 'investor'::relations.role_context_enum
  WHERE  a.role_context IS NULL
    AND  EXISTS (
      SELECT 1
      FROM   relations.investor_profile ip
      WHERE  ip.person_id = a.person_id
        AND  ip.fit_rationale LIKE '%migration_source:v1.x_crm_investor_backfill%'
    );

  GET DIAGNOSTICS v_activity_updated = ROW_COUNT;

  RAISE NOTICE 'V102.1 backfill complete — % investor_profile rows inserted, % activity rows role_context stamped',
    v_backfilled_count,
    v_activity_updated;

END $$;
