-- ===========================================================================
-- V102.1_DEFERRED — Relations non-Pro profiles: backfill from CRM v1.x investor records
-- ===========================================================================
-- DEFERRED — renamed from V102.1 on 2026-06-03 (Hammer-C, per Strata pre-flight).
--
-- Why this is still a _DEFERRED (out-of-band) run, not a standard ordered apply:
--   1. CROSS-DB: reads the v1.x CRM investor records from the old CRM v1.x database.
--      UPDATE 2026-06-06 (Petra-C, per Knox): Knox is no longer using the old CRM v1.x
--      investor DB — it is now a FROZEN source and he just wants the data preserved into
--      the new DB. So this is a ONE-TIME OFFLINE COPY from a frozen source (pg_dump+load
--      into a temp table on shared-prod), NOT an attended live ceremony. Strata runs it
--      (verifies the frozen source still physically exists + V102 applied on destination).
--      Relations FS v0.2 §8.1 Phase 2 amended to record this disposition.
--   2. PRECONDITION — RESOLVED 2026-06-06: reads from relations.activity, which now exists.
--      V100.1_relations_activity_base.sql landed on shared-prod 2026-06-03 (Strata-confirmed
--      Stage-3 clean apply). The earlier "not yet created / migration not authored" note is
--      cleared. No further precondition outstanding on relations.activity.
--
-- Strata's apply runner skips _DEFERRED files (same pattern as V101.2_DEFERRED).
-- Strata confirmed this at pre-flight 2026-06-03.
-- ---------------------------------------------------------------------------
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
--   crm_investor.useful_links        → investor_profile.useful_links (already JSONB)
--   (SUPERSEDED by the STRATA LIVE-SOURCE DIFF block below: the real source is
--    public.investor_profile and has NO created_at / created_by_user_id / tenant_id /
--    owner_entity_id — those dest columns are supplied as constants, not copied.)
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

-- ===========================================================================
-- STRATA LIVE-SOURCE DIFF (2026-06-06) — applied to the SELECT below:
--   • Source is public.investor_profile on sanctom-crm-prod (260 rows) — NOT
--     crm.investor_profile / crm_investor. FROM clause corrected.
--   • Source has NO tenant_id, owner_entity_id, created_at, or created_by/updated_by.
--     The 4 NOT-NULL dest columns are SUPPLIED as constants from the v_* vars below
--     (created_by = updated_by = one actor). created_at defaults now().
--   • check_size_min/max: source numeric → dest bigint (::bigint cast added).
--   • investment_focus / portfolio_cos: source is free TEXT → dest TEXT[]. Wrapped
--     as a single-element array (NON-LOSSY default). ⚠️ If a delimiter split is
--     wanted, Petra-C confirms the delimiter and we swap to string_to_array().
--   • useful_links: source is already JSONB — passes through.
--   • Dropped 5 source-only cols (first_outbound_at, last_inbound_at,
--     last_stage_transition_at, stalled, stalled_since) — not in dest, not selected.
--
-- ⛔ BEFORE RUNNING: set the 3 uuids below. They are a Petra-C/Knox product decision
--    (Sanctom tenant + Knox's owning entity + Knox's user). The guard RAISEs if unset,
--    so this migration CANNOT insert NULL-scoped or unattributed rows by accident.
-- ===========================================================================

DO $$
DECLARE
  v_backfilled_count  BIGINT;
  v_activity_updated  BIGINT;
  -- ⛔ FILL these 3 before running (pending Petra-C/Knox; Strata can pull candidate
  --    ids from identity/entity once decided). owner_entity_id is also the ON CONFLICT key.
  v_tenant_id         UUID := NULL;  -- Sanctom tenant uuid
  v_owner_entity_id   UUID := NULL;  -- Knox's owning entity uuid
  v_actor_user_id     UUID := NULL;  -- Knox's user uuid (created_by_user_id = updated_by_user_id)
BEGIN

  IF v_tenant_id IS NULL OR v_owner_entity_id IS NULL OR v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'V102.1: set v_tenant_id / v_owner_entity_id / v_actor_user_id before running (pending Petra-C/Knox).';
  END IF;

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
    v_tenant_id,        -- supplied (source has no tenant_id)
    v_owner_entity_id,  -- supplied (source has no owner_entity_id; also ON CONFLICT key)

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

    crm_inv.check_size_min_usd::bigint,   -- source numeric → dest bigint
    crm_inv.check_size_max_usd::bigint,

    -- Source investment_focus / portfolio_cos are free TEXT; dest is TEXT[].
    -- Non-lossy default: wrap the whole value as a single-element array. Swap to
    -- string_to_array(crm_inv.<col>, '<delim>') if Petra-C confirms a delimiter.
    CASE WHEN crm_inv.investment_focus IS NULL OR btrim(crm_inv.investment_focus) = ''
         THEN ARRAY[]::TEXT[] ELSE ARRAY[crm_inv.investment_focus] END,
    crm_inv.stage_preference,
    CASE WHEN crm_inv.portfolio_cos IS NULL OR btrim(crm_inv.portfolio_cos) = ''
         THEN ARRAY[]::TEXT[] ELSE ARRAY[crm_inv.portfolio_cos] END,

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

    now(),              -- source has no created_at
    now(),
    v_actor_user_id,    -- supplied (source has no created_by_user_id)
    v_actor_user_id     -- supplied (updated_by_user_id = same actor)

  FROM public.investor_profile crm_inv  -- Strata-confirmed source (sanctom-crm-prod, 260 rows)
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
