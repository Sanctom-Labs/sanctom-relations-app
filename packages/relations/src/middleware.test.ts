// =============================================================================
// Relations v0.2 — middleware.ts unit tests
// =============================================================================
// Coverage targets:
//   • Error classes (status codes + name strings)
//   • assertStaff (guard + pass-through)
//   • extractContext (dev path via X-Dev-* headers; JWT path; null cases)
// =============================================================================

import { describe, it, expect } from "vitest";
import { IncomingMessage } from "node:http";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertStaff,
  extractContext,
} from "./middleware.js";
import type { RelationsContext } from "./types.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("UnauthorizedError", () => {
  it("has status 401 and name UnauthorizedError", () => {
    const err = new UnauthorizedError();
    expect(err.status).toBe(401);
    expect(err.name).toBe("UnauthorizedError");
    expect(err.message).toBe("Unauthorized");
  });

  it("accepts custom message", () => {
    const err = new UnauthorizedError("not logged in");
    expect(err.message).toBe("not logged in");
  });
});

describe("ForbiddenError", () => {
  it("has status 403 and name ForbiddenError", () => {
    const err = new ForbiddenError();
    expect(err.status).toBe(403);
    expect(err.name).toBe("ForbiddenError");
    expect(err.message).toBe("Forbidden");
  });

  it("accepts custom message", () => {
    const err = new ForbiddenError("staff only");
    expect(err.message).toBe("staff only");
  });
});

describe("NotFoundError", () => {
  it("has status 404 and name NotFoundError", () => {
    const err = new NotFoundError();
    expect(err.status).toBe(404);
    expect(err.name).toBe("NotFoundError");
    expect(err.message).toBe("Not Found");
  });

  it("accepts custom message", () => {
    const err = new NotFoundError("pro_profile abc not found");
    expect(err.message).toBe("pro_profile abc not found");
  });
});

describe("ValidationError", () => {
  it("has status 422 and name ValidationError", () => {
    const err = new ValidationError("bad input");
    expect(err.status).toBe(422);
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("bad input");
  });
});

// ---------------------------------------------------------------------------
// assertStaff
// ---------------------------------------------------------------------------

describe("assertStaff", () => {
  it("does not throw when identityClass is staff", () => {
    const ctx: RelationsContext = {
      userId: "u1",
      tenantId: "t1",
      entityId: "e1",
      identityClass: "staff",
    };
    expect(() => assertStaff(ctx)).not.toThrow();
  });

  it("throws ForbiddenError when identityClass is personal", () => {
    const ctx: RelationsContext = {
      userId: "u1",
      tenantId: "t1",
      entityId: "e1",
      identityClass: "personal",
    };
    expect(() => assertStaff(ctx)).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when identityClass is pro", () => {
    const ctx: RelationsContext = {
      userId: "u1",
      tenantId: "t1",
      entityId: "e1",
      identityClass: "pro",
    };
    expect(() => assertStaff(ctx)).toThrow(ForbiddenError);
  });

  it("ForbiddenError message mentions identity class restriction", () => {
    const ctx: RelationsContext = {
      userId: "u1",
      tenantId: "t1",
      entityId: "e1",
      identityClass: "personal",
    };
    try {
      assertStaff(ctx);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).toMatch(/Sanctom-Staff/);
    }
  });
});

// ---------------------------------------------------------------------------
// extractContext — dev mode (NODE_ENV !== 'production')
// ---------------------------------------------------------------------------

function makeRequest(headers: Record<string, string>): IncomingMessage {
  const req = Object.create(IncomingMessage.prototype) as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = headers;
  return req;
}

describe("extractContext (dev mode)", () => {
  // NODE_ENV in test runner is not 'production', so dev path is active.

  it("returns RelationsContext from X-Dev-* headers", () => {
    const req = makeRequest({
      "x-dev-user-id":        "user-abc",
      "x-dev-tenant-id":      "tenant-xyz",
      "x-dev-entity-id":      "entity-123",
      "x-dev-identity-class": "staff",
    });

    const ctx = extractContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx?.userId).toBe("user-abc");
    expect(ctx?.tenantId).toBe("tenant-xyz");
    expect(ctx?.entityId).toBe("entity-123");
    expect(ctx?.identityClass).toBe("staff");
  });

  it("accepts identity class 'pro'", () => {
    const req = makeRequest({
      "x-dev-user-id":        "u2",
      "x-dev-tenant-id":      "t2",
      "x-dev-entity-id":      "e2",
      "x-dev-identity-class": "pro",
    });
    const ctx = extractContext(req);
    expect(ctx?.identityClass).toBe("pro");
  });

  it("accepts identity class 'personal'", () => {
    const req = makeRequest({
      "x-dev-user-id":        "u3",
      "x-dev-tenant-id":      "t3",
      "x-dev-entity-id":      "e3",
      "x-dev-identity-class": "personal",
    });
    const ctx = extractContext(req);
    expect(ctx?.identityClass).toBe("personal");
  });

  it("returns null for invalid identity class", () => {
    const req = makeRequest({
      "x-dev-user-id":        "u4",
      "x-dev-tenant-id":      "t4",
      "x-dev-entity-id":      "e4",
      "x-dev-identity-class": "superadmin",  // not a valid class
    });
    const ctx = extractContext(req);
    expect(ctx).toBeNull();
  });

  it("returns null when X-Dev-User-Id is missing and no Bearer token", () => {
    const req = makeRequest({
      "x-dev-tenant-id":      "t5",
      "x-dev-entity-id":      "e5",
      "x-dev-identity-class": "staff",
    });
    const ctx = extractContext(req);
    expect(ctx).toBeNull();
  });

  it("falls back to JWT when X-Dev-* headers missing", () => {
    // Build a valid-structure JWT (unsigned — dev mode doesn't verify sig)
    const payload = {
      sub:               "jwt-user",
      tenant_id:         "jwt-tenant",
      current_entity_id: "jwt-entity",
      identity_class:    "staff",
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const fakeJwt = `header.${encoded}.sig`;

    const req = makeRequest({
      authorization: `Bearer ${fakeJwt}`,
    });

    const ctx = extractContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx?.userId).toBe("jwt-user");
    expect(ctx?.tenantId).toBe("jwt-tenant");
    expect(ctx?.entityId).toBe("jwt-entity");
    expect(ctx?.identityClass).toBe("staff");
  });

  it("returns null for malformed JWT (not 3 parts)", () => {
    const req = makeRequest({
      authorization: "Bearer notajwt",
    });
    const ctx = extractContext(req);
    expect(ctx).toBeNull();
  });

  it("returns null for JWT with missing required claims", () => {
    const payload = { sub: "uid" };  // missing tenant_id, entity_id, identity_class
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const req = makeRequest({
      authorization: `Bearer header.${encoded}.sig`,
    });
    const ctx = extractContext(req);
    expect(ctx).toBeNull();
  });
});
