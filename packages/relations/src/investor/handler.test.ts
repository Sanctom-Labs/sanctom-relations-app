// =============================================================================
// Relations v0.2 — investor/handler.ts unit tests
// =============================================================================
// Covers: assertStaff gate on every endpoint, CRUD success paths, error paths,
// stage transition with activity row emission, pagination shape.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError, ForbiddenError } from "../middleware.js";
import {
  listInvestorProfiles,
  getInvestorProfile,
  createInvestorProfile,
  updateInvestorProfile,
  updateInvestorStage,
  deleteInvestorProfile,
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
  userId: "staff-user-1", tenantId: "t-111", entityId: "e-222", identityClass: "staff" as const,
};

const PERSONAL_CTX = {
  userId: "personal-1", tenantId: "t-111", entityId: "e-222", identityClass: "personal" as const,
};

const INVESTOR_ROW = {
  id:                 "inv-001",
  person_id:          "person-inv-1",
  tenant_id:          "t-111",
  owner_entity_id:    "e-222",
  stage:              "prospect",
  fit_score:          "high",
  priority:           "urgent",
  check_size_min_usd: null,
  check_size_max_usd: null,
  investment_focus:   ["AI", "SaaS"],
  stage_preference:   null,
  portfolio_cos:      [],
  fit_rationale:      null,
  outreach_approach:  null,
  suggested_hook:     null,
  warm_intro_path:    null,
  rec_timing:         null,
  knox_notes:         null,
  next_action:        "Send deck",
  useful_links:       [],
  created_at:         "2026-05-01T00:00:00Z",
  updated_at:         "2026-05-01T00:00:00Z",
  created_by_user_id: "staff-user-1",
  updated_by_user_id: "staff-user-1",
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
// listInvestorProfiles
// ---------------------------------------------------------------------------

describe("listInvestorProfiles", () => {
  it("returns paginated result for staff", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "10" }]))
      .mockResolvedValueOnce(qr([INVESTOR_ROW]));

    const result = await listInvestorProfiles(STAFF_CTX, {});

    expect(result.total).toBe(10);
    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(50);
  });

  it("throws ForbiddenError for non-staff identity", async () => {
    await expect(listInvestorProfiles(PERSONAL_CTX, {})).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("applies stage filter in WHERE values", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "3" }]))
      .mockResolvedValueOnce(qr([INVESTOR_ROW]));

    await listInvestorProfiles(STAFF_CTX, { stage: "contacted" });

    expect(qwc.mock.calls[0]?.[2]).toContain("contacted");
  });

  it("applies fit_score filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([INVESTOR_ROW]));

    await listInvestorProfiles(STAFF_CTX, { fit_score: "high" });

    expect(qwc.mock.calls[0]?.[2]).toContain("high");
  });

  it("has_more reflects offset + data < total", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "100" }]))
      .mockResolvedValueOnce(qr([INVESTOR_ROW]));

    const result = await listInvestorProfiles(STAFF_CTX, { page: "1", page_size: "50" });
    expect(result.has_more).toBe(true);
  });

  it("has_more = false when all data returned", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([INVESTOR_ROW]));

    const result = await listInvestorProfiles(STAFF_CTX, {});
    expect(result.has_more).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getInvestorProfile
// ---------------------------------------------------------------------------

