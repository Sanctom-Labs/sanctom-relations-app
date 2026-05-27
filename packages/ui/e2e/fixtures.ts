import { test as base, expect } from "@playwright/test";
import type { IdentityClass, RelationsContext } from "../src/types/index.js";

/**
 * Relations v0.2 E2E Test Fixtures
 *
 * Provides pre-authenticated contexts for testing each identity class.
 * Handles sessionStorage setup + splash screen bypass.
 */

const SESSION_STORAGE_KEY = "relations_context";

interface AuthenticatedPageFixture {
  page: any; // Playwright Page
  context: RelationsContext;
  identityClass: IdentityClass;
}

/**
 * Create a test context for a given identity class.
 * Sets sessionStorage so splash screen is skipped.
 */
function createContext(identityClass: IdentityClass): RelationsContext {
  const contexts: Record<IdentityClass, RelationsContext> = {
    staff: {
      userId: "test-staff-001",
      tenantId: "tenant-001",
      identityClass: "staff",
      displayName: "Test Staff User",
    },
    pro: {
      userId: "test-pro-001",
      tenantId: "tenant-001",
      identityClass: "pro",
      displayName: "Test Pro User",
    },
    personal: {
      userId: "test-personal-001",
      tenantId: "tenant-001",
      identityClass: "personal",
      displayName: "Test Personal User",
    },
  };

  return contexts[identityClass];
}

/**
 * Fixture: authenticatedPage
 * Navigates to the app with a pre-set identity class in sessionStorage.
 * Splash screen is skipped; user lands on home (/investors).
 */
const authenticatedPage = async (
  { page },
  use: (page: AuthenticatedPageFixture) => Promise<void>,
  testInfo: any
) => {
  // Extract identity class from test title or use default "staff"
  const identityClass: IdentityClass = testInfo.title.includes("[pro]")
    ? "pro"
    : testInfo.title.includes("[personal]")
      ? "personal"
      : "staff";

  const ctx = createContext(identityClass);

  // Set sessionStorage before navigating
  await page.addInitScript((key: string, data: string) => {
    sessionStorage.setItem(key, data);
  }, SESSION_STORAGE_KEY, JSON.stringify(ctx));

  // Navigate to home
  await page.goto("/");

  // Wait for the app to load (heading or main content should be visible)
  await page.waitForSelector('[data-testid="shell-main"]', { timeout: 5000 }).catch(() => {
    // Fallback: wait for any main navigation element
    return page.waitForLoadState("networkidle");
  });

  // Provide the authenticated page + context to the test
  await use({ page, context: ctx, identityClass });

  // Cleanup (optional; Playwright handles browser cleanup)
};

/**
 * Extend the base test with authentication fixtures.
 * Usage:
 *
 *   import { test, expect } from "./fixtures.js";
 *
 *   test("Investor Kanban loads with stages", async ({ page, context }) => {
 *     // page is already at http://localhost:5733/ with auth context set
 *     // ...
 *   });
 */
export const test = base.extend<AuthenticatedPageFixture>({
  authenticatedPage,
});

export { expect };
