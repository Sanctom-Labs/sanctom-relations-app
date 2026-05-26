// =============================================================================
// Relations v0.2 — Cross-role Activity Timeline handler
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §6.2 (Cross-role Activity Timeline)
// Endpoint:
//   GET  /v1/relations/persons/:personId/activity — unified timeline (all roles)
//   POST /v1/relations/persons/:personId/activity — add note
//
// Filter dimensions (§6.2):
//   • role_context — investor | pro | member | candidate | employee | cross_role
//   • activity_type — any value from relations.activity_type ENUM
//   • created_by (agent filter) — UUID of creator user/agent
//   • after / before — date range
// Pagination: newest-first default; server-side.
// =============================================================================

import { z } from "zod";
import type { RelationsContext } from "../types.js";
import { queryWithContext } from "../db.js";

// ---------------------------------------------------------------------------
// § Activity row (minimal shape — full schema on relations.activity)
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  person_id: string;
  activity_type: string;
  role_context: string | null;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// § Query params
// ---------------------------------------------------------------------------

const TimelineParamsSchema = z.object({
  role_context:    z.string().optional(),
  activity_type:   z.string().optional(),
  created_by:      z.string().uuid().optional(),
  after:           z.string().optional(),
  before:          z.string().optional(),
  page:            z.coerce.number().int().min(1).default(1),
  page_size:       z.coerce.number().int().min(1).max(200).default(50),
});

const AddNoteSchema = z.object({
  text:         z.string().min(1).max(10000),
  role_context: z.enum(["investor","pro","member","candidate","employee","cross_role"]).optional(),
});

// ---------------------------------------------------------------------------
// § Get unified timeline
// ---------------------------------------------------------------------------

export async function getPersonTimeline(
  ctx: RelationsContext,
  personId: string,
  rawParams: Record<string, string>
): Promise<{ data: ActivityRow[]; total: number; page: number; page_size: number; has_more: boolean }> {
  const params = TimelineParamsSchema.parse(rawParams);

  const conditions = ["a.person_id = $1", "a.tenant_id = $2"];
  const values: unknown[] = [personId, ctx.tenantId];
  let idx = 3;

  if (params.role_context) {
    conditions.push(`a.role_context = $${idx++}`);
    values.push(params.role_context);
  }
  if (params.activity_type) {
    conditions.push(`a.activity_type = $${idx++}`);
    values.push(params.activity_type);
  }
  if (params.created_by) {
    conditions.push(`a.created_by = $${idx++}`);
    values.push(params.created_by);
  }
  if (params.after) {
    conditions.push(`a.created_at >= $${idx++}`);
    values.push(params.after);
  }
  if (params.before) {
    conditions.push(`a.created_at <= $${idx++}`);
    values.push(params.before);
  }

  const where = conditions.join(" AND ");
  const offset = (params.page - 1) * params.page_size;

  const countRow = await queryWithContext<{ count: string }>(
    ctx,
    `SELECT count(*) AS count FROM relations.activity a WHERE ${where}`,
    values
  );
  const total = parseInt(countRow.rows[0]?.count ?? "0", 10);

  const dataResult = await queryWithContext<ActivityRow>(
    ctx,
    `SELECT
       a.id, a.person_id, a.activity_type,
       a.role_context, a.created_by, a.metadata, a.created_at
     FROM relations.activity a
     WHERE ${where}
     ORDER BY a.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, params.page_size, offset]
  );

  return {
    data: dataResult.rows,
    total,
    page: params.page,
    page_size: params.page_size,
    has_more: offset + dataResult.rows.length < total,
  };
}

// ---------------------------------------------------------------------------
// § Add note to timeline
// ---------------------------------------------------------------------------

export async function addTimelineNote(
  ctx: RelationsContext,
  personId: string,
  body: unknown
): Promise<ActivityRow> {
  const input = AddNoteSchema.parse(body);

  const result = await queryWithContext<ActivityRow>(
    ctx,
    `INSERT INTO relations.activity
       (person_id, tenant_id, activity_type, role_context, created_by, metadata)
     VALUES ($1, $2, 'note', $3, $4, $5::jsonb)
     RETURNING id, person_id, activity_type, role_context, created_by, metadata, created_at`,
    [
      personId,
      ctx.tenantId,
      input.role_context ?? null,
      ctx.userId,
      JSON.stringify({ text: input.text }),
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("INSERT returned no rows");
  return row;
}
