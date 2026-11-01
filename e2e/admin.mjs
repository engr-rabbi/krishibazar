import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173/krishibazar-ai/';
const API = 'http://localhost:8787';
const results = [];
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { failed++; results.push(['FAIL', `${name} → ${String(e.message).split('\n')[0]}`]); }
};

// 1×1 red PNG: what "Google Drive" will serve for our thumbnails in this test
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// a real (tiny) JPEG for the upload input
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ/AB//Z', 'base64');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const sessions = [];

async function login(email, password, { routeDrive = true, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  if (clock) await ctx.clock.install();
  if (routeDrive) {
    // Pretend Google Drive serves the thumbnail; a URL containing "BROKEN" simulates a dead image host
    await ctx.route('https://drive.google.com/thumbnail**', route =>
      route.request().url().includes('BROKEN') ? route.abort() : route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /লগইন করুন|Login/ }).click();
  await page.waitForFunction(() => !!localStorage.getItem('kb_token'), null, { timeout: 10000 });   // logged in
  const s = { ctx, page, errors }; sessions.push(s);
  return s;
}
const english = async page => { const b = page.getByRole('button', { name: 'English' }).first(); if (await b.count()) await b.click(); };
const api = (page, body) => page.evaluate(async ({ url, body }) => {
  const token = localStorage.getItem('kb_token');
  return (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token, ...body }) })).json();
}, { url: API, body });
const modal = page => page.locator('div.fixed');
const confirmYes = (page, re) => modal(page).getByRole('button', { name: re }).click();
const toast = (page, kind, re) => page.getByTestId(`notice-${kind}`).filter({ hasText: re }).first().waitFor({ timeout: 10000 });

let farmerSession;
const A = await login('admin@test.com', 'admin123');
const ap = A.page;
await ap.getByText(/Admin Control Panel|অ্যাডমিন কন্ট্রোল প্যানেল/).waitFor({ timeout: 10000 });
await english(ap);

// ───────────────────────────── access control ─────────────────────────────
await step('the admin console shows all nine sections', async () => {
  for (const id of ['overview', 'products', 'farmers', 'retailers', 'orders', 'hubs', 'categories', 'users', 'settings']) {
    await ap.getByTestId(`tab-${id}`).waitFor({ timeout: 3000 });
  }
});

await step('non-admin roles cannot see the console, and the server refuses their admin calls', async () => {
  const f = await login('farmer@test.com', 'farmer123');
  await f.page.getByText(/Farmer Dashboard|কৃষক ড্যাশবোর্ড/).waitFor({ timeout: 10000 });
  if (await f.page.getByTestId('tab-users').count()) throw new Error('farmer can see admin tabs');
  const r = await api(f.page, { action: 'ADMIN', entity: 'users', op: 'create', row: { name: 'Mallory', email: 'm@evil.com', role: 'admin', password: 'password123' } });
  if (r.success || r.code !== 'FORBIDDEN') throw new Error('server accepted a farmer creating an admin: ' + JSON.stringify(r));
  const g = await api(f.page, { action: 'GET_ALL' });
  if (g.data.users.length) throw new Error('farmer received the user list');
});

// ───────────────────────────── categories ─────────────────────────────
await step('admin creates a category and a subcategory; rejects a duplicate name', async () => {
  await ap.getByTestId('tab-categories').click();
  await ap.getByRole('button', { name: /Add category/ }).click();
  await modal(ap).getByRole('textbox').nth(0).fill('Fruits');
  await modal(ap).getByRole('textbox').nth(1).fill('ফল');
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Category created/);
  await ap.getByTestId('category-row-Fruits').getByRole('button', { name: /^Sub$/ }).click();
  await modal(ap).getByRole('textbox').nth(0).fill('Mango');
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Category created/);
  await ap.getByTestId('category-row-Mango').waitFor();
  // duplicate
  await ap.getByRole('button', { name: /Add category/ }).click();
  await modal(ap).getByRole('textbox').nth(0).fill('fruits');
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await modal(ap).getByRole('alert').filter({ hasText: /already exists/ }).waitFor({ timeout: 8000 });
  await modal(ap).getByRole('button', { name: /^Cancel$/ }).click();
});

