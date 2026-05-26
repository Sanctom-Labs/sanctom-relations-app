// =============================================================================
// Relations v0.2 — pro-profile/handler.ts unit tests
// =============================================================================
// DB is fully mocked via vi.mock('../db.js').
// Tests exercise the handler logic: SQL parameterization, error paths, Zod
// validation delegation, and client-lifecycle (getContextClient / release).
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError, ValidationError, ForbiddenError } from "../middleware.js";
import {
  listProProfiles,
  getProProfile,
  getProProfilesByPerson,
  createProProfile,
  updateProProfile,
  updateProProfileStage,
  deleteProProfile,
  listOnboardingTemplates,
  listEngagementStageLabels,
} from "./handler.js";

// ---------------------------------------------------------------------------
// Mock the DB module
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
  queryWithContext: vi.fn(),
  getContextClient: vi.fn(),
}));

// Import *after* mock registration so we get the mocked version
import { queryWithContext, getContextClient } from "../db.js";

const qwc = vi.mocked(queryWithContext);
const gcc = vi.mocked(getContextClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qr<T extends QueryResultRow>(rows: T[], rowCount?: number): QueryResult<T> {
  return {
    rows,
    rowCount: rowCount ?? rows.length,
    command: "SELECT",
    oid: 0,
    fields: [],
  };
}

const STAFF_CTX = {
  userId:        "user-staff-1",
  tenantId:      "tenant-111",
  entityId:      "entity-222",
  identityClass: "staff" as const,
};

const PRO_CTX = {
  userId:        "user-pro-1",
  tenantId:      "tenant-111",
  entityId:      "entity-222",
  identityClass: "pro" as const,
};

const PRO_PROFILE_ROW = {
  id:                     "pp-001",
  person_id:              "person-001",
  tenant_id:              "tenant-111",
  owner_entity_id:        "entity-222",
  pro_type:               "coach",
  pro_category:           "healing_arts",
  billing_model:          "session_based",
  engagement_structure:   "recurring_sessions",
  regulatory_tier:        "cert_based",
  pro_type_fields:        {},
  specialties:            [],
  years_of_experience:    null,
  languages:              [],
  capacity_per_period:    null,
  availability_open:      true,
  payout_method:          null,
  payout_account_status:  "unverified",
  onboarding_status:      "not_started",
  onboarding_template_id: null,
  fit_rationale:          null,
  utilization_rate:       null,
  repeat_client_rate:     null,
  nps_score:              null,
  useful_links:           [],
  current_stage:          "prospect",
  created_at:             "2026-05-01T00:00:00Z",
  updated_at:             "2026-05-01T00:00:00Z",
  created_by_user_id:     "user-staff-1",
  updated_by_user_id:     "user-staff-1",
} as const;

// Mock client (used by getContextClient)
const mockClientQuery = vi.fn();
const mockRelease     = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  gcc.mockResolvedValue({
    client:  { query: mockClientQuery } as unknown as import("pg").PoolClient,
    release: mockRelease,
  });
});

// ---------------------------------------------------------------------------
// listProProfiles
// ---------------------------------------------------------------------------

