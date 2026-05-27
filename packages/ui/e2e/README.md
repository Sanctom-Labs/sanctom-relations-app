# Relations v0.2 E2E Tests

Playwright end-to-end tests for the Relations v0.2 application.

## Test Coverage (AC-REL-10)

| Spec File | ACs | Coverage |
|-----------|-----|----------|
| `investor-kanban.spec.ts` | AC-REL-3 | Investor Kanban board render + stage drag-and-drop + API persistence |
| `member-list.spec.ts` | AC-REL-4, AC-REL-5 | Member list pagination + faceted filters (subscription status, churn risk) |
| `person-detail.spec.ts` | AC-REL-6 | Cross-role person detail panel, role chips, RLS enforcement |
| `activity-timeline.spec.ts` | AC-REL-7 | Activity timeline render, add note, event types, role filtering |
| `saved-filters.spec.ts` | AC-REL-8 | Global search, saved filter creation/application/deletion, pinning |

## Prerequisites

1. **Node.js 20+**
   ```bash
   node --version
   ```

2. **Dependencies installed**
   ```bash
   npm install
   ```

3. **Both servers running** (in separate terminals):
   ```bash
   # Terminal 1: Backend (port 7330)
   npm run dev --workspace=@sanctom/relations
   
   # Terminal 2: Frontend (port 5733)
   npm run dev --workspace=@sanctom/relations-ui
   ```

   Or use the unified dev command:
   ```bash
   npm run dev
   ```

## Running Tests

### All tests (headless, all browsers)
```bash
npm run test:e2e
```

### UI mode (interactive test runner)
```bash
npm run test:e2e:ui
```

### Debug mode (headed browser, step through)
```bash
npm run test:e2e:debug
```

### Headed browser (see the tests run visually)
```bash
npm run test:e2e:headed
```

### Single test file
```bash
npx playwright test packages/ui/e2e/investor-kanban.spec.ts
```

### Single test case
```bash
npx playwright test -g "should load Investor Pipeline page"
```

### Specific browser
```bash
npx playwright test --project=chromium
```

## Test Fixtures

All tests use the custom `fixtures.ts` which provides:

- **`authenticatedPage`**: Pre-authenticates with sessionStorage context before test runs
- **`context`**: The RelationsContext (userId, tenantId, identityClass)
- **`identityClass`**: Currently selected identity class ("staff", "pro", "personal")

### Auth Contexts

Three test contexts are available (selected by test title):

| Test Title | Identity Class | User ID | Access |
|-----------|----------------|---------|--------|
| Default / [staff] | `staff` | test-staff-001 | Full access to all roles |
| [pro] | `pro` | test-pro-001 | Pro-filtered views |
| [personal] | `personal` | test-personal-001 | Personal/read-only views |

Example test with [pro] context:
```typescript
test("should restrict member list for pro users [pro]", async ({ page, context }) => {
  // context.identityClass === "pro"
  // ...
});
```

## What's Tested

### Investor Kanban (AC-REL-3)
- ✅ Kanban board renders with all pipeline stages (prospect → passed)
- ✅ Investor cards display in correct stages
- ✅ Drag-and-drop stage transitions work
- ✅ API PATCH request made to update investor stage
- ✅ Staff-only access enforcement

### Member List & Filters (AC-REL-4, AC-REL-5)
- ✅ Member list renders with pagination
- ✅ Next/previous page navigation works
- ✅ Subscription status filter available
- ✅ Churn risk score filter available
- ✅ Multiple filters can be combined
- ✅ Clear filters resets list
- ✅ Staff-only access (403 for pro/personal)

### Person Detail (AC-REL-6)
- ✅ Person detail page loads from list
- ✅ Person info displays (name, email, links)
- ✅ Role chips display all roles for person
- ✅ Clicking role chip switches role context
- ✅ Role-specific profile details render
- ✅ Activity timeline accessible
- ✅ RLS prevents unauthorized access

