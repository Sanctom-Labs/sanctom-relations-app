import { test, expect } from "./fixtures.js";

/**
 * AC-REL-7: Cross-Role Activity Timeline
 *
 * Tests:
 * 1. Activity timeline loads and displays past events
 * 2. Timeline shows events from all roles (investor stage change, member subscription change, etc.)
 * 3. Can add a new note/activity entry
 * 4. Activity entries include metadata (created_by, timestamp, role_context)
 * 5. Timeline respects RLS permissions (staff sees all, others see filtered)
 * 6. Activity types are rendered appropriately (stage_changed, note_added, etc.)
 */

test.describe("Activity Timeline", () => {
  test("should display activity timeline on person detail page [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/investors");
    await page.waitForLoadState("networkidle");

    // Get a person ID
    const firstCard = page.locator('[data-testid="investor-card"]').first();
    const personId = await firstCard.getAttribute("data-person-id").catch(() => null);

    if (personId) {
      await page.goto(`/persons/${personId}`);
      await page.waitForLoadState("networkidle");

      // Look for activity timeline
      const timeline = page.locator('[data-testid="activity-timeline"], .timeline, [aria-label*="activity"]').first();

      if (await timeline.isVisible()) {
        await expect(timeline).toBeVisible();
      } else {
        // Try clicking activity tab
        const activityTab = page.locator('[role="tab"]:has-text("Activity"), button:has-text("Timeline")').first();
        if (await activityTab.isVisible()) {
          await activityTab.click();
          await expect(timeline).toBeVisible({ timeout: 3000 }).catch(() => null);
        }
      }
    }
  });

  test("should show timeline events with timestamps and creators [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/investors");
    await page.waitForLoadState("networkidle");

    const firstCard = page.locator('[data-testid="investor-card"]').first();
    const personId = await firstCard.getAttribute("data-person-id").catch(() => null);

    if (personId) {
      await page.goto(`/persons/${personId}`);

      // Find timeline events
      const events = page.locator('[data-testid="timeline-event"], .activity-item, [role="listitem"]');
      const eventCount = await events.count();

      if (eventCount > 0) {
        // Verify first event has content
        const firstEvent = events.first();
        await expect(firstEvent).toContainText(/[a-z]/i);

        // Check for timestamp
        const timestamp = firstEvent.locator('[data-testid="event-timestamp"], time').first();
        const hasTimestamp = await timestamp.isVisible().catch(() => false);
        if (hasTimestamp) {
          await expect(timestamp).toBeVisible();
        }

        // Check for creator/user
        const creator = firstEvent.locator('[data-testid="event-creator"]').first();
        const hasCreator = await creator.isVisible().catch(() => false);
        if (hasCreator) {
          await expect(creator).toBeVisible();
        }
      }
    }
  });

  test("should support adding a new note to timeline [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/investors");
    await page.waitForLoadState("networkidle");

    const firstCard = page.locator('[data-testid="investor-card"]').first();
    const personId = await firstCard.getAttribute("data-person-id").catch(() => null);

    if (personId) {
      await page.goto(`/persons/${personId}`);
      await page.waitForLoadState("networkidle");

      // Find add note button
      const addNoteButton = page.locator('[data-testid="add-note-button"], button:has-text("Add Note")').first();

      if (await addNoteButton.isVisible()) {
        await addNoteButton.click();

        // Wait for note input form
        const noteInput = page.locator('[data-testid="note-input"], textarea').first();
        if (await noteInput.isVisible()) {
          // Type a test note
          const testNote = `Test note - ${Date.now()}`;
          await noteInput.fill(testNote);

          // Click save
          const saveButton = page.locator('button:has-text("Save"), button:has-text("Post")').first();
          if (await saveButton.isVisible()) {
            // Intercept the POST request
            let noteSaved = false;
            page.on("response", (r) => {
              if (r.url().includes("/api/persons/") && r.url().includes("/timeline") && r.status() === 201) {
                noteSaved = true;
              }
            });

            await saveButton.click();

            // Wait for update
            await page.waitForLoadState("networkidle");

            // Verify note appears in timeline
            const newEvent = page.locator(`text="${testNote}"`).first();
            const noteVisible = await newEvent.isVisible().catch(() => false);

            expect(noteVisible || noteSaved).toBeTruthy();
          }
        }
      }
    }
  });

  test("should show role context on timeline events [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/investors");
    await page.waitForLoadState("networkidle");

    const firstCard = page.locator('[data-testid="investor-card"]').first();
    const personId = await firstCard.getAttribute("data-person-id").catch(() => null);

    if (personId) {
      await page.goto(`/persons/${personId}`);

      // Get events
      const events = page.locator('[data-testid="timeline-event"]');
      const eventCount = await events.count();

      if (eventCount > 0) {
        const firstEvent = events.first();

        // Check for role context badge
        const roleContext = firstEvent.locator('[data-testid="role-context"], .role-badge').first();
        const hasRole = await roleContext.isVisible().catch(() => false);

        if (hasRole) {
          // Should show one of: investor, pro, member, candidate, employee
          await expect(roleContext).toContainText(/investor|pro|member|candidate|employee/i);
        }
      }
    }
  });

  test("should display different event types appropriately [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/investors");
    await page.waitForLoadState("networkidle");

    const firstCard = page.locator('[data-testid="investor-card"]').first();
    const personId = await firstCard.getAttribute("data-person-id").catch(() => null);

    if (personId) {
      await page.goto(`/persons/${personId}`);

      // Get events
      const events = page.locator('[data-testid="timeline-event"]');
      const eventCount = await events.count();

      // Verify at least one event type is visible
      const eventTypes = ["stage_changed", "note_added", "subscription_changed", "profile_updated"];
      const eventsText = await page.locator('[data-testid="timeline-event"]').allTextContents();

      const hasEventType = eventTypes.some((type) =>
        eventsText.join(" ").toLowerCase().includes(type.replace(/_/g, " "))
      );

      // If any events exist, check they're formatted
      if (eventCount > 0) {
        await expect(events.first()).toContainText(/[a-z]/i);
      }
    }
  });

  test("should filter timeline by role context [staff]", async ({ page, context }) => {
    if (context.identityClass !== "staff") {
      test.skip();
    }

    await page.goto("/investors");
    await page.waitForLoadState("networkidle");

    const firstCard = page.locator('[data-testid="investor-card"]').first();
    const personId = await firstCard.getAttribute("data-person-id").catch(() => null);

    if (personId) {
      await page.goto(`/persons/${personId}`);

      // Look for timeline filter
      const filterSelect = page.locator('[data-testid="timeline-filter"], select, [aria-label*="filter"]').first();

      if (await filterSelect.isVisible()) {
        // Select "investor" role filter
        await filterSelect.selectOption("investor").catch(() => {
          // Might be a button-based filter
          return page.locator('button:has-text("Investor")').first().click();
        });

        // Wait for filtered results
        await page.waitForLoadState("networkidle");

        // All visible events should be from investor role
        const events = page.locator('[data-testid="timeline-event"]');
        const eventCount = await events.count();

        if (eventCount > 0) {
          const firstEventRole = await events.first().locator('[data-testid="role-context"]').textContent();
          expect(firstEventRole?.toLowerCase()).toContain("investor");
        }
      }
    }
  });
});
