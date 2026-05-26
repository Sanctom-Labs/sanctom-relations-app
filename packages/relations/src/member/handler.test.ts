// =============================================================================
// Relations v0.2 — member/handler.ts unit tests
// =============================================================================
// Covers: assertStaff gate, 8-axis faceted filter logic, CRUD paths, stage
// transition, boolean has_coach_match filter, comma-separated multi-select.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError, ForbiddenError } from "../middleware.js";
import {
  listMemberProfiles,
  getMemberProfile,
  createMemberProfile,
  updateMemberProfile,
  updateMemberStage,
  deleteMemberProfile,
} from "./handler.js";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
  queryWithContext: vi.fn(),
  getContextClient: vi.fn(),
}));

import { queryWithContext, getContextClient } from "../db.js";

const qwc = vi.mocked(queryWithContext);
const gcc = vi.mocked(getContextClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qr<T extends QueryResultRow>(rows: T[], rowCount?: number): QueryResult<T> {
  return { rows, rowCount: rowCount ?? rows.length, command: "SELECT", oid: 0, fields: [] };
}

const STAFF_CTX = {
  userId: "staff-1", tenantId: "t-abc", entityId: "e-def", identityClass: "staff" as const,
};

const PRO_CTX = {
  userId: "pro-1", tenantId: "t-abc", entityId: "e-def", identityClass: "pro" as const,
};

const MEMBER_ROW = {
  id:                           "mem-001",
  person_id:                    "person-mem-1",
  tenant_id:                    "t-abc",
  owner_entity_id:              "e-def",
  signup_date:                  "2026-01-15T00:00:00Z",
  first_session_date:           null,
  onboarding_completion_date:   null,
  subscription_status:          "active",
  subscription_tier:            "pro",
  ltv_cents:                    "25000",
  arpu_cents:                   2500,
  cohort:                       "2026-Q1",
  segment:                      "power_user",
  churn_risk_score:             "0.15",
  last_activity_date:           "2026-05-20T00:00:00Z",
  coach_match_id:               "coach-999",
  current_stage:                "paying",
  useful_links:                 [],
  created_at:                   "2026-01-15T00:00:00Z",
  updated_at:                   "2026-05-20T00:00:00Z",
  created_by_user_id:           "staff-1",
  updated_by_user_id:           "staff-1",
} as const;

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
// listMemberProfiles — staff gate + filter logic
// ---------------------------------------------------------------------------

describe("listMemberProfiles", () => {
  it("returns paginated result for staff (no filters)", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "20" }]))
      .mockResolvedValueOnce(qr([MEMBER_ROW]));

    const result = await listMemberProfiles(STAFF_CTX, {});

    expect(result.total).toBe(20);
    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(50);
    expect(result.has_more).toBe(true);
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(listMemberProfiles(PRO_CTX, {})).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("multi-select subscription_status splits comma-separated values", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))
      .mockResolvedValueOnce(qr([MEMBER_ROW]));

    await listMemberProfiles(STAFF_CTX, { subscription_status: "active,trial" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    // Should contain the array ["active", "trial"]
    expect(countValues).toContainEqual(["active", "trial"]);
  });

  it("multi-select cohort splits comma-separated values", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "3" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { cohort: "2026-Q1,2026-Q2" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContainEqual(["2026-Q1", "2026-Q2"]);
  });

  it("churn_risk_gte is added to WHERE conditions", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "2" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { churn_risk_gte: "0.7" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContain(0.7);
  });

  it("churn_risk range (gte + lte) both added", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "4" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { churn_risk_gte: "0.5", churn_risk_lte: "0.8" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContain(0.5);
    expect(countValues).toContain(0.8);
  });

  it("has_coach_match=true adds IS NOT NULL condition (not a param value)", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "10" }]))
      .mockResolvedValueOnce(qr([MEMBER_ROW]));

    await listMemberProfiles(STAFF_CTX, { has_coach_match: "true" });

    // The COUNT query SQL should contain IS NOT NULL
    const countSql = qwc.mock.calls[0]?.[1] as string;
    expect(countSql).toContain("IS NOT NULL");
  });

  it("has_coach_match=false adds IS NULL condition", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { has_coach_match: "false" });

    const countSql = qwc.mock.calls[0]?.[1] as string;
    expect(countSql).toContain("IS NULL");
  });

  it("last_activity_after / before date range filters", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "3" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, {
      last_activity_after:  "2026-05-01",
      last_activity_before: "2026-05-31",
    });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContain("2026-05-01");
    expect(countValues).toContain("2026-05-31");
  });

  it("signup date range filters", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "2" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, {
      signup_after:  "2026-01-01",
      signup_before: "2026-03-31",
    });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContain("2026-01-01");
    expect(countValues).toContain("2026-03-31");
  });

  it("multi-select segment filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "2" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { segment: "power_user,casual" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContainEqual(["power_user", "casual"]);
  });

  it("multi-select subscription_tier filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { subscription_tier: "pro,enterprise" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContainEqual(["pro", "enterprise"]);
  });

  it("current_stage filter is passed as scalar", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))
      .mockResolvedValueOnce(qr([]));

    await listMemberProfiles(STAFF_CTX, { current_stage: "paying" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContain("paying");
  });

  it("honours page + page_size params", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "200" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await listMemberProfiles(STAFF_CTX, { page: "3", page_size: "25" });
    expect(result.page).toBe(3);
    expect(result.page_size).toBe(25);
  });

  it("returns has_more=false when total fits on one page", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([MEMBER_ROW]));

    const result = await listMemberProfiles(STAFF_CTX, {});
    expect(result.has_more).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMemberProfile
