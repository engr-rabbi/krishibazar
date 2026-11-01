# Test report

Run on the final code. Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`.

| Check | Result |
|---|---|
| TypeScript (`tsc -b`, strict) | ✅ no errors |
| ESLint | ✅ no errors |
| Unit + backend-logic tests (Vitest) | ✅ **110 / 110** (6 files) |
| End-to-end, real Chromium — role workflows (`e2e/flow.mjs`) | ✅ **21 / 21** |
| End-to-end, real Chromium — admin console, photos, propagation (`e2e/admin.mjs`) | ✅ **23 / 23** |
| End-to-end, real Chromium — reported-problem regressions (`e2e/regressions.mjs`) | ✅ **10 / 10** (run twice; stable) |
| Demo-mode smoke test (5 roles log in, no JS errors) | ✅ 5 / 5 |
| Built site contains no demo passwords / no “Bolt” branding / no third-party image host | ✅ (grep of `dist/`; the letters “bolt” appear only inside library names such as `symbolTotalCodewords`) |
| Base path: project repo `/<repo>/` and `<user>.github.io` `/` | ✅ both verified |

## What the tests cover

**`tests/appsscript.test.ts` (30) and `tests/admin.test.ts` (40)** run the *real* `Code.gs` in a Node VM against in-memory mocks of
SpreadsheetApp / CacheService / LockService / Utilities / DriveApp.
- Auth: login, lockout, expiry, logout, password change; **deactivation and role changes kill open sessions immediately**; maintenance mode.
- **Admin access control:** every admin operation is refused for each non-admin role and for anonymous callers; only admins receive the user list; password hashes never leave the server.
- Users: create (email normalised), validation, duplicate email, transporter gets a bookable vehicle row, edit + name cascade to products/hubs/orders, reset password, delete guards (data still owned → refuse), no self-lockout, **randomised invariant: ≥ 1 active admin after 150 random admin operations**.
- Hub points: create/edit/deactivate/delete, duplicate name, manager must be a Hub-manager user, capacity ≥ current stock, inactive hub rejects bookings, delete refused while in use.
- Categories: two-level tree, duplicates, rename cascades to products/orders, in-use delete refused, farmers limited to active categories, product `type` derived server-side.
- Products (admin): create for a farmer (optionally listed directly at a hub), validation, edit price/weight/stock (cannot go below packets already ordered), forbidden fields, delete blocked by live orders and cleaning up afterwards.
- Orders (admin/retailer): cancel returns stock and re-opens the product, no double-cancel, collected orders can’t be cancelled, quantity edit before payment only with unit price preserved, notes admin-only, retailer may cancel only their own.
- Settings: validation, shares must total 100, public to all roles, payment limit follows the configured farmer share.
- Photos: Drive upload (shared by link, correct MIME), rejects non-images / SVG / disguised files / oversize / anonymous / wrong role, per-hour limit, clear error when Drive refuses, **only allow-listed image URLs can be stored**, every role that can see a product receives its images, legacy photos remain editable.
- Upgrade path: re-running `setupSheets` on an old layout adds columns without touching data; works before setup is re-run.
- *Mutation checks:* breaking the admin check, the image allow-list, the cancel→stock return and session re-validation each made tests fail (the “last-admin” guard is unreachable via the API, so it is covered by the invariant test instead).

**Reported-problem regressions (`tests/admin.test.ts` + `e2e/regressions.mjs`)** — a real browser against a backend made to answer like the *old* script:
red banner with the fix steps; admin “New product” form explains why farmer/category lists are empty and keeps Save/Cancel on screen; admin actions show a helpful message
instead of “Unknown action.”; the farmer still gets a usable crop list; with a current backend there is no banner and categories → subcategories (Potato, Tomato, Onion, Carrot, Eggplant, Cucumber, Rice) are listed;
ghost transporters are never offered and are refused by the server (mutation-tested); a newly registered transporter is offered, receives the farmer’s booking and sees it;
a transporter with the dashboard already open receives a new booking **without reloading** (fake clock: not at 30 s, yes at 50 s).

**`tests/productImage.test.tsx` (4)** — photo → next photo → bundled placeholder fallback, no infinite loop, empty list, referrer policy.
**`tests/domain.test.ts` (18), `utils.test.ts` (5), `sheetsApi.test.ts` (6)** — business rules, cancellation, configurable shares, API client behaviour.

**`e2e/flow.mjs` (21)** — the original full supply chain through the UI + security checks.
**`e2e/admin.mjs` (23)** — in a real browser, against the real backend logic:
all nine tabs; non-admins can’t see the console and the server refuses their admin calls; category create/duplicate/empty-name; farmer registration with inline validation, duplicate email, immediate login; profile edit; **deactivate asks first and kills the open session**; password reset; delete asks first and *Cancel really cancels*; no self-delete buttons; hub create/edit/deactivate/delete; hub-in-use refusal; **product creation with a real file upload → Drive URL saved on the product**; photo-less product shows the fallback; **photo visible to admin, farmer, hub manager, retailer and transporter**; dead image URL → placeholder; price/stock edit reaches the retailer’s page; **already-open pages update by themselves (no reload)**; order edit + cancel returns stock; product delete refused with a reason then allowed; settings validation, new platform name shown to other roles; maintenance mode lock/unlock; no uncaught JS errors in any session.

## What was NOT verified (please read)

- ❌ **A real Google Apps Script deployment, real Google Drive and real Google Sheets.** They are mocked faithfully but are still mocks.
  Only a real run can confirm: the Drive permission prompt, that “anyone with the link” sharing is allowed on your account/domain,
  that `drive.google.com/thumbnail?id=…` loads for all users and isn’t throttled, real CORS from `github.io`, latency, quotas, real Sheets cell coercion.
  In the browser test, Drive’s image responses are simulated with Playwright routing.
- ❌ A real GitHub push / Actions run / Pages deployment (workflow reviewed, build run with the same env vars).
- ❌ Real phones, Safari/Firefox, PWA install/offline (only desktop Chromium).
- ❌ Concurrency with many simultaneous users or two admins editing the same record.
- Photo upload from a *camera/phone*: only a small JPEG file input was exercised.

## 10-minute checklist after you deploy
1. Open `<your /exec URL>` → `{"status":"ok",…}`; upgrade steps from SETUP_GUIDE.md done (re-ran `setupSheets`, approved Drive, **new version** deployed).
2. Log in as admin → **Products → Add product**, attach a phone photo → open the Drive folder “KrishiBazar Product Images”: the file is there.
3. Open the site on **another phone / private window as retailer and farmer** → the photo shows. Turn Wi-Fi off for a moment and reload: the placeholder shows, not a broken icon.
4. Add a farmer, a hub and a category; log in as the new farmer and add a product using the new category.
5. Settings → change the platform name → another user sees it within ~2 minutes (or after the refresh icon).
6. Deactivate a test user while they are logged in → their next click returns them to login.
