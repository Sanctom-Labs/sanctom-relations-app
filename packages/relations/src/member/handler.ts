// =============================================================================
// Relations v0.2 — Member Profile CRUD handlers
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §3 (Member) + §7.3 (DDL)
// Identity gate: Sanctom-Staff ONLY
// Volume: 10k+ rows — server-side pagination; 8-axis faceted filters.
// Endpoints:
//   GET    /v1/relations/member-profiles           — list (faceted filters + pagination)
//   POST   /v1/relations/member-profiles           — create
//   GET    /v1/relations/member-profiles/:id       — get by id
//   PATCH  /v1/relations/member-profiles/:id       — update fields
//   PATCH  /v1/relations/member-profiles/:id/stage — stage transition
//   DELETE /v1/relations/member-profiles/:id       — delete
// =============================================================================

import { z } from "zod";
import type { RelationsContext, MemberProfileRow, PaginatedResult } from "../types.js";
import { queryWithContext, getContextClient } from "../db.js";
import { NotFoundError, assertStaff } from "../middleware.js";

// ---------------------------------------------------------------------------
// § Input schemas
// ---------------------------------------------------------------------------

const MemberStageEnum = z.enum(["prospect","trial","paying","churned","reactivation","winback"]);

const MemberSubscriptionStatusEnum = z.enum([
  "trial","active","paused","churned","reactivation_pending",
]);

const CreateMemberProfileSchema = z.object({
  person_id:                  z.string().uuid(),
  owner_entity_id:            z.string().uuid(),
  signup_date:                z.string().datetime({ offset: true }).optional(),
  first_session_date:         z.string().datetime({ offset: true }).optional(),
  onboarding_completion_date: z.string().datetime({ offset: true }).optional(),
  subscription_status:        MemberSubscriptionStatusEnum.default("trial"),
  subscription_tier:          z.string().max(100).optional(),
  ltv_cents:                  z.number().int().min(0).default(0),
  arpu_cents:                 z.number().int().min(0).default(0),
  cohort:                     z.string().max(200).optional(),
  segment:                    z.string().max(200).optional(),
  churn_risk_score:           z.number().min(0).max(1).optional(),
  last_activity_date:         z.string().datetime({ offset: true }).optional(),
  coach_match_id:             z.string().uuid().optional(),
  current_stage:              MemberStageEnum.default("prospect"),
  useful_links:               z.array(z.object({ label: z.string().max(200), url: z.string().url() })).max(20).default([]),
});

const UpdateMemberProfileSchema = CreateMemberProfileSchema
  .omit({ person_id: true, owner_entity_id: true })
  .partial();

const StageUpdateSchema = z.object({ stage: MemberStageEnum });

// ---------------------------------------------------------------------------
// § Faceted filter query params (§3.4 — 8-axis filter)
// ---------------------------------------------------------------------------

const ListParamsSchema = z.object({
  // Axis 1 — subscription_status (multi-select; comma-separated)
  subscription_status:    z.string().optional(),
  // Axis 2 — cohort (multi-select)
  cohort:                 z.string().optional(),
  // Axis 3 — churn_risk_score range
  churn_risk_gte:         z.coerce.number().min(0).max(1).optional(),
  churn_risk_lte:         z.coerce.number().min(0).max(1).optional(),
  // Axis 4 — last_activity_date range
  last_activity_after:    z.string().optional(),
  last_activity_before:   z.string().optional(),
  // Axis 5 — segment (multi-select)
  segment:                z.string().optional(),
  // Axis 6 — subscription_tier (multi-select)
  subscription_tier:      z.string().optional(),
  // Axis 7 — signup_date range
  signup_after:           z.string().optional(),
  signup_before:          z.string().optional(),
  // Axis 8 — coach_match_id presence
  has_coach_match:        z.enum(["true","false"]).optional(),
  // Current stage filter
  current_stage:          z.string().optional(),
  // Pagination (default 50 rows / page; sort last_activity_date DESC)
  page:                   z.coerce.number().int().min(1).default(1),
  page_size:              z.coerce.number().int().min(1).max(200).default(50),
  sort_by:                z.enum(["last_activity_date","created_at","ltv_cents","churn_risk_score"]).optional().default("last_activity_date"),
  sort_dir:               z.enum(["asc","desc"]).optional().default("desc"),
});

