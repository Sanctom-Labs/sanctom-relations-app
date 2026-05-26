// =============================================================================
// Relations v0.2 — Investor Profile CRUD handlers
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §2 (Investor) + §7.2 (DDL)
// Identity gate: Sanctom-Staff ONLY (assertStaff in all handlers)
// Endpoints:
//   GET    /v1/relations/investor-profiles           — list (Kanban data)
//   POST   /v1/relations/investor-profiles           — create
//   GET    /v1/relations/investor-profiles/:id       — get by id
//   PATCH  /v1/relations/investor-profiles/:id       — update fields
//   PATCH  /v1/relations/investor-profiles/:id/stage — stage transition
//   DELETE /v1/relations/investor-profiles/:id       — delete
// =============================================================================

import { z } from "zod";
import type { RelationsContext, InvestorProfileRow, PaginatedResult } from "../types.js";
import { queryWithContext, getContextClient } from "../db.js";
import { NotFoundError, assertStaff } from "../middleware.js";

// ---------------------------------------------------------------------------
// § Input schemas
// ---------------------------------------------------------------------------

const InvestorStageEnum = z.enum([
  "prospect","contacted","responded","meeting_scheduled",
  "meeting_held","diligence","committed","passed",
]);

const CreateInvestorProfileSchema = z.object({
  person_id:          z.string().uuid(),
  owner_entity_id:    z.string().uuid(),
  stage:              InvestorStageEnum.default("prospect"),
  fit_score:          z.enum(["high","medium_high","medium","low"]).optional(),
  priority:           z.enum(["urgent","high","medium","low"]).optional(),
  check_size_min_usd: z.number().int().positive().optional(),
  check_size_max_usd: z.number().int().positive().optional(),
  investment_focus:   z.array(z.string().max(200)).max(30).default([]),
  stage_preference:   z.string().max(500).optional(),
  portfolio_cos:      z.array(z.string().max(200)).max(50).default([]),
  fit_rationale:      z.string().max(2000).optional(),
  outreach_approach:  z.string().max(2000).optional(),
  suggested_hook:     z.string().max(1000).optional(),
  warm_intro_path:    z.string().max(500).optional(),
  rec_timing:         z.string().max(500).optional(),
  knox_notes:         z.string().max(5000).optional(),
  next_action:        z.string().max(1000).optional(),
  useful_links:       z.array(z.object({ label: z.string().max(200), url: z.string().url() })).max(20).default([]),
});

const UpdateInvestorProfileSchema = CreateInvestorProfileSchema
  .omit({ person_id: true, owner_entity_id: true })
  .partial();

const StageUpdateSchema = z.object({ stage: InvestorStageEnum });

const ListParamsSchema = z.object({
  stage:      z.string().optional(),
  fit_score:  z.string().optional(),
  priority:   z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  page_size:  z.coerce.number().int().min(1).max(200).default(50),
  sort_by:    z.enum(["created_at","updated_at","stage","priority"]).optional().default("priority"),
  sort_dir:   z.enum(["asc","desc"]).optional().default("desc"),
});

// ---------------------------------------------------------------------------
// § List investor profiles
// ---------------------------------------------------------------------------

