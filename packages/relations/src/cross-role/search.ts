// =============================================================================
// Relations v0.2 — Cross-role Search handler
// =============================================================================
// Spec: Relations-Functional-Spec-v0.2.md §6.3 (Search + saved filters)
// Endpoint: GET /v1/relations/search?q=<text>[&role=investor|pro|member|...]
//
// v0.2: Postgres FTS (tsvector/tsquery) across ct.person + role-specific fields.
// Upgrade path: OpenSearch at ~500K total rows per SR Tier B ladder.
//
// Search fields:
//   • ct.person: display_name, primary_email, bio, primary_phone, location
//   • investor_profile: portfolio_cos[], fit_rationale
//   • pro_profile: specialties[], pro_type_fields->>coaching_modality
//   • member_profile: cohort, segment
// =============================================================================

import { z } from "zod";
import type { RelationsContext } from "../types.js";
import { queryWithContext } from "../db.js";

// ---------------------------------------------------------------------------
// § Search result shape
// ---------------------------------------------------------------------------

export interface SearchResult {
  readonly person_id: string;
  readonly display_name: string;
  readonly primary_email: string | null;
  readonly matching_roles: string[];        // which role profiles contributed to the match
  readonly rank: number;                    // ts_rank score
  readonly snippet: string | null;          // matched field excerpt
}

// ---------------------------------------------------------------------------
// § Query params
// ---------------------------------------------------------------------------

const SearchParamsSchema = z.object({
  q:          z.string().min(1).max(500),
  role:       z.string().optional(),        // comma-separated role filter
  page:       z.coerce.number().int().min(1).default(1),
  page_size:  z.coerce.number().int().min(1).max(100).default(25),
});

// ---------------------------------------------------------------------------
// § search
// ---------------------------------------------------------------------------

export async function searchPersons(
  ctx: RelationsContext,
  rawParams: Record<string, string>
): Promise<{ data: SearchResult[]; total: number; page: number; page_size: number }> {
  const params = SearchParamsSchema.parse(rawParams);

  // Normalize query for plainto_tsquery (safer than to_tsquery for arbitrary user input)
  const tsQuery = params.q.trim().replace(/\s+/g, " ");

  const roleFilter = params.role
    ? params.role.split(",").map(r => r.trim()).filter(Boolean)
    : null;

  const offset = (params.page - 1) * params.page_size;

  // ---------------------------------------------------------------------------
  // FTS query: join ct.person + role profile tables; aggregate matching roles.
  // Uses plainto_tsquery for robustness (no special char issues).
  // RLS on each table filters per identity_class automatically.
  // ---------------------------------------------------------------------------

  const roleJoins = `
    LEFT JOIN relations.investor_profile ip
      ON ip.person_id = cp.id AND ip.tenant_id = cp.tenant_id
    LEFT JOIN relations.pro_profile pp
      ON pp.person_id = cp.id AND pp.tenant_id = cp.tenant_id
    LEFT JOIN relations.member_profile mp
      ON mp.person_id = cp.id AND mp.tenant_id = cp.tenant_id
  `;

  // Build tsvector columns per table
  const personTsv = `
    to_tsvector('english',
      coalesce(cp.display_name, '') || ' ' ||
      coalesce(cp.primary_email, '') || ' ' ||
      coalesce(cp.bio, '') || ' ' ||
      coalesce(cp.primary_phone, '') || ' ' ||
      coalesce(cp.location_city, '') || ' ' ||
      coalesce(cp.location_state, '')
    )
  `;

  const investorTsv = `
    to_tsvector('english',
      coalesce(array_to_string(ip.portfolio_cos, ' '), '') || ' ' ||
      coalesce(ip.fit_rationale, '')
    )
  `;

  const proTsv = `
    to_tsvector('english',
      coalesce(array_to_string(pp.specialties, ' '), '')
    )
  `;

  const memberTsv = `
    to_tsvector('english',
      coalesce(mp.cohort, '') || ' ' ||
      coalesce(mp.segment, '')
    )
  `;

  const combinedTsv = `(${personTsv} || ${investorTsv} || ${proTsv} || ${memberTsv})`;

  const conditions = [
    `cp.tenant_id = $1`,
    `${combinedTsv} @@ plainto_tsquery('english', $2)`,
  ];
  const values: unknown[] = [ctx.tenantId, tsQuery];
  let idx = 3;

  if (roleFilter && roleFilter.length > 0) {
    // Filter to persons with at least one of the requested role profiles
    const roleClauses: string[] = [];
    if (roleFilter.includes("investor")) roleClauses.push("ip.id IS NOT NULL");
    if (roleFilter.includes("pro"))      roleClauses.push("pp.id IS NOT NULL");
    if (roleFilter.includes("member"))   roleClauses.push("mp.id IS NOT NULL");
    if (roleClauses.length > 0) {
      conditions.push(`(${roleClauses.join(" OR ")})`);
    }
  }

  const where = conditions.join(" AND ");

  const countRow = await queryWithContext<{ count: string }>(
    ctx,
    `SELECT count(DISTINCT cp.id) AS count
     FROM ct.person cp
     ${roleJoins}
     WHERE ${where}`,
    values
  );
  const total = parseInt(countRow.rows[0]?.count ?? "0", 10);

  interface SearchRow {
    person_id: string;
    display_name: string;
    primary_email: string | null;
    matching_roles: string[];
    rank: number;
    snippet: string | null;
  }

  const dataResult = await queryWithContext<SearchRow>(
    ctx,
    `SELECT
       cp.id AS person_id,
       cp.display_name,
       cp.primary_email,
       ts_rank(${combinedTsv}, plainto_tsquery('english', $2)) AS rank,
       ts_headline('english', coalesce(cp.display_name,'') || ' ' || coalesce(cp.primary_email,''),
                   plainto_tsquery('english', $2),
                   'MaxFragments=1,FragmentDelimiter=" … "') AS snippet,
       array_remove(ARRAY[
         CASE WHEN ip.id IS NOT NULL THEN 'investor' END,
         CASE WHEN pp.id IS NOT NULL THEN 'pro'      END,
         CASE WHEN mp.id IS NOT NULL THEN 'member'   END
       ], NULL) AS matching_roles
     FROM ct.person cp
     ${roleJoins}
     WHERE ${where}
     ORDER BY rank DESC, cp.display_name ASC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, params.page_size, offset]
  );

  return {
    data: dataResult.rows.map(r => ({
      person_id:      r.person_id,
      display_name:   r.display_name,
      primary_email:  r.primary_email,
      matching_roles: r.matching_roles ?? [],
      rank:           Number(r.rank),
      snippet:        r.snippet,
    })),
    total,
    page: params.page,
    page_size: params.page_size,
  };
}