describe("listProProfiles", () => {
  it("returns paginated result with no filters", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))   // COUNT query
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW])); // DATA query

    const result = await listProProfiles(STAFF_CTX, {});

    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(50);
    expect(result.data).toHaveLength(1);
    expect(result.has_more).toBe(true); // 5 total, 1 returned
    expect(qwc).toHaveBeenCalledTimes(2);
  });

  it("applies pro_type filter in WHERE clause", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "2" }]))
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    await listProProfiles(STAFF_CTX, { pro_type: "attorney" });

    // First call is COUNT; check that it includes the filter value
    const countCall = qwc.mock.calls[0];
    expect(countCall?.[2]).toContain("attorney");
  });

  it("applies availability_open=true filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    await listProProfiles(STAFF_CTX, { availability_open: "true" });

    const countCall = qwc.mock.calls[0];
    expect(countCall?.[2]).toContain(true); // boolean coercion
  });

  it("has_more is false when all results fit on page", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    const result = await listProProfiles(STAFF_CTX, {});
    expect(result.has_more).toBe(false);
  });

  it("honours page + page_size", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "100" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await listProProfiles(STAFF_CTX, { page: "2", page_size: "10" });
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
    // offset 10 + 0 data rows < 100 total → has_more = true
    expect(result.has_more).toBe(true);
  });

  it("throws ZodError for invalid page value", async () => {
    await expect(listProProfiles(STAFF_CTX, { page: "-1" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getProProfile
// ---------------------------------------------------------------------------

describe("getProProfile", () => {
  it("returns row when found", async () => {
    qwc.mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    const row = await getProProfile(STAFF_CTX, "pp-001");
    expect(row.id).toBe("pp-001");
    expect(qwc).toHaveBeenCalledOnce();
  });

  it("throws NotFoundError when row is absent", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(getProProfile(STAFF_CTX, "nonexistent")).rejects.toThrow(NotFoundError);
  });

  it("passes correct params (id, tenantId, entityId) to queryWithContext", async () => {
    qwc.mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    await getProProfile(STAFF_CTX, "pp-001");

    const call = qwc.mock.calls[0];
    expect(call?.[2]).toEqual(["pp-001", "tenant-111", "entity-222"]);
  });
});

// ---------------------------------------------------------------------------
// getProProfilesByPerson
// ---------------------------------------------------------------------------

describe("getProProfilesByPerson", () => {
  it("returns empty array when no profiles found", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    const rows = await getProProfilesByPerson(STAFF_CTX, "person-xyz");
    expect(rows).toEqual([]);
  });

  it("returns multiple profiles", async () => {
    const row2 = { ...PRO_PROFILE_ROW, id: "pp-002", pro_type: "attorney" };
    qwc.mockResolvedValueOnce(qr([PRO_PROFILE_ROW, row2]));

    const rows = await getProProfilesByPerson(STAFF_CTX, "person-001");
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// createProProfile
// ---------------------------------------------------------------------------

const VALID_CREATE_BODY = {
  person_id:            "00000000-0000-0000-0000-000000000001",
  owner_entity_id:      "00000000-0000-0000-0000-000000000002",
  pro_type:             "coach" as const,
  pro_category:         "healing_arts" as const,
  billing_model:        "session_based" as const,
  engagement_structure: "recurring_sessions" as const,
  regulatory_tier:      "cert_based" as const,
};

describe("createProProfile", () => {
  it("inserts and returns the created row", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([]))               // onboarding_template lookup → none found
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW])); // INSERT RETURNING

    const row = await createProProfile(STAFF_CTX, VALID_CREATE_BODY);
    expect(row.id).toBe("pp-001");
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases client even when INSERT fails", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([]))               // template lookup
      .mockRejectedValueOnce(new Error("pg error")); // INSERT throws

    await expect(createProProfile(STAFF_CTX, VALID_CREATE_BODY)).rejects.toThrow("pg error");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ZodError for invalid body (bad UUID)", async () => {
    const badBody = { ...VALID_CREATE_BODY, person_id: "not-a-uuid" };
    await expect(createProProfile(STAFF_CTX, badBody)).rejects.toThrow();
    // No DB calls should have been made
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("throws ValidationError for coach with invalid pro_type_fields", async () => {
    const badBody = {
      ...VALID_CREATE_BODY,
      pro_type_fields: { hourly_rate_usd: -100 }, // negative → invalid
    };
    await expect(createProProfile(STAFF_CTX, badBody)).rejects.toThrow(ValidationError);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("accepts coach with valid pro_type_fields", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    const bodyWithFields = {
      ...VALID_CREATE_BODY,
      pro_type_fields: { hourly_rate_usd: 150, icf_credential: "PCC" },
    };

    const row = await createProProfile(STAFF_CTX, bodyWithFields);
    expect(row).toBeDefined();
  });

  it("throws ForbiddenError for pro_type=other with personal identityClass", async () => {
    const personalCtx = { ...STAFF_CTX, identityClass: "personal" as const };
    const body = { ...VALID_CREATE_BODY, pro_type: "other" as const, pro_category: "other" as const };

    await expect(createProProfile(personalCtx, body)).rejects.toThrow(ForbiddenError);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("allows pro_type=other for pro identity class", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([]))
      .mockResolvedValueOnce(qr([{ ...PRO_PROFILE_ROW, pro_type: "other" }]));

    const body = { ...VALID_CREATE_BODY, pro_type: "other" as const, pro_category: "other" as const };
    const row = await createProProfile(PRO_CTX, body);
    expect(row).toBeDefined();
  });

  it("uses provided onboarding_template_id when supplied (skips template lookup)", async () => {
    const tmplId = "00000000-0000-0000-0000-000000000099";
    mockClientQuery
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW])); // Only the INSERT — no template lookup

    const body = { ...VALID_CREATE_BODY, onboarding_template_id: tmplId };
    await createProProfile(STAFF_CTX, body);

    // Should be called exactly once (INSERT only)
    expect(mockClientQuery).toHaveBeenCalledOnce();
    // The INSERT call should include the template id
    const insertCall = mockClientQuery.mock.calls[0];
    expect(insertCall?.[1]).toContain(tmplId);
  });
});

// ---------------------------------------------------------------------------
// updateProProfile
// ---------------------------------------------------------------------------

describe("updateProProfile", () => {
  it("updates scalar fields and returns row", async () => {
    qwc.mockResolvedValueOnce(qr([{ ...PRO_PROFILE_ROW, availability_open: false }]));

    const row = await updateProProfile(STAFF_CTX, "pp-001", { availability_open: false });
    expect(row.availability_open).toBe(false);
    expect(qwc).toHaveBeenCalledOnce(); // no getProProfile needed (no pro_type_fields change)
  });

  it("throws NotFoundError when UPDATE returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(updateProProfile(STAFF_CTX, "nonexistent", { availability_open: true }))
      .rejects.toThrow(NotFoundError);
  });

  it("fetches current row when pro_type_fields updated but pro_type not in body", async () => {
    // Call 1: getProProfile (internal) → returns current row
    // Call 2: UPDATE → returns updated row
    qwc
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW]))
      .mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    await updateProProfile(STAFF_CTX, "pp-001", {
      pro_type_fields: { hourly_rate_usd: 200 },
    });

    expect(qwc).toHaveBeenCalledTimes(2);
  });

  it("does NOT fetch current row when pro_type IS in the update body", async () => {
    // Only the UPDATE call needed when pro_type is in body
    qwc.mockResolvedValueOnce(qr([PRO_PROFILE_ROW]));

    await updateProProfile(STAFF_CTX, "pp-001", {
      pro_type:        "attorney",
      pro_category:    "professional_services",
      billing_model:   "billable_hours",
      engagement_structure: "case_based",
      regulatory_tier: "state_license",
    });

    expect(qwc).toHaveBeenCalledOnce();
  });

  it("throws ZodError for invalid stage value", async () => {
    await expect(
      updateProProfile(STAFF_CTX, "pp-001", { current_stage: "unknown_stage" as never })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateProProfileStage
// ---------------------------------------------------------------------------

describe("updateProProfileStage", () => {
  it("updates stage and inserts activity row", async () => {
    const updatedRow = { ...PRO_PROFILE_ROW, current_stage: "onboarded" };
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "prospect", person_id: "person-001" }])) // SELECT
      .mockResolvedValueOnce(qr([updatedRow]))  // UPDATE
      .mockResolvedValueOnce(qr([]));           // INSERT activity

    const row = await updateProProfileStage(STAFF_CTX, "pp-001", { stage: "onboarded" });
    expect(row.current_stage).toBe("onboarded");
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws NotFoundError when profile not found", async () => {
    mockClientQuery.mockResolvedValueOnce(qr([])); // SELECT returns nothing

    await expect(
      updateProProfileStage(STAFF_CTX, "nonexistent", { stage: "active" })
    ).rejects.toThrow(NotFoundError);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases client even when UPDATE fails", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "prospect", person_id: "p1" }]))
      .mockRejectedValueOnce(new Error("db down"));

    await expect(
      updateProProfileStage(STAFF_CTX, "pp-001", { stage: "active" })
    ).rejects.toThrow("db down");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ZodError for invalid stage", async () => {
    await expect(
      updateProProfileStage(STAFF_CTX, "pp-001", { stage: "not_a_stage" as never })
    ).rejects.toThrow();
    // DB should not have been called (validation fires first)
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteProProfile
// ---------------------------------------------------------------------------

describe("deleteProProfile", () => {
  it("resolves void when rowCount >= 1", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 1 });

    await expect(deleteProProfile(STAFF_CTX, "pp-001")).resolves.toBeUndefined();
  });

  it("throws NotFoundError when rowCount is 0", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 0 });

    await expect(deleteProProfile(STAFF_CTX, "pp-001")).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// listOnboardingTemplates
// ---------------------------------------------------------------------------

describe("listOnboardingTemplates", () => {
  it("returns rows from DB (active only by default)", async () => {
    const tmpl = { id: "t1", pro_type: "coach", is_active: true };
    qwc.mockResolvedValueOnce(qr([tmpl]));

    const rows = await listOnboardingTemplates(STAFF_CTX);
    expect(rows).toHaveLength(1);
    // activeOnly = true → second param passed to queryWithContext
    expect(qwc.mock.calls[0]?.[2]).toEqual([true]);
  });

  it("passes false for activeOnly=false", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await listOnboardingTemplates(STAFF_CTX, false);
    expect(qwc.mock.calls[0]?.[2]).toEqual([false]);
  });
});

// ---------------------------------------------------------------------------
// listEngagementStageLabels
// ---------------------------------------------------------------------------

describe("listEngagementStageLabels", () => {
  it("returns all labels when no engagementStructure filter", async () => {
    qwc.mockResolvedValueOnce(qr([{ engagement_structure: "recurring_sessions", stage: "prospect" }]));

    const rows = await listEngagementStageLabels(STAFF_CTX);
    expect(rows).toHaveLength(1);
    expect(qwc.mock.calls[0]?.[2]).toEqual([null]);
  });

  it("passes engagementStructure filter", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await listEngagementStageLabels(STAFF_CTX, "case_based");
    expect(qwc.mock.calls[0]?.[2]).toEqual(["case_based"]);
  });
});
