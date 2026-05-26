// =============================================================================
// Relations v0.2 — employee/handler.ts unit tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError, ForbiddenError } from "../middleware.js";
import {
  getEmployeeProfile,
  getEmployeeProfileByPerson,
  createEmployeeProfile,
  updateEmployeeProfile,
  deleteEmployeeProfile,
} from "./handler.js";

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
  userId: "s1", tenantId: "t-emp", entityId: "e-1", identityClass: "staff" as const,
};

const PERSONAL_CTX = {
  userId: "p1", tenantId: "t-emp", entityId: "e-1", identityClass: "personal" as const,
};

const EMP_ROW = {
  id:                 "emp-001",
  person_id:          "person-e1",
  tenant_id:          "t-emp",
  owner_entity_id:    "e-1",
  deel_employee_id:   "DEEL-123",
  employment_type:    "fte",
  start_date:         "2025-01-01",
  end_date:           null,
  cross_role_links:   [],
  notes:              null,
  created_at:         "2025-01-01T00:00:00Z",
  updated_at:         "2025-01-01T00:00:00Z",
  created_by_user_id: "s1",
  updated_by_user_id: "s1",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// getEmployeeProfile
// ---------------------------------------------------------------------------

describe("getEmployeeProfile", () => {
  it("returns row for staff", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    const row = await getEmployeeProfile(STAFF_CTX, "emp-001");
    expect(row.id).toBe("emp-001");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(getEmployeeProfile(PERSONAL_CTX, "emp-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when absent", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(getEmployeeProfile(STAFF_CTX, "emp-999")).rejects.toThrow(NotFoundError);
  });

  it("passes (id, tenantId) as params", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    await getEmployeeProfile(STAFF_CTX, "emp-001");
    expect(qwc.mock.calls[0]?.[2]).toEqual(["emp-001", "t-emp"]);
  });
});

// ---------------------------------------------------------------------------
// getEmployeeProfileByPerson
// ---------------------------------------------------------------------------

describe("getEmployeeProfileByPerson", () => {
  it("returns row when found", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    const row = await getEmployeeProfileByPerson(STAFF_CTX, "person-e1");
    expect(row).not.toBeNull();
    expect(row?.id).toBe("emp-001");
  });

  it("returns null when not found", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    const row = await getEmployeeProfileByPerson(STAFF_CTX, "person-nobody");
    expect(row).toBeNull();
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(
      getEmployeeProfileByPerson(PERSONAL_CTX, "person-e1")
    ).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createEmployeeProfile
// ---------------------------------------------------------------------------

const VALID_BODY = {
  person_id:       "00000000-0000-0000-0000-000000000001",
  owner_entity_id: "00000000-0000-0000-0000-000000000002",
};

describe("createEmployeeProfile", () => {
  it("inserts and returns row", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    const row = await createEmployeeProfile(STAFF_CTX, VALID_BODY);
    expect(row.id).toBe("emp-001");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(createEmployeeProfile(PERSONAL_CTX, VALID_BODY)).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid person_id", async () => {
    await expect(
      createEmployeeProfile(STAFF_CTX, { ...VALID_BODY, person_id: "bad" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid employment_type", async () => {
    await expect(
      createEmployeeProfile(STAFF_CTX, { ...VALID_BODY, employment_type: "intern_special" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("accepts all valid employment_type values", async () => {
    const types = ["fte","contractor","advisor","part_time","intern"] as const;
    for (const t of types) {
      qwc.mockResolvedValueOnce(qr([{ ...EMP_ROW, employment_type: t }]));
      const row = await createEmployeeProfile(STAFF_CTX, { ...VALID_BODY, employment_type: t });
      expect(row.employment_type).toBe(t);
    }
  });

  it("serialises cross_role_links to JSON", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    const links = [{ role: "investor", profile_id: "00000000-0000-0000-0000-000000000099" }];
    await createEmployeeProfile(STAFF_CTX, { ...VALID_BODY, cross_role_links: links });
    const insertValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(insertValues).toContain(JSON.stringify(links));
  });

  it("defaults cross_role_links to [] when not supplied", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    await createEmployeeProfile(STAFF_CTX, VALID_BODY);
    const insertValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(insertValues).toContain(JSON.stringify([]));
  });

  it("rejects invalid start_date format", async () => {
    await expect(
      createEmployeeProfile(STAFF_CTX, { ...VALID_BODY, start_date: "January 1 2025" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateEmployeeProfile
// ---------------------------------------------------------------------------

describe("updateEmployeeProfile", () => {
  it("returns updated row", async () => {
    const updated = { ...EMP_ROW, notes: "Excellent performer" };
    qwc.mockResolvedValueOnce(qr([updated]));
    const row = await updateEmployeeProfile(STAFF_CTX, "emp-001", { notes: "Excellent performer" });
    expect(row.notes).toBe("Excellent performer");
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(
      updateEmployeeProfile(PERSONAL_CTX, "emp-001", { notes: "x" })
    ).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when UPDATE returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(
      updateEmployeeProfile(STAFF_CTX, "nonexistent", { notes: "hi" })
    ).rejects.toThrow(NotFoundError);
  });

  it("serialises cross_role_links when updated", async () => {
    qwc.mockResolvedValueOnce(qr([EMP_ROW]));
    const links = [{ role: "pro", profile_id: "00000000-0000-0000-0000-000000000088" }];
    await updateEmployeeProfile(STAFF_CTX, "emp-001", { cross_role_links: links });
    const sql = qwc.mock.calls[0]?.[1] as string;
    expect(sql).toContain("::jsonb");
  });
});

// ---------------------------------------------------------------------------
// deleteEmployeeProfile
// ---------------------------------------------------------------------------

describe("deleteEmployeeProfile", () => {
  it("resolves void on success", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 1 });
    await expect(deleteEmployeeProfile(STAFF_CTX, "emp-001")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError for non-staff", async () => {
    await expect(deleteEmployeeProfile(PERSONAL_CTX, "emp-001")).rejects.toThrow(ForbiddenError);
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when rowCount is 0", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 0 });
    await expect(deleteEmployeeProfile(STAFF_CTX, "emp-999")).rejects.toThrow(NotFoundError);
  });
});
