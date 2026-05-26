// =============================================================================
// Relations v0.2 — Pro Profile input/output shapes + per-type field schemas
// =============================================================================
// Spec: Relations-Pro-Functional-Spec-v0.2.md §4 (field catalog) + §9 (DDL)
// =============================================================================

import { z } from "zod";
import type {
  ProType, ProCategory, BillingModel, EngagementStructure,
  RegulatoryTier, ProStage, PayoutAccountStatus, OnboardingStatus,
} from "../types.js";

// ---------------------------------------------------------------------------
// § Coach pro_type_fields schema (§4.3 matrix — cert_based)
// ---------------------------------------------------------------------------

export const CoachFieldsSchema = z.object({
  hourly_rate_usd:    z.number().positive().optional(),
  cert_org:           z.string().max(200).optional(),
  cert_id:            z.string().max(100).optional(),
  cert_expiry:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // ISO date
  coaching_modality:  z.string().max(200).optional(),     // "1:1" / "group" / "hybrid"
  ica_member:         z.boolean().optional(),
  icf_credential:     z.enum(["ACC", "PCC", "MCC"]).optional(),
});

export type CoachFields = z.infer<typeof CoachFieldsSchema>;

// ---------------------------------------------------------------------------
// § Attorney pro_type_fields schema (§4.3 matrix — state_license)
// ---------------------------------------------------------------------------

export const AttorneyFieldsSchema = z.object({
  bar_number:         z.string().max(100).optional(),
  bar_state:          z.string().max(100).optional(),
  bar_expiry:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  practice_areas:     z.array(z.string().max(100)).max(20).optional(),
  case_capacity:      z.number().int().positive().optional(),
  insurance_provider: z.string().max(200).optional(),
  retainer_usd:       z.number().positive().optional(),
});

export type AttorneyFields = z.infer<typeof AttorneyFieldsSchema>;

// ---------------------------------------------------------------------------
// § Plumber pro_type_fields schema (§4.3 matrix — state_license)
// ---------------------------------------------------------------------------

export const PlumberFieldsSchema = z.object({
  license_number:     z.string().max(100).optional(),
  license_state:      z.string().max(100).optional(),
  license_expiry:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  service_area_zip:   z.array(z.string().max(10)).max(50).optional(),
  hourly_rate_usd:    z.number().positive().optional(),
  job_min_usd:        z.number().positive().optional(),
  insurance_provider: z.string().max(200).optional(),
  bonded:             z.boolean().optional(),
});

export type PlumberFields = z.infer<typeof PlumberFieldsSchema>;

// ---------------------------------------------------------------------------
// § Generic stub schema (all remaining pro_types at v0.2)
// ---------------------------------------------------------------------------

export const StubFieldsSchema = z.record(z.unknown());

// ---------------------------------------------------------------------------
// § Per-type field schema registry
// ---------------------------------------------------------------------------

export const PRO_TYPE_FIELD_SCHEMAS: Record<ProType, z.ZodType> = {
  coach:             CoachFieldsSchema,
  attorney:          AttorneyFieldsSchema,
  plumber:           PlumberFieldsSchema,
  // Stubs — validated as open objects until concrete-activation at v0.3+
  therapist:         StubFieldsSchema,
  mentor:            StubFieldsSchema,
  trainer:           StubFieldsSchema,
  tutor:             StubFieldsSchema,
  healer:            StubFieldsSchema,
  practitioner:      StubFieldsSchema,
  accountant:        StubFieldsSchema,
  financial_advisor: StubFieldsSchema,
  consultant:        StubFieldsSchema,
  electrician:       StubFieldsSchema,
  contractor:        StubFieldsSchema,
  handyman:          StubFieldsSchema,
  other:             StubFieldsSchema,
};

// ---------------------------------------------------------------------------
// § Create / Update input schemas
// ---------------------------------------------------------------------------

export const CreateProProfileSchema = z.object({
  person_id:            z.string().uuid(),
  owner_entity_id:      z.string().uuid(),
  pro_type:             z.enum(["coach","therapist","mentor","trainer","tutor","healer",
                                "practitioner","attorney","accountant","financial_advisor",
                                "consultant","plumber","electrician","contractor","handyman",
                                "other"]),
  pro_category:         z.enum(["healing_arts","professional_services","trades","other"]),
  billing_model:        z.enum(["session_based","billable_hours","job_based","aum_percent",
                                "flat_fee","retainer","hybrid"]),
  engagement_structure: z.enum(["recurring_sessions","case_based","annual_plus_adhoc",
                                "ongoing_relationship","job_to_completion"]),
  regulatory_tier:      z.enum(["none","cert_based","state_license","multi_state_license",
                                "federal_regulatory"]),
  pro_type_fields:      z.record(z.unknown()).optional().default({}),
  specialties:          z.array(z.string().max(200)).max(30).optional().default([]),
  years_of_experience:  z.number().int().min(0).max(80).optional(),
  languages:            z.array(z.string().max(100)).max(20).optional().default([]),
  capacity_per_period:  z.number().int().positive().optional(),
  availability_open:    z.boolean().optional().default(true),
  payout_method:        z.string().max(100).optional(),
  current_stage:        z.enum(["prospect","contacted","screened","onboarded","active",
                                "churn","reactivation"]).optional().default("prospect"),
  onboarding_template_id: z.string().uuid().optional(),
  fit_rationale:        z.string().max(2000).optional(),
  useful_links:         z.array(z.object({
    label: z.string().max(200),
    url:   z.string().url(),
  })).max(20).optional().default([]),
});