await step('validation: an empty category name is rejected before reaching the server', async () => {
  await ap.getByRole('button', { name: /Add category/ }).click();
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await modal(ap).getByText(/Name is required/).waitFor({ timeout: 3000 });
  await modal(ap).getByRole('button', { name: /^Cancel$/ }).click();
});

// ───────────────────────────── users ─────────────────────────────
await step('admin registers a new farmer; the farmer can log in right away', async () => {
  await ap.getByTestId('tab-farmers').click();
  await ap.getByRole('button', { name: /Add Farmer/ }).click();
  const m = modal(ap);
  await m.getByRole('button', { name: /^Save$/ }).click();                       // empty form → inline validation
  await m.getByText(/Name is required/).waitFor({ timeout: 3000 });
  await m.getByText(/valid email/).waitFor();
  await m.getByText(/at least 8 characters/).waitFor();
  const fields = m.getByRole('textbox');
  await fields.nth(0).fill('Rahima Begum');
  await fields.nth(1).fill('rahima@example.com');
  await fields.nth(2).fill('+880 1712-345678');
  await fields.nth(3).fill('Bogura');
  await fields.nth(4).fill('Rahima#2026pw');
  await m.getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /User created/);
  await ap.getByTestId('user-row-rahima@example.com').waitFor();
  // duplicate email is refused by the server and shown inside the form
  await ap.getByRole('button', { name: /Add Farmer/ }).click();
  const m2 = modal(ap);
  const f2 = m2.getByRole('textbox');
  await f2.nth(0).fill('Dup'); await f2.nth(1).fill('RAHIMA@example.com'); await f2.nth(4).fill('Another#2026pw');
  await m2.getByRole('button', { name: /^Save$/ }).click();
  await m2.getByRole('alert').filter({ hasText: /already uses this email/ }).waitFor({ timeout: 8000 });
  await m2.getByRole('button', { name: /^Cancel$/ }).click();
  // the new farmer can really log in
  farmerSession = await login('rahima@example.com', 'Rahima#2026pw');
  const nf = farmerSession;
  await nf.page.getByText(/কৃষক ড্যাশবোর্ড|Farmer Dashboard/).waitFor({ timeout: 10000 });
});

await step('admin edits the farmer’s profile; the change shows up in the list', async () => {
  await ap.getByTestId('user-row-rahima@example.com').getByRole('button', { name: /^Edit$/ }).click();
  const f = modal(ap).getByRole('textbox');
  await f.nth(3).fill('Rangpur');
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Changes saved/);
  await ap.getByTestId('user-row-rahima@example.com').getByText('Rangpur').waitFor();
});

await step('deactivating a farmer asks for confirmation, and kills their open session at once', async () => {
  const nf = farmerSession;
  await ap.getByTestId('user-row-rahima@example.com').getByRole('button', { name: /^Deactivate$/ }).click();
  await modal(ap).getByText(/signed out immediately/).waitFor();
  await confirmYes(ap, /^Deactivate$/);
  await toast(ap, 'success', /deactivated/);
  await ap.getByTestId('user-row-rahima@example.com').getByText('Inactive').waitFor();
  const r = await api(nf.page, { action: 'GET_ALL' });
  if (r.code !== 'UNAUTHORIZED') throw new Error('open session still works: ' + JSON.stringify(r).slice(0, 100));
  // login refused
  const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(BASE);
  await p.getByPlaceholder('your@email.com').fill('rahima@example.com'); await p.getByPlaceholder('••••••••').fill('Rahima#2026pw');
  await p.getByRole('button', { name: /লগইন করুন|Login/ }).click();
  await p.getByText(/Invalid email or password|ইমেইল বা পাসওয়ার্ড/).waitFor({ timeout: 8000 });
  await ctx.close();
  // reactivate
  await ap.getByTestId('user-row-rahima@example.com').getByRole('button', { name: /^Activate$/ }).click();
  await toast(ap, 'success', /activated/);
});