// ---------------------------------------------------------------------------

describe("getMemberProfile", () => {
  it("returns row for staff", async () => {
    qwc.mockResolvedValueOnce(qr([MEMBER_ROW]));

    const row = await getMemberProfile(STAFF_CTX, "mem-001");
    expect(row.id).toBe("mem-001");
  });

  it("throws ForbiddenError for pro identity", async () => {
    await expect(getMemberProfile(PRO_CTX, "mem-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when absent", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(getMemberProfile(STAFF_CTX, "mem-999")).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// createMemberProfile
// ---------------------------------------------------------------------------

const VALID_CREATE_BODY = {
  person_id:       "00000000-0000-0000-0000-000000000001",
  owner_entity_id: "00000000-0000-0000-0000-000000000002",
};

describe("createMemberProfile", () => {
  it("inserts and returns row for staff", async () => {
    qwc.mockResolvedValueOnce(qr([MEMBER_ROW]));

    const row = await createMemberProfile(STAFF_CTX, VALID_CREATE_BODY);
    expect(row.id).toBe("mem-001");
  });

  it("throws ForbiddenError for pro identity", async () => {
    await expect(createMemberProfile(PRO_CTX, VALID_CREATE_BODY)).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid person_id", async () => {
    await expect(
      createMemberProfile(STAFF_CTX, { ...VALID_CREATE_BODY, person_id: "bad" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("defaults subscription_status to 'trial' and current_stage to 'prospect'", async () => {
    qwc.mockResolvedValueOnce(qr([MEMBER_ROW]));

    await createMemberProfile(STAFF_CTX, VALID_CREATE_BODY);

    const insertValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(insertValues).toContain("trial");    // subscription_status default
    expect(insertValues).toContain("prospect"); // current_stage default
  });

  it("accepts churn_risk_score between 0 and 1", async () => {
    qwc.mockResolvedValueOnce(qr([MEMBER_ROW]));

    await expect(
      createMemberProfile(STAFF_CTX, { ...VALID_CREATE_BODY, churn_risk_score: 0.75 })
    ).resolves.toBeDefined();
  });

  it("rejects churn_risk_score > 1", async () => {
    await expect(
      createMemberProfile(STAFF_CTX, { ...VALID_CREATE_BODY, churn_risk_score: 1.5 })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("accepts optional coach_match_id as valid UUID", async () => {
    qwc.mockResolvedValueOnce(qr([MEMBER_ROW]));

    await expect(
      createMemberProfile(STAFF_CTX, {
        ...VALID_CREATE_BODY,
        coach_match_id: "00000000-0000-0000-0000-000000000099",
      })
    ).resolves.toBeDefined();
  });

  it("rejects invalid coach_match_id (not UUID)", async () => {
    await expect(
      createMemberProfile(STAFF_CTX, { ...VALID_CREATE_BODY, coach_match_id: "not-a-uuid" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateMemberProfile
// ---------------------------------------------------------------------------

describe("updateMemberProfile", () => {
  it("returns updated row on success", async () => {
    const updated = { ...MEMBER_ROW, subscription_status: "paused" };
    qwc.mockResolvedValueOnce(qr([updated]));

    const row = await updateMemberProfile(STAFF_CTX, "mem-001", { subscription_status: "paused" });
    expect(row.subscription_status).toBe("paused");
  });

  it("throws ForbiddenError for pro identity", async () => {
    await expect(
      updateMemberProfile(PRO_CTX, "mem-001", { cohort: "2026-Q2" })
    ).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when UPDATE returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(
      updateMemberProfile(STAFF_CTX, "nonexistent", { segment: "casual" })
    ).rejects.toThrow(NotFoundError);
  });

  it("serialises useful_links to JSON", async () => {
    const links = [{ label: "Portal", url: "https://portal.example.com" }];
    qwc.mockResolvedValueOnce(qr([{ ...MEMBER_ROW, useful_links: links }]));

    await updateMemberProfile(STAFF_CTX, "mem-001", { useful_links: links });

    const updateSql = qwc.mock.calls[0]?.[1] as string;
    expect(updateSql).toContain("::jsonb");
  });
});

// ---------------------------------------------------------------------------
// updateMemberStage
// ---------------------------------------------------------------------------

describe("updateMemberStage", () => {
  it("updates stage and emits activity row", async () => {
    const updatedRow = { ...MEMBER_ROW, current_stage: "churned" };
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "paying", person_id: "person-mem-1" }]))
      .mockResolvedValueOnce(qr([updatedRow]))
      .mockResolvedValueOnce(qr([]));

    const row = await updateMemberStage(STAFF_CTX, "mem-001", { stage: "churned" });
    expect(row.current_stage).toBe("churned");
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ForbiddenError for pro identity", async () => {
    await expect(
      updateMemberStage(PRO_CTX, "mem-001", { stage: "paying" })
    ).rejects.toThrow(ForbiddenError);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when member not found", async () => {
    mockClientQuery.mockResolvedValueOnce(qr([]));

    await expect(
      updateMemberStage(STAFF_CTX, "nonexistent", { stage: "paying" })
    ).rejects.toThrow(NotFoundError);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases client even when UPDATE fails", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "trial", person_id: "p1" }]))
      .mockRejectedValueOnce(new Error("pg error"));

    await expect(
      updateMemberStage(STAFF_CTX, "mem-001", { stage: "paying" })
    ).rejects.toThrow("pg error");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ZodError for invalid stage", async () => {
    await expect(
      updateMemberStage(STAFF_CTX, "mem-001", { stage: "ghost_stage" as never })
    ).rejects.toThrow();
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("activity metadata includes role_context=member, from_stage and to_stage", async () => {
    const updatedRow = { ...MEMBER_ROW, current_stage: "reactivation" };
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "churned", person_id: "p1" }]))
      .mockResolvedValueOnce(qr([updatedRow]))
      .mockResolvedValueOnce(qr([]));

    await updateMemberStage(STAFF_CTX, "mem-001", { stage: "reactivation" });

    const activityCall = mockClientQuery.mock.calls[2];
    // Second element is values array; third value is the metadata JSON string
    const activityValues = activityCall?.[1] as unknown[];
    const metadataJson = activityValues?.[2] as string;
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    expect(metadata["from_stage"]).toBe("churned");
    expect(metadata["to_stage"]).toBe("reactivation");

    // The INSERT SQL should reference 'member' as role_context
    const activitySql = activityCall?.[0] as string;
    expect(activitySql).toContain("'member'");
  });
});

// ---------------------------------------------------------------------------
// deleteMemberProfile
// ---------------------------------------------------------------------------

describe("deleteMemberProfile", () => {
  it("resolves void when rowCount >= 1", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 1 });
    await expect(deleteMemberProfile(STAFF_CTX, "mem-001")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError for pro identity", async () => {
    await expect(deleteMemberProfile(PRO_CTX, "mem-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when rowCount is 0", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 0 });
    await expect(deleteMemberProfile(STAFF_CTX, "mem-999")).rejects.toThrow(NotFoundError);
  });
});