type ListParams = z.infer<typeof ListParamsSchema>;

// ---------------------------------------------------------------------------
// § List member profiles (volume-optimized, faceted)
// ---------------------------------------------------------------------------

export async function listMemberProfiles(
  ctx: RelationsContext,
  rawParams: Record<string, string>
): Promise<PaginatedResult<MemberProfileRow>> {
  assertStaff(ctx);

  const params = ListParamsSchema.parse(rawParams);
  const conditions = ["tenant_id = $1"];
  const values: unknown[] = [ctx.tenantId];
  let idx = 2;

  // Multi-select filters: split comma-separated strings into arrays
  if (params.subscription_status) {
    const statuses = params.subscription_status.split(",").map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      conditions.push(`subscription_status = ANY($${idx++}::text[])`);
      values.push(statuses);
    }
  }
  if (params.cohort) {
    const cohorts = params.cohort.split(",").map(s => s.trim()).filter(Boolean);
    if (cohorts.length > 0) {
      conditions.push(`cohort = ANY($${idx++}::text[])`);
      values.push(cohorts);
    }
  }
  if (params.segment) {
    const segments = params.segment.split(",").map(s => s.trim()).filter(Boolean);
    if (segments.length > 0) {
      conditions.push(`segment = ANY($${idx++}::text[])`);
      values.push(segments);
    }
  }
  if (params.subscription_tier) {
    const tiers = params.subscription_tier.split(",").map(s => s.trim()).filter(Boolean);
    if (tiers.length > 0) {
      conditions.push(`subscription_tier = ANY($${idx++}::text[])`);
      values.push(tiers);
    }
  }
  if (params.current_stage) {
    conditions.push(`current_stage = $${idx++}`);
    values.push(params.current_stage);
  }

  // Range filters
  if (params.churn_risk_gte !== undefined) {
    conditions.push(`churn_risk_score >= $${idx++}`);
    values.push(params.churn_risk_gte);
  }
  if (params.churn_risk_lte !== undefined) {
    conditions.push(`churn_risk_score <= $${idx++}`);
    values.push(params.churn_risk_lte);
  }
  if (params.last_activity_after) {
    conditions.push(`last_activity_date >= $${idx++}`);
    values.push(params.last_activity_after);
  }
  if (params.last_activity_before) {
    conditions.push(`last_activity_date <= $${idx++}`);
    values.push(params.last_activity_before);
  }
  if (params.signup_after) {
    conditions.push(`signup_date >= $${idx++}`);
    values.push(params.signup_after);
  }
  if (params.signup_before) {
    conditions.push(`signup_date <= $${idx++}`);
    values.push(params.signup_before);
  }

  // Boolean: has_coach_match
  if (params.has_coach_match !== undefined) {
    if (params.has_coach_match === "true") {
      conditions.push("coach_match_id IS NOT NULL");
    } else {
      conditions.push("coach_match_id IS NULL");
    }
  }

  const where = conditions.join(" AND ");
  const sortCol = params.sort_by ?? "last_activity_date";
  const sortDir = (params.sort_dir ?? "desc").toUpperCase();
  const offset = (params.page - 1) * params.page_size;

  const countRow = await queryWithContext<{ count: string }>(
    ctx,
    `SELECT count(*) AS count FROM relations.member_profile WHERE ${where}`,
    values
  );
  const total = parseInt(countRow.rows[0]?.count ?? "0", 10);

  const dataResult = await queryWithContext<MemberProfileRow>(
    ctx,
    `SELECT * FROM relations.member_profile
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
// § Get single member profile
// ---------------------------------------------------------------------------

export async function getMemberProfile(
  ctx: RelationsContext,
  id: string
): Promise<MemberProfileRow> {
  assertStaff(ctx);

  const result = await queryWithContext<MemberProfileRow>(
    ctx,
    `SELECT * FROM relations.member_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`member_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Create member profile
// ---------------------------------------------------------------------------

export async function createMemberProfile(
  ctx: RelationsContext,
  body: unknown
): Promise<MemberProfileRow> {
  assertStaff(ctx);

  const input = CreateMemberProfileSchema.parse(body);

  const result = await queryWithContext<MemberProfileRow>(
    ctx,
    `INSERT INTO relations.member_profile (
      person_id, tenant_id, owner_entity_id,
      signup_date, first_session_date, onboarding_completion_date,
      subscription_status, subscription_tier,
      ltv_cents, arpu_cents,
      cohort, segment,
      churn_risk_score, last_activity_date, coach_match_id,
      current_stage, useful_links,
      created_by_user_id, updated_by_user_id
    ) VALUES (
      $1,  $2,  $3,
      $4,  $5,  $6,
      $7,  $8,
      $9,  $10,
      $11, $12,
      $13, $14, $15,
      $16, $17::jsonb,
      $18, $18
    ) RETURNING *`,
    [
      input.person_id, ctx.tenantId, input.owner_entity_id,
      input.signup_date ?? null,
      input.first_session_date ?? null,
      input.onboarding_completion_date ?? null,
      input.subscription_status, input.subscription_tier ?? null,
      input.ltv_cents, input.arpu_cents,
      input.cohort ?? null, input.segment ?? null,
      input.churn_risk_score ?? null,
      input.last_activity_date ?? null,
      input.coach_match_id ?? null,
      input.current_stage,
      JSON.stringify(input.useful_links),
      ctx.userId,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("INSERT returned no rows");
  return row;
}

// ---------------------------------------------------------------------------
// § Update member profile (partial PATCH)
// ---------------------------------------------------------------------------

export async function updateMemberProfile(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<MemberProfileRow> {
  assertStaff(ctx);

  const input = UpdateMemberProfileSchema.parse(body);
  const setClauses: string[] = ["updated_by_user_id = $1", "updated_at = now()"];
  const values: unknown[] = [ctx.userId];
  let idx = 2;

  const scalarFields = [
    "signup_date","first_session_date","onboarding_completion_date",
    "subscription_status","subscription_tier",
    "ltv_cents","arpu_cents",
    "cohort","segment",
    "churn_risk_score","last_activity_date","coach_match_id",
    "current_stage",
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

  const result = await queryWithContext<MemberProfileRow>(
    ctx,
    `UPDATE relations.member_profile
     SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`member_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Stage transition
// ---------------------------------------------------------------------------

export async function updateMemberStage(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<MemberProfileRow> {
  assertStaff(ctx);

  const { stage: newStage } = StageUpdateSchema.parse(body);

  const { client, release } = await getContextClient(ctx);
  try {
    const current = await client.query<{ current_stage: string; person_id: string }>(
      `SELECT current_stage, person_id FROM relations.member_profile
       WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId]
    );
    const row = current.rows[0];
    if (!row) throw new NotFoundError(`member_profile ${id} not found`);

    const updated = await client.query<MemberProfileRow>(
      `UPDATE relations.member_profile
       SET current_stage = $1, updated_at = now(), updated_by_user_id = $2
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [newStage, ctx.userId, id, ctx.tenantId]
    );

    await client.query(
      `INSERT INTO relations.activity
         (person_id, activity_type, role_context, created_by, metadata)
       VALUES ($1, 'stage_change', 'member', $2, $3::jsonb)`,
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
// § Delete member profile
// ---------------------------------------------------------------------------

export async function deleteMemberProfile(
  ctx: RelationsContext,
  id: string
): Promise<void> {
  assertStaff(ctx);

  const result = await queryWithContext(
    ctx,
    `DELETE FROM relations.member_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError(`member_profile ${id} not found`);
  }
}
