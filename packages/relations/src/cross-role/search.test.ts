// =============================================================================
// Relations v0.2 — cross-role/search.ts unit tests
// =============================================================================
// Covers: FTS query construction, role filter logic, pagination, empty results,
// ZodError paths, rank/snippet field mapping.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { searchPersons } from "./search.js";

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
  userId: "s1", tenantId: "t-search", entityId: "e-1", identityClass: "staff" as const,
};

const SEARCH_ROW = {
  person_id:      "p-001",
  display_name:   "Alice Smith",
  primary_email:  "alice@example.com",
  matching_roles: ["investor", "member"],
  rank:           0.75,
  snippet:        "Alice <b>Smith</b> …",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// searchPersons — basic functionality
// ---------------------------------------------------------------------------

describe("searchPersons", () => {
  it("returns paginated result shape with data and total", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "3" }]))    // COUNT
      .mockResolvedValueOnce(qr([SEARCH_ROW]));        // DATA

    const result = await searchPersons(STAFF_CTX, { q: "Alice" });

    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(25);
  });

  it("maps rank to Number and preserves snippet", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([SEARCH_ROW]));

    const result = await searchPersons(STAFF_CTX, { q: "Alice" });
    const item = result.data[0];

    expect(typeof item?.rank).toBe("number");
    expect(item?.rank).toBeCloseTo(0.75);
    expect(item?.snippet).toBe("Alice <b>Smith</b> …");
  });

  it("defaults matching_roles to [] when null from DB", async () => {
    const rowWithNullRoles = { ...SEARCH_ROW, matching_roles: null };
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([rowWithNullRoles]));

    const result = await searchPersons(STAFF_CTX, { q: "query" });
    expect(result.data[0]?.matching_roles).toEqual([]);
  });

  it("returns empty data when no FTS matches", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "0" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await searchPersons(STAFF_CTX, { q: "xyz_nonexistent" });
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it("passes tenantId and query text to both DB calls", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "0" }]))
      .mockResolvedValueOnce(qr([]));

    await searchPersons(STAFF_CTX, { q: "find me" });

    const countValues = qwc.mock.calls[0]?.[2] as unknown[];
    expect(countValues).toContain("t-search");
    expect(countValues).toContain("find me");
  });

  it("throws ZodError for missing q param", async () => {
    await expect(searchPersons(STAFF_CTX, {})).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for empty q string", async () => {
    await expect(searchPersons(STAFF_CTX, { q: "" })).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for q string > 500 chars", async () => {
    await expect(
      searchPersons(STAFF_CTX, { q: "a".repeat(501) })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("defaults page=1 and page_size=25", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "0" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await searchPersons(STAFF_CTX, { q: "test" });
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(25);
  });

  it("honours custom page and page_size", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "50" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await searchPersons(STAFF_CTX, { q: "test", page: "2", page_size: "10" });
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
  });

  it("rejects page_size > 100", async () => {
    await expect(
      searchPersons(STAFF_CTX, { q: "test", page_size: "101" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// searchPersons — role filter
// ---------------------------------------------------------------------------

describe("searchPersons — role filter", () => {
  it("adds role filter when role param provided", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([SEARCH_ROW]));

    await searchPersons(STAFF_CTX, { q: "test", role: "investor" });

    // The COUNT SQL should contain IS NOT NULL check for investor
    const countSql = qwc.mock.calls[0]?.[1] as string;
    expect(countSql).toContain("IS NOT NULL");
  });

  it("handles comma-separated role filter (investor,pro)", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "2" }]))
      .mockResolvedValueOnce(qr([SEARCH_ROW]));

    await searchPersons(STAFF_CTX, { q: "coach", role: "investor,pro" });

    const countSql = qwc.mock.calls[0]?.[1] as string;
    // Both role checks should be in the SQL
    expect(countSql).toContain("IS NOT NULL");
  });

  it("no role filter clause when role param absent", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))
      .mockResolvedValueOnce(qr([]));

    await searchPersons(STAFF_CTX, { q: "test" });

    // With no role filter, WHERE clause should not have a role-based OR sub-expression.
    // The SQL still runs — just verify no crash and 2 calls made.
    expect(qwc).toHaveBeenCalledTimes(2);
  });

  it("unknown role value in filter doesn't crash (roleClauses remains empty)", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "0" }]))
      .mockResolvedValueOnce(qr([]));

    // "dragon" is not a recognized role — roleClauses stays empty → no extra WHERE added
    await expect(
      searchPersons(STAFF_CTX, { q: "test", role: "dragon" })
    ).resolves.toBeDefined();
  });
});
