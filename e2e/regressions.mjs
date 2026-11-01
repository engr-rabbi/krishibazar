// Reproduces the two problems reported from the live site and proves they are handled.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173/krishibazar-ai/';
const API = 'http://localhost:8787';
const results = []; let failed = 0;
const allSessions = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) {
    failed++; results.push(['FAIL', `${name} → ${String(e.message).split('\n')[0]}`]);
    if (process.env.E2E_DEBUG) for (const s of allSessions.slice(-2)) console.log('  [page text]', JSON.stringify((await s.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500)));
  }
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function login(email, password, { oldBackend = false, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  if (clock) await ctx.clock.install();
  if (oldBackend) {
    // Make the real backend look like v2.0: GET_ALL has no users / categories / settings / meta
    await ctx.route(API, async route => {
      const req = route.request();
      if (req.method() !== 'POST' || !(req.postData() ?? '').includes('"GET_ALL"')) return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      if (json.data) { delete json.data.users; delete json.data.categories; delete json.data.settings; delete json.data.meta; }
      await route.fulfill({ response: res, json });
    });
  }
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /লগইন করুন|Login/ }).click();
  await page.waitForFunction(() => !!localStorage.getItem('kb_token'), null, { timeout: 10000 });
  const sess = { ctx, page, errors }; allSessions.push(sess);
  return sess;
}
const english = async page => {
  await page.getByRole('button', { name: /^(English|বাংলা)$/ }).first().waitFor({ timeout: 15000 });   // header has rendered
  const b = page.getByRole('button', { name: 'English' }).first();
  if (await b.count()) await b.click();
};
const api = (page, body) => page.evaluate(async ({ url, body }) => {
  const token = localStorage.getItem('kb_token');
  return (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token, ...body }) })).json();
}, { url: API, body });
const modal = p => p.locator('div.fixed');

// ───────── Problem 1: empty dropdowns when the Apps Script is older than the site ─────────
const oldAdmin = await login('admin@test.com', 'admin123', { oldBackend: true });
await step('OLD backend: admin sees a clear red banner telling them exactly how to fix it', async () => {
  await oldAdmin.page.getByTestId('backend-outdated').waitFor({ timeout: 10000 });
  await oldAdmin.page.getByTestId('backend-outdated').getByText(/New version/).waitFor();
});
await step('OLD backend: the admin “New product” form explains WHY the farmer/category lists are empty', async () => {
  const p = oldAdmin.page; await english(p);
  await p.getByTestId('tab-products').click();
  await p.getByRole('button', { name: /Add product/ }).click();
  await p.getByTestId('no-farmers-hint').getByText(/out of date/).waitFor({ timeout: 5000 });
  await p.getByTestId('no-categories-hint').getByText(/out of date/).waitFor({ timeout: 5000 });
  // header and Save/Cancel stay visible without scrolling the dialog
  const box = await modal(p).getByRole('button', { name: /^Save$/ }).boundingBox();
  const vh = p.viewportSize().height;
  if (!box || box.y + box.height > vh) throw new Error('Save button is outside the viewport');
  await modal(p).getByRole('button', { name: /^Cancel$/ }).click();
});
await step('OLD backend: admin-only actions fail with a helpful message instead of “Unknown action.”', async () => {
  const p = oldAdmin.page;
  // simulate the old script's answer to an unknown action
  await p.route(API, async r => (r.request().postData() ?? '').includes('"ADMIN"') ? r.fulfill({ json: { success: false, code: 'BAD_REQUEST', error: 'Unknown action.' } }) : r.fallback());
  await p.getByTestId('tab-categories').click();
  await p.getByRole('button', { name: /Add category/ }).click();
  await modal(p).getByRole('textbox').nth(0).fill('Spices');
  await modal(p).getByRole('button', { name: /^Save$/ }).click();
  await modal(p).getByRole('alert').getByText(/older than this website/).waitFor({ timeout: 8000 });
});

const oldFarmer = await login('farmer@test.com', 'farmer123', { oldBackend: true });
await step('OLD backend: the farmer still gets a usable crop list (built-in fallback) instead of an empty dropdown', async () => {
  const p = oldFarmer.page; await english(p);
  await p.getByTestId('backend-outdated').waitFor({ timeout: 10000 });
  await p.getByRole('button', { name: /Add Crop/ }).first().click();
  const options = await modal(p).locator('select').first().locator('option').allTextContents();
  for (const crop of ['Potato', 'Tomato', 'Rice', 'Onion', 'Carrot', 'Eggplant', 'Cucumber']) {
    if (!options.some(o => o.includes(crop))) throw new Error(`missing ${crop} in ${JSON.stringify(options)}`);
  }
  await modal(p).getByRole('button', { name: /^Add Crop$/ }).click();
  await modal(p).getByText(/Please choose a crop/).waitFor();
});

const upToDate = await login('farmer@test.com', 'farmer123');
await step('UP-TO-DATE backend: no banner, and the category list is populated from the sheet', async () => {
  const p = upToDate.page; await english(p);
  await p.getByRole('button', { name: /Add Crop/ }).first().click();
  const options = await modal(p).locator('select').first().locator('option').allTextContents();
  if (!options.some(o => /Vegetables/.test(o)) || !options.some(o => /Grains/.test(o))) throw new Error(JSON.stringify(options));
  if (await p.getByTestId('backend-outdated').count()) throw new Error('banner shown on a current backend');
  await modal(p).locator('select').first().selectOption('cat-vegetables');
  const subs = await modal(p).locator('select').nth(1).locator('option').allTextContents();
  for (const crop of ['Potato', 'Tomato', 'Onion', 'Carrot', 'Eggplant', 'Cucumber']) {
    if (!subs.some(o => o.includes(crop))) throw new Error(`missing ${crop} in subcategories`);
  }
  await modal(p).getByRole('button', { name: /^Cancel$/ }).click();
});

