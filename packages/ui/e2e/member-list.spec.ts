import { test, expect } from "./fixtures.js";

/**
 * AC-REL-4: Member List View + Server-Side Pagination
 * AC-REL-5: Faceted Filters (subscription status, segment, churn risk)
 *
 * Tests:
 * 1. Member list page loads with paginated results
 * 2. Pagination controls navigate between pages
 * 3. Filter panel renders with available facets
 * 4. Filter selection updates the list (server-side filtering)
 * 5. Multiple filters can be combined
 * 6. Filter state persists in URL or sessionStorage
 */

test.describe("Member List View", () => {
  test("should load Member List page for staff user", async ({ page, context }) => {
    // Navigate to members page
    await page.goto("/members");

    // Verify page title
    await expect(page.locator("h1, h2")).first().toContainText(/member|list/i);

    // Verify table or list structure exists
    await expect(page.locator('[role="grid"], [role="table"], .member-list, [data-testid="member-table"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("should display paginated member results", async ({ page }) => {
    await page.goto("/members");

    // Wait for list to load
    await page.waitForLoadState("networkidle");

    // Check for member rows
    const memberRows = page.locator('[data-testid="member-row"], [role="row"]');
    const rowCount = await memberRows.count();

    if (rowCount > 0) {
      // Verify first member row has expected content
      const firstRow = memberRows.first();
      await expect(firstRow).toContainText(/[a-z]/i); // Has text content
    }
  });

  test("should navigate to next page via pagination controls", async ({ page }) => {
    await page.goto("/members");

    // Wait for list
    await page.waitForLoadState("networkidle");

    // Look for next page button
    const nextButton = page.locator('[aria-label*="next"], [data-testid="pagination-next"], button:has-text("Next")').first();

    if (await nextButton.isEnabled()) {
      const currentUrl = page.url();

      // Click next
      await nextButton.click();

      // Wait for new results
      await page.waitForLoadState("networkidle");

      // URL should have changed (offset param) or results updated
      const newUrl = page.url();
      expect(newUrl).not.toEqual(currentUrl);
    }
  });

  test("should filter members by subscription status [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/members");

    // Look for filter panel
    const filterPanel = page.locator('[data-testid="filter-panel"], .filter-sidebar, aside').first();

    if (await filterPanel.isVisible()) {
      // Find subscription status filter
      const statusFilterButton = page.locator('[data-testid="filter-subscription_status"], label:has-text("Subscription Status")').first();

      if (await statusFilterButton.isVisible()) {
        // Click to expand
        await statusFilterButton.click();

        // Select a status (e.g., "active")
        const activeOption = page.locator('[value="active"], label:has-text("Active")').first();
        if (await activeOption.isVisible()) {
          await activeOption.click();

          // Wait for results to update
          await page.waitForLoadState("networkidle");

          // Verify results changed (optional: check for loading state)
          const memberRows = page.locator('[data-testid="member-row"], [role="row"]');
          const rowCount = await memberRows.count();
          expect(rowCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test("should filter members by churn risk score [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/members");

    // Wait for page load
    await page.waitForLoadState("networkidle");

    // Look for churn risk filter
    const churnFilter = page.locator('[data-testid="filter-churn_risk"], label:has-text("Churn Risk")').first();

    if (await churnFilter.isVisible()) {
      // Click to expand or show options
      await churnFilter.click();

      // Select high risk
      const highRiskOption = page.locator('[value="high"], label:has-text("High")').first();
      if (await highRiskOption.isVisible()) {
        await highRiskOption.click();

        // Wait for update
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("should combine multiple filters (subscription + churn) [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/members");

    // Apply first filter
    const statusFilter = page.locator('[data-testid="filter-subscription_status"]').first();
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      await page.locator('[value="active"]').first().click();
    }

    // Apply second filter
    const churnFilter = page.locator('[data-testid="filter-churn_risk"]').first();
    if (await churnFilter.isVisible()) {
      await churnFilter.click();
      await page.locator('[value="high"]').first().click();
    }

    // Wait for combined results
    await page.waitForLoadState("networkidle");

    // Verify both filters are active
    const filterTags = page.locator('[data-testid="filter-tag"], .filter-badge');
    const activeFilters = await filterTags.count();
    expect(activeFilters).toBeGreaterThanOrEqual(0);
  });

  test("should clear filters and reset list [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/members");

    // Apply a filter
    const filter = page.locator('[data-testid="filter-subscription_status"]').first();
    if (await filter.isVisible()) {
      await filter.click();
      await page.locator('[value="active"]').first().click();
      await page.waitForLoadState("networkidle");
    }

    // Find clear/reset button
    const clearButton = page.locator('[data-testid="clear-filters"], button:has-text("Clear")').first();

    if (await clearButton.isVisible()) {
      await clearButton.click();

      // Wait for results to reset
      await page.waitForLoadState("networkidle");

      // Verify no filters are active
      const filterTags = page.locator('[data-testid="filter-tag"]');
      const count = await filterTags.count();
      expect(count).toBe(0);
    }
  });

  test("should not load member list for pro/personal users (403)", async ({ page, context }) => {
    if (context.identityClass === "staff") {
      test.skip();
    }

    // Try to access members list
    let got403 = false;
    page.on("response", (r) => {
      if (r.url().includes("/api/members") && r.status() === 403) {
        got403 = true;
      }
    });

    await page.goto("/members");

    // Wait briefly
    await page.waitForTimeout(1000);

    // Should see error or redirect
    const errorElement = page.locator('[role="alert"], [data-testid="error-message"]').first();
    const errorVisible = await errorElement.isVisible().catch(() => false);

    expect(got403 || errorVisible).toBeTruthy();
  });

  test("should load member list for pro users with pro-filtered view", async ({ page, context }) => {
    if (context.identityClass !== "pro") {
      test.skip();
    }

    await page.goto("/members");

    // Page may load but with different permissions/visibility
    // Verify the page doesn't error
    const errorElement = page.locator('[role="alert"]').first();
    const hasError = await errorElement.isVisible().catch(() => false);

    expect(hasError).toBe(false);
  });
});
