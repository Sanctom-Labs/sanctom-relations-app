// =============================================================================
// Relations v0.2 — candidate/handler.ts unit tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError, ForbiddenError } from "../middleware.js";
import {
  listCandidateProfiles,
  getCandidateProfile,
  createCandidateProfile,
  updateCandidateProfile,
  updateCandidateStage,
  deleteCandidateProfile,
} from "./handler.js";

vi.mock("../db.js", () => ({
  queryWithContext: vi.fn(),
  getContextClient: vi.fn(),
}));

import { queryWithContext, getContextClient } from "../db.js";

const qwc = vi.mocked(queryWithContext);
const gcc = vi.mocked(getContextClient);

function qr<T extends QueryResultRow>(rows: T[], rowCount?: number): QueryResult<T> {
  return { rows, rowCount: rowCount ?? rows.length, command: "SELECT", oid: 0, fields: [] };
}

const STAFF_CTX = {
  userId: "s1", tenantId: "t-cand", entityId: "e-1", identityClass: "staff" as const,
};

const PERSONAL_CTX = {
  userId: "p1", tenantId: "t-cand", entityId: "e-1", identityClass: "personal" as const,
};

const CANDIDATE_ROW = {
  id:                 "cand-001",
  person_id:          "person-c1",
  tenant_id:          "t-cand",
  owner_entity_id:    "e-1",
  current_stage:      "applied",
  role_applied_for:   "Backend Engineer",
  application_source: "LinkedIn",
  notes:              null,
  created_at:         "2026-05-01T00:00:00Z",
  updated_at:         "2026-05-01T00:00:00Z",
  created_by_user_id: "s1",
  updated_by_user_id: "s1",
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
// listCandidateProfiles
// ---------------------------------------------------------------------------

describe("listCandidateProfiles", () => {
  it("returns paginated result for staff (no filter)", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "7" }]))
      .mockResolvedValueOnce(qr([CANDIDATE_ROW]));

    const result = await listCandidateProfiles(STAFF_CTX, {});
    expect(result.total).toBe(7);
    expect(result.data).toHaveLength(1);
    expect(result.has_more).toBe(true);
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(listCandidateProfiles(PERSONAL_CTX, {})).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("applies current_stage filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "3" }]))
      .mockResolvedValueOnce(qr([CANDIDATE_ROW]));

    await listCandidateProfiles(STAFF_CTX, { current_stage: "interviewed" });

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain("interviewed");
  });

  it("has_more is false when total fits on page", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([CANDIDATE_ROW]));

    const result = await listCandidateProfiles(STAFF_CTX, {});
    expect(result.has_more).toBe(false);
  });

  it("honours page + page_size params", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "100" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await listCandidateProfiles(STAFF_CTX, { page: "2", page_size: "20" });
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// getCandidateProfile
// ---------------------------------------------------------------------------

describe("getCandidateProfile", () => {
  it("returns row for staff", async () => {
    qwc.mockResolvedValueOnce(qr([CANDIDATE_ROW]));
    const row = await getCandidateProfile(STAFF_CTX, "cand-001");
    expect(row.id).toBe("cand-001");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(getCandidateProfile(PERSONAL_CTX, "cand-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when absent", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(getCandidateProfile(STAFF_CTX, "cand-999")).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// createCandidateProfile
// ---------------------------------------------------------------------------

const VALID_BODY = {
  person_id:       "00000000-0000-0000-0000-000000000001",
  owner_entity_id: "00000000-0000-0000-0000-000000000002",
};

describe("createCandidateProfile", () => {
  it("inserts and returns row", async () => {
    qwc.mockResolvedValueOnce(qr([CANDIDATE_ROW]));
    const row = await createCandidateProfile(STAFF_CTX, VALID_BODY);
    expect(row.id).toBe("cand-001");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(createCandidateProfile(PERSONAL_CTX, VALID_BODY)).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid person_id", async () => {
    await expect(
      createCandidateProfile(STAFF_CTX, { ...VALID_BODY, person_id: "bad" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("defaults current_stage to 'applied'", async () => {
    qwc.mockResolvedValueOnce(qr([CANDIDATE_ROW]));
    await createCandidateProfile(STAFF_CTX, VALID_BODY);
    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain("applied");
  });

  it("accepts all 6 candidate stages", async () => {
    const stages = ["applied","screened","interviewed","offered","hired","rejected"] as const;
    for (const stage of stages) {
      qwc.mockResolvedValueOnce(qr([{ ...CANDIDATE_ROW, current_stage: stage }]));
      const row = await createCandidateProfile(STAFF_CTX, { ...VALID_BODY, current_stage: stage });
      expect(row.current_stage).toBe(stage);
    }
  });
});

// ---------------------------------------------------------------------------
// updateCandidateProfile
// ---------------------------------------------------------------------------

describe("updateCandidateProfile", () => {
  it("returns updated row", async () => {
    const updated = { ...CANDIDATE_ROW, notes: "Strong candidate" };
    qwc.mockResolvedValueOnce(qr([updated]));
    const row = await updateCandidateProfile(STAFF_CTX, "cand-001", { notes: "Strong candidate" });
    expect(row.notes).toBe("Strong candidate");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(
      updateCandidateProfile(PERSONAL_CTX, "cand-001", { notes: "x" })
    ).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when UPDATE returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(
      updateCandidateProfile(STAFF_CTX, "nonexistent", { notes: "hi" })
    ).rejects.toThrow(NotFoundError);
  });

  it("accepts empty body (no-op)", async () => {
    qwc.mockResolvedValueOnce(qr([CANDIDATE_ROW]));
    await expect(updateCandidateProfile(STAFF_CTX, "cand-001", {})).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateCandidateStage
// ---------------------------------------------------------------------------

describe("updateCandidateStage", () => {
  it("updates stage and emits activity row", async () => {
    const updatedRow = { ...CANDIDATE_ROW, current_stage: "screened" };
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "applied", person_id: "person-c1" }]))
      .mockResolvedValueOnce(qr([updatedRow]))
      .mockResolvedValueOnce(qr([]));

    const row = await updateCandidateStage(STAFF_CTX, "cand-001", { stage: "screened" });
    expect(row.current_stage).toBe("screened");
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(
      updateCandidateStage(PERSONAL_CTX, "cand-001", { stage: "screened" })
    ).rejects.toThrow(ForbiddenError);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when candidate not found", async () => {
    mockClientQuery.mockResolvedValueOnce(qr([]));
    await expect(
      updateCandidateStage(STAFF_CTX, "nonexistent", { stage: "screened" })
    ).rejects.toThrow(NotFoundError);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("releases client even when UPDATE fails", async () => {
    mockClientQuery
      .mockResolvedValueOnce(qr([{ current_stage: "applied", person_id: "p1" }]))
      .mockRejectedValueOnce(new Error("db err"));
    await expect(
      updateCandidateStage(STAFF_CTX, "cand-001", { stage: "offered" })
    ).rejects.toThrow("db err");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("throws ZodError for invalid stage", async () => {
    await expect(
      updateCandidateStage(STAFF_CTX, "cand-001", { stage: "promoted" as never })
    ).rejects.toThrow();
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteCandidateProfile
// ---------------------------------------------------------------------------

describe("deleteCandidateProfile", () => {
  it("resolves void on success", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 1 });
    await expect(deleteCandidateProfile(STAFF_CTX, "cand-001")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(deleteCandidateProfile(PERSONAL_CTX, "cand-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when rowCount is 0", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 0 });
    await expect(deleteCandidateProfile(STAFF_CTX, "cand-999")).rejects.toThrow(NotFoundError);
  });
});
