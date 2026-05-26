// ── Relations API client ─────────────────────────────────────────────────────
// All calls go to /api/* which Vite proxies to http://localhost:7330 in dev.
// The dev-auth headers (X-Dev-User-Id, X-Dev-Tenant-Id, X-Dev-Identity-Class)
// are injected per-request from the context stored in sessionStorage.

const API_BASE = "/api";

export interface RequestOptions {
  userId?: string;
  tenantId?: string;
  identityClass?: string;
  signal?: AbortSignal;
}

function devHeaders(opts: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.userId) headers["X-Dev-User-Id"] = opts.userId;
  if (opts.tenantId) headers["X-Dev-Tenant-Id"] = opts.tenantId;
  if (opts.identityClass) headers["X-Dev-Identity-Class"] = opts.identityClass;
  return headers;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  opts: RequestOptions = {}
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== "") {
        url.searchParams.set(key, String(val));
      }
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: devHeaders(opts),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: devHeaders(opts),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: devHeaders(opts),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function apiDelete<T>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: devHeaders(opts),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