export type CreateProProfileInput = z.infer<typeof CreateProProfileSchema>;

export const UpdateProProfileSchema = CreateProProfileSchema
  .omit({ person_id: true, owner_entity_id: true })
  .partial();

export type UpdateProProfileInput = z.infer<typeof UpdateProProfileSchema>;

export const StageUpdateSchema = z.object({
  stage: z.enum(["prospect","contacted","screened","onboarded","active","churn","reactivation"]),
});

export type StageUpdateInput = z.infer<typeof StageUpdateSchema>;

// ---------------------------------------------------------------------------
// § List / filter query params
// ---------------------------------------------------------------------------

export const ProProfileListParamsSchema = z.object({
  pro_type:             z.string().optional(),
  pro_category:         z.string().optional(),
  engagement_structure: z.string().optional(),
  current_stage:        z.string().optional(),
  availability_open:    z.enum(["true","false"]).optional(),
  page:                 z.coerce.number().int().min(1).default(1),
  page_size:            z.coerce.number().int().min(1).max(200).default(50),
  sort_by:              z.enum(["created_at","updated_at","current_stage"]).optional().default("created_at"),
  sort_dir:             z.enum(["asc","desc"]).optional().default("desc"),
});

export type ProProfileListParams = z.infer<typeof ProProfileListParamsSchema>;

// ---------------------------------------------------------------------------
// § Default value matrix (§4.3 — per pro_type defaults)
// ---------------------------------------------------------------------------

interface ProTypeDefaults {
  readonly pro_category:         ProCategory;
  readonly billing_model:        BillingModel;
  readonly engagement_structure: EngagementStructure;
  readonly regulatory_tier:      RegulatoryTier;
}

export const PRO_TYPE_DEFAULTS: Record<ProType, ProTypeDefaults> = {
  // Healing Arts
  coach:             { pro_category: "healing_arts",         billing_model: "session_based",  engagement_structure: "recurring_sessions",  regulatory_tier: "cert_based"           },
  therapist:         { pro_category: "healing_arts",         billing_model: "session_based",  engagement_structure: "recurring_sessions",  regulatory_tier: "state_license"        },
  mentor:            { pro_category: "healing_arts",         billing_model: "flat_fee",       engagement_structure: "recurring_sessions",  regulatory_tier: "none"                 },
  trainer:           { pro_category: "healing_arts",         billing_model: "session_based",  engagement_structure: "recurring_sessions",  regulatory_tier: "none"                 },
  tutor:             { pro_category: "healing_arts",         billing_model: "session_based",  engagement_structure: "recurring_sessions",  regulatory_tier: "none"                 },
  healer:            { pro_category: "healing_arts",         billing_model: "session_based",  engagement_structure: "recurring_sessions",  regulatory_tier: "cert_based"           },
  practitioner:      { pro_category: "healing_arts",         billing_model: "session_based",  engagement_structure: "recurring_sessions",  regulatory_tier: "cert_based"           },
  // Professional Services
  attorney:          { pro_category: "professional_services", billing_model: "billable_hours", engagement_structure: "case_based",          regulatory_tier: "state_license"        },
  accountant:        { pro_category: "professional_services", billing_model: "flat_fee",       engagement_structure: "annual_plus_adhoc",   regulatory_tier: "multi_state_license"  },
  financial_advisor: { pro_category: "professional_services", billing_model: "aum_percent",    engagement_structure: "ongoing_relationship", regulatory_tier: "federal_regulatory"  },
  consultant:        { pro_category: "professional_services", billing_model: "retainer",       engagement_structure: "ongoing_relationship", regulatory_tier: "none"                },
  // Trades
  plumber:           { pro_category: "trades",               billing_model: "job_based",      engagement_structure: "job_to_completion",   regulatory_tier: "state_license"        },
  electrician:       { pro_category: "trades",               billing_model: "job_based",      engagement_structure: "job_to_completion",   regulatory_tier: "state_license"        },
  contractor:        { pro_category: "trades",               billing_model: "job_based",      engagement_structure: "job_to_completion",   regulatory_tier: "state_license"        },
  handyman:          { pro_category: "trades",               billing_model: "job_based",      engagement_structure: "job_to_completion",   regulatory_tier: "cert_based"           },
  // Other
  other:             { pro_category: "other",                billing_model: "flat_fee",       engagement_structure: "recurring_sessions",  regulatory_tier: "none"                 },
};
