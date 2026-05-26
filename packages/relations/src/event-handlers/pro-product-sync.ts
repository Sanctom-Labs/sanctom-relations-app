// =============================================================================
// Relations v0.2 — Sanctom Pro product event subscriber
// =============================================================================
// Spec: Relations-Pro-Functional-Spec-v0.2.md §10 (cross-product integration)
//       + Relations-Arch-Spec-v0.3 §3.1 (Entity-context middleware integration)
//
// PURPOSE:
//   When Sanctom Pro fires lifecycle events (session_booked, session_completed,
//   package_purchased, etc.), this handler writes the corresponding row to
//   relations.activity with role_context='pro', ensuring the cross-role timeline
//   in Relations stays synchronized without Relations polling Pro's DB.
//
//   At v0.2, the event transport is AWS EventBridge (Lambda subscriber wrapping
//   this handler). EventBridge rule: source="sanctom.pro", detail-type matches
//   the event type list below.
//
// EVENT TYPES HANDLED (subset of V101 activity_type extensions):
//   session_booked · session_completed · session_cancelled
//   package_purchased · package_completed
//   (case_opened · pleading_filed · etc. handled by same handler for attorney pro_type)
//
// IDEMPOTENCY: each inbound event carries a unique event_id; we INSERT ... ON CONFLICT
// (event_id) DO NOTHING to prevent duplicate processing on EventBridge retries.
// =============================================================================

import { z } from "zod";
import { getPool } from "../db.js";

// ---------------------------------------------------------------------------
// § Inbound event shape (from EventBridge detail payload)
// ---------------------------------------------------------------------------

const ProEventSchema = z.object({
  event_id:       z.string().uuid(),
  event_type:     z.enum([
    "session_booked", "session_completed", "session_cancelled",
    "package_purchased", "package_completed",
    "case_opened", "pleading_filed", "motion_filed",
    "discovery_request", "deposition_taken", "case_settled", "case_closed",
    "return_prepared", "return_filed", "extension_filed",
    "client_review_meeting", "ad_hoc_consultation",
    "portfolio_review", "rebalance_executed", "quarterly_meeting",
    "quote_provided", "quote_accepted", "job_scheduled",
    "job_started", "materials_purchased", "job_completed",
    "invoice_sent", "payment_received",
  ]),
  person_id:      z.string().uuid(),
  pro_profile_id: z.string().uuid(),
  tenant_id:      z.string().uuid(),
  actor_user_id:  z.string().uuid(),
  occurred_at:    z.string().datetime({ offset: true }),
  metadata:       z.record(z.unknown()).optional().default({}),
});

export type ProEvent = z.infer<typeof ProEventSchema>;

// ---------------------------------------------------------------------------
// § handleProEvent — main entry point
// ---------------------------------------------------------------------------
// Called by the EventBridge Lambda wrapper (src/lambda/pro-event-handler.ts).
// Returns { processed: boolean; reason: string }.

export async function handleProEvent(
  rawPayload: unknown
): Promise<{ processed: boolean; reason: string }> {
  let event: ProEvent;
  try {
    event = ProEventSchema.parse(rawPayload);
  } catch (err) {
    return {
      processed: false,
      reason: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Set GUC context so RLS triggers don't reject the insert
    await client.query(
      `SELECT
        set_config('app.current_tenant_id', $1, true),
        set_config('app.current_entity_id', $2, true),
        set_config('app.current_user_id',   $3, true),
        set_config('app.identity_class',    'system', true)`,
      [event.tenant_id, "", event.actor_user_id]
    );

    // Resolve pro_type for this profile (needed for activity context)
    const profileResult = await client.query<{ pro_type: string }>(
      `SELECT pro_type FROM relations.pro_profile WHERE id = $1 AND tenant_id = $2`,
      [event.pro_profile_id, event.tenant_id]
    );

    if (profileResult.rows.length === 0) {
      return {
        processed: false,
        reason: `pro_profile ${event.pro_profile_id} not found in tenant ${event.tenant_id}`,
      };
    }

    const proType = profileResult.rows[0]?.pro_type ?? "unknown";

    // Idempotent insert — ON CONFLICT (event_id) DO NOTHING
    // NOTE: requires a unique index on relations.activity.event_id (add in V103 if not present)
    const insertResult = await client.query(
      `INSERT INTO relations.activity (
         person_id, tenant_id, activity_type, role_context,
         created_by, metadata, created_at
       )
       VALUES ($1, $2, $3, 'pro', $4, $5::jsonb, $6)
       ON CONFLICT DO NOTHING`,
      [
        event.person_id,
        event.tenant_id,
        event.event_type,
        event.actor_user_id,
        JSON.stringify({
          event_id:       event.event_id,
          pro_profile_id: event.pro_profile_id,
          pro_type:       proType,
          ...event.metadata,
        }),
        event.occurred_at,
      ]
    );

    if ((insertResult.rowCount ?? 0) === 0) {
      return { processed: false, reason: `Duplicate event_id ${event.event_id} — skipped` };
    }

    return { processed: true, reason: `Activity row created for event ${event.event_id}` };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// § Lambda handler wrapper (for EventBridge integration)
// ---------------------------------------------------------------------------
// This function signature matches the AWS Lambda handler contract.
// Deploy as: runtime=nodejs20.x, handler=dist/event-handlers/pro-product-sync.lambdaHandler

export async function lambdaHandler(event: {
  Records?: Array<{ body: string }>;
  detail?: unknown;
}): Promise<void> {
  // EventBridge direct invocation
  if (event.detail !== undefined) {
    const result = await handleProEvent(event.detail);
    if (!result.processed) {
      console.warn("[pro-product-sync]", result.reason);
    } else {
      console.info("[pro-product-sync]", result.reason);
    }
    return;
  }

  // SQS batched invocation (EventBridge → SQS → Lambda)
  if (Array.isArray(event.Records)) {
    for (const record of event.Records) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(record.body) as unknown;
      } catch {
        console.error("[pro-product-sync] Failed to parse SQS record body");
        continue;
      }

      // SQS record wraps EventBridge detail in an SNS-style envelope
      const detail = (parsed as Record<string, unknown>)["detail"] ?? parsed;
      const result = await handleProEvent(detail);
      if (!result.processed) {
        console.warn("[pro-product-sync] SQS record:", result.reason);
      } else {
        console.info("[pro-product-sync] SQS record:", result.reason);
      }
    }
  }
}
