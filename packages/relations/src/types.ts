// =============================================================================
// Relations v0.2 — Shared TypeScript types
// =============================================================================
// Mirrors relations.* schema enums + DB row shapes exactly.
// Spec: Relations-Pro-Functional-Spec-v0.2.md + Relations-Functional-Spec-v0.2.md
// =============================================================================

// ---------------------------------------------------------------------------
// § Pro profile enums (V101)
// ---------------------------------------------------------------------------

export type ProType =
  | "coach" | "therapist" | "mentor" | "trainer" | "tutor" | "healer" | "practitioner"
  | "attorney" | "accountant" | "financial_advisor" | "consultant"
  | "plumber" | "electrician" | "contractor" | "handyman"
  | "other";

export type ProCategory = "healing_arts" | "professional_services" | "trades" | "other";

export type BillingModel =
  | "session_based" | "billable_hours" | "job_based" | "aum_percent"
  | "flat_fee" | "retainer" | "hybrid";

export type EngagementStructure =
  | "recurring_sessions" | "case_based" | "annual_plus_adhoc"
  | "ongoing_relationship" | "job_to_completion";

export type RegulatoryTier =
  | "none" | "cert_based" | "state_license" | "multi_state_license" | "federal_regulatory";

export type ProStage =
  | "prospect" | "contacted" | "screened" | "onboarded" | "active"
  | "churn" | "reactivation";

export type PayoutAccountStatus = "unverified" | "pending" | "verified" | "suspended";

export type OnboardingStatus = "not_started" | "in_progress" | "paused" | "complete" | "failed";

// ---------------------------------------------------------------------------
// § Non-Pro profile enums (V102)
// ---------------------------------------------------------------------------

export type InvestorStage =
  | "prospect" | "contacted" | "responded" | "meeting_scheduled"
  | "meeting_held" | "diligence" | "committed" | "passed";

export type InvestorFitScore = "high" | "medium_high" | "medium" | "low";

export type InvestorPriority = "urgent" | "high" | "medium" | "low";

export type MemberStage = "prospect" | "trial" | "paying" | "churned" | "reactivation" | "winback";

export type MemberSubscriptionStatus =
  | "trial" | "active" | "paused" | "churned" | "reactivation_pending";

export type CandidateStage = "applied" | "screened" | "interviewed" | "offered" | "hired" | "rejected";

export type RoleContext = "investor" | "pro" | "member" | "candidate" | "employee" | "cross_role";

// ---------------------------------------------------------------------------
// § Row shapes — Pro profile
// ---------------------------------------------------------------------------

export interface OnboardingTemplateRow {
  id: string;
  template_version: string;
  pro_type: ProType;
  regulatory_tier: RegulatoryTier;
  steps: unknown;              // JSONB — validated at app layer per step schema
  is_active: boolean;
  created_at: string;
  superseded_at: string | null;
  superseded_by_id: string | null;
}

export interface EngagementStructureStageLabelRow {
  engagement_structure: EngagementStructure;
  stage: ProStage;
  label: string;
  display_order: number;
}

export interface ProProfileRow {
  id: string;
  person_id: string;
  tenant_id: string;
  owner_entity_id: string;
  pro_type: ProType;
  pro_category: ProCategory;
  billing_model: BillingModel;
  engagement_structure: EngagementStructure;
  regulatory_tier: RegulatoryTier;
  pro_type_fields: Record<string, unknown>;    // JSONB per-type fields
  specialties: string[];
  years_of_experience: number | null;
  languages: string[];
  capacity_per_period: number | null;
  availability_open: boolean;
  payout_method: string | null;
  payout_account_status: PayoutAccountStatus;
  onboarding_status: OnboardingStatus;
  onboarding_template_id: string | null;
  fit_rationale: string | null;
  utilization_rate: string | null;        // NUMERIC(5,4) comes back as string from pg
  repeat_client_rate: string | null;      // NUMERIC(5,4)
  nps_score: number | null;
  useful_links: unknown[];               // JSONB array
  current_stage: ProStage;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
}

// ---------------------------------------------------------------------------
// § Row shapes — Non-Pro profiles
// ---------------------------------------------------------------------------

export interface InvestorProfileRow {
  id: string;
  person_id: string;
  tenant_id: string;
  owner_entity_id: string;
  stage: InvestorStage;
  fit_score: InvestorFitScore | null;
  priority: InvestorPriority | null;
  check_size_min_usd: string | null;    // BIGINT → string from pg
  check_size_max_usd: string | null;
  investment_focus: string[];
  stage_preference: string | null;
  portfolio_cos: string[];
  fit_rationale: string | null;
  outreach_approach: string | null;
  suggested_hook: string | null;
  warm_intro_path: string | null;
  rec_timing: string | null;
  knox_notes: string | null;
  next_action: string | null;
  useful_links: unknown[];
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
}

export interface MemberProfileRow {
  id: string;
  person_id: string;
  tenant_id: string;
  owner_entity_id: string;
  signup_date: string | null;
  first_session_date: string | null;
  onboarding_completion_date: string | null;
  subscription_status: MemberSubscriptionStatus;
  subscription_tier: string | null;
  ltv_cents: string;                  // BIGINT → string
  arpu_cents: number;
  cohort: string | null;
  segment: string | null;
  churn_risk_score: string | null;    // NUMERIC(3,2) → string
  last_activity_date: string | null;
  coach_match_id: string | null;
  current_stage: MemberStage;
  useful_links: unknown[];
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
}

export interface CandidateProfileRow {
  id: string;
  person_id: string;
  tenant_id: string;
  owner_entity_id: string;
  current_stage: CandidateStage;
  role_applied_for: string | null;
  application_source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
}

export interface EmployeeProfileRow {
  id: string;
  person_id: string;
  tenant_id: string;
  owner_entity_id: string;
  deel_employee_id: string | null;
  employment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  cross_role_links: unknown[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
}

export interface SavedFilterRow {
  id: string;
  user_id: string;
  tenant_id: string;
  name: string;
  filter_json: Record<string, unknown>;
  pinned: boolean;
  display_order: number | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// § Request context (set by middleware from JWT / app GUC settings)
// ---------------------------------------------------------------------------

export interface RelationsContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly entityId: string;
  readonly identityClass: "personal" | "pro" | "staff";
}

// ---------------------------------------------------------------------------
// § HTTP handler shapes
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiError {
  readonly error: string;
  readonly message: string;
  readonly status: number;
}

// ---------------------------------------------------------------------------
// § Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  readonly data: T[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly has_more: boolean;
}

export interface PaginationParams {
  readonly page: number;       // 1-indexed
  readonly page_size: number;  // default 50; max 200
  readonly sort_by?: string;
  readonly sort_dir?: "asc" | "desc";
}
