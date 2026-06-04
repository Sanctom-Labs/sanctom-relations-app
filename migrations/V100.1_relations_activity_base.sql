-- =============================================================================
-- V100.1 — Relations Phase 1 base: relations.activity table
-- =============================================================================
-- Creates the `relations.activity` table — the v1.x rebrand of `crm.activity`
-- — on `sanctom-platform-shared-prod` (db: sanctom_platform_shared).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------------------------------------------------------
-- V100 created the `relations` schema + `relations.activity_type` ENUM, but
-- NOT the v1.x base TABLES. Strata's Stage-3 pre-flight (2026-06-03) confirmed
-- `relations` had ZERO tables. V102 §7.7 (`ALTER TABLE relations.activity ADD
-- COLUMN role_context`) and the DEFERRED V102.1 investor backfill both assume
-- `relations.activity` already exists as the Phase-1 base — but it was never
-- ported from the CRM database. Result: Stage 3 rolled back atomically on
-- `ERROR: relation "relations.activity" does not exist`, taking V101 + the four
-- V102 profile tables down with it.
--
-- This migration ports the canonical v1.x `crm.activity` shape so the ALTER in
-- V102 §7.7 has a table to extend, unblocking the entire stage (V101 + V102
-- profiles + §7.7) in one shot. It also satisfies V102.1's `relations.activity`
-- precondition for the eventual investor backfill ceremony.
--
-- CANONICAL SOURCE OF THE v1.x SHAPE
-- -------------------------------------------------------------------------
-- `Sanctom-Labs/Products/Stack/Platform/MCPs/sanctom-crm-mcp/sql/sanctom-crm-schema-v2.sql`
--   §activity (lines 311-319) + the two activity indexes (lines 356-357).
-- This is a FAITHFUL rebrand — same columns, same types — with two corrections
-- carried forward from V101/V102's schema-name reconciliation (2026-06-03):
--   1. person_id FK targets `contacts.person(id)` (NOT the v1.x bare `person` /
--      the wrong `ct.person`) — `contacts` is the canonical CT schema on
--      shared-prod (Strata-confirmed live).
--   2. `type` uses `relations.activity_type` (the V100 ENUM), not the bare
--      v1.x `activity_type`.
--
-- DELIBERATELY NOT INCLUDED (flagged for Petra-C / Strata)
-- -------------------------------------------------------------------------
--   • role_context column — added by V102 §7.7 (ADD COLUMN IF NOT EXISTS), kept
--     there so the migration history reads cleanly: V100.1 = the v1.x base port,
--     V102 §7.7 = the v0.2 extension.
--   • RLS policy — the v1.x `crm.activity` was single-tenant and carried no
--     `tenant_id`; this faithful rebrand has none either. Tenant isolation for
--     activity rows is reachable only via the `person_id → contacts.person`
--     join (contacts.person is tenant-scoped). The Relations v0.2 spec §7.7
--     specs only the role_context ALTER for this table — it does NOT spec RLS
--     on relations.activity. PORTING FAITHFULLY rather than authoring a
--     speculative tenant_id + RLS policy mid-apply. >>> Petra-C / Strata: if
--     activity rows need direct tenant-scoped RLS on shared-prod, that is a
--     spec decision + a follow-on ALTER (add tenant_id + policy); flag it and
--     I'll author it. Not blocking the Stage-3 unblock.
--
-- APPLY ORDER (updated)
-- -------------------------------------------------------------------------
--   V100  (schema + activity_type ENUM)
--   V100.1  ← THIS FILE (relations.activity base table)
--   V101 ALTER TYPE autocommit pre-step → V101 body → V101.1
--   V102 → V102.1 (deferred)
--   (skip V101.2_DEFERRED)
-- Safe to run inside the Stage-3 transaction; purely additive on an empty schema.
--
-- Author: Hammer-C, 2026-06-03 (closing the relations.activity base-table gap
--   Strata flagged in Stage-3 rollback #4; resolves Strata's "split §7.7 vs
--   author the base table" choice via the author-the-base-table path — strictly
--   better: unblocks V102 §7.7 AND V102.1 together instead of deferring both).
-- Coordinator: Petra-C (spec owner) — surfaced as the same Phase-1 base gap
--   already documented for V102.1; this lands it for real.
-- =============================================================================

-- ── §1 — relations.activity (v1.x rebrand of crm.activity) ───────────────────
-- Full interaction log. Pip-class rule evaluators read trigger types to evaluate
-- transitions; non-trigger types (note, call, signal, stage_change, system) are
-- recorded but never move a stage. Mirrors crm.activity column-for-column.
CREATE TABLE IF NOT EXISTS relations.activity (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    UUID NOT NULL REFERENCES contacts.person(id) ON DELETE CASCADE,
  type         relations.activity_type NOT NULL,
  content      TEXT,
  metadata     JSONB,
  created_by   VARCHAR(50),   -- agent or user identifier (pulse, clara, pip, knox, ...)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE relations.activity IS
  'Per-person interaction log. v1.x rebrand of crm.activity (Relations v0.2 §7). '
  'role_context column added by V102 §7.7. No tenant_id in the v1.x shape — tenant '
  'isolation is via person_id → contacts.person; direct RLS is a flagged follow-on.';

COMMENT ON COLUMN relations.activity.created_by IS
  'Free-text agent or user identifier. Tighten to FK against an identity table once AOE roles are live.';

-- ── §2 — activity timeline indexes (per-person, most-recent-first) ───────────
-- Carried over from crm-schema-v2 idx_activity_person / idx_activity_type_time,
-- renamed into the relations namespace for operator clarity.
CREATE INDEX IF NOT EXISTS idx_relations_activity_person
  ON relations.activity (person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_relations_activity_type_time
  ON relations.activity (type, created_at DESC);
