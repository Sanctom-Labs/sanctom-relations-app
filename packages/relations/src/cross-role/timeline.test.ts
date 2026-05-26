// =============================================================================
// Relations v0.2 — cross-role/timeline.ts unit tests
// =============================================================================
// Covers: getPersonTimeline (filters + pagination), addTimelineNote (success + error)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { getPersonTimeline, addTimelineNote } from "./timeline.js";

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
  userId: "s1", tenantId: "t-tl", entityId: "e-1", identityClass: "staff" as const,
};

const ACTIVITY_ROW = {
  id:            "act-001",
  person_id:     "person-001",
  activity_type: "stage_change",
  role_context:  "investor",
  created_by:    "s1",
  metadata:      { from_stage: "prospect", to_stage: "contacted" },
  created_at:    "2026-05-20T10:00:00Z",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// getPersonTimeline
// ---------------------------------------------------------------------------

describe("getPersonTimeline", () => {
  it("returns paginated timeline result", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "10" }]))
      .mockResolvedValueOnce(qr([ACTIVITY_ROW]));

    const result = await getPersonTimeline(STAFF_CTX, "person-001", {});
    expect(result.total).toBe(10);
    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(50);
    expect(result.has_more).toBe(true);
  });

  it("returns empty result when no activity", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "0" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await getPersonTimeline(STAFF_CTX, "person-001", {});
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it("applies role_context filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "3" }]))
      .mockResolvedValueOnce(qr([ACTIVITY_ROW]));

    await getPersonTimeline(STAFF_CTX, "person-001", { role_context: "investor" });

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain("investor");
  });

  it("applies activity_type filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "2" }]))
      .mockResolvedValueOnce(qr([]));

    await getPersonTimeline(STAFF_CTX, "person-001", { activity_type: "note" });

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain("note");
  });

  it("applies created_by filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([]));

    const createdBy = "00000000-0000-0000-0000-000000000001";
    await getPersonTimeline(STAFF_CTX, "person-001", { created_by: createdBy });

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain(createdBy);
  });

  it("throws ZodError for invalid created_by (not UUID)", async () => {
    await expect(
      getPersonTimeline(STAFF_CTX, "person-001", { created_by: "not-a-uuid" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("applies after date filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))
      .mockResolvedValueOnce(qr([]));

    await getPersonTimeline(STAFF_CTX, "person-001", { after: "2026-05-01" });

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain("2026-05-01");
  });

  it("applies before date filter", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "5" }]))
      .mockResolvedValueOnce(qr([]));

    await getPersonTimeline(STAFF_CTX, "person-001", { before: "2026-05-31" });

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values).toContain("2026-05-31");
  });

  it("honours page and page_size", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "100" }]))
      .mockResolvedValueOnce(qr([]));

    const result = await getPersonTimeline(STAFF_CTX, "person-001", { page: "3", page_size: "20" });
    expect(result.page).toBe(3);
    expect(result.page_size).toBe(20);
  });

  it("rejects page_size > 200", async () => {
    await expect(
      getPersonTimeline(STAFF_CTX, "person-001", { page_size: "201" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("passes personId and tenantId as first two params", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "0" }]))
      .mockResolvedValueOnce(qr([]));

    await getPersonTimeline(STAFF_CTX, "person-001", {});

    const values = qwc.mock.calls[0]?.[2] as unknown[];
    expect(values[0]).toBe("person-001");
    expect(values[1]).toBe("t-tl");
  });

  it("has_more is false when all fit on page", async () => {
    qwc
      .mockResolvedValueOnce(qr([{ count: "1" }]))
      .mockResolvedValueOnce(qr([ACTIVITY_ROW]));

    const result = await getPersonTimeline(STAFF_CTX, "person-001", {});
    expect(result.has_more).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addTimelineNote
// ---------------------------------------------------------------------------

const NOTE_ROW = {
  id:            "act-note-1",
  person_id:     "person-001",
  activity_type: "note",
  role_context:  null,
  created_by:    "s1",
  metadata:      { text: "This is a note" },
  created_at:    "2026-05-26T00:00:00Z",
} as const;

describe("addTimelineNote", () => {
  it("inserts and returns note activity row", async () => {
    qwc.mockResolvedValueOnce(qr([NOTE_ROW]));

    const row = await addTimelineNote(STAFF_CTX, "person-001", { text: "This is a note" });
    expect(row.activity_type).toBe("note");
    expect(row.id).toBe("act-note-1");
  });

  it("throws ZodError for empty text", async () => {
    await expect(
      addTimelineNote(STAFF_CTX, "person-001", { text: "" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for text > 10000 chars", async () => {
    await expect(
      addTimelineNote(STAFF_CTX, "person-001", { text: "a".repeat(10001) })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid role_context", async () => {
    await expect(
      addTimelineNote(STAFF_CTX, "person-001", { text: "note", role_context: "unknown_role" })
    ).rejects.toThrow();
    expect(qwc).not.toHaveBeenCalled();
  });

  it("accepts valid role_context values", async () => {
    const roles = ["investor","pro","member","candidate","employee","cross_role"] as const;
    for (const role of roles) {
      qwc.mockResolvedValueOnce(qr([NOTE_ROW]));
      await expect(
        addTimelineNote(STAFF_CTX, "person-001", { text: "note", role_context: role })
      ).resolves.toBeDefined();
    }
  });

  it("serialises text into metadata JSON", async () => {
    qwc.mockResolvedValueOnce(qr([NOTE_ROW]));

    await addTimelineNote(STAFF_CTX, "person-001", { text: "My note" });

    const insertValues = qwc.mock.calls[0]?.[2] as unknown[];
    // 5th value is metadata JSON
    const metadataJson = insertValues[4] as string;
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    expect(metadata["text"]).toBe("My note");
  });

  it("throws when INSERT returns no rows", async () => {
    qwc.mockResolvedValueOnce(qr([]));

    await expect(
      addTimelineNote(STAFF_CTX, "person-001", { text: "A note" })
    ).rejects.toThrow("INSERT returned no rows");
  });
});
