# KrishiBazar AI (কৃষিবাজার AI) v2

Agricultural supply-chain platform for Bangladesh: farmers → transporters → hubs → retailers → admin,
with a public QR complaint page. React 18 + TypeScript + Tailwind, bilingual (বাংলা / English), installable PWA.

- **Hosting:** GitHub Pages (GitHub Actions)
- **Database:** Google Sheets, accessed only through a Google Apps Script web app
- **Setup:** see [SETUP_GUIDE.md](SETUP_GUIDE.md) · **Tests:** see [TEST_REPORT.md](TEST_REPORT.md) · **Changes from v1 & limits:** see [CHANGES.md](CHANGES.md)

```bash
npm install
npm run dev          # demo mode, or set VITE_APPS_SCRIPT_URL in .env.local
npm run typecheck && npm run lint && npm test
npm run test:e2e     # real-browser end-to-end test (needs Playwright's Chromium)
npm run build
```

## Layout
```
google-apps-script/Code.gs   backend: auth, authorisation, validation, locking, Sheets access
src/lib/domain.ts            pure business rules (status flow, stock, revenue) — unit-tested
src/lib/sheetsApi.ts         API client (timeout, error mapping, session expiry handling)
src/contexts/                Auth, Data (sync + optimistic UI), Language
src/pages/                   one dashboard per role + public complaint page
tests/                       unit + backend-logic tests     e2e/   browser tests
.github/workflows/deploy.yml test → build → GitHub Pages
```