await step('admin resets a password; deleting asks for confirmation and removes the user', async () => {
  await ap.getByTestId('user-row-rahima@example.com').getByRole('button', { name: /Reset password/ }).click();
  await modal(ap).getByRole('textbox').fill('short');
  await modal(ap).getByRole('button', { name: /Change password/ }).click();
  await modal(ap).getByText(/at least 8 characters/).waitFor();
  await modal(ap).getByRole('textbox').fill('BrandNew#2026pw');
  await modal(ap).getByRole('button', { name: /Change password/ }).click();
  await toast(ap, 'success', /Password changed/);
  // delete
  await ap.getByTestId('user-row-rahima@example.com').getByRole('button', { name: /^Delete$/ }).click();
  await modal(ap).getByText(/cannot be undone/).waitFor();
  await modal(ap).getByRole('button', { name: /^Cancel$/ }).click();                    // cancelling must NOT delete
  if (!(await ap.getByTestId('user-row-rahima@example.com').count())) throw new Error('cancel still deleted the user');
  await ap.getByTestId('user-row-rahima@example.com').getByRole('button', { name: /^Delete$/ }).click();
  await confirmYes(ap, /Yes, delete/);
  await toast(ap, 'success', /User deleted/);
  await ap.getByTestId('user-row-rahima@example.com').waitFor({ state: 'detached', timeout: 8000 });
});

await step('the admin cannot deactivate or delete their own account from the UI', async () => {
  await ap.getByTestId('tab-users').click();
  const own = ap.getByTestId('user-row-admin@test.com');
  await own.waitFor();
  if (await own.getByRole('button', { name: /^Delete$|^Deactivate$/ }).count()) throw new Error('self-destruct buttons are visible');
});

// ───────────────────────────── hub points ─────────────────────────────
await step('admin creates, edits, deactivates and deletes a hub point (with confirmations)', async () => {
  await ap.getByTestId('tab-hubs').click();
  await ap.getByRole('button', { name: /Add hub point/ }).click();
  const m = modal(ap);
  await m.getByRole('button', { name: /^Save$/ }).click();
  await m.getByText(/Name is required/).waitFor();
  const f = m.getByRole('textbox');
  await f.nth(0).fill('Rajshahi Hub'); await f.nth(1).fill('Rajshahi, Bangladesh');
  await m.locator('input[type=number]').fill('600');
  await m.locator('select').selectOption({ index: 1 });                                   // first real manager
  await m.getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Hub point created/);
  const row = ap.getByTestId('hub-row-Rajshahi Hub');
  await row.waitFor();
  await row.getByRole('button', { name: /^Edit$/ }).click();
  await modal(ap).locator('input[type=number]').fill('900');
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Hub point updated/);
  await row.getByText('0 / 900').waitFor();
  await row.getByRole('button', { name: /^Deactivate$/ }).click();
  await confirmYes(ap, /^Deactivate$/);
  await toast(ap, 'success', /deactivated/);
  await row.getByText('Inactive').waitFor();
  await row.getByRole('button', { name: /^Delete$/ }).click();
  await confirmYes(ap, /Yes, delete/);
  await toast(ap, 'success', /Hub point deleted/);
  await row.waitFor({ state: 'detached', timeout: 8000 });
});

await step('a hub that has stock or orders refuses deletion and suggests deactivation', async () => {
  const ar = await api(ap, { action: 'GET_ALL' });
  const used = ar.data.crops.find(c => c.hubPointId);
  if (!used) return;                                                                    // (flow.mjs normally leaves one)
  await ap.getByTestId('tab-hubs').click();
  const hub = ar.data.hubPoints.find(h => h.id === used.hubPointId);
  await ap.getByTestId(`hub-row-${hub.name}`).getByRole('button', { name: /^Delete$/ }).click();
  await confirmYes(ap, /Yes, delete/);
  await toast(ap, 'error', /Deactivate it instead/);
});

