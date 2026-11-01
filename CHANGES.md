# Changes from v1, feature parity, and known limitations

## 0. Latest update — branding, photos, full Admin Control Panel

1. **Branding:** the “Built with Bolt.new ⚡” badge is gone from every page (footer rebuilt; searched the built site for the word — none left).
2. **Photos visible to everyone — root causes found and fixed**
   - Photos were only rendered on the farmer and retailer pages; hub, transporter and admin never showed them → a shared `ProductImage` is now used everywhere.
   - No load-failure handling → tries the next photo, then a placeholder **bundled with the site** (the old default was a third-party Pexels URL that can be blocked).
   - Photos lived as base64 inside a spreadsheet cell → now uploaded to **Google Drive** through the Apps Script; only the link is stored. Server accepts only our own Drive thumbnail links or tiny inline previews (no arbitrary URLs), checks the file’s real type, and rate-limits uploads.
3. **Admin Control Panel** (9 tabs) with full create / view / edit / delete for products, farmers, retailers, hub points, categories & subcategories, orders (cancel instead of delete), users, and platform settings. Everything is validated twice (browser and server), saved to Sheets, confirmed with a visible success/error message, and destructive actions ask first.
4. **No code changes needed any more** for: crop list (now admin-managed categories), hubs, user accounts/roles, revenue split, platform name/contacts, maintenance mode.
5. **Changes reach other pages automatically:** after an admin save everything is re-read from the sheet; other users’ open pages refresh every 2 minutes and on tab focus (verified in a real browser).
6. Security: sessions now re-check the user’s role/active flag on every request (deactivation or role change is immediate); only whitelisted fields are editable; no self-lockout; dependants block deletion; maintenance mode; reads no longer take the global lock.
8. **Reported from the live site, fixed:**
   - *Empty category/farmer dropdowns* — cause: the deployed Apps Script was older than the website (it doesn’t send `users` / `categories`) and my code silently treated that as “empty list”. Now: a version handshake (`BACKEND_VERSION = 3`, visible at the `/exec` URL), a red banner explaining exactly what to do, a clear hint inside the admin “New product” form, and a built-in crop list for the farmer’s form so adding a crop never becomes impossible.
   - *Booking not visible to the transporter* — cause: farmers could pick any of 5 seeded transporters but only one had a login. Now only transporters with an **active transporter account** are offered; the server refuses anything else; creating/changing a user to Transporter creates the vehicle automatically; the farmer is told who received the booking; transporter and hub dashboards refresh every 45 s.
   - *Pop-up layout* — dialog title and Save/Cancel buttons now stay visible while the form scrolls.
7. Fixed on the way: the farmer’s booking used a hard-coded hub `'1'` (would break once hubs are managed by the admin) → farmer now chooses an active hub.

## 1. What changed (v1 → v2)

| Area | v1 (Bolt export) | v2 |
|---|---|---|
| Data | In-memory only (lost on refresh); unused Supabase `.env` | Google Sheets via Apps Script; persists |
| Auth | 5 hard-coded demo accounts + plain passwords **in the JS bundle** | Server-side login (salted+iterated hash), session tokens, role + ownership checks. Demo accounts exist **only** in local demo mode and are excluded from backend builds (verified) |
| Rules | Computed in the browser, trusted by nobody | Stock, order amounts, collection, payments and status transitions enforced **server-side** under a lock |
| Hub / transporter numbers | Mutable counters that could drift | Derived from crops/orders/bookings, never stored |
| UI feedback | `alert()` everywhere, no validation, no loading/error states | Modals/banners, validation, loading and error states, failed saves re-sync from the server |
| Hosting | Bolt preview | GitHub Pages via GitHub Actions (typecheck → lint → tests → build → deploy), `HashRouter` so deep links/QR codes work on Pages |
| Dependencies | firebase, chart.js, qr-scanner, supabase (all unused in `src/`) | Removed. (Verified by searching the original `src/`.) |
| Types/structure | Types inside contexts, ~3,100 lines of pages | `types/`, `lib/domain.ts` (pure, tested), `lib/sheetsApi.ts`, shared UI kit |

## 2. Bugs found and fixed