### Activity Timeline (AC-REL-7)
- ✅ Timeline loads and displays events
- ✅ Events show timestamps and creators
- ✅ Can add new note/activity entry
- ✅ Event types rendered (stage_changed, note_added, etc.)
- ✅ Role context shown on events
- ✅ Timeline can be filtered by role
- ✅ Staff-only features gated for pro/personal

### Search & Saved Filters (AC-REL-8)
- ✅ Search bar finds persons by name
- ✅ Search results include role context
- ✅ Can navigate from search to person detail
- ✅ Saved filters created from filter state
- ✅ Saved filters can be applied
- ✅ Filters can be deleted
- ✅ Filters can be pinned/unpinned
- ✅ filter_json structure maintained

## CI/CD Integration

Tests run in CI with a single worker and retries:
```bash
CI=true npm run test:e2e
```

HTML report generated at: `playwright-report/index.html`

## Debugging Failed Tests

1. **View the HTML report** (after test run):
   ```bash
   npx playwright show-report
   ```

2. **Check screenshots/videos** (on failure):
   - Default location: `test-results/`
   - Shows browser state at failure moment

3. **Run with tracing enabled** (captures full interaction):
   ```bash
   npx playwright test --trace on
   ```

4. **Inspect network requests**:
   - Check `page.on("response")` listeners in tests
   - Verify API URLs and headers in browser DevTools

## Extending Tests

To add a new test:

1. Create new `.spec.ts` file in `packages/ui/e2e/`
2. Import fixtures:
   ```typescript
   import { test, expect } from "./fixtures.js";
   ```
3. Use authenticated page + context:
   ```typescript
   test("my test [staff]", async ({ page, context }) => {
     // page is already at http://localhost:5733/ with auth set
     // context.identityClass === "staff"
   });
   ```
4. Run test:
   ```bash
   npx playwright test packages/ui/e2e/my-test.spec.ts
   ```

## RLS & Access Control Tests

Tests verify Row-Level Security (RLS) policies:

- **Staff users** (`identity_class='staff'`): Full access to all roles and profiles
- **Pro users** (`identity_class='pro'`): Limited to pro-related views; 403 on restricted endpoints
- **Personal users** (`identity_class='personal'`): Read-only; 403 on write/restricted endpoints

Each test file includes identity-class-specific tests:
```typescript
test("my restricted feature [staff]", async ({ page, context }) => {
  if (context.identityClass !== "staff") test.skip();
  // ...
});
```

## Troubleshooting

### Tests timeout
- Ensure both servers are running and accessible
- Check `baseURL` in `playwright.config.ts` (should be http://localhost:5733)
- Increase timeout in test: `{ timeout: 10000 }`

### Navigation fails
- Verify Vite proxy is working (`/api/*` → http://localhost:7330)
- Check backend is running on port 7330
- Look for CORS errors in browser console

### Selectors not found
- Use `--debug` mode to step through and inspect DOM
- Verify `data-testid` attributes exist in React components
- Check for dynamic class names (dnd-kit may use generated classes)

### Drag-and-drop fails
- dnd-kit tests may require special handling
- Use `--debug` mode to verify drop target is reachable
- Check for z-index or visibility issues in CSS

## Performance & Parallelism

- Tests run in parallel by default (workers = CPU count)
- In CI: single worker to avoid port conflicts
- Each browser type (chromium, firefox, webkit) runs independently

To adjust:
```bash
# Run with specific worker count
npx playwright test --workers=1

# Run specific browsers only
npx playwright test --project=chromium
```

## References

- [Playwright Testing Guide](https://playwright.dev/docs/intro)
- [Relations v0.2 Spec](../../Specs/Relations-Functional-Spec-v0.2.md)
- [AC-REL-10 Coverage](../../Specs/Relations-Functional-Spec-v0.2.md#ac-rel-10-quinn-qa-gates)
