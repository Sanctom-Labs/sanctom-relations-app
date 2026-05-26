// =============================================================================
// Relations v0.2 — Cross-role Person Detail handler
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §6.1 (Person detail panel — role chip + tab bar)
// Endpoint: GET /v1/relations/persons/:personId
//
// Fetches the full person detail:
//   1. ct.person identity fields (name, email, phone, LinkedIn, location)
//   2. All role_profile rows the person holds (across all enabled role types)
//   3. Role chips: which profiles are active + their current stage
//
// RLS applies per role profile table (staff-only for investor/member/candidate/employee;
// pro uses entity-scoped policy). Person with no visible profiles returns just CT identity.
// =============================================================================

import type { RelationsContext } from "../types.js";
import { queryWithContext } from "../db.js";
import { NotFoundError } from "../middleware.js";

// ---------------------------------------------------------------------------
// § Person identity (from ct.person)
// ---------------------------------------------------------------------------

interface CtPersonRow {
  id: string;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  linkedin_url: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  contact_types: string[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// § Role chip (summary per active role)
// ---------------------------------------------------------------------------

export interface RoleChip {
  readonly role: "investor" | "pro" | "member" | "candidate" | "employee";
  readonly profile_id: string;
  readonly stage: string;           // current_stage or stage depending on profile
  readonly is_active: boolean;      // false if stage = terminal (passed/churned/rejected)
}

// ---------------------------------------------------------------------------
// § Person detail response
// ---------------------------------------------------------------------------

export interface PersonDetailResponse {
  readonly person: CtPersonRow;
  readonly role_chips: RoleChip[];
  readonly pro_profiles: unknown[];          // ProProfileRow[]
  readonly investor_profile: unknown | null; // InvestorProfileRow | null
  readonly member_profile: unknown | null;   // MemberProfileRow | null
  readonly candidate_profile: unknown | null;
  readonly employee_profile: unknown | null;
}

// Terminal stages (chip renders muted)
const TERMINAL_STAGES = new Set(["passed","churned","rejected","churn"]);

// ---------------------------------------------------------------------------
// § getPersonDetail
// ---------------------------------------------------------------------------

export async function getPersonDetail(
  ctx: RelationsContext,
  personId: string
): Promise<PersonDetailResponse> {
  // Fetch ct.person (cross-schema read — RLS on ct.person enforced by CT v2.1)
  const personResult = await queryWithContext<CtPersonRow>(
    ctx,
    `SELECT
       id, display_name,
       primary_email, primary_phone, linkedin_url,
       location_city, location_state, location_country,
       contact_types,
       created_at, updated_at
     FROM ct.person
     WHERE id = $1 AND tenant_id = $2`,
    [personId, ctx.tenantId]
  );

  const person = personResult.rows[0];
  if (!person) throw new NotFoundError(`Person ${personId} not found`);

  // Fetch all role profiles in parallel (RLS filters by identity_class)
  const [proResult, investorResult, memberResult, candidateResult, employeeResult] =
    await Promise.all([
      queryWithContext(ctx,
        `SELECT * FROM relations.pro_profile WHERE person_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
        [personId, ctx.tenantId]
      ),
      queryWithContext(ctx,
        `SELECT * FROM relations.investor_profile WHERE person_id = $1 AND tenant_id = $2 LIMIT 1`,
        [personId, ctx.tenantId]
      ),
      queryWithContext(ctx,
        `SELECT * FROM relations.member_profile WHERE person_id = $1 AND tenant_id = $2 LIMIT 1`,
        [personId, ctx.tenantId]
      ),
      queryWithContext(ctx,
        `SELECT * FROM relations.candidate_profile WHERE person_id = $1 AND tenant_id = $2 LIMIT 1`,
        [personId, ctx.tenantId]
      ),
      queryWithContext(ctx,
        `SELECT * FROM relations.employee_profile WHERE person_id = $1 AND tenant_id = $2 LIMIT 1`,
        [personId, ctx.tenantId]
      ),
    ]);

  // Build role chips
  const roleChips: RoleChip[] = [];

  for (const proRow of proResult.rows) {
    const row = proRow as { id: string; current_stage: string };
    roleChips.push({
      role: "pro",
      profile_id: row.id,
      stage: row.current_stage,
      is_active: !TERMINAL_STAGES.has(row.current_stage),
    });
  }

  const investorRow = investorResult.rows[0] as { id: string; stage: string } | undefined;
  if (investorRow) {
    roleChips.push({
      role: "investor",
      profile_id: investorRow.id,
      stage: investorRow.stage,
      is_active: !TERMINAL_STAGES.has(investorRow.stage),
    });
  }

  const memberRow = memberResult.rows[0] as { id: string; current_stage: string } | undefined;
  if (memberRow) {
    roleChips.push({
      role: "member",
      profile_id: memberRow.id,
      stage: memberRow.current_stage,
      is_active: !TERMINAL_STAGES.has(memberRow.current_stage),
    });
  }

  const candidateRow = candidateResult.rows[0] as { id: string; current_stage: string } | undefined;
  if (candidateRow) {
    roleChips.push({
      role: "candidate",
      profile_id: candidateRow.id,
      stage: candidateRow.current_stage,
      is_active: !TERMINAL_STAGES.has(candidateRow.current_stage),
    });
  }

  const employeeRow = employeeResult.rows[0] as { id: string } | undefined;
  if (employeeRow) {
    roleChips.push({
      role: "employee",
      profile_id: employeeRow.id,
      stage: "active",      // employees don't have a stage at v0.2
      is_active: true,
    });
  }

  return {
    person,
    role_chips: roleChips,
    pro_profiles:       proResult.rows,
    investor_profile:   investorResult.rows[0] ?? null,
    member_profile:     memberResult.rows[0] ?? null,
    candidate_profile:  candidateResult.rows[0] ?? null,
    employee_profile:   employeeResult.rows[0] ?? null,
  };
}
