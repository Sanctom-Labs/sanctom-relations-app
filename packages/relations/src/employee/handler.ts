// =============================================================================
// Relations v0.2 — Employee Profile CRUD handlers (stub)
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §5 (Employee stub) + §7.5 (DDL)
// Identity gate: Sanctom-Staff ONLY
// v0.2 scope: detail view only (accessed via person-search). No list view,
// no faceted filters, no agent integration.
// =============================================================================

import { z } from "zod";
import type { RelationsContext, EmployeeProfileRow } from "../types.js";
import { queryWithContext } from "../db.js";
import { NotFoundError, assertStaff } from "../middleware.js";

// ---------------------------------------------------------------------------
// § Input schemas
// ---------------------------------------------------------------------------

const CreateEmployeeProfileSchema = z.object({
  person_id:        z.string().uuid(),
  owner_entity_id:  z.string().uuid(),
  deel_employee_id: z.string().max(200).optional(),
  employment_type:  z.enum(["fte","contractor","advisor","part_time","intern"]).optional(),
  start_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cross_role_links: z.array(z.object({
    role:       z.string().max(100),
    profile_id: z.string().uuid(),
    label:      z.string().max(200).optional(),
  })).max(20).default([]),
  notes:            z.string().max(5000).optional(),
});

const UpdateEmployeeProfileSchema = CreateEmployeeProfileSchema
  .omit({ person_id: true, owner_entity_id: true })
  .partial();

// ---------------------------------------------------------------------------
// § Get employee profile (by id)
// v0.2: accessed via person-search → detail panel (no standalone list view)
// ---------------------------------------------------------------------------

export async function getEmployeeProfile(
  ctx: RelationsContext,
  id: string
): Promise<EmployeeProfileRow> {
  assertStaff(ctx);

  const result = await queryWithContext<EmployeeProfileRow>(
    ctx,
    `SELECT * FROM relations.employee_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError(`employee_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Get employee profile by person_id
// ---------------------------------------------------------------------------

export async function getEmployeeProfileByPerson(
  ctx: RelationsContext,
  personId: string
): Promise<EmployeeProfileRow | null> {
  assertStaff(ctx);

  const result = await queryWithContext<EmployeeProfileRow>(
    ctx,
    `SELECT * FROM relations.employee_profile
     WHERE person_id = $1 AND tenant_id = $2
     LIMIT 1`,
    [personId, ctx.tenantId]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// § Create employee profile
// ---------------------------------------------------------------------------

export async function createEmployeeProfile(
  ctx: RelationsContext,
  body: unknown
): Promise<EmployeeProfileRow> {
  assertStaff(ctx);

  const input = CreateEmployeeProfileSchema.parse(body);

  const result = await queryWithContext<EmployeeProfileRow>(
    ctx,
    `INSERT INTO relations.employee_profile (
      person_id, tenant_id, owner_entity_id,
      deel_employee_id, employment_type,
      start_date, end_date,
      cross_role_links, notes,
      created_by_user_id, updated_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $10)
    RETURNING *`,
    [
      input.person_id, ctx.tenantId, input.owner_entity_id,
      input.deel_employee_id ?? null,
      input.employment_type ?? null,
      input.start_date ?? null,
      input.end_date ?? null,
      JSON.stringify(input.cross_role_links),
      input.notes ?? null,
      ctx.userId,
    ]
  );

  const row = result.rows[0];
  if (!row) throw new Error("INSERT returned no rows");
  return row;
}

// ---------------------------------------------------------------------------
// § Update employee profile (partial PATCH)
// ---------------------------------------------------------------------------

export async function updateEmployeeProfile(
  ctx: RelationsContext,
  id: string,
  body: unknown
): Promise<EmployeeProfileRow> {
  assertStaff(ctx);

  const input = UpdateEmployeeProfileSchema.parse(body);
  const setClauses: string[] = ["updated_by_user_id = $1", "updated_at = now()"];
  const values: unknown[] = [ctx.userId];
  let idx = 2;

  for (const field of ["deel_employee_id","employment_type","start_date","end_date","notes"] as const) {
    const val = (input as Record<string, unknown>)[field];
    if (val !== undefined) {
      setClauses.push(`${field} = $${idx++}`);
      values.push(val);
    }
  }

  if (input.cross_role_links !== undefined) {
    setClauses.push(`cross_role_links = $${idx++}::jsonb`);
    values.push(JSON.stringify(input.cross_role_links));
  }

  values.push(id, ctx.tenantId);
  const idIdx = idx;
  const tenantIdx = idx + 1;

  const result = await queryWithContext<EmployeeProfileRow>(
    ctx,
    `UPDATE relations.employee_profile
     SET ${setClauses.join(", ")}
     WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) throw new NotFoundError(`employee_profile ${id} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// § Delete employee profile
// ---------------------------------------------------------------------------

export async function deleteEmployeeProfile(
  ctx: RelationsContext,
  id: string
): Promise<void> {
  assertStaff(ctx);

  const result = await queryWithContext(
    ctx,
    `DELETE FROM relations.employee_profile WHERE id = $1 AND tenant_id = $2`,
    [id, ctx.tenantId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError(`employee_profile ${id} not found`);
  }
}
