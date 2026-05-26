// =============================================================================
// Relations v0.2 — Request context middleware
// =============================================================================
// Extracts RelationsContext from the inbound JWT / request headers.
//
// In production: JWT Bearer token carries:
//   - sub → userId
//   - tenant_id → tenantId
//   - current_entity_id → entityId
//   - identity_class → "personal" | "pro" | "staff"
//
// In DEV mode (process.env.NODE_ENV !== 'production'):
//   Falls back to X-Dev-* headers so engineers can test without a live JWT
//   issuer. Never active in production.
//
// Spec ref: Relations-Arch-Spec-v0.3 §3.1 Entity-context middleware integration
// =============================================================================

import type { IncomingMessage } from "node:http";
import type { RelationsContext } from "./types.js";

// ---------------------------------------------------------------------------
// Header names for DEV fallback
// ---------------------------------------------------------------------------

const DEV_HEADERS = {
  userId:        "x-dev-user-id",
  tenantId:      "x-dev-tenant-id",
  entityId:      "x-dev-entity-id",
  identityClass: "x-dev-identity-class",
} as const;

// ---------------------------------------------------------------------------
// extractContext
// ---------------------------------------------------------------------------
// Returns RelationsContext or null if the request is unauthenticated.
// HTTP layer translates null → 401.

export function extractContext(req: IncomingMessage): RelationsContext | null {
  if (process.env["NODE_ENV"] !== "production") {
    return extractDevContext(req);
  }
  return extractJwtContext(req);
}

// ---------------------------------------------------------------------------
// JWT extraction (production)
// ---------------------------------------------------------------------------

function extractJwtContext(req: IncomingMessage): RelationsContext | null {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    // Decode without verification — signature verification is the responsibility
    // of the upstream API Gateway / F-AU middleware. Relations trusts the
    // gateway-validated JWT passed through.
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf-8")
    ) as Record<string, unknown>;

    const userId        = asString(payload["sub"]);
    const tenantId      = asString(payload["tenant_id"]);
    const entityId      = asString(payload["current_entity_id"]);
    const identityClass = asIdentityClass(payload["identity_class"]);

    if (!userId || !tenantId || !entityId || !identityClass) return null;

    return { userId, tenantId, entityId, identityClass };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DEV fallback (non-production)
// ---------------------------------------------------------------------------

function extractDevContext(req: IncomingMessage): RelationsContext | null {
  const userId        = req.headers[DEV_HEADERS.userId];
  const tenantId      = req.headers[DEV_HEADERS.tenantId];
  const entityId      = req.headers[DEV_HEADERS.entityId];
  const identityClass = req.headers[DEV_HEADERS.identityClass];

  if (!userId || !tenantId || !entityId || !identityClass) {
    // Try JWT path as fallback even in dev
    return extractJwtContext(req);
  }

  const ic = asIdentityClass(identityClass);
  if (!ic) return null;

  return {
    userId:        Array.isArray(userId) ? (userId[0] ?? "") : userId,
    tenantId:      Array.isArray(tenantId) ? (tenantId[0] ?? "") : tenantId,
    entityId:      Array.isArray(entityId) ? (entityId[0] ?? "") : entityId,
    identityClass: ic,
  };
}

// ---------------------------------------------------------------------------
// Identity-class guard
// ---------------------------------------------------------------------------

export function assertStaff(ctx: RelationsContext): void {
  if (ctx.identityClass !== "staff") {
    throw new ForbiddenError(
      "This resource is restricted to Sanctom-Staff identity class."
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function asIdentityClass(v: unknown): RelationsContext["identityClass"] | undefined {
  if (v === "personal" || v === "pro" || v === "staff") return v;
  return undefined;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not Found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
