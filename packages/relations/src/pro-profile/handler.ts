// =============================================================================
// Relations v0.2 — Pro Profile CRUD handlers
// =============================================================================
// Spec: Relations-Pro-Functional-Spec-v0.2.md §9 (DDL) + §12 (ACs)
// Endpoints:
//   GET    /v1/relations/pro-profiles              — list (paginated + filtered)
//   POST   /v1/relations/pro-profiles              — create
//   GET    /v1/relations/pro-profiles/:id          — get by id
//   PATCH  /v1/relations/pro-profiles/:id          — update fields
//   PATCH  /v1/relations/pro-profiles/:id/stage    — stage transition
//   DELETE /v1/relations/pro-profiles/:id          — delete
//   GET    /v1/relations/pro-profiles/person/:pid  — all pro_profiles for a person
//   GET    /v1/relations/onboarding-templates      — active templates (read-only)
//   GET    /v1/relations/engagement-stage-labels   — stage labels per structure
// =============================================================================

import type { RelationsContext, ProProfileRow, PaginatedResult } from "../types.js";
import { queryWithContext, getContextClient } from "../db.js";
import { NotFoundError, ValidationError, ForbiddenError } from "../middleware.js";
import {
  CreateProProfileSchema,
  UpdateProProfileSchema,
  StageUpdateSchema,
  ProProfileListParamsSchema,
  PRO_TYPE_FIELD_SCHEMAS,
  PRO_TYPE_DEFAULTS,
  type CreateProProfileInput,
  type ProProfileListParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// § List pro profiles
// ---------------------------------------------------------------------------

export async function listProProfiles(
  ctx: RelationsContext,
  rawParams: Record<string, string>
): Promise<PaginatedResult<ProProfileRow>> {
  const params = ProProfileListParamsSchema.parse(rawParams);

  const conditions: string[] = [
    "p.tenant_id = $1",
    "p.owner_entity_id = $2",
  ];
  const values: unknown[] = [ctx.tenantId, ctx.entityId];
  let idx = 3;

  if (params.pro_type) {
    conditions.push(`p.pro_type = $${idx++}`);
    values.push(params.pro_type);
  }
  if (params.pro_category) {
    conditions.push(`p.pro_category = $${idx++}`);
    values.push(params.pro_category);
  }
  if (params.engagement_structure) {
    conditions.push(`p.engagement_structure = $${idx++}`);
    values.push(params.engagement_structure);
  }
  if (params.current_stage) {
    conditions.push(`p.current_stage = $${idx++}`);
    values.push(params.current_stage);
  }
  if (params.availability_open !== undefined) {
    conditions.push(`p.availability_open = $${idx++}`);
    values.push(params.availability_open === "true");
  }

  const whereClause = conditions.join(" AND ");
  const sortCol = params.sort_by ?? "created_at";
  const sortDir = params.sort_dir ?? "desc";
  const offset = (params.page - 1) * params.page_size;

  // Count query
  const countResult = await queryWithContext<{ count: string }>(
    ctx,
    `SELECT count(*) AS count FROM relations.pro_profile p WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  // Data query — no ORDER BY on user-supplied input directly (validated via enum)
  const dataResult = await queryWithContext<ProProfileRow>(
    ctx,
    `SELECT p.*
     FROM relations.pro_profile p
     WHERE ${whereClause}
     ORDER BY p.${sortCol} ${sortDir.toUpperCase()}
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
// § Get single pro profile by id
// ---------------------------------------------------------------------------

export async function getProProfile(
  ctx: RelationsContext,
  id: string
): Promise<ProProfileRow> {
  const result = await queryWithContext<ProProfileRow>(
    ctx,
    `SELECT * FROM relations.pro_profile
     WHERE id = $1 AND tenant_id = $2 AND owner_entity_id = $3`,
    [id, ctx.tenantId, ctx.entityId]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`pro_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Get all pro profiles for a person (cross-role support)
// ---------------------------------------------------------------------------

export async function getProProfilesByPerson(
  ctx: RelationsContext,
  personId: string
): Promise<ProProfileRow[]> {
  const result = await queryWithContext<ProProfileRow>(
    ctx,
    `SELECT * FROM relations.pro_profile
     WHERE person_id = $1 AND tenant_id = $2
     ORDER BY created_at DESC`,
    [personId, ctx.tenantId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// § Create pro profile
// ---------------------------------------------------------------------------

export async function createProProfile(
  ctx: RelationsContext,
  body: unknown
): Promise<ProProfileRow> {
  const input = CreateProProfileSchema.parse(body);
  validateProTypeFields(input);

  // Enforce pro_type='other' only for Pro identity-class (OQ-5 ratification)
  if (input.pro_type === "other" && ctx.identityClass !== "pro" && ctx.identityClass !== "staff") {
    throw new ForbiddenError("pro_type='other' is restricted to Pro identity class.");
  }

  const { client, release } = await getContextClient(ctx);
  try {
    // Resolve active onboarding template if not supplied
    let onboardingTemplateId = input.onboarding_template_id ?? null;
    if (!onboardingTemplateId) {
      const defaults = PRO_TYPE_DEFAULTS[input.pro_type];
      const tmplResult = await client.query<{ id: string }>(
        `SELECT id FROM relations.onboarding_template
         WHERE pro_type = $1 AND regulatory_tier = $2 AND is_active = true
         LIMIT 1`,
        [input.pro_type, defaults.regulatory_tier]
      );
      onboardingTemplateId = tmplResult.rows[0]?.id ?? null;
    }

    const result = await client.query<ProProfileRow>(
      `INSERT INTO relations.pro_profile (
        person_id, tenant_id, owner_entity_id,
        pro_type, pro_category, billing_model,
        engagement_structure, regulatory_tier, pro_type_fields,
        specialties, years_of_experience, languages,
        capacity_per_period, availability_open, payout_method,
        onboarding_status, onboarding_template_id,
        fit_rationale, useful_links, current_stage,
        created_by_user_id, updated_by_user_id
      ) VALUES (
        $1,  $2,  $3,
        $4,  $5,  $6,
        $7,  $8,  $9::jsonb,
        $10, $11, $12,
        $13, $14, $15,
        'not_started', $16,
        $17, $18::jsonb, $19,
        $20, $20
      )
      RETURNING *`,
      [
        input.person_id, ctx.tenantId, input.owner_entity_id,
        input.pro_type, input.pro_category, input.billing_model,
        input.engagement_structure, input.regulatory_tier,
        JSON.stringify(input.pro_type_fields ?? {}),
        input.specialties ?? [], input.years_of_experience ?? null,
        input.languages ?? [],
        input.capacity_per_period ?? null, input.availability_open ?? true,
        input.payout_method ?? null,
        onboardingTemplateId,
        input.fit_rationale ?? null,
        JSON.stringify(input.useful_links ?? []),
        input.current_stage ?? "prospect",
        ctx.userId,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new Error("INSERT returned no rows");
    return row;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// § Update pro profile (partial PATCH)
// ---------------------------------------------------------------------------

export async function updateProProfile(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<ProProfileRow> {
  const input = UpdateProProfileSchema.parse(body);

  // pro_type_fields re-validation if pro_type_fields or pro_type changes
  if (input.pro_type_fields !== undefined || input.pro_type !== undefined) {
    // Fetch current row to get pro_type if not in update
    if (input.pro_type === undefined) {
      const current = await getProProfile(ctx, id);
      validateProTypeFieldsForType(current.pro_type, input.pro_type_fields ?? current.pro_type_fields);
    } else {
      validateProTypeFieldsForType(input.pro_type, input.pro_type_fields ?? {});
    }
  }

  const setClauses: string[] = ["updated_by_user_id = $1", "updated_at = now()"];
  const values: unknown[] = [ctx.userId];
  let idx = 2;

  const fieldMap: Record<string, string> = {
    pro_type: "pro_type", pro_category: "pro_category",
    billing_model: "billing_model", engagement_structure: "engagement_structure",
    regulatory_tier: "regulatory_tier", specialties: "specialties",
    years_of_experience: "years_of_experience", languages: "languages",
    capacity_per_period: "capacity_per_period", availability_open: "availability_open",
    payout_method: "payout_method", current_stage: "current_stage",
    onboarding_template_id: "onboarding_template_id",
    fit_rationale: "fit_rationale",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    const val = (input as Record<string, unknown>)[key];
    if (val !== undefined) {
      setClauses.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  if (input.pro_type_fields !== undefined) {
    setClauses.push(`pro_type_fields = $${idx++}::jsonb`);
    values.push(JSON.stringify(input.pro_type_fields));
  }
  if (input.useful_links !== undefined) {
    setClauses.push(`useful_links = $${idx++}::jsonb`);
    values.push(JSON.stringify(input.useful_links));
  }

  values.push(id, ctx.tenantId, ctx.entityId);
  const idIdx = idx;
  const tenantIdx = idx + 1;
  const entityIdx = idx + 2;

  const result = await queryWithContext<ProProfileRow>(
    ctx,
    `UPDATE relations.pro_profile
     SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND tenant_id = $${tenantIdx} AND owner_entity_id = $${entityIdx}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`pro_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Stage transition (PATCH /:id/stage)
// Emits an audit event + wires to F-WH (activity row) on success.
// ---------------------------------------------------------------------------

export async function updateProProfileStage(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<ProProfileRow> {
  const { stage: newStage } = StageUpdateSchema.parse(body);

  const { client, release } = await getContextClient(ctx);
  try {
    // Fetch current stage for audit delta
    const current = await client.query<{ current_stage: string; person_id: string }>(
      `SELECT current_stage, person_id FROM relations.pro_profile
       WHERE id = $1 AND tenant_id = $2 AND owner_entity_id = $3`,
      [id, ctx.tenantId, ctx.entityId]
    );
    const row = current.rows[0];
    if (!row) throw new NotFoundError(`pro_profile ${id} not found`);

    const prevStage = row.current_stage;

    // Update stage
    const updated = await client.query<ProProfileRow>(
      `UPDATE relations.pro_profile
       SET current_stage = $1, updated_at = now(), updated_by_user_id = $2
       WHERE id = $3 AND tenant_id = $4 AND owner_entity_id = $5
       RETURNING *`,
      [newStage, ctx.userId, id, ctx.tenantId, ctx.entityId]
    );

    // Insert activity row for the stage change
    await client.query(
      `INSERT INTO relations.activity
         (person_id, activity_type, role_context, created_by, metadata)
       VALUES ($1, 'stage_change', 'pro', $2, $3::jsonb)`,
      [
        row.person_id,
        ctx.userId,
        JSON.stringify({
          profile_id: id,
          profile_type: "pro_profile",
          from_stage: prevStage,
          to_stage: newStage,
        }),
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
// § Delete pro profile
// ---------------------------------------------------------------------------

export async function deleteProProfile(
  ctx: RelationsContext,
  id: string
): Promise<void> {
  const result = await queryWithContext(
    ctx,
    `DELETE FROM relations.pro_profile
     WHERE id = $1 AND tenant_id = $2 AND owner_entity_id = $3`,
    [id, ctx.tenantId, ctx.entityId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError(`pro_profile ${id} not found`);
  }
}

// ---------------------------------------------------------------------------
// § Onboarding templates (read-only — seeded by V101.1)
// ---------------------------------------------------------------------------

export async function listOnboardingTemplates(
  ctx: RelationsContext,
  activeOnly = true
) {
  const result = await queryWithContext(
    ctx,
    `SELECT * FROM relations.onboarding_template
     WHERE ($1 = false OR is_active = true)
     ORDER BY pro_type, regulatory_tier`,
    [activeOnly]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// § Engagement structure stage labels (read-only — seeded by V101.1)
// ---------------------------------------------------------------------------

export async function listEngagementStageLabels(
  ctx: RelationsContext,
  engagementStructure?: string
) {
  const result = await queryWithContext(
    ctx,
    `SELECT * FROM relations.engagement_structure_stage_label
     WHERE ($1::text IS NULL OR engagement_structure = $1)
     ORDER BY engagement_structure, display_order`,
    [engagementStructure ?? null]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// § Private helpers
// ---------------------------------------------------------------------------

function validateProTypeFields(input: CreateProProfileInput): void {
  validateProTypeFieldsForType(input.pro_type, input.pro_type_fields ?? {});
}

function validateProTypeFieldsForType(
  proType: string,
  fields: Record<string, unknown>
): void {
  const schema = PRO_TYPE_FIELD_SCHEMAS[proType as keyof typeof PRO_TYPE_FIELD_SCHEMAS];
  if (!schema) return; // unknown type — let DB constraints catch it

  const result = schema.safeParse(fields);
  if (!result.success) {
    throw new ValidationError(
      `pro_type_fields validation failed for pro_type='${proType}': ${result.error.message}`
    );
  }
}
