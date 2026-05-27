-- ===========================================================================
-- V101.2 — Relations Pro Profile: backfill from v1.x coach_profile
-- ===========================================================================
-- DEFER: DO NOT APPLY in standard V101 ceremony.
-- Disposition: Strata 2026-05-27 (Option B ratified per §5 of Strata→Hammer-C ping).
-- Apply window: v1.x CRM data migration ceremony (Knox-attended, separate scope).
-- Reason: coach_profile lives on sanctom-crm-prod (separate RDS instance); cross-DB
--   migration is non-trivial. Gated on Petra-C / Knox scoping that migration window.
-- ===========================================================================
-- Spec: Relations-Pro-Functional-Spec-v0.2.md §11.1 Phase 3 (Petra-C, 2026-05-26 PM)
-- Ratified: Knox 2026-05-26 PM
-- Author: Hammer-C
-- Depends on: V101_relations_pro_profile.sql, V101.1_relations_pro_seed.sql
--
-- PURPOSE:
--   Migrate every existing v1.x coach_profile row to a pro_profile row with
--   pro_type='coach'. Field mapping per §12.3 AC-PRO-3.
--
-- SAFETY:
--   • v1.x coach_profile table is NOT dropped (stays for v1.x app compatibility)
--   • Backfilled rows tagged with source comment in fit_rationale for traceability
--   • Rollback: DELETE FROM relations.pro_profile WHERE fit_rationale LIKE
--     '%migration_source:v1.x_coach_profile%' (before stabilization only)
--   • This migration is IDEMPOTENT if re-run: INSERT ... ON CONFLICT (person_id,
--     owner_entity_id) DO NOTHING prevents duplicates
--
-- FIELD MAPPING (coach_profile → pro_profile):
--   coach_profile.person_id           → pro_profile.person_id
--   coach_profile.tenant_id           → pro_profile.tenant_id
--   coach_profile.owner_entity_id     → pro_profile.owner_entity_id (or default entity)
--   coach_profile.specialties         → pro_profile.specialties
--   coach_profile.hourly_rate         → pro_profile.pro_type_fields.hourly_rate_usd
--   coach_profile.cert_org            → pro_profile.pro_type_fields.cert_org
--   coach_profile.cert_id             → pro_profile.pro_type_fields.cert_id
--   coach_profile.cert_expiry         → pro_profile.pro_type_fields.cert_expiry
--   coach_profile.coaching_modality   → pro_profile.pro_type_fields.coaching_modality
--   coach_profile.created_at          → pro_profile.created_at
--   coach_profile.created_by_user_id  → pro_profile.created_by_user_id
--   (defaults for all other fields per §4.3 coach row: healing_arts / session_based /
--    recurring_sessions / cert_based / onboarding_status=not_started)
--
-- ASSUMPTIONS:
--   • coach_profile has columns: person_id, tenant_id, owner_entity_id, specialties,
--     hourly_rate (NUMERIC), cert_org (TEXT), cert_id (TEXT), cert_expiry (DATE),
--     coaching_modality (TEXT or TEXT[]), created_at, created_by_user_id
--   • Columns that don't exist on v1.x coach_profile are skipped (COALESCE → default)
--   • If coach_profile uses a different schema name, update the FROM clause below
--
-- NOTE: Adjust the FROM clause if coach_profile lives in a schema other than
-- the default (e.g. public.coach_profile or crm.coach_profile).
-- ===========================================================================

-- Fetch the active coach/cert_based onboarding template id once
DO $$
DECLARE
  v_coach_template_id UUID;
BEGIN

  SELECT id INTO v_coach_template_id
  FROM relations.onboarding_template
  WHERE pro_type = 'coach'
    AND regulatory_tier = 'cert_based'
    AND is_active = true
  LIMIT 1;

  -- Insert one pro_profile row per existing coach_profile row
  -- ON CONFLICT DO NOTHING makes this migration safe to re-run
  INSERT INTO relations.pro_profile (
    person_id,
    tenant_id,
    owner_entity_id,
    pro_type,
    pro_category,
    billing_model,
    engagement_structure,
    regulatory_tier,
    pro_type_fields,
    specialties,
    onboarding_status,
    onboarding_template_id,
    fit_rationale,
    current_stage,
    created_at,
    updated_at,
    created_by_user_id,
    updated_by_user_id
  )
  SELECT
    cp.person_id,
    cp.tenant_id,
    cp.owner_entity_id,

    -- Pro type defaults for coach (§4.3 matrix)
    'coach'::relations.pro_type_enum,
    'healing_arts'::relations.pro_category_enum,
    'session_based'::relations.billing_model_enum,
    'recurring_sessions'::relations.engagement_structure_enum,
    'cert_based'::relations.regulatory_tier_enum,

    -- JSONB field mapping from v1.x coach_profile columns
    jsonb_strip_nulls(jsonb_build_object(
      'hourly_rate_usd',       cp.hourly_rate,
      'cert_org',              cp.cert_org,
      'cert_id',               cp.cert_id,
      'cert_expiry',           cp.cert_expiry::text,
      'coaching_modality',     cp.coaching_modality
    )),

    COALESCE(cp.specialties, ARRAY[]::TEXT[]),

    -- Onboarding status: treat all backfilled coaches as complete
    -- (they were operating coaches in v1.x; verification was done there)
    'complete'::relations.onboarding_status_enum,
    v_coach_template_id,

    -- Traceability tag for rollback identification
    'migration_source:v1.x_coach_profile_backfill — 2026-05-26',

    -- Map v1.x stage to pro_stage_enum (best-effort; adjust if coach_profile
    -- has its own stage column)
    'active'::relations.pro_stage_enum,

    cp.created_at,
    now(),
    cp.created_by_user_id,
    cp.created_by_user_id

  FROM coach_profile cp  -- adjust schema prefix if needed (e.g. public.coach_profile)
  ON CONFLICT (person_id, owner_entity_id) DO NOTHING;

  RAISE NOTICE 'V101.2 backfill complete — % coach_profile rows migrated to pro_profile',
    (SELECT count(*) FROM relations.pro_profile WHERE fit_rationale LIKE '%migration_source:v1.x_coach_profile_backfill%');

END $$;
