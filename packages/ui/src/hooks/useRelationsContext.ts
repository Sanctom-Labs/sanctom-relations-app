import { createContext, useContext } from "react";
import type { RelationsContext } from "../types/index.js";

// The current user's Relations context (identity class, user ID, tenant).
// Set on the IdentityClassChooser splash screen; persisted to sessionStorage.
// All API calls inject these as X-Dev-* headers for the backend middleware.

export const SESSION_STORAGE_KEY = "relations_context";

export const RelationsCtx = createContext<RelationsContext | null>(null);

export function useRelationsContext(): RelationsContext {
  const ctx = useContext(RelationsCtx);
  if (!ctx) throw new Error("useRelationsContext must be used inside RelationsProvider");
  return ctx;
}

export function saveContext(ctx: RelationsContext): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(ctx));
}

export function loadContext(): RelationsContext | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RelationsContext;
  } catch {
    return null;
  }
}

export function clearContext(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// Helper: build RequestOptions for api/* calls from a context
export function ctxToOpts(ctx: RelationsContext) {
  return {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    identityClass: ctx.identityClass,
  };
}
