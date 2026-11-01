# KrishiBazar AI v2 — Setup Guide (GitHub Pages + Google Sheets)

Hosting: **GitHub Pages only**. Database: **Google Sheets** via a Google Apps Script web app.
No Vercel, Netlify, Supabase or any other service is used.

```
Browser ──▶ GitHub Pages (static React app)
   │
   └──POST (HTTPS)──▶ Google Apps Script web app ──▶ Google Sheets (private)
                      (login, permissions, validation)
```

GitHub Pages can only serve static files, so the Apps Script web app *is* the backend.
The spreadsheet is never public; only the script can read it.

You need: a Google account, a GitHub account, Node.js 20+.

---

## Part 1 — Google Sheet + backend (≈10 min)

1. Go to https://sheets.google.com → **Blank** → name it `KrishiBazar AI Database`.
   Keep it **private** (do not share it).
2. **Extensions → Apps Script**. Delete the default code and paste the entire contents of
   `google-apps-script/Code.gs`. Save (💾).
3. In the function dropdown choose **`setupSheets`** → **Run**. Approve the permission prompt
   (Advanced → Go to project → Allow). The script asks for access to **Google Sheets** (the database)
   and **Google Drive** (product photos — it only creates and reads its own folder
   “KrishiBazar Product Images”). Expected result: 10 tabs appear in your spreadsheet
   (Users, Crops, Bookings, HubPoints, Transporters, RetailerOrders, Complaints, FarmerPayments, Categories, Settings)
   and the log says *Setup complete*.
4. **Change the demo passwords now.** The setup creates 5 demo users (see the table below).
   In the Apps Script editor, add a temporary function and run it once per user:
   ```js
   function changePasswords() {
     setUserPassword('admin@test.com',       'a-strong-password-1');
     setUserPassword('farmer@test.com',      'a-strong-password-2');
     setUserPassword('transporter@test.com', 'a-strong-password-3');
     setUserPassword('hub@test.com',         'a-strong-password-4');
     setUserPassword('retailer@test.com',    'a-strong-password-5');
   }
   ```
   Then delete that function. Add real users with `addUser(id, email, name, role, location, password)`.
   Passwords are stored salted + hashed in the `Users` tab, never in plain text.
5. **Deploy → New deployment → ⚙ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (this only makes the URL reachable; every data call still needs a login token)
   - Click **Deploy**, authorise, and copy the **Web app URL** (ends in `/exec`).
6. Sanity check: open the URL in a browser. You should see `{"status":"ok","app":"KrishiBazar AI Backend","version":2}`.

> ⚠️ **Every time you edit `Code.gs`** you must publish it: **Deploy → Manage deployments → ✏ Edit →
> Version: New version → Deploy**. Saving alone does not update the live URL.

| Role | Demo email | Demo password (change it!) |
|---|---|---|
| Farmer | farmer@test.com | farmer123 |
| Transporter | transporter@test.com | transport123 |
| Hub manager | hub@test.com | hubmanager123 |
| Retailer | retailer@test.com | retail123 |
| Admin | admin@test.com | admin123 |

### ⚠️ Empty dropdowns? The two halves must match — check this first
The website (GitHub Pages) and the script (Google Apps Script) are deployed **separately**. If you update only the website,
lists that come from the script — farmers, categories, hubs in the admin forms, the crop list on the farmer’s form — stay **empty**.
Since this version the site detects it and shows a **red banner** on every page (“The backend (Google Apps Script) is out of date”).

**30-second check:** open your `/exec` URL in a browser. You must see `"version":3`. If you see `"version":2` (or the banner is red),
do the steps in the next section. (Editing the script is not enough — you must publish a **New version** of the deployment.)

### Upgrading an existing v2.0 deployment (you already set this up before)
Your data is kept. Do this once:
1. Replace the code in Apps Script with the new `Code.gs`, save.
2. Run **`setupSheets`** again → approve the **new Drive permission** when asked.
   It adds the new columns/tabs (Categories, Settings, hub phone/active, order notes, product categories…) and never deletes anything.
3. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.** (The URL stays the same.)
4. Push the new front-end to GitHub (Part 3/4). Existing products keep working; they have no category until an admin edits them.
5. Open `<your /exec URL>` → it must say `"version":3`; reload the site → the red banner is gone and the dropdowns are filled.

**About transporters:** a farmer can now book only transporters that have a **login account** (otherwise nobody could see the booking).
Old “ghost” transporters from the first setup (Karim Mia, Ali Hossen, Nurul Islam, Salam Mia) are hidden automatically and the script
refuses bookings to them. To add a real transporter: Admin → **Users → Add User → role Transporter** (this also creates their vehicle/capacity).
After a booking the farmer sees who received it, and the transporter’s dashboard refreshes by itself every 45 seconds (or press the refresh icon).