// ───────────────────────────── products + photos ─────────────────────────────
let productId;
await step('admin adds a product for a farmer with a real photo upload (stored via Drive, URL kept in the sheet)', async () => {
  await ap.getByTestId('tab-products').click();
  await ap.getByRole('button', { name: /Add product/ }).click();
  const m = modal(ap);
  await m.getByRole('button', { name: /^Save$/ }).click();                              // validation first
  await m.getByText(/Choose a farmer/).waitFor();
  await m.getByText(/Choose a category/).waitFor();
  const sel = m.locator('select');
  await sel.nth(0).selectOption('1');                                                    // farmer@test.com (id 1)
  await sel.nth(1).selectOption('cat-grains');                                          // category (single child → subcategory select appears)
  await sel.nth(2).selectOption('sub-rice');
  await m.locator('input[type=number]').nth(0).fill('80');
  await m.locator('input[type=number]').nth(2).fill('42');
  await m.locator('select').filter({ hasText: /Pending|Available at a hub/ }).selectOption('available_at_hub');
  await m.locator('select').filter({ hasText: /Dhaka|Chittagong/ }).last().selectOption({ index: 1 });
  await m.getByTestId('photo-input').setInputFiles({ name: 'rice.jpg', mimeType: 'image/jpeg', buffer: JPG });
  await m.locator('img').first().waitFor({ timeout: 10000 });                           // preview appears after upload
  const src = await m.locator('img').first().getAttribute('src');
  if (!/^https:\/\/drive\.google\.com\/thumbnail\?id=FILE/.test(src)) throw new Error('photo was not uploaded to Drive: ' + src.slice(0, 60));
  await m.getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Product added/);
  const all = await api(ap, { action: 'GET_ALL' });
  const p = all.data.crops.find(c => c.type === 'Rice' && c.packets === 80);
  if (!p || p.images.length !== 1 || !p.images[0].startsWith('https://drive.google.com/thumbnail')) throw new Error('image URL not stored on the product');
  productId = p.id;
});

await step('a photo-less product shows the bundled fallback (never a broken image) in the admin list', async () => {
  await ap.getByRole('button', { name: /Add product/ }).click();
  const m = modal(ap); const sel = m.locator('select');
  await sel.nth(0).selectOption({ index: 1 }); await sel.nth(1).selectOption('cat-grains'); await sel.nth(2).selectOption('sub-rice');
  await m.locator('input[type=number]').nth(0).fill('5'); await m.locator('input[type=number]').nth(2).fill('10');
  await m.getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Product added/);
  await ap.waitForFunction(() => [...document.querySelectorAll('img')].some(i => i.dataset.fallback === 'true' && i.naturalWidth > 0), null, { timeout: 8000 });
});

await step('EVERY role that can see the product sees its photo: admin, farmer, hub manager, retailer', async () => {
  const seen = {};
  for (const [role, email, pw] of [['admin', 'admin@test.com', 'admin123'], ['farmer', 'farmer@test.com', 'farmer123'],
                                    ['hub', 'hub@test.com', 'hubmanager123'], ['retailer', 'retailer@test.com', 'retail123']]) {
    const s = role === 'admin' ? A : await login(email, pw);
    if (role === 'admin') await ap.getByTestId('tab-products').click();
    seen[role] = await s.page.waitForFunction(() => [...document.querySelectorAll('img')].some(i =>
      i.src.includes('drive.google.com/thumbnail') && i.naturalWidth > 0 && i.dataset.fallback === 'false'), null, { timeout: 12000 }).then(() => true).catch(() => false);
  }
  const bad = Object.entries(seen).filter(([, v]) => !v).map(([r]) => r);
  if (bad.length) throw new Error('photo not visible for: ' + bad.join(', '));
});

