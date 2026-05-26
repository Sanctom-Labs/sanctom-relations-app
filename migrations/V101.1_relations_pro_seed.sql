-- ===========================================================================
-- V101.1 — Relations Pro Profile seed data
-- ===========================================================================
-- Spec: Relations-Pro-Functional-Spec-v0.2.md §9.2 + §9.3 (Petra-C, 2026-05-26 PM)
-- Ratified: Knox 2026-05-26 PM
-- Author: Hammer-C
-- Depends on: V101_relations_pro_profile.sql
--
-- Seeds:
--   1. relations.onboarding_template — 3 concrete (Coach/Attorney/Plumber)
--                                     + 13 stub pro_type rows (one per stub)
--   2. relations.engagement_structure_stage_label — 35 rows (5 structs × 7 stages)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §9.2 — Onboarding templates: 3 concrete pro_types
-- ---------------------------------------------------------------------------

INSERT INTO relations.onboarding_template (template_version, pro_type, regulatory_tier, steps)
VALUES

  -- Coach: cert_based (§6 table — identity_verify + cert_upload + cert_verify)
  ('v0.2.0', 'coach', 'cert_based', '[
    {"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"},
    {"step_id":"cert_upload","label":"Coaching Certification","required":true,"order":2,"handler":"file_upload","config":{"max_files":3,"allowed_types":["pdf","image/*"]}},
    {"step_id":"cert_verify","label":"Certification Review","required":true,"order":3,"handler":"manual_review"}
  ]'::jsonb),

  -- Attorney: state_license (§6 table — identity_verify + bar_upload + bar_verify + insurance)
  ('v0.2.0', 'attorney', 'state_license', '[
    {"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"},
    {"step_id":"bar_admission_upload","label":"Bar Admission Documents","required":true,"order":2,"handler":"file_upload","config":{"max_files":5,"allowed_types":["pdf","image/*"]}},
    {"step_id":"bar_admission_verify","label":"Bar Admission Verification","required":true,"order":3,"handler":"manual_review"},
    {"step_id":"insurance_panel","label":"Insurance Paneling","required":false,"order":4,"handler":"file_upload","config":{"max_files":3,"allowed_types":["pdf"]}}
  ]'::jsonb),

  -- Plumber: state_license (§6 table — identity_verify + license_upload + license_verify + insurance)
  ('v0.2.0', 'plumber', 'state_license', '[
    {"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"},
    {"step_id":"state_license_upload","label":"State Plumbing License","required":true,"order":2,"handler":"file_upload","config":{"max_files":3,"allowed_types":["pdf","image/*"]}},
    {"step_id":"state_license_verify","label":"License Verification","required":true,"order":3,"handler":"manual_review"},
    {"step_id":"insurance_panel","label":"Liability Insurance","required":true,"order":4,"handler":"file_upload","config":{"max_files":3,"allowed_types":["pdf"]}}
  ]'::jsonb);

-- ---------------------------------------------------------------------------
-- §9.2 — Onboarding templates: 13 stub pro_types
-- Regulatory tier defaults per §4.3 default value matrix.
-- Steps: identity_verify only (minimal stub; full steps at concrete-activation).
-- ---------------------------------------------------------------------------

INSERT INTO relations.onboarding_template (template_version, pro_type, regulatory_tier, steps)
VALUES

  -- Healing Arts stubs (§3 catalog)
  ('v0.2.0-stub', 'therapist',     'state_license',       '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'mentor',        'none',                 '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'trainer',       'none',                 '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'tutor',         'none',                 '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'healer',        'cert_based',           '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'practitioner',  'cert_based',           '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),

  -- Professional Services stubs (§3 catalog)
  ('v0.2.0-stub', 'accountant',       'multi_state_license',  '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'financial_advisor','federal_regulatory',   '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'consultant',       'none',                 '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),

  -- Trades stubs (§3 catalog)
  ('v0.2.0-stub', 'electrician',  'state_license',  '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'contractor',   'state_license',  '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),
  ('v0.2.0-stub', 'handyman',     'cert_based',     '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb),

  -- Other (universal catch-all — gated to Pro identity-class per OQ-5)
  ('v0.2.0-stub', 'other',        'none',           '[{"step_id":"identity_verify","label":"Identity Verification","required":true,"order":1,"handler":"stripe_identity"}]'::jsonb);

-- ---------------------------------------------------------------------------
-- §9.3 — engagement_structure_stage_label: 35 rows (5 structures × 7 stages)
-- Matches §7.2 stage label rendering table exactly.
-- ---------------------------------------------------------------------------

INSERT INTO relations.engagement_structure_stage_label
  (engagement_structure, stage, label, display_order)
VALUES

  -- recurring_sessions (Coach, Therapist, Mentor, Trainer, Tutor, Healer, Practitioner)
  ('recurring_sessions', 'prospect',     'Inquiry',               1),
  ('recurring_sessions', 'contacted',    'Contacted',             2),
  ('recurring_sessions', 'screened',     'Intake screening',      3),
  ('recurring_sessions', 'onboarded',    'Intake complete',       4),
  ('recurring_sessions', 'active',       'Active client',         5),
  ('recurring_sessions', 'churn',        'Churned',               6),
  ('recurring_sessions', 'reactivation', 'Reactivation outreach', 7),

  -- case_based (Attorney)
  ('case_based', 'prospect',     'Initial inquiry',                      1),
  ('case_based', 'contacted',    'Consultation booked',                  2),
  ('case_based', 'screened',     'Conflict check + engagement pending',  3),
  ('case_based', 'onboarded',    'Engaged (representation in progress)', 4),
  ('case_based', 'active',       'Active matter',                        5),
  ('case_based', 'churn',        'Matter resolved',                      6),
  ('case_based', 'reactivation', 'Reactivation',                         7),

  -- annual_plus_adhoc (Accountant)
  ('annual_plus_adhoc', 'prospect',     'Tax-season prospect',        1),
  ('annual_plus_adhoc', 'contacted',    'Consultation booked',        2),
  ('annual_plus_adhoc', 'screened',     'Engagement-letter pending',  3),
  ('annual_plus_adhoc', 'onboarded',    'Engaged (returns prepared)', 4),
  ('annual_plus_adhoc', 'active',       'Active engagement',          5),
  ('annual_plus_adhoc', 'churn',        'Engagement ended',           6),
  ('annual_plus_adhoc', 'reactivation', 'Reactivation',               7),

  -- ongoing_relationship (Financial Advisor, Consultant)
  ('ongoing_relationship', 'prospect',     'Prospect',               1),
  ('ongoing_relationship', 'contacted',    'Discovery call',         2),
  ('ongoing_relationship', 'screened',     'Suitability review',     3),
  ('ongoing_relationship', 'onboarded',    'Onboarded + IPS signed', 4),
  ('ongoing_relationship', 'active',       'Active relationship',    5),
  ('ongoing_relationship', 'churn',        'Disengaged',             6),
  ('ongoing_relationship', 'reactivation', 'Reactivation',           7),

  -- job_to_completion (Plumber, Electrician, Contractor, Handyman)
  ('job_to_completion', 'prospect',     'Quote requested',                 1),
  ('job_to_completion', 'contacted',    'Quoted',                          2),
  ('job_to_completion', 'screened',     'Site survey / estimate pending',  3),
  ('job_to_completion', 'onboarded',    'Scheduled',                       4),
  ('job_to_completion', 'active',       'Job in progress',                 5),
  ('job_to_completion', 'churn',        'Job completed + invoiced',        6),
  ('job_to_completion', 'reactivation', 'Reactivation',                    7);
