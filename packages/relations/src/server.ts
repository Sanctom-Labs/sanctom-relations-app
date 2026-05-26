// =============================================================================
// Relations v0.2 — HTTP server
// =============================================================================
// Spec: Relations-Arch-Spec-v0.3 §3.1 + Relations-Functional-Spec-v0.2 §8.1 Phase 3
// Port: 7330 (Relations service; avoids conflict with broker:7321 + executive:7322)
//
// Route map:
//   GET    /health                                        — liveness probe
//   GET    /version                                       — version info
//
//   GET    /v1/relations/persons/:personId                — cross-role person detail
//   GET    /v1/relations/persons/:personId/activity       — unified timeline
//   POST   /v1/relations/persons/:personId/activity       — add note
//   GET    /v1/relations/search                           — cross-role search
//
//   GET    /v1/relations/pro-profiles                     — list
//   POST   /v1/relations/pro-profiles                     — create
//   GET    /v1/relations/pro-profiles/:id                 — get
//   PATCH  /v1/relations/pro-profiles/:id                 — update
//   PATCH  /v1/relations/pro-profiles/:id/stage           — stage transition
//   DELETE /v1/relations/pro-profiles/:id                 — delete
//   GET    /v1/relations/pro-profiles/person/:personId    — by person
//
//   GET    /v1/relations/onboarding-templates             — list templates
//   GET    /v1/relations/engagement-stage-labels          — list stage labels
//
//   GET    /v1/relations/investor-profiles                — list
//   POST   /v1/relations/investor-profiles                — create
//   GET    /v1/relations/investor-profiles/:id            — get
//   PATCH  /v1/relations/investor-profiles/:id            — update
//   PATCH  /v1/relations/investor-profiles/:id/stage      — stage transition
//   DELETE /v1/relations/investor-profiles/:id            — delete
//
//   GET    /v1/relations/member-profiles                  — list (faceted)
//   POST   /v1/relations/member-profiles                  — create
//   GET    /v1/relations/member-profiles/:id              — get
//   PATCH  /v1/relations/member-profiles/:id              — update
//   PATCH  /v1/relations/member-profiles/:id/stage        — stage transition
//   DELETE /v1/relations/member-profiles/:id              — delete
//
//   GET    /v1/relations/candidate-profiles               — list
//   POST   /v1/relations/candidate-profiles               — create
//   GET    /v1/relations/candidate-profiles/:id           — get
//   PATCH  /v1/relations/candidate-profiles/:id           — update
//   PATCH  /v1/relations/candidate-profiles/:id/stage     — stage transition
//   DELETE /v1/relations/candidate-profiles/:id           — delete
//
//   GET    /v1/relations/employee-profiles/:id            — get (detail only at v0.2)
//   POST   /v1/relations/employee-profiles                — create
//   PATCH  /v1/relations/employee-profiles/:id            — update
//   DELETE /v1/relations/employee-profiles/:id            — delete
//
//   GET    /v1/relations/saved-filters                    — list (per-user)
//   POST   /v1/relations/saved-filters                    — create
//   GET    /v1/relations/saved-filters/:id                — get
//   PATCH  /v1/relations/saved-filters/:id                — update
//   PATCH  /v1/relations/saved-filters/:id/pin            — pin
//   DELETE /v1/relations/saved-filters/:id/pin            — unpin
//   DELETE /v1/relations/saved-filters/:id                — delete
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { dbPing, closePool } from "./db.js";
import { extractContext, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from "./middleware.js";

// Role profile handlers
import * as ProProfileHandler from "./pro-profile/handler.js";
import * as InvestorHandler from "./investor/handler.js";
import * as MemberHandler from "./member/handler.js";
import * as CandidateHandler from "./candidate/handler.js";
import * as EmployeeHandler from "./employee/handler.js";

// Cross-role handlers
import { getPersonDetail } from "./cross-role/person-detail.js";
import { getPersonTimeline, addTimelineNote } from "./cross-role/timeline.js";
import { searchPersons } from "./cross-role/search.js";
import * as SavedFilterHandler from "./cross-role/saved-filter.js";

export const DEFAULT_PORT = 7330;
const VERSION = "0.2.0";

// ---------------------------------------------------------------------------
// § Server lifecycle
// ---------------------------------------------------------------------------

export function startServer(port = DEFAULT_PORT): { stop: () => Promise<void>; port: number } {
  const server = createServer(handleRequest);

  server.listen(port, () => {
    console.info(`[relations] Server listening on port ${port}`);
  });

  return {
    port,
    stop: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
      );
      await closePool();
    },
  };
}

