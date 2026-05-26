// =============================================================================
// Relations v0.2 — Candidate Profile CRUD handlers (stub)
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §4 (Candidate stub) + §7.4 (DDL)
// Identity gate: Sanctom-Staff ONLY
// v0.2 scope: list view + detail block only. No agents, no faceted filters.
// =============================================================================

import { z } from "zod";
import type { RelationsContext, CandidateProfileRow, PaginatedResult } from "../types.js";
import { queryWithContext, getContextClient } from "../db.js";
import { NotFoundError, assertStaff } from "../middleware.js";

// ---------------------------------------------------------------------------
// § Input schemas
// ---------------------------------------------------------------------------

const CandidateStageEnum = z.enum([
  "applied","screened","interviewed","offered","hired","rejected",
]);

const CreateCandidateProfileSchema = z.object({
  person_id:          z.string().uuid(),
  owner_entity_id:    z.string().uuid(),
  current_stage:      CandidateStageEnum.default("applied"),
  role_applied_for:   z.string().max(500).optional(),
  application_source: z.string().max(200).optional(),
  notes:              z.string().max(5000).optional(),
});

const UpdateCandidateProfileSchema = CreateCandidateProfileSchema
  .omit({ person_id: true, owner_entity_id: true })
  .partial();

const StageUpdateSchema = z.object({ stage: CandidateStageEnum });

const ListParamsSchema = z.object({
  current_stage:  z.string().optional(),
  page:           z.coerce.number().int().min(1).default(1),
  page_size:      z.coerce.number().int().min(1).max(200).default(50),
  sort_by:        z.enum(["created_at","updated_at","current_stage"]).optional().default("created_at"),
  sort_dir:       z.enum(["asc","desc"]).optional().default("desc"),
});

// ---------------------------------------------------------------------------
// § List candidate profiles
// ---------------------------------------------------------------------------

export async function listCandidateProfiles(
  ctx: RelationsContext,
  rawParams: Record<string, string>
): Promise<PaginatedResult<CandidateProfileRow>> {
  assertStaff(ctx);

  const params = ListParamsSchema.parse(rawParams);
  const conditions = ["tenant_id = $1"];
  const values: unknown[] = [ctx.tenantId];
  let idx = 2;

  if (params.current_stage) {
    conditions.push(`current_stage = $${idx++}`);
    values.push(params.current_stage);
  }

  const where = conditions.join(" AND ");
  const sortCol = params.sort_by ?? "created_at";
  const sortDir = (params.sort_dir ?? "desc").toUpperCase();
  const offset = (params.page - 1) * params.page_size;

  const countRow = await queryWithContext<{ count: string }>(
    ctx,
    `SELECT count(*) AS count FROM relations.candidate_profile WHERE ${where}`,
    values
  );
  const total = parseInt(countRow.rows[0]?.count ?? "0", 10);

  const dataResult = await queryWithContext<CandidateProfileRow>(
    ctx,
    `SELECT * FROM relations.candidate_profile
     WHERE ${where}
     ORDER BY ${sortCol} ${sortDir}
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
// § Get single candidate profile
// ---------------------------------------------------------------------------

export async function getCandidateProfile(
  ctx: RelationsContext,
  id: string
): Promise<CandidateProfileRow> {
  assertStaff(ctx);

  const result = await queryWithContext<CandidateProfileRow>(
    ctx,
    `SELECT * FROM relations.candidate_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`candidate_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Create candidate profile
// ---------------------------------------------------------------------------

export async function createCandidateProfile(
  ctx: RelationsContext,
  body: unknown
): Promise<CandidateProfileRow> {
  assertStaff(ctx);

  const input = CreateCandidateProfileSchema.parse(body);

  const result = await queryWithContext<CandidateProfileRow>(
    ctx,
    `INSERT INTO relations.candidate_profile (
      person_id, tenant_id, owner_entity_id,
      current_stage, role_applied_for, application_source, notes,
      created_by_user_id, updated_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    RETURNING *`,
    [
      input.person_id, ctx.tenantId, input.owner_entity_id,
      input.current_stage,
      input.role_applied_for ?? null,
      input.application_source ?? null,
      input.notes ?? null,
      ctx.userId,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("INSERT returned no rows");
  return row;
}

// ---------------------------------------------------------------------------
// § Update candidate profile (partial PATCH)
// ---------------------------------------------------------------------------

export async function updateCandidateProfile(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<CandidateProfileRow> {
  assertStaff(ctx);

  const input = UpdateCandidateProfileSchema.parse(body);
  const setClauses: string[] = ["updated_by_user_id = $1", "updated_at = now()"];
  const values: unknown[] = [ctx.userId];
  let idx = 2;

  for (const field of ["current_stage","role_applied_for","application_source","notes"] as const) {
    const val = (input as Record<string, unknown>)[field];
    if (val !== undefined) {
      setClauses.push(`${field} = $${idx++}`);
      values.push(val);
    }
  }

  values.push(id, ctx.tenantId);
  const idIdx = idx;
  const tenantIdx = idx + 1;

  const result = await queryWithContext<CandidateProfileRow>(
    ctx,
    `UPDATE relations.candidate_profile
     SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`candidate_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Stage transition
// ---------------------------------------------------------------------------

export async function updateCandidateStage(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<CandidateProfileRow> {
  assertStaff(ctx);

  const { stage: newStage } = StageUpdateSchema.parse(body);

  const { client, release } = await getContextClient(ctx);
  try {
    const current = await client.query<{ current_stage: string; person_id: string }>(
      `SELECT current_stage, person_id FROM relations.candidate_profile
       WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId]
    );
    const row = current.rows[0];
    if (!row) throw new NotFoundError(`candidate_profile ${id} not found`);

    const updated = await client.query<CandidateProfileRow>(
      `UPDATE relations.candidate_profile
       SET current_stage = $1, updated_at = now(), updated_by_user_id = $2
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [newStage, ctx.userId, id, ctx.tenantId]
    );

    await client.query(
      `INSERT INTO relations.activity
         (person_id, activity_type, role_context, created_by, metadata)
       VALUES ($1, 'stage_change', 'candidate', $2, $3::jsonb)`,
      [
        row.person_id, ctx.userId,
        JSON.stringify({ profile_id: id, from_stage: row.current_stage, to_stage: newStage }),
      ]
    );

    const result = updated.rows[0];
    if (!result) throw new Error("UPDATE returned no rows");
    return result;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// § Delete candidate profile
// ---------------------------------------------------------------------------

export async function deleteCandidateProfile(
  ctx: RelationsContext,
  id: string
): Promise<void> {
  assertStaff(ctx);

  const result = await queryWithContext(
    ctx,
    `DELETE FROM relations.candidate_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError(`candidate_profile ${id} not found`);
  }
}
