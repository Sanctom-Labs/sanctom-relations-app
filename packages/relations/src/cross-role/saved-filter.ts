// =============================================================================
// Relations v0.2 — Saved Filter CRUD handler
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §6.3 + §7.6 (saved_filter table)
// Per-user RLS: users see ONLY their own saved filters (RLS policy on table).
// Endpoints:
//   GET    /v1/relations/saved-filters           — list (user's filters, pinned first)
//   POST   /v1/relations/saved-filters           — create
//   GET    /v1/relations/saved-filters/:id       — get by id
//   PATCH  /v1/relations/saved-filters/:id       — update (name / filter_json)
//   PATCH  /v1/relations/saved-filters/:id/pin   — pin (set pinned=true + display_order)
//   DELETE /v1/relations/saved-filters/:id/pin   — unpin
//   DELETE /v1/relations/saved-filters/:id       — delete
// =============================================================================

import { z } from "zod";
import type { RelationsContext, SavedFilterRow } from "../types.js";
import { queryWithContext } from "../db.js";
import { NotFoundError } from "../middleware.js";

// ---------------------------------------------------------------------------
// § filter_json canonical shapes (examples from spec §6.3)
//   { "role": "investor", "stage": ["prospect","contacted"], "fit_score": ["high"] }
//   { "role": "member",   "churn_risk_score_gte": 0.7, "winback_within_days": 7 }
//   { "role": "cross",    "predicate": "investor AND coach" }
// Stored as JSONB — validated loosely at v0.2; strict validation at v0.3+.
// ---------------------------------------------------------------------------

const FilterJsonSchema = z.object({
  role: z.string().optional(),
}).and(z.record(z.unknown()));

const CreateSavedFilterSchema = z.object({
  name:         z.string().min(1).max(200),
  filter_json:  FilterJsonSchema,
  pinned:       z.boolean().default(false),
  display_order: z.number().int().min(0).optional(),
});

const UpdateSavedFilterSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  filter_json:  FilterJsonSchema.optional(),
});

const PinSchema = z.object({
  display_order: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// § List saved filters (current user only — per-user RLS)
// ---------------------------------------------------------------------------

export async function listSavedFilters(
  ctx: RelationsContext
): Promise<SavedFilterRow[]> {
  // RLS policy `saved_filter_owner_only` ensures user sees only their own
  const result = await queryWithContext<SavedFilterRow>(
    ctx,
    `SELECT * FROM relations.saved_filter
     WHERE tenant_id = $1
     ORDER BY
       pinned DESC,
       display_order ASC NULLS LAST,
       created_at DESC`,
    [ctx.tenantId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// § Get single saved filter
// ---------------------------------------------------------------------------

export async function getSavedFilter(
  ctx: RelationsContext,
  id: string
): Promise<SavedFilterRow> {
  const result = await queryWithContext<SavedFilterRow>(
    ctx,
    `SELECT * FROM relations.saved_filter
     WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`saved_filter ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Create saved filter
// ---------------------------------------------------------------------------

export async function createSavedFilter(
  ctx: RelationsContext,
  body: unknown
): Promise<SavedFilterRow> {
  const input = CreateSavedFilterSchema.parse(body);

  const result = await queryWithContext<SavedFilterRow>(
    ctx,
    `INSERT INTO relations.saved_filter
       (user_id, tenant_id, name, filter_json, pinned, display_order)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING *`,
    [
      ctx.userId,
      ctx.tenantId,
      input.name,
      JSON.stringify(input.filter_json),
      input.pinned,
      input.display_order ?? null,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("INSERT returned no rows");
  return row;
}

// ---------------------------------------------------------------------------
// § Update saved filter (name + filter_json only)
// ---------------------------------------------------------------------------

export async function updateSavedFilter(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<SavedFilterRow> {
  const input = UpdateSavedFilterSchema.parse(body);
  const setClauses: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    setClauses.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.filter_json !== undefined) {
    setClauses.push(`filter_json = $${idx++}::jsonb`);
    values.push(JSON.stringify(input.filter_json));
  }

  if (setClauses.length === 1) {
    // Only updated_at — nothing useful changed; return current row
    return getSavedFilter(ctx, id);
  }

  values.push(id, ctx.tenantId);
  const idIdx = idx;
  const tenantIdx = idx + 1;

  const result = await queryWithContext<SavedFilterRow>(
    ctx,
    `UPDATE relations.saved_filter
     SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`saved_filter ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Pin a saved filter (PATCH /:id/pin)
// ---------------------------------------------------------------------------

export async function pinSavedFilter(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<SavedFilterRow> {
  const input = PinSchema.parse(body);

  const result = await queryWithContext<SavedFilterRow>(
    ctx,
    `UPDATE relations.saved_filter
     SET pinned = true, display_order = $1, updated_at = now()
     WHERE id = $2 AND tenant_id = $3
     RETURNING *`,
    [input.display_order, id, ctx.tenantId]
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`saved_filter ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Unpin a saved filter (DELETE /:id/pin)
// ---------------------------------------------------------------------------

export async function unpinSavedFilter(
  ctx: RelationsContext,
  id: string
): Promise<SavedFilterRow> {
  const result = await queryWithContext<SavedFilterRow>(
    ctx,
    `UPDATE relations.saved_filter
     SET pinned = false, display_order = NULL, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [id, ctx.tenantId]
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`saved_filter ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Delete saved filter
// ---------------------------------------------------------------------------

export async function deleteSavedFilter(
  ctx: RelationsContext,
  id: string
): Promise<void> {
  const result = await queryWithContext(
    ctx,
    `DELETE FROM relations.saved_filter WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError(`saved_filter ${id} not found`);
  }
}