await step('the transporter sees the photo on their booking card too', async () => {
  const photo = 'https://drive.google.com/thumbnail?id=TRANSPORTPHOTO0001&sz=w800';
  const made = await api(ap, { action: 'ADMIN', entity: 'crops', op: 'create', row: { farmerId: '1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 20, weightPerPacket: 10, predictedPrice: 30, qualityScore: 90, location: 'Jessore', images: [photo] } });
  if (!made.success) throw new Error(made.error);
  const farmer = await login('farmer@test.com', 'farmer123');
  const booked = await api(farmer.page, { action: 'BATCH', ops: [
    { op: 'insert', entity: 'bookings', row: { id: 'e2e-booking-1', cropId: made.data.id, transporterId: '2', hubPointId: '1', currentLoad: 20, route: 'Jessore → Dhaka', pickupTime: new Date(Date.now() + 864e5).toISOString() } },
    { op: 'update', entity: 'crops', id: made.data.id, fields: { status: 'booked', bookingId: 'e2e-booking-1', hubPointId: '1', transporterId: '2' } }] });
  if (!booked.success) throw new Error(booked.error);
  const tr = await login('transporter@test.com', 'transport123');
  await tr.page.waitForFunction(() => [...document.querySelectorAll('img')].some(i =>
    i.src.includes('TRANSPORTPHOTO0001') && i.naturalWidth > 0 && i.dataset.fallback === 'false'), null, { timeout: 12000 });
});

await step('a dead image URL falls back to the placeholder instead of a broken-image icon', async () => {
  await ap.getByTestId('tab-products').click();
  const res = await api(ap, { action: 'ADMIN', entity: 'crops', op: 'update', id: productId, fields: { images: ['https://drive.google.com/thumbnail?id=BROKENBROKENBROKEN&sz=w800'] } });
  if (!res.success) throw new Error(res.error);
  await ap.reload(); await english(ap); await ap.getByTestId('tab-products').click();
  const row = ap.getByTestId(`product-row-${productId}`);
  await row.waitFor();
  await ap.waitForFunction(id => {
    const img = document.querySelector(`[data-testid="product-row-${id}"] img`);
    return img && img.dataset.fallback === 'true' && img.naturalWidth > 0;
  }, productId, { timeout: 10000 });
});

await step('admin edits price and stock; the new price reaches the retailer’s page without code changes', async () => {
  await ap.getByTestId(`product-row-${productId}`).getByRole('button', { name: /^Edit$/ }).click();
  const m = modal(ap);
  await m.locator('input[type=number]').nth(0).fill('120');                              // packets
  await m.locator('input[type=number]').nth(2).fill('55');                               // price
  await m.getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Product updated/);
  const row = ap.getByTestId(`product-row-${productId}`);
  await row.getByText('120').first().waitFor({ timeout: 8000 });
  await row.getByText('৳55').waitFor();
  const ret = await login('retailer@test.com', 'retail123');
  await ret.page.getByText('৳55/').first().waitFor({ timeout: 12000 });
});

await step('pages that are ALREADY OPEN pick up the admin\'s change by themselves (no reload)', async () => {
  const open = await login('retailer@test.com', 'retail123', { clock: true });
  await open.page.getByText('৳55/').first().waitFor({ timeout: 12000 });
  const r = await api(ap, { action: 'ADMIN', entity: 'crops', op: 'update', id: productId, fields: { predictedPrice: 77 } });
  if (!r.success) throw new Error(r.error);
  await open.page.clock.fastForward(125_000);                               // the 2-minute background refresh fires
  await open.page.getByText('৳77/').first().waitFor({ timeout: 12000 });
});

await step('a retailer places an order, then the admin edits and cancels it — stock comes back', async () => {
  const ret = await login('retailer@test.com', 'retail123');
  const place = await api(ret.page, { action: 'BATCH', ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'e2e-order-1', cropId: productId, packets: 10 } }] });
  if (!place.success) throw new Error(place.error);
  await ap.getByTestId('tab-orders').click();
  await ap.reload(); await english(ap); await ap.getByTestId('tab-orders').click();
  const row = ap.getByTestId('order-row-e2e-order-1');
  await row.waitFor({ timeout: 8000 });
  await row.getByRole('button', { name: /^Edit$/ }).click();
  await modal(ap).locator('input[type=number]').fill('15');
  await modal(ap).getByRole('textbox').fill('Customer asked for 5 more');
  await modal(ap).getByRole('button', { name: /^Save$/ }).click();
  await toast(ap, 'success', /Order updated/);
  await row.getByText('15', { exact: true }).waitFor({ timeout: 8000 });
  await row.getByRole('button', { name: /Cancel order/ }).click();
  await modal(ap).getByText(/return to stock/).waitFor();
  await confirmYes(ap, /Yes, cancel order/);
  await toast(ap, 'success', /Order cancelled/);
  await row.getByText('Cancelled').waitFor();
  const all = await api(ap, { action: 'GET_ALL' });
  const p = all.data.crops.find(c => c.id === productId);
  if (p.packetsRemaining !== 120) throw new Error('stock not restored: ' + p.packetsRemaining);
});

