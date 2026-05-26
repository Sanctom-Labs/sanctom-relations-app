// =============================================================================
// Relations v0.2 — Database connection pool
// =============================================================================
// Target: sanctom-platform-shared-prod (relations.* schema)
// Connection URL: RELATIONS_DATABASE_URL env var (never committed)
//
// GUC session parameters set per-connection:
//   • app.current_tenant_id   — for RLS (platform.tenant FK)
//   • app.current_entity_id   — for RLS (platform.entity FK)
//   • app.current_user_id     — for RLS (auth.users cross-instance)
//   • app.identity_class      — for Sanctom-Staff-only RLS gates
//
// NOTE: platform.fn_set_updated_at() and platform.entity() are prerequisites
// on shared-prod (TN bootstrap V001_tenant.sql ✅ + F-EN gate pending).
// =============================================================================

import pg from "pg";
import type { RelationsContext } from "./types.js";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Pool singleton
// ---------------------------------------------------------------------------

let _pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env["RELATIONS_DATABASE_URL"];
    if (!url) {
      throw new Error(
        "RELATIONS_DATABASE_URL environment variable is not set. " +
        "Point this at sanctom-platform-shared-prod (relations.* schema)."
      );
    }
    _pool = new Pool({
      connectionString: url,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env["NODE_ENV"] === "production" ? { rejectUnauthorized: true } : false,
    });

    _pool.on("error", (err) => {
      console.error("[relations:db] Pool error:", err.message);
    });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Context-scoped client
// ---------------------------------------------------------------------------
// Returns a pool client with all four GUC session parameters set.
// MUST be released after use: await release().
// RLS policies fire on every subsequent query through this client.

export async function getContextClient(
  ctx: RelationsContext
): Promise<{ client: pg.PoolClient; release: () => void }> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Set all four GUC params atomically before any RLS query fires
    await client.query(
      `SELECT
        set_config('app.current_tenant_id', $1, true),
        set_config('app.current_entity_id', $2, true),
        set_config('app.current_user_id',   $3, true),
        set_config('app.identity_class',    $4, true)`,
      [ctx.tenantId, ctx.entityId, ctx.userId, ctx.identityClass]
    );
  } catch (err) {
    client.release();
    throw err;
  }

  return {
    client,
    release: () => client.release(),
  };
}

// ---------------------------------------------------------------------------
// Convenience: run a single parameterized query with context GUCs set
// ---------------------------------------------------------------------------

export async function queryWithContext<T extends pg.QueryResultRow = pg.QueryResultRow>(
  ctx: RelationsContext,
  text: string,
  values?: unknown[]
): Promise<pg.QueryResult<T>> {
  const { client, release } = await getContextClient(ctx);
  try {
    return await client.query<T>(text, values);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Health check — no context required
// ---------------------------------------------------------------------------

export async function dbPing(): Promise<{ ok: boolean; latency_ms: number }> {
  const pool = getPool();
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latency_ms: Date.now() - start };
  } catch {
    return { ok: false, latency_ms: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
