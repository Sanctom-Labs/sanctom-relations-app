-- =============================================================================
-- V100 — Relations Phase 1 base schema
-- =============================================================================
-- Creates the foundational `relations` schema + the `activity_type` ENUM
-- (v1.x values) on `sanctom-platform-shared-prod` (db: sanctom_platform_shared).
--
-- This migration was MISSING from the repo — the V101 header noted the
-- activity_type ENUM as a precondition "from sanctom-crm-prod schema" but
-- that schema/enum was never ported to shared-prod. Strata's pre-flight 2026-06-02
-- confirmed: `relations` schema absent, `relations.activity_type` absent.
--
-- Source for v1.x enum values: CRM-App-v1/app.py ACTIVITY_TYPES + the LinkedIn
-- extension migration (2026-04-18). These must match the CRM database exactly.
--
-- Apply before V101 (re-ordered sequence: V100 → V101 ALTER TYPE autocommit
-- pre-step → V101 body → V101.1 → V102 → V102.1; skip V101.2_DEFERRED).
-- Safe to run in a single transaction.
--
-- Author: Hammer-C, 2026-06-02 (closing the missing Phase 1 gap found by Strata)
-- Coordinator: Petra-C (spec owner) — surfaced as drift; apply continues since
--   this is purely additive on an empty schema.
-- =============================================================================

-- ── §1 — Ensure relations schema ─────────────────────────────────────────────
-- V101 also has CREATE SCHEMA IF NOT EXISTS relations; — idempotent.
CREATE SCHEMA IF NOT EXISTS relations;

-- ── §2 — Base activity_type ENUM (v1.x, from sanctom-crm-prod canonical) ────
-- These are the values that exist in the CRM database's relations.activity_type
-- enum. V101 §9.4 extends this ENUM with Pro-specific values via ALTER TYPE
-- ADD VALUE IF NOT EXISTS (additive, non-breaking).
--
-- v1.x values (CRM-App-v1/app.py ACTIVITY_TYPES, last updated 2026-04-18):
CREATE TYPE relations.activity_type AS ENUM (
  'email_sent_outbound',
  'email_received_inbound',
  'linkedin_dm_outbound',
  'linkedin_dm_inbound',
  'linkedin_connection_requested',
  'linkedin_connection_accepted',
  'meeting_scheduled',
  'meeting_held',
  'materials_requested',
  'follow_up_question_about_terms',
  'commitment_signaled',
  'pass',
  'note',
  'call',
  'signal',
  'stage_change',
  'system'
);

-- ── §3 — Grant search_path visibility ────────────────────────────────────────
-- Confirm `relations` is in the search_path for the apply session if needed.
-- Strata's explicit-file apply does not assume a default search_path;
-- all objects below are schema-qualified so this is informational only.