await step('deleting a product asks for confirmation; one with live orders is refused with a clear reason', async () => {
  const retailerSession = await login('retailer@test.com', 'retail123');
  const placed = await api(retailerSession.page, { action: 'BATCH', ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'e2e-order-2', cropId: productId, packets: 3 } }] });
  if (!placed.success) throw new Error(placed.error);
  await ap.getByTestId('tab-products').click(); await ap.reload(); await english(ap); await ap.getByTestId('tab-products').click();
  const row = ap.getByTestId(`product-row-${productId}`);
  await row.getByRole('button', { name: /^Delete$/ }).click();
  await modal(ap).getByText(/cannot be undone/).waitFor();
  await confirmYes(ap, /Yes, delete/);
  await toast(ap, 'error', /Cancel them first/);
  // cancel the order, delete succeeds
  await api(ap, { action: 'BATCH', ops: [{ op: 'update', entity: 'retailerOrders', id: 'e2e-order-2', fields: { status: 'cancelled' } }] });
  await ap.reload(); await english(ap); await ap.getByTestId('tab-products').click();
  await ap.getByTestId(`product-row-${productId}`).getByRole('button', { name: /^Delete$/ }).click();
  await confirmYes(ap, /Yes, delete/);
  await toast(ap, 'success', /Product deleted/);
  await ap.getByTestId(`product-row-${productId}`).waitFor({ state: 'detached', timeout: 8000 });
});

// ───────────────────────────── settings & propagation ─────────────────────────────
await step('settings validate (shares must total 100), save, and the new platform name appears on every page', async () => {
  await ap.getByTestId('tab-settings').click();
  const name = ap.getByRole('textbox').first();
  await name.fill('কৃষি হাট');
  const nums = ap.locator('input[type=number]');
  await nums.nth(0).fill('60'); await nums.nth(1).fill('25'); await nums.nth(2).fill('10');   // = 95
  await ap.getByRole('button', { name: /Save settings/ }).click();
  await ap.getByText(/must add up to 100/).waitFor({ timeout: 3000 });
  await nums.nth(2).fill('15');
  await ap.getByTestId('share-total').filter({ hasText: '100%' }).waitFor();
  await ap.getByRole('button', { name: /Save settings/ }).click();
  await toast(ap, 'success', /Settings saved/);
  const r = await login('retailer@test.com', 'retail123');
  await r.page.getByText('কৃষি হাট').first().waitFor({ timeout: 10000 });        // header shows the new name for another role
});

await step('maintenance mode (with confirmation) locks everyone but the admin, then is switched off', async () => {
  await ap.getByRole('button', { name: /Turn ON/ }).click();
  await modal(ap).getByText(/blocked immediately/).waitFor();
  await confirmYes(ap, /Turn ON/);
  await toast(ap, 'success', /Maintenance mode is ON/);
  const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(BASE);
  await p.getByPlaceholder('your@email.com').fill('farmer@test.com'); await p.getByPlaceholder('••••••••').fill('farmer123');
  await p.getByRole('button', { name: /লগইন করুন|Login/ }).click();
  await p.getByText(/under maintenance/).waitFor({ timeout: 8000 });
  await ctx.close();
  await ap.getByRole('button', { name: /Turn OFF/ }).click();
  await toast(ap, 'success', /Maintenance mode is OFF/);
});

await step('no uncaught JavaScript errors in any session', async () => {
  const all = sessions.flatMap(s => s.errors);
  if (all.length) throw new Error(all.join(' | '));
});

await browser.close();
for (const [status, name] of results) console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
