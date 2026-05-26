// =============================================================================
// Relations v0.2 — cross-role/saved-filter.ts unit tests
// =============================================================================
// Covers: list, get, create, update, pin, unpin, delete — all 7 endpoints.
// Per-user RLS is enforced at the DB layer; handler just passes userId in GUC.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { NotFoundError } from "../middleware.js";
import {
  listSavedFilters,
  getSavedFilter,
  createSavedFilter,
  updateSavedFilter,
  pinSavedFilter,
  unpinSavedFilter,
  deleteSavedFilter,
} from "./saved-filter.js";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
  queryWithContext: vi.fn(),
  getContextClient: vi.fn(),
}));

import { queryWithContext } from "../db.js";

const qwc = vi.mocked(queryWithContext);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qr<T extends QueryResultRow>(rows: T[], rowCount?: number): QueryResult<T> {
  return { rows, rowCount: rowCount ?? rows.length, command: "SELECT", oid: 0, fields: [] };
}

const STAFF_CTX = {
  userId: "user-777", tenantId: "t-zzz", entityId: "e-aaa", identityClass: "staff" as const,
};

const FILTER_ROW = {
  id:            "sf-001",
  user_id:       "user-777",
  tenant_id:     "t-zzz",
  name:          "High Priority Investors",
  filter_json:   { role: "investor", stage: ["prospect", "contacted"] },
  pinned:        false,
  display_order: null,
  created_at:    "2026-05-20T00:00:00Z",
  updated_at:    "2026-05-20T00:00:00Z",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// listSavedFilters
// ---------------------------------------------------------------------------

describe("listSavedFilters", () => {
  it("returns all saved filters for the tenant (RLS scopes to user at DB layer)", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    const rows = await listSavedFilters(STAFF_CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("High Priority Investors");
  });

  it("returns empty array when no filters exist", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    const rows = await listSavedFilters(STAFF_CTX);
    expect(rows).toEqual([]);
  });

  it("passes tenantId as the WHERE param", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await listSavedFilters(STAFF_CTX);

    expect(qwc.mock.calls[0]?.[2]).toEqual(["t-zzz"]);
  });
});

// ---------------------------------------------------------------------------
// getSavedFilter
// ---------------------------------------------------------------------------

describe("getSavedFilter", () => {
  it("returns the filter when found", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    const row = await getSavedFilter(STAFF_CTX, "sf-001");
    expect(row.id).toBe("sf-001");
  });

  it("throws NotFoundError when not found", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(getSavedFilter(STAFF_CTX, "sf-nonexistent")).rejects.toThrow(NotFoundError);
  });

  it("passes (id, tenantId) as params", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    await getSavedFilter(STAFF_CTX, "sf-001");
    expect(qwc.mock.calls[0]?.[2]).toEqual(["sf-001", "t-zzz"]);
  });
});

// ---------------------------------------------------------------------------
// createSavedFilter
// ---------------------------------------------------------------------------