// ───────── Problem 2: a booking must reach a transporter who can log in ─────────
const admin = await login('admin@test.com', 'admin123');
let truck;
await step('admin registers a transporter account (this also creates the vehicle)', async () => {
  const p = admin.page; await english(p);
  await p.getByTestId('tab-users').click();
  await p.getByRole('button', { name: /Add User/ }).click();
  const m = modal(p);
  await m.locator('select').first().selectOption('transporter');
  const f = m.getByRole('textbox');
  await f.nth(0).fill('Sundarban Transport'); await f.nth(1).fill('sundarban@example.com'); await f.nth(3).fill('Khulna');
  await m.locator('input[type=number]').fill('250');
  await f.nth(4).fill('Truck#2026pw');
  await m.getByRole('button', { name: /^Save$/ }).click();
  await p.getByTestId('notice-success').getByText(/User created/).waitFor({ timeout: 10000 });
});

await step('the farmer is offered ONLY transporters who have an account (no more “ghost” transporters)', async () => {
  const p = upToDate.page;
  await p.reload(); await english(p);
  await p.getByRole('button', { name: /^Book$|^বুক$/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const crops = await api(p, { action: 'GET_ALL' });
  const offered = crops.data.transporters.map(t => t.name);
  if (offered.some(n => /Karim Mia|Ali Hossen|Nurul|Salam/.test(n))) throw new Error('ghost transporter offered: ' + offered.join(', '));
  if (!offered.some(n => /Sundarban Transport/.test(n))) throw new Error('new transporter not offered: ' + offered.join(', '));
});

await step('farmer books the NEW transporter → that transporter logs in and SEES the booking', async () => {
  const p = upToDate.page;
  const made = await api(p, { action: 'BATCH', ops: [{ op: 'insert', entity: 'crops', row: { id: 'reg-crop-1', categoryId: 'cat-vegetables', subcategoryId: 'sub-onion', packets: 40, weightPerPacket: 10, predictedPrice: 30, qualityScore: 90, images: [], location: 'Jessore' } }] });
  if (!made.success) throw new Error(made.error);
  await p.reload(); await english(p);
  await p.getByRole('heading', { name: 'Onion' }).waitFor({ timeout: 10000 });
  await p.locator('div', { has: p.getByRole('heading', { name: 'Onion' }) }).getByRole('button', { name: /^Book$/ }).last().click();
  await p.getByText('Sundarban Transport').first().waitFor();
  await p.locator('div.fixed').locator('div', { hasText: 'Sundarban Transport' }).getByRole('button', { name: /^Select$/ }).last().click();
  await p.getByText(/booked with Sundarban Transport/).waitFor({ timeout: 10000 });          // farmer is told WHO got it
  const t = await login('sundarban@example.com', 'Truck#2026pw');
  await english(t.page);
  await t.page.getByText(/Booking List/).waitFor({ timeout: 10000 });
  await t.page.getByText('Onion').first().waitFor({ timeout: 10000 });
  await t.page.getByRole('button', { name: /Confirmed/ }).first().waitFor();
  truck = t;
});

await step('a transporter who is ALREADY looking at their dashboard gets a new booking by themselves (no reload)', async () => {
  const t = await login('sundarban@example.com', 'Truck#2026pw', { clock: true });
  await english(t.page);
  await t.page.getByText(/Booking List/).waitFor({ timeout: 10000 });
  if (await t.page.getByText('Carrot').count()) throw new Error('precondition: Carrot should not be listed yet');

  const f = await login('farmer@test.com', 'farmer123');
  const made = await api(f.page, { action: 'BATCH', ops: [{ op: 'insert', entity: 'crops', row: { id: 'reg-crop-2', categoryId: 'cat-vegetables', subcategoryId: 'sub-carrot', packets: 20, weightPerPacket: 10, predictedPrice: 30, qualityScore: 90, images: [], location: 'Jessore' } }] });
  if (!made.success) throw new Error(made.error);
  const tid = (await api(admin.page, { action: 'GET_ALL' })).data.users.find(u => u.email === 'sundarban@example.com').id;
  const booked = await api(f.page, { action: 'BATCH', ops: [
    { op: 'insert', entity: 'bookings', row: { id: 'reg-booking-2', cropId: 'reg-crop-2', transporterId: tid, hubPointId: '1', currentLoad: 20, route: 'Jessore → Dhaka', pickupTime: new Date(Date.now() + 864e5).toISOString() } },
    { op: 'update', entity: 'crops', id: 'reg-crop-2', fields: { status: 'booked', bookingId: 'reg-booking-2', hubPointId: '1', transporterId: tid } }] });
  if (!booked.success) throw new Error(booked.error);

  await t.page.clock.fastForward(30_000);                       // 30 s: a transporter refreshes every 45 s → must NOT have refreshed yet
  if (await t.page.getByText('Carrot').count()) throw new Error('refreshed too early (before 45 s)');
  await t.page.clock.fastForward(20_000);                       // 50 s total → the background refresh fires
  await t.page.getByText('Carrot').first().waitFor({ timeout: 10000 });
});

await step('no uncaught JavaScript errors', async () => {
  const all = [oldAdmin, oldFarmer, upToDate, admin, truck].filter(Boolean).flatMap(s => s.errors);
  if (all.length) throw new Error(all.join(' | '));
});

await browser.close();
for (const [s, n] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}`);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
