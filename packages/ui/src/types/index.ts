// ── Identity ────────────────────────────────────────────────────────────────
export type IdentityClass = "staff" | "pro" | "personal";

export interface RelationsContext {
  userId: string;
  tenantId: string;
  identityClass: IdentityClass;
  displayName?: string;
}

// ── Person ──────────────────────────────────────────────────────────────────
export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  linkedin_url?: string;
  bio?: string;
  location?: string;
  created_at: string;
  updated_at: string;
}

// ── Role chips ───────────────────────────────────────────────────────────────
export type RoleContext = "investor" | "pro" | "member" | "candidate" | "employee" | "cross_role";

export interface RoleChip {
  role: RoleContext;
  profile_id: string;
  stage: string | null;
  is_active: boolean;
  is_terminal: boolean;
}

export interface PersonDetail {
  person: Person;
  role_chips: RoleChip[];
  profiles: {
    investor: InvestorProfile | null;
    pro: ProProfile | null;
    member: MemberProfile | null;
    candidate: CandidateProfile | null;
    employee: EmployeeProfile | null;
  };
}

// ── Investor ─────────────────────────────────────────────────────────────────
export type InvestorStage =
  | "prospect" | "contacted" | "responded"
  | "meeting_scheduled" | "meeting_held" | "diligence"
  | "committed" | "passed";

export type InvestorFitScore = "high" | "medium_high" | "medium" | "low";
export type InvestorPriority = "urgent" | "high" | "medium" | "low";

export interface InvestorProfile {
  id: string;
  person_id: string;
  stage: InvestorStage;
  fit_score?: InvestorFitScore;
  priority?: InvestorPriority;
  check_size_min_usd?: number;
  check_size_max_usd?: number;
  investment_focus?: string[];
  next_action?: string;
  rec_timing?: string;
  knox_notes?: string;
  useful_links?: Array<{ label: string; url: string }>;
  updated_at: string;
  // Joined
  first_name?: string;
  last_name?: string;
  email?: string;
  linkedin_url?: string;
}

export interface InvestorPipelineResult {
  profiles: InvestorProfile[];
  stage_counts: Array<{ stage: InvestorStage; count: string }>;
  total: number;
  limit: number;
  offset: number;
}

// ── Pro ───────────────────────────────────────────────────────────────────────
export type ProType =
  | "coach" | "therapist" | "mentor" | "trainer" | "tutor" | "healer" | "practitioner"
  | "attorney" | "accountant" | "financial_advisor" | "consultant"
  | "plumber" | "electrician" | "contractor" | "handyman" | "other";

export type ProStage = "prospect" | "contacted" | "screened" | "onboarded" | "active" | "churn" | "reactivation";

export interface ProProfile {
  id: string;
  person_id: string;
  pro_type: ProType;
  pro_category: string;
  engagement_structure: string;
  regulatory_tier: string;
  current_stage: ProStage;
  onboarding_status: string;
  availability_open: boolean;
  payout_account_status: string;
  updated_at: string;
  // Joined
  first_name?: string;
  last_name?: string;
  email?: string;
}

// ── Member ────────────────────────────────────────────────────────────────────
export type MemberStage = "prospect" | "trial" | "paying" | "churned" | "reactivation" | "winback";
export type MemberSubscriptionStatus = "trial" | "active" | "paused" | "churned" | "reactivation_pending";

export interface MemberProfile {
  id: string;
  person_id: string;
  subscription_status: MemberSubscriptionStatus;
  subscription_tier?: string;
  current_stage: MemberStage;
  cohort?: string;
  segment?: string;
  churn_risk_score?: number;
  last_activity_date?: string;
  ltv_cents: number;
  arpu_cents: number;
  coach_match_id?: string;
  signup_date?: string;
  updated_at: string;
  // Joined
  first_name?: string;
  last_name?: string;
  email?: string;
}

// ── Candidate ─────────────────────────────────────────────────────────────────
export type CandidateStage = "applied" | "screened" | "interviewed" | "offered" | "hired" | "rejected";

export interface CandidateProfile {
  id: string;
  person_id: string;
  current_stage: CandidateStage;
  role_applied_for?: string;
  application_source?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

// ── Employee ──────────────────────────────────────────────────────────────────
export interface EmployeeProfile {
  id: string;
  person_id: string;
  deel_employee_id?: string;
  employment_type?: string;
  start_date?: string;
  end_date?: string;
  cross_role_links?: Array<{ role: RoleContext; profile_id: string; linked_at: string }>;
  notes?: string;
  first_name?: string;
  last_name?: string;
}

// ── Activity ──────────────────────────────────────────────────────────────────
export interface ActivityRow {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_by: string;
  role_context?: RoleContext;
  created_at: string;
}

// ── Search ────────────────────────────────────────────────────────────────────
export interface SearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  linkedin_url?: string;
  rank: number;
  headline: string;
  matching_roles: Array<{ role: RoleContext; stage?: string }>;
}

// ── Saved Filter ──────────────────────────────────────────────────────────────
export interface SavedFilter {
  id: string;
  user_id: string;
  name: string;
  filter_json: Record<string, unknown>;
  pinned: boolean;
  display_order?: number;
  created_at: string;
  updated_at: string;
}

// ── API response ──────────────────────────────────────────────────────────────
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
}