## Part 1b — Product photos (Google Drive)
Photos are shrunk in the browser (≤ 800 px), uploaded **through the script** to a Drive folder that the script creates,
shared as “anyone with the link can view”, and only the link is stored in the sheet. This is why every user can see them.
- If your Google Workspace policy forbids “anyone with the link” sharing, uploads fail. The app then keeps a tiny inline preview
  so adding a product still works, and shows a warning. Ask your Workspace admin to allow link sharing, or use a personal Google account.
- If any photo cannot be loaded, the site shows a bundled placeholder image instead of a broken icon.

## Part 1c — Running the platform from the Admin panel (no code changes)
Log in as an administrator. The **Admin Control Panel** has nine tabs:

| Tab | What you can do |
|---|---|
| Overview | Filters, workflow, tracing table, revenue, charts, complaints |
| Products | Add / edit (price, stock, photos, category) / delete products; list stock straight at a hub |
| Farmers · Retailers | Register, edit profile & contacts, activate/deactivate, reset password, delete |
| Orders | See all orders, mark paid / collected, edit quantity & note (before payment), **cancel** (stock returns) |
| Hub points | Create, edit location/contact/capacity/manager, activate/deactivate, delete |
| Categories | Categories & subcategories (what farmers choose from), rename, activate/deactivate, delete |
| Users | All roles, role changes, activate/deactivate, reset password |
| Settings | Platform name, support contacts, revenue split (must total 100%), maintenance mode, role/permission table |

Safety rules built in: every delete asks for confirmation; a user/hub/category/product that other records depend on
cannot be deleted (deactivate it instead); you cannot deactivate, demote or delete yourself; deactivating a user or changing
their role signs them out immediately; orders are cancelled, never deleted. If you ever lock yourself out, run
`addUser(...)` or `setUserPassword(...)` from the Apps Script editor.

## Part 2 — Run locally (≈5 min)

```bash
npm install
cp .env.example .env.local        # then paste your /exec URL into .env.local
npm run dev                       # http://localhost:5173
```
Without a URL the app runs in **demo mode** with built-in sample data (nothing is saved) and shows
quick-login buttons. With a URL it uses your spreadsheet and requires real logins.

## Part 3 — Put the code on GitHub

```bash
git init
git add .
git commit -m "KrishiBazar AI v2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/krishibazar-ai.git
git push -u origin main
```
`.env`/`.env.local` are git-ignored. Do not commit real secrets (there are none in this project).

## Part 4 — Deploy with GitHub Pages (≈5 min)

1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**
   - Name: `VITE_APPS_SCRIPT_URL`
   - Value: your Apps Script `/exec` URL
3. Push to `main` (or **Actions → Test, Build & Deploy → Run workflow**).
   The pipeline type-checks, lints, runs the tests, builds and publishes.
4. Your site: `https://YOUR_USERNAME.github.io/krishibazar-ai/`
   (a repo named `YOUR_USERNAME.github.io` is served from the root).

If the variable is missing the workflow still deploys, but in demo mode and prints a warning.

## Day-to-day

- Change the app: edit → `git push` → auto-deploy.
- Change `Code.gs`: paste into Apps Script → **new version** deploy (see warning above).
- Add users: run `addUser(...)` in the Apps Script editor.
- Back up data: **File → Make a copy** on the spreadsheet, or download as .xlsx.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach the server" | Wrong/old `/exec` URL, or deployment access isn't *Anyone*. Open the URL — it must return the JSON health message. |
| Changes to Code.gs have no effect | Publish a **new version** of the deployment. |
| "Database is not set up" | Run `setupSheets()` once. |
| "Invalid email or password" for a demo user | You changed it, or typed the wrong one. Reset with `setUserPassword`. |
| "Too many failed attempts" | Account locked for 15 min after 5 wrong passwords. |
| Red banner “backend is out of date”, empty farmer/category lists | Update the script and publish a **New version** (see the section above); `/exec` must show `"version":3`. |
| Transporter doesn’t see a booking | The transporter must be a real user (Users tab, role Transporter) and the farmer must have chosen *that* transporter. Old ghost transporters are no longer offered. |
| “The photo could not be uploaded” warning | Drive permission not granted (re-run `setupSheets` and approve), or Workspace blocks link sharing (see Part 1b). |
| New admin tabs say “needs the Google Sheets backend” | The site was built without `VITE_APPS_SCRIPT_URL` (demo mode). Set the repository variable and redeploy. |
| Admin changes don't show for other users | Open pages refresh themselves every 2 minutes and when the tab regains focus; the “refresh” icon in the header does it at once. |
| Blank page on GitHub Pages | The workflow ran for a different repo name, or Pages source isn't *GitHub Actions*. |
| Slow first load (1–3 s per action) | Normal for Apps Script (cold start). |