export async function listInvestorProfiles(
  ctx: RelationsContext,
  rawParams: Record<string, string>
): Promise<PaginatedResult<InvestorProfileRow>> {
  assertStaff(ctx);

  const params = ListParamsSchema.parse(rawParams);
  const conditions = ["tenant_id = $1"];
  const values: unknown[] = [ctx.tenantId];
  let idx = 2;

  if (params.stage)     { conditions.push(`stage = $${idx++}`);     values.push(params.stage); }
  if (params.fit_score) { conditions.push(`fit_score = $${idx++}`); values.push(params.fit_score); }
  if (params.priority)  { conditions.push(`priority = $${idx++}`);  values.push(params.priority); }

  const where = conditions.join(" AND ");
  const sortCol = params.sort_by ?? "priority";
  const sortDir = (params.sort_dir ?? "desc").toUpperCase();
  const offset = (params.page - 1) * params.page_size;

  const countRow = await queryWithContext<{ count: string }>(
    ctx,
    `SELECT count(*) AS count FROM relations.investor_profile WHERE ${where}`,
    values
  );
  const total = parseInt(countRow.rows[0]?.count ?? "0", 10);

  const dataResult = await queryWithContext<InvestorProfileRow>(
    ctx,
    `SELECT * FROM relations.investor_profile
     WHERE ${where}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST
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
// § Get single investor profile
// ---------------------------------------------------------------------------

export async function getInvestorProfile(
  ctx: RelationsContext,
  id: string
): Promise<InvestorProfileRow> {
  assertStaff(ctx);

  const result = await queryWithContext<InvestorProfileRow>(
    ctx,
    `SELECT * FROM relations.investor_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`investor_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Create investor profile
// ---------------------------------------------------------------------------

export async function createInvestorProfile(
  ctx: RelationsContext,
  body: unknown
): Promise<InvestorProfileRow> {
  assertStaff(ctx);

  const input = CreateInvestorProfileSchema.parse(body);

  const result = await queryWithContext<InvestorProfileRow>(
    ctx,
    `INSERT INTO relations.investor_profile (
      person_id, tenant_id, owner_entity_id,
      stage, fit_score, priority,
      check_size_min_usd, check_size_max_usd,
      investment_focus, stage_preference, portfolio_cos,
      fit_rationale, outreach_approach, suggested_hook,
      warm_intro_path, rec_timing, knox_notes, next_action,
      useful_links,
      created_by_user_id, updated_by_user_id
    ) VALUES (
      $1,  $2,  $3,
      $4,  $5,  $6,
      $7,  $8,
      $9,  $10, $11,
      $12, $13, $14,
      $15, $16, $17, $18,
      $19::jsonb,
      $20, $20
    ) RETURNING *`,
    [
      input.person_id, ctx.tenantId, input.owner_entity_id,
      input.stage, input.fit_score ?? null, input.priority ?? null,
      input.check_size_min_usd ?? null, input.check_size_max_usd ?? null,
      input.investment_focus, input.stage_preference ?? null, input.portfolio_cos,
      input.fit_rationale ?? null, input.outreach_approach ?? null,
      input.suggested_hook ?? null, input.warm_intro_path ?? null,
      input.rec_timing ?? null, input.knox_notes ?? null, input.next_action ?? null,
      JSON.stringify(input.useful_links),
      ctx.userId,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("INSERT returned no rows");
  return row;
}

// ---------------------------------------------------------------------------
// § Update investor profile (partial PATCH)
// ---------------------------------------------------------------------------

export async function updateInvestorProfile(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<InvestorProfileRow> {
  assertStaff(ctx);

  const input = UpdateInvestorProfileSchema.parse(body);
  const setClauses: string[] = ["updated_by_user_id = $1", "updated_at = now()"];
  const values: unknown[] = [ctx.userId];
  let idx = 2;

  const scalarFields = [
    "stage","fit_score","priority","check_size_min_usd","check_size_max_usd",
    "investment_focus","stage_preference","portfolio_cos",
    "fit_rationale","outreach_approach","suggested_hook",
    "warm_intro_path","rec_timing","knox_notes","next_action",
  ] as const;

  for (const field of scalarFields) {
    const val = (input as Record<string, unknown>)[field];
    if (val !== undefined) {
      setClauses.push(`${field} = $${idx++}`);
      values.push(val);
    }
  }

  if (input.useful_links !== undefined) {
    setClauses.push(`useful_links = $${idx++}::jsonb`);
    values.push(JSON.stringify(input.useful_links));
  }

  values.push(id, ctx.tenantId);
  const idIdx = idx;
  const tenantIdx = idx + 1;

  const result = await queryWithContext<InvestorProfileRow>(
    ctx,
    `UPDATE relations.investor_profile
     SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`investor_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Stage transition (PATCH /:id/stage)
// ---------------------------------------------------------------------------

export async function updateInvestorStage(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<InvestorProfileRow> {
  assertStaff(ctx);

  const { stage: newStage } = StageUpdateSchema.parse(body);

  const { client, release } = await getContextClient(ctx);
  try {
    const current = await client.query<{ stage: string; person_id: string }>(
      `SELECT stage, person_id FROM relations.investor_profile
       WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId]
    );
    const row = current.rows[0];
    if (!row) throw new NotFoundError(`investor_profile ${id} not found`);

    const updated = await client.query<InvestorProfileRow>(
      `UPDATE relations.investor_profile
       SET stage = $1, updated_at = now(), updated_by_user_id = $2
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [newStage, ctx.userId, id, ctx.tenantId]
    );

    // Activity row — stage_change
    await client.query(
      `INSERT INTO relations.activity
         (person_id, activity_type, role_context, created_by, metadata)
       VALUES ($1, 'stage_change', 'investor', $2, $3::jsonb)`,
      [
        row.person_id, ctx.userId,
        JSON.stringify({ profile_id: id, from_stage: row.stage, to_stage: newStage }),
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
// § Delete investor profile
// ---------------------------------------------------------------------------

export async function deleteInvestorProfile(
  ctx: RelationsContext,
  id: string
): Promise<void> {
  assertStaff(ctx);

  const result = await queryWithContext(
    ctx,
    `DELETE FROM relations.investor_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError(`investor_profile ${id} not found`);
  }
}