// ---------------------------------------------------------------------------
// § Request dispatcher
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";

  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    sendJson(res, 400, { error: "BadRequest", message: "Invalid URL" });
    return;
  }

  const pathname = url.pathname.replace(/\/$/, ""); // strip trailing slash
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    // --- Health / version (no auth required) ---
    if (method === "GET" && pathname === "/health") {
      const ping = await dbPing();
      sendJson(res, 200, { status: ping.ok ? "ok" : "degraded", db_latency_ms: ping.latency_ms, version: VERSION });
      return;
    }
    if (method === "GET" && pathname === "/version") {
      sendJson(res, 200, { version: VERSION });
      return;
    }

    // --- Auth context (required for all /v1/* routes) ---
    const ctx = extractContext(req);
    if (!ctx) throw new UnauthorizedError();

    const body = await parseBody(req);

    // -----------------------------------------------------------------------
    // § Cross-role
    // -----------------------------------------------------------------------

    // GET /v1/relations/search
    if (method === "GET" && pathname === "/v1/relations/search") {
      sendJson(res, 200, await searchPersons(ctx, query));
      return;
    }

    // GET /v1/relations/persons/:personId
    const personDetailMatch = matchPath(pathname, "/v1/relations/persons/{personId}");
    if (method === "GET" && personDetailMatch) {
      sendJson(res, 200, await getPersonDetail(ctx, personDetailMatch["personId"]!));
      return;
    }

    // GET/POST /v1/relations/persons/:personId/activity
    const timelineMatch = matchPath(pathname, "/v1/relations/persons/{personId}/activity");
    if (timelineMatch) {
      if (method === "GET") {
        sendJson(res, 200, await getPersonTimeline(ctx, timelineMatch["personId"]!, query));
        return;
      }
      if (method === "POST") {
        sendJson(res, 201, await addTimelineNote(ctx, timelineMatch["personId"]!, body));
        return;
      }
    }

    // -----------------------------------------------------------------------
    // § Pro Profile routes
    // -----------------------------------------------------------------------

    if (method === "GET" && pathname === "/v1/relations/pro-profiles") {
      sendJson(res, 200, await ProProfileHandler.listProProfiles(ctx, query));
      return;
    }
    if (method === "POST" && pathname === "/v1/relations/pro-profiles") {
      sendJson(res, 201, await ProProfileHandler.createProProfile(ctx, body));
      return;
    }
    if (method === "GET" && pathname === "/v1/relations/onboarding-templates") {
      sendJson(res, 200, await ProProfileHandler.listOnboardingTemplates(ctx));
      return;
    }
    if (method === "GET" && pathname === "/v1/relations/engagement-stage-labels") {
      sendJson(res, 200, await ProProfileHandler.listEngagementStageLabels(ctx, query["engagement_structure"]));
      return;
    }

    // /v1/relations/pro-profiles/person/:personId
    const proByPersonMatch = matchPath(pathname, "/v1/relations/pro-profiles/person/{personId}");
    if (method === "GET" && proByPersonMatch) {
      sendJson(res, 200, await ProProfileHandler.getProProfilesByPerson(ctx, proByPersonMatch["personId"]!));
      return;
    }

    // /v1/relations/pro-profiles/:id/stage
    const proStageMatch = matchPath(pathname, "/v1/relations/pro-profiles/{id}/stage");
    if (method === "PATCH" && proStageMatch) {
      sendJson(res, 200, await ProProfileHandler.updateProProfileStage(ctx, proStageMatch["id"]!, body));
      return;
    }

    // /v1/relations/pro-profiles/:id
    const proMatch = matchPath(pathname, "/v1/relations/pro-profiles/{id}");
    if (proMatch) {
      if (method === "GET")    { sendJson(res, 200, await ProProfileHandler.getProProfile(ctx, proMatch["id"]!)); return; }
      if (method === "PATCH")  { sendJson(res, 200, await ProProfileHandler.updateProProfile(ctx, proMatch["id"]!, body)); return; }
      if (method === "DELETE") { await ProProfileHandler.deleteProProfile(ctx, proMatch["id"]!); sendJson(res, 204, null); return; }
    }

    // -----------------------------------------------------------------------
    // § Investor Profile routes
    // -----------------------------------------------------------------------

    if (method === "GET"  && pathname === "/v1/relations/investor-profiles") { sendJson(res, 200, await InvestorHandler.listInvestorProfiles(ctx, query)); return; }
    if (method === "POST" && pathname === "/v1/relations/investor-profiles") { sendJson(res, 201, await InvestorHandler.createInvestorProfile(ctx, body)); return; }

    const investorStageMatch = matchPath(pathname, "/v1/relations/investor-profiles/{id}/stage");
    if (method === "PATCH" && investorStageMatch) { sendJson(res, 200, await InvestorHandler.updateInvestorStage(ctx, investorStageMatch["id"]!, body)); return; }

    const investorMatch = matchPath(pathname, "/v1/relations/investor-profiles/{id}");
    if (investorMatch) {
      if (method === "GET")    { sendJson(res, 200, await InvestorHandler.getInvestorProfile(ctx, investorMatch["id"]!)); return; }
      if (method === "PATCH")  { sendJson(res, 200, await InvestorHandler.updateInvestorProfile(ctx, investorMatch["id"]!, body)); return; }
      if (method === "DELETE") { await InvestorHandler.deleteInvestorProfile(ctx, investorMatch["id"]!); sendJson(res, 204, null); return; }
    }

    // -----------------------------------------------------------------------
    // § Member Profile routes
    // -----------------------------------------------------------------------

    if (method === "GET"  && pathname === "/v1/relations/member-profiles") { sendJson(res, 200, await MemberHandler.listMemberProfiles(ctx, query)); return; }
    if (method === "POST" && pathname === "/v1/relations/member-profiles") { sendJson(res, 201, await MemberHandler.createMemberProfile(ctx, body)); return; }

    const memberStageMatch = matchPath(pathname, "/v1/relations/member-profiles/{id}/stage");
    if (method === "PATCH" && memberStageMatch) { sendJson(res, 200, await MemberHandler.updateMemberStage(ctx, memberStageMatch["id"]!, body)); return; }

    const memberMatch = matchPath(pathname, "/v1/relations/member-profiles/{id}");
    if (memberMatch) {
      if (method === "GET")    { sendJson(res, 200, await MemberHandler.getMemberProfile(ctx, memberMatch["id"]!)); return; }
      if (method === "PATCH")  { sendJson(res, 200, await MemberHandler.updateMemberProfile(ctx, memberMatch["id"]!, body)); return; }
      if (method === "DELETE") { await MemberHandler.deleteMemberProfile(ctx, memberMatch["id"]!); sendJson(res, 204, null); return; }
    }

    // -----------------------------------------------------------------------
    // § Candidate Profile routes
    // -----------------------------------------------------------------------

    if (method === "GET"  && pathname === "/v1/relations/candidate-profiles") { sendJson(res, 200, await CandidateHandler.listCandidateProfiles(ctx, query)); return; }
    if (method === "POST" && pathname === "/v1/relations/candidate-profiles") { sendJson(res, 201, await CandidateHandler.createCandidateProfile(ctx, body)); return; }

    const candidateStageMatch = matchPath(pathname, "/v1/relations/candidate-profiles/{id}/stage");
    if (method === "PATCH" && candidateStageMatch) { sendJson(res, 200, await CandidateHandler.updateCandidateStage(ctx, candidateStageMatch["id"]!, body)); return; }

    const candidateMatch = matchPath(pathname, "/v1/relations/candidate-profiles/{id}");
    if (candidateMatch) {
      if (method === "GET")    { sendJson(res, 200, await CandidateHandler.getCandidateProfile(ctx, candidateMatch["id"]!)); return; }
      if (method === "PATCH")  { sendJson(res, 200, await CandidateHandler.updateCandidateProfile(ctx, candidateMatch["id"]!, body)); return; }
      if (method === "DELETE") { await CandidateHandler.deleteCandidateProfile(ctx, candidateMatch["id"]!); sendJson(res, 204, null); return; }
    }

    // -----------------------------------------------------------------------
    // § Employee Profile routes (detail-only at v0.2)
    // -----------------------------------------------------------------------

    if (method === "POST" && pathname === "/v1/relations/employee-profiles") { sendJson(res, 201, await EmployeeHandler.createEmployeeProfile(ctx, body)); return; }

    const employeeMatch = matchPath(pathname, "/v1/relations/employee-profiles/{id}");
    if (employeeMatch) {
      if (method === "GET")    { sendJson(res, 200, await EmployeeHandler.getEmployeeProfile(ctx, employeeMatch["id"]!)); return; }
      if (method === "PATCH")  { sendJson(res, 200, await EmployeeHandler.updateEmployeeProfile(ctx, employeeMatch["id"]!, body)); return; }
      if (method === "DELETE") { await EmployeeHandler.deleteEmployeeProfile(ctx, employeeMatch["id"]!); sendJson(res, 204, null); return; }
    }

    // -----------------------------------------------------------------------
    // § Saved Filter routes
    // -----------------------------------------------------------------------

    if (method === "GET"  && pathname === "/v1/relations/saved-filters") { sendJson(res, 200, await SavedFilterHandler.listSavedFilters(ctx)); return; }
    if (method === "POST" && pathname === "/v1/relations/saved-filters") { sendJson(res, 201, await SavedFilterHandler.createSavedFilter(ctx, body)); return; }

    const savedFilterPinMatch = matchPath(pathname, "/v1/relations/saved-filters/{id}/pin");
    if (savedFilterPinMatch) {
      if (method === "PATCH")  { sendJson(res, 200, await SavedFilterHandler.pinSavedFilter(ctx, savedFilterPinMatch["id"]!, body)); return; }
      if (method === "DELETE") { sendJson(res, 200, await SavedFilterHandler.unpinSavedFilter(ctx, savedFilterPinMatch["id"]!)); return; }
    }

    const savedFilterMatch = matchPath(pathname, "/v1/relations/saved-filters/{id}");
    if (savedFilterMatch) {
      if (method === "GET")    { sendJson(res, 200, await SavedFilterHandler.getSavedFilter(ctx, savedFilterMatch["id"]!)); return; }
      if (method === "PATCH")  { sendJson(res, 200, await SavedFilterHandler.updateSavedFilter(ctx, savedFilterMatch["id"]!, body)); return; }
      if (method === "DELETE") { await SavedFilterHandler.deleteSavedFilter(ctx, savedFilterMatch["id"]!); sendJson(res, 204, null); return; }
    }

    // -----------------------------------------------------------------------
    // § 404 fallthrough
    // -----------------------------------------------------------------------
    sendJson(res, 404, { error: "NotFound", message: `${method} ${pathname} is not a Relations v0.2 endpoint` });

  } catch (err) {
    if (err instanceof UnauthorizedError) {
      sendJson(res, 401, { error: "Unauthorized", message: err.message });
    } else if (err instanceof ForbiddenError) {
      sendJson(res, 403, { error: "Forbidden", message: err.message });
    } else if (err instanceof NotFoundError) {
      sendJson(res, 404, { error: "NotFound", message: err.message });
    } else if (err instanceof ValidationError) {
      sendJson(res, 422, { error: "ValidationError", message: err.message });
    } else {
      console.error("[relations] Unhandled error:", err);
      sendJson(res, 500, { error: "InternalError", message: "An unexpected error occurred" });
    }
  }
}

// ---------------------------------------------------------------------------
// § Utilities
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new ValidationError("Request body is not valid JSON")); }
    });
    req.on("error", reject);
  });
}

/**
 * Match a URL path against a template with {param} placeholders.
 * Returns null if no match; returns param map on match.
 *
 * Example: matchPath("/v1/relations/pro-profiles/abc-123", "/v1/relations/pro-profiles/{id}")
 *   → { id: "abc-123" }
 */
function matchPath(
  pathname: string,
  template: string
): Record<string, string> | null {
  const templateParts = template.split("/");
  const pathParts = pathname.split("/");

  if (templateParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < templateParts.length; i++) {
    const tp = templateParts[i]!;
    const pp = pathParts[i]!;
    if (tp.startsWith("{") && tp.endsWith("}")) {
      params[tp.slice(1, -1)] = pp;
    } else if (tp !== pp) {
      return null;
    }
  }

  return params;
}