describe("createSavedFilter", () => {
  it("inserts and returns the created filter", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    const row = await createSavedFilter(STAFF_CTX, {
      name:        "High Priority Investors",
      filter_json: { role: "investor", stage: ["prospect"] },
    });
    expect(row.id).toBe("sf-001");
  });

  it("throws ZodError for missing name", async () => {
    await expect(
      createSavedFilter(STAFF_CTX, { filter_json: { role: "investor" } })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for empty name", async () => {
    await expect(
      createSavedFilter(STAFF_CTX, { name: "", filter_json: { role: "investor" } })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("defaults pinned to false when not provided", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    await createSavedFilter(STAFF_CTX, { name: "My Filter", filter_json: {} });

    const insertValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(insertValues).toContain(false); // pinned default
  });

  it("accepts pinned=true and display_order", async () => {
    qwc.mockResolvedValueOnce(qr([{ ...FILTER_ROW, pinned: true, display_order: 1 }]));

    const row = await createSavedFilter(STAFF_CTX, {
      name:          "Pinned Filter",
      filter_json:   { role: "member" },
      pinned:        true,
      display_order: 1,
    });
    expect(row.pinned).toBe(true);
  });

  it("accepts filter_json with only role field", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    await expect(
      createSavedFilter(STAFF_CTX, { name: "Role Filter", filter_json: { role: "investor" } })
    ).resolves.toBeDefined();
  });

  it("accepts filter_json with additional arbitrary fields", async () => {
    qwc.mockResolvedValueOnce(qr([FILTER_ROW]));

    await expect(
      createSavedFilter(STAFF_CTX, {
        name:        "Complex Filter",
        filter_json: { role: "member", churn_risk_score_gte: 0.7, winback_within_days: 7 },
      })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateSavedFilter
// ---------------------------------------------------------------------------

describe("updateSavedFilter", () => {
  it("updates name and returns row", async () => {
    const updated = { ...FILTER_ROW, name: "Renamed Filter" };
    qwc.mockResolvedValueOnce(qr([updated]));

    const row = await updateSavedFilter(STAFF_CTX, "sf-001", { name: "Renamed Filter" });
    expect(row.name).toBe("Renamed Filter");
  });

  it("falls back to getSavedFilter when body is empty (no effective changes)", async () => {
    // Empty body: only updated_at is set — handler calls getSavedFilter instead
    qwc.mockResolvedValueOnce(qr([FILTER_ROW])); // getSavedFilter call

    const row = await updateSavedFilter(STAFF_CTX, "sf-001", {});
    expect(row.id).toBe("sf-001");
    // Only one DB call (getSavedFilter, not UPDATE)
    expect(qwc).toHaveBeenCalledOnce();
  });

  it("throws NotFoundError when UPDATE returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(
      updateSavedFilter(STAFF_CTX, "nonexistent", { name: "Ghost" })
    ).rejects.toThrow(NotFoundError);
  });

  it("updates filter_json", async () => {
    const updated = { ...FILTER_ROW, filter_json: { role: "pro", stage: "active" } };
    qwc.mockResolvedValueOnce(qr([updated]));

    const row = await updateSavedFilter(STAFF_CTX, "sf-001", {
      filter_json: { role: "pro", stage: "active" },
    });
    expect((row.filter_json as Record<string, unknown>)["role"]).toBe("pro");
  });
});

// ---------------------------------------------------------------------------
// pinSavedFilter
// ---------------------------------------------------------------------------

describe("pinSavedFilter", () => {
  it("sets pinned=true and display_order", async () => {
    const pinned = { ...FILTER_ROW, pinned: true, display_order: 0 };
    qwc.mockResolvedValueOnce(qr([pinned]));

    const row = await pinSavedFilter(STAFF_CTX, "sf-001", { display_order: 0 });
    expect(row.pinned).toBe(true);
    expect(row.display_order).toBe(0);
  });

  it("throws ZodError when display_order missing", async () => {
    await expect(pinSavedFilter(STAFF_CTX, "sf-001", {})).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when row not found", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(
      pinSavedFilter(STAFF_CTX, "nonexistent", { display_order: 0 })
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// unpinSavedFilter
// ---------------------------------------------------------------------------

describe("unpinSavedFilter", () => {
  it("sets pinned=false and display_order=null", async () => {
    const unpinned = { ...FILTER_ROW, pinned: false, display_order: null };
    qwc.mockResolvedValueOnce(qr([unpinned]));

    const row = await unpinSavedFilter(STAFF_CTX, "sf-001");
    expect(row.pinned).toBe(false);
    expect(row.display_order).toBeNull();
  });

  it("throws NotFoundError when row not found", async () => {
    qwc.mockResolvedValueOnce(qr([]));
    await expect(unpinSavedFilter(STAFF_CTX, "nonexistent")).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// deleteSavedFilter
// ---------------------------------------------------------------------------

describe("deleteSavedFilter", () => {
  it("resolves void when rowCount >= 1", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 1 });
    await expect(deleteSavedFilter(STAFF_CTX, "sf-001")).resolves.toBeUndefined();
  });

  it("throws NotFoundError when rowCount is 0", async () => {
    qwc.mockResolvedValueOnce({ ...qr([]), rowCount: 0 });
    await expect(deleteSavedFilter(STAFF_CTX, "sf-999")).rejects.toThrow(NotFoundError);
  });
});