- **Retailer "Pay" never moved the order to `pre_paid`**, so "Collect" could never appear (my own first draft — caught by testing).
- Collecting an order decremented `packetsRemaining` a second time; a partly-ordered crop disappeared from the retailer list. Fixed; covered by tests.
- Sheets turns `'3'` into the number `3`, breaking `managerId === user.id`. IDs are normalised to strings server-side; covered by a test.
- Photos stored as base64 exceeded Google Sheets' 50,000-char cell limit. Photos are now shrunk in the browser (max 240 px) and guarded server-side.
- "Time Period" filter in the admin dashboard did nothing in v1; it now filters by crop creation date.
- Dates are ISO strings (v1 used `Date` objects that don't survive serialisation).

## 3. Feature parity with v1

All v1 screens and sections were ported: five role dashboards, the public complaint page, bilingual UI, PWA, QR codes.
I initially dropped several sections by mistake and restored them after auditing the original source:
admin filters / workflow cards / grid-based product tracing / revenue sharing with per-farmer detail / government monitoring /
hub-stock, workflow, price-trend and crop-distribution charts / complaints / system alerts / AI insights;
hub incoming + available + pending-orders sections and overview; transporter route details and route map;
retailer permanent QR card and full crop cards; farmer real-time panel and details modal.

Deliberate differences:
- `alert()` pop-ups became in-page messages/modals.
- The transporter "Route Map" `alert()` is now a modal (the v1 text itself said Google Maps was not integrated).
- Hub manager sees **all** hubs they manage (v1 hard-coded "Dhaka Central Hub" only).
- v1 payment/“AI” features are not real — see §4.

## 4. Things that look like features but are NOT real (inherited from v1)

These were mock-ups in the original and remain mock-ups. Don't present them to real users as working:

| Item | Reality |
|---|---|
| "AI" price prediction and quality score | `Math.random()` when a crop is added — no model, no image analysis |
| AI Market Forecast, Price Trends chart, AI Route Optimization, Traffic Updates, Government-monitoring figures (SDG %, “spoilage reduced 18%”), AI Insights text | Hard-coded sample text/numbers. They are now marked with an amber **“Sample data”** badge in the UI |
| Retailer "Pay" | Records the order as paid. **No payment gateway.** |
| Admin "Pay farmer" | Writes a ledger row (and refuses to exceed what is owed). **No bank/bKash/Nagad transfer.** |
| Google Maps | Not integrated |
| Notifications bell | Cosmetic |

## 5. Security notes and honest limits

Done: no secrets in the repo or bundle; passwords hashed; every action authorised by role and ownership; data scoped per role
(a farmer cannot read other farmers' crops, orders, complaints or payments); input validation; plain-text cell format so
spreadsheet formulas cannot be injected; locking; global rate limit; per-account login lockout; generic error messages.

Limits you should know about:
- **The Apps Script URL is public** (it is in the JS). Protection comes from login + server checks, not secrecy.
- **Rate limiting is global** (240 requests/minute for the whole app, Apps Script cannot see client IPs). A determined abuser can
  exhaust it for everyone; and 5 wrong passwords lock *that account* for 15 min (so someone can lock out a known email).
- **Password hashing is salted SHA-256 × 1000** — Apps Script has no bcrypt/argon2. Use long passwords. Anyone with edit access to the spreadsheet can read the hashes and edit data: keep the sheet private.
- Session token lives in `localStorage` (a stored-XSS bug would expose it). Sessions last 6 h.
- No password-reset or user-management UI: manage users from the Apps Script editor (`addUser`, `setUserPassword`).
- Status fields are last-write-wins between *different* users editing the *same* record; stock, orders, collection and payments are server-authoritative.
- Google Apps Script quotas and speed: ~1–3 s per call, every request reads whole sheets. Fine for hundreds–low thousands of rows; plan a real database beyond that. **No server-side pagination** (not needed at this scale).
- Photos are tiny thumbnails (≈240 px), not production-quality images; use real object storage if you need proper photos.
- **Product photos in Drive:** stored as public-by-link files in one Drive folder (anyone who has a photo’s link can open it). Don’t upload anything sensitive. Google may throttle heavy thumbnail traffic; the placeholder fallback covers that.
- **Auto-refresh is polling** (every 2 min / on focus), not instant push. Two admins editing the same record: last save wins.
- Changing revenue shares recalculates *all* reports, including past orders (they are derived, not frozen).
- Admin tabs are read-only/disabled in local demo mode (they need the real backend).
- Existing products from an older deployment have no category until an admin edits them; their old photos keep displaying (with fallback) and can be edited without being rejected.
- The explicit “last administrator” guard in the script cannot be triggered through the API (self-changes are already blocked and the acting admin is itself active); the guarantee is verified by a randomised invariant test instead.

## 6. Suggested next steps
1. Replace mock "AI" with real data/models or remove it from the UI. 2. Add a real payment/MFS integration. 3. Move to a real database
(Supabase/Postgres) when data grows. 4. Add user management + password reset. 5. Add bundle size work (charts chunk ≈ 400 kB).
