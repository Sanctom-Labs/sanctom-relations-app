// =============================================================================
// Relations v0.2 — cross-role/person-detail.ts unit tests
// =============================================================================
// Covers: getPersonDetail — person lookup, parallel role profile fetches,
// role chip construction (including terminal stage detection), null paths.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError } from "../middleware.js";
import { getPersonDetail } from "./person-detail.js";

vi.mock("../db.js", () => ({
  queryWithContext: vi.fn(),
  getContextClient: vi.fn(),
}));

import { queryWithContext } from "../db.js";

const qwc = vi.mocked(queryWithContext);

function qr<T extends QueryResultRow>(rows: T[], rowCount?: number): QueryResult<T> {
  return { rows, rowCount: rowCount ?? rows.length, command: "SELECT", oid: 0, fields: [] };
}

const STAFF_CTX = {
  userId: "s1", tenantId: "t-pd", entityId: "e-1", identityClass: "staff" as const,
};

const PERSON_ROW = {
  id:               "person-001",
  display_name:     "Alice Smith",
  primary_email:    "alice@example.com",
  primary_phone:    null,
  linkedin_url:     null,
  location_city:    "New York",
  location_state:   "NY",
  location_country: "US",
  contact_types:    ["investor", "pro"],
  created_at:       "2026-01-01T00:00:00Z",
  updated_at:       "2026-05-01T00:00:00Z",
} as const;

// Setup: queryWithContext is called 6 times total in getPersonDetail
//   Call 1: ct.person lookup
//   Calls 2-6 (via Promise.all): pro_profile, investor_profile, member_profile, candidate_profile, employee_profile
function setupMocks(
  person: unknown,
  proRows: unknown[],
  investorRows: unknown[],
  memberRows: unknown[],
  candidateRows: unknown[],
  employeeRows: unknown[]
) {
  qwc
    .mockResolvedValueOnce(qr(person ? [person] : []))           // 1. ct.person
    .mockResolvedValueOnce(qr(proRows as QueryResultRow[]))       // 2. pro_profile
    .mockResolvedValueOnce(qr(investorRows as QueryResultRow[]))  // 3. investor_profile
    .mockResolvedValueOnce(qr(memberRows as QueryResultRow[]))    // 4. member_profile
    .mockResolvedValueOnce(qr(candidateRows as QueryResultRow[])) // 5. candidate_profile
    .mockResolvedValueOnce(qr(employeeRows as QueryResultRow[])); // 6. employee_profile
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// getPersonDetail
// ---------------------------------------------------------------------------

describe("getPersonDetail", () => {
  it("throws NotFoundError when ct.person not found", async () => {
    qwc.mockResolvedValueOnce(qr([])); // person not found → bail immediately
    await expect(getPersonDetail(STAFF_CTX, "nonexistent")).rejects.toThrow(NotFoundError);
  });

  it("returns person identity and empty role_chips when no profiles exist", async () => {
    setupMocks(PERSON_ROW, [], [], [], [], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.person.display_name).toBe("Alice Smith");
    expect(result.role_chips).toEqual([]);
    expect(result.pro_profiles).toEqual([]);
    expect(result.investor_profile).toBeNull();
    expect(result.member_profile).toBeNull();
    expect(result.candidate_profile).toBeNull();
    expect(result.employee_profile).toBeNull();
  });

  it("builds investor role chip with correct stage", async () => {
    const investorRow = { id: "inv-1", stage: "contacted" };
    setupMocks(PERSON_ROW, [], [investorRow], [], [], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips).toHaveLength(1);
    expect(result.role_chips[0]).toEqual({
      role:       "investor",
      profile_id: "inv-1",
      stage:      "contacted",
      is_active:  true,
    });
    expect(result.investor_profile).toEqual(investorRow);
  });

  it("marks investor chip as inactive when stage is terminal (passed)", async () => {
    const investorRow = { id: "inv-1", stage: "passed" };
    setupMocks(PERSON_ROW, [], [investorRow], [], [], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips[0]?.is_active).toBe(false);
  });

  it("builds pro role chip for each pro_profile row", async () => {
    const pro1 = { id: "pp-1", current_stage: "active" };
    const pro2 = { id: "pp-2", current_stage: "churn" };
    setupMocks(PERSON_ROW, [pro1, pro2], [], [], [], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    const proChips = result.role_chips.filter(c => c.role === "pro");
    expect(proChips).toHaveLength(2);
    expect(proChips[0]?.is_active).toBe(true);
    expect(proChips[1]?.is_active).toBe(false); // "churn" is terminal
  });

  it("builds member role chip with correct is_active", async () => {
    const memberRow = { id: "mem-1", current_stage: "paying" };
    setupMocks(PERSON_ROW, [], [], [memberRow], [], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips[0]).toEqual({
      role: "member", profile_id: "mem-1", stage: "paying", is_active: true,
    });
  });

  it("marks member chip inactive for churned stage", async () => {
    const memberRow = { id: "mem-1", current_stage: "churned" };
    setupMocks(PERSON_ROW, [], [], [memberRow], [], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips[0]?.is_active).toBe(false);
  });

  it("builds candidate role chip", async () => {
    const candidateRow = { id: "cand-1", current_stage: "applied" };
    setupMocks(PERSON_ROW, [], [], [], [candidateRow], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips[0]).toEqual({
      role: "candidate", profile_id: "cand-1", stage: "applied", is_active: true,
    });
    expect(result.candidate_profile).toEqual(candidateRow);
  });

  it("marks candidate chip inactive for rejected stage", async () => {
    const candidateRow = { id: "cand-1", current_stage: "rejected" };
    setupMocks(PERSON_ROW, [], [], [], [candidateRow], []);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips[0]?.is_active).toBe(false);
  });

  it("builds employee role chip (always active, stage='active')", async () => {
    const empRow = { id: "emp-1" };
    setupMocks(PERSON_ROW, [], [], [], [], [empRow]);

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips[0]).toEqual({
      role: "employee", profile_id: "emp-1", stage: "active", is_active: true,
    });
    expect(result.employee_profile).toEqual(empRow);
  });

  it("builds chips for all 5 roles simultaneously", async () => {
    setupMocks(
      PERSON_ROW,
      [{ id: "pp-1", current_stage: "active" }],
      [{ id: "inv-1", stage: "diligence" }],
      [{ id: "mem-1", current_stage: "paying" }],
      [{ id: "cand-1", current_stage: "hired" }],
      [{ id: "emp-1" }]
    );

    const result = await getPersonDetail(STAFF_CTX, "person-001");
    expect(result.role_chips).toHaveLength(5);
    const roles = result.role_chips.map(c => c.role);
    expect(roles).toContain("pro");
    expect(roles).toContain("investor");
    expect(roles).toContain("member");
    expect(roles).toContain("candidate");
    expect(roles).toContain("employee");
  });

  it("makes exactly 6 queryWithContext calls (1 person + 5 parallel role fetches)", async () => {
    setupMocks(PERSON_ROW, [], [], [], [], []);

    await getPersonDetail(STAFF_CTX, "person-001");
    expect(qwc).toHaveBeenCalledTimes(6);
  });

  it("passes personId and tenantId to the ct.person query", async () => {
    setupMocks(PERSON_ROW, [], [], [], [], []);

    await getPersonDetail(STAFF_CTX, "person-001");
    expect(qwc.mock.calls[0]?.[2]).toEqual(["person-001", "t-pd"]);
  });
});