describe("getInvestorProfile", () => {
  it("returns row for staff", async () => {
    qwc.mockResolvedValueOnce(qr([INVESTOR_ROW]));

    const row = await getInvestorProfile(STAFF_CTX, "inv-001");
    expect(row.id).toBe("inv-001");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(getInvestorProfile(PERSONAL_CTX, "inv-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when row absent", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(getInvestorProfile(STAFF_CTX, "inv-999")).rejects.toThrow(NotFoundError);
  });

  it("passes (id, tenantId) as params", async () => {
    qwc.mockResolvedValueOnce(qr([INVESTOR_ROW]));

    await getInvestorProfile(STAFF_CTX, "inv-001");
    expect(qwc.mock.calls[0]?.[2]).toEqual(["inv-001", "t-111"]);
  });
});

// ---------------------------------------------------------------------------
// createInvestorProfile
// ---------------------------------------------------------------------------

const VALID_CREATE_BODY = {
  person_id:       "00000000-0000-0000-0000-000000000001",
  owner_entity_id: "00000000-0000-0000-0000-000000000002",
};

describe("createInvestorProfile", () => {
  it("inserts and returns row for staff", async () => {
    qwc.mockResolvedValueOnce(qr([INVESTOR_ROW]));

    const row = await createInvestorProfile(STAFF_CTX, VALID_CREATE_BODY);
    expect(row.id).toBe("inv-001");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(createInvestorProfile(PERSONAL_CTX, VALID_CREATE_BODY))
      .rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid person_id", async () => {
    await expect(
      createInvestorProfile(STAFF_CTX, { ...VALID_CREATE_BODY, person_id: "bad-id" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid stage value", async () => {
    await expect(
      createInvestorProfile(STAFF_CTX, { ...VALID_CREATE_BODY, stage: "unknown" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("defaults stage to 'prospect' when not supplied", async () => {
    qwc.mockResolvedValueOnce(qr([INVESTOR_ROW]));

    await createInvestorProfile(STAFF_CTX, VALID_CREATE_BODY);

    // The INSERT values should include "prospect" for stage
    const insertValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(insertValues).toContain("prospect");
  });

  it("accepts all 8 investor stages", async () => {
    const stages = [
      "prospect","contacted","responded","meeting_scheduled",
      "meeting_held","diligence","committed","passed",
    ] as const;

    for (const stage of stages) {
      qwc.mockResolvedValueOnce(qr([{ ...INVESTOR_ROW, stage }]));
      const row = await createInvestorProfile(STAFF_CTX, { ...VALID_CREATE_BODY, stage });
      expect(row.stage).toBe(stage);
    }
  });
});

// ---------------------------------------------------------------------------
// updateInvestorProfile
// ---------------------------------------------------------------------------

describe("updateInvestorProfile", () => {
  it("returns updated row", async () => {
    const updated = { ...INVESTOR_ROW, next_action: "Schedule call" };
    qwc.mockResolvedValueOnce(qr([updated]));

    const row = await updateInvestorProfile(STAFF_CTX, "inv-001", { next_action: "Schedule call" });
    expect(row.next_action).toBe("Schedule call");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(
      updateInvestorProfile(PERSONAL_CTX, "inv-001", { next_action: "x" })
    ).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when UPDATE returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(
      updateInvestorProfile(STAFF_CTX, "nonexistent", { fit_score: "low" })
    ).rejects.toThrow(NotFoundError);
  });

  it("handles useful_links update (JSON serialised)", async () => {
    const links = [{ label: "LinkedIn", url: "https://linkedin.com/in/test" }];
    qwc.mockResolvedValueOnce(qr([{ ...INVESTOR_ROW, useful_links: links }]));

    const row = await updateInvestorProfile(STAFF_CTX, "inv-001", { useful_links: links });
    expect(row.useful_links).toEqual(links);
  });
});

// ---------------------------------------------------------------------------
// updateInvestorStage
// ---------------------------------------------------------------------------

describe("updateInvestorStage", () => {
  it("updates stage and emits activity row", async () => {
    const updatedRow = { ...INVESTOR_ROW, stage: "contacted" };
    mockClientQuery
      .mockResolvedValueOnce(qr([{ stage: "prospect", person_id: "person-inv-1" }])) // SELECT
      .mockResolvedValueOnce(qr([updatedRow]))  // UPDATE
      .mockResolvedValueOnce(qr([]));           // INSERT activity

    const row = await updateInvestorStage(STAFF_CTX, "inv-001", { stage: "contacted" });
    expect(row.stage).toBe("contacted");
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(
      updateInvestorStage(PERSONAL_CTX, "inv-001", { stage: "contacted" })
    ).rejects.toThrow(ForbiddenError);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when profile not found", async () => {
    mockClientQuery.mockResolvedValueOnce(qr([]));

    await expect(
      updateInvestorStage(STAFF_CTX, "nonexistent", { stage: "diligence" })
    ).rejects.toThrow(NotFoundError);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases client even when UPDATE fails", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([{ stage: "prospect", person_id: "p1" }]))
      .mockRejectedValueOnce(new Error("db crash"));

    await expect(
      updateInvestorStage(STAFF_CTX, "inv-001", { stage: "committed" })
    ).rejects.toThrow("db crash");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ZodError for invalid stage", async () => {
    await expect(
      updateInvestorStage(STAFF_CTX, "inv-001", { stage: "ghost_stage" as never })
    ).rejects.toThrow();
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("activity row includes from_stage and to_stage in metadata", async () => {
    const updatedRow = { ...INVESTOR_ROW, stage: "responded" };
    mockClientQuery
      .mockResolvedValueOnce(qr([{ stage: "contacted", person_id: "p1" }]))
      .mockResolvedValueOnce(qr([updatedRow]))
      .mockResolvedValueOnce(qr([]));

    await updateInvestorStage(STAFF_CTX, "inv-001", { stage: "responded" });

    const activityCall = mockClientQuery.mock.calls[2];
    const metadataArg = activityCall?.[1]?.[2] as string;
    const metadata = JSON.parse(metadataArg) as Record<string, unknown>;
    expect(metadata["from_stage"]).toBe("contacted");
    expect(metadata["to_stage"]).toBe("responded");
  });
});

// ---------------------------------------------------------------------------
// deleteInvestorProfile
// ---------------------------------------------------------------------------

describe("deleteInvestorProfile", () => {
  it("resolves void when rowCount >= 1", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 1 });

    await expect(deleteInvestorProfile(STAFF_CTX, "inv-001")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(deleteInvestorProfile(PERSONAL_CTX, "inv-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when rowCount is 0", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 0 });

    await expect(deleteInvestorProfile(STAFF_CTX, "inv-999")).rejects.toThrow(NotFoundError);
  });
});
