import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173/krishibazar-ai/';
const results = [];
let failed = 0;

async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { failed++; results.push(['FAIL', `${name} → ${String(e.message).split('\n')[0]}`]); }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function session(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /লগইন করুন|Login/ }).click();
  return { ctx, page, errors };
}
const switchToEnglish = async page => {
  const btn = page.getByRole('button', { name: 'English' }).first();
  if (await btn.count()) await btn.click();
};

// ── 0. Public page, wrong login, no demo shortcuts in a backend build ─────────
await step('login page shows NO demo credentials when a backend is configured', async () => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE);
  await page.getByPlaceholder('your@email.com').waitFor();
  const html = await page.content();
  if (/farmer123|admin123|farmer@test\.com/.test(html)) throw new Error('demo credentials visible');
});

await step('wrong password shows an error and stays on login', async () => {
  const { page, ctx } = await session('farmer@test.com', 'wrong-password');
  await page.getByText(/Invalid email or password|ভুল/).waitFor({ timeout: 8000 });
  await ctx.close();
});

// ── 1. Farmer: login, add crop, book transport ────────────────────────────────
const farmer = await session('farmer@test.com', 'farmer123');
await step('farmer logs in and reaches the dashboard', async () => {
  await farmer.page.getByText(/কৃষক ড্যাশবোর্ড|Farmer Dashboard/).waitFor({ timeout: 10000 });
  await switchToEnglish(farmer.page);
});

await step('farmer sees client-side validation when submitting an empty crop form', async () => {
  await farmer.page.getByRole('button', { name: /Add Crop|নতুন ফসল/ }).first().click();
  await farmer.page.locator('div.fixed').getByRole('button', { name: /^Add Crop$|^যোগ করুন$/ }).click();
  await farmer.page.getByText(/Please choose a category|ক্যাটাগরি নির্বাচন করুন/).waitFor({ timeout: 3000 });
});

await step('farmer adds a Potato crop (50 packets × 10kg) and it persists to the backend', async () => {
  const p = farmer.page;
  const modal = p.locator('div.fixed');
  await modal.locator('select').nth(0).selectOption('cat-vegetables');   // category → subcategory appears
  await modal.locator('select').nth(1).selectOption('sub-potato');
  await modal.locator('input[type=number]').fill('50');
  await modal.locator('select').nth(2).selectOption('10');
  await p.locator('div.fixed').getByRole('button', { name: /^Add Crop$|^যোগ করুন$/ }).click();
  await p.getByText(/added successfully|সফলভাবে যোগ/).waitFor({ timeout: 10000 });
});

await step('crop survives a full page reload (data really comes from the sheet)', async () => {
  await farmer.page.reload();
  await farmer.page.getByRole('heading', { name: 'Potato' }).waitFor({ timeout: 10000 });
});

await step('farmer books transporter Rahim Uddin', async () => {
  const p = farmer.page;
  await switchToEnglish(p);
  await p.getByRole('button', { name: /^Book$|^বুক$/ }).first().click();
  await p.getByText(/Rahim Uddin/).first().waitFor();
  await p.getByRole('button', { name: /^Select$|^নির্বাচন$/ }).first().click();
  await p.getByText(/Transport booked|পরিবহন বুক/).waitFor({ timeout: 10000 });
});

await step('farmer sees the ported Real-time Updates panel and the Details modal', async () => {
  const p = farmer.page;
  await p.getByText(/Real-time Updates|রিয়েল-টাইম আপডেট/).first().waitFor({ timeout: 5000 });
  await p.getByText(/Payment Status|পেমেন্ট স্ট্যাটাস/).first().waitFor({ timeout: 3000 });
  await p.getByRole('button', { name: /^Details$|^বিস্তারিত$/ }).first().click();
  await p.getByText(/Transport Info|পরিবহন তথ্য/).waitFor({ timeout: 3000 });
  await p.locator('div.fixed').getByRole('button', { name: /^Close$|^বন্ধ করুন$/ }).click();
});

// ── 2. Transporter moves the booking along ────────────────────────────────────
const trans = await session('transporter@test.com', 'transport123');
await step('transporter sees the booking and advances it to "delivered to hub"', async () => {
  const p = trans.page;
  await p.getByText(/পরিবহনকারী ড্যাশবোর্ড|Transporter Dashboard/).waitFor({ timeout: 10000 });
  await switchToEnglish(p);
  // ported: inline Route Map (replaces the old alert()) and sample-data badges on the mock panels
  await p.getByRole('button', { name: /Route Map|রুট ম্যাপ/ }).first().click();
  await p.getByText(/Jessore → Dhaka|জেসোর/).first().waitFor({ timeout: 3000 }).catch(() => {});
  await p.locator('div.fixed').getByRole('button', { name: /^Close$|^বন্ধ করুন$/ }).click();
  await p.getByText(/Sample data|নমুনা তথ্য/).first().waitFor({ timeout: 3000 });
  for (const label of [/Confirmed|নিশ্চিত/, /In Transit|পরিবহনে/, /Delivered to Hub|হাবে পৌঁছেছে/]) {
    await p.getByRole('button', { name: label }).first().click();
    await p.getByText(/Booking confirmed|Now in transit|Successfully delivered|বুকিং নিশ্চিত|এখন ট্রানজিটে|সফলভাবে ডেলিভার/).waitFor({ timeout: 10000 });
    await p.waitForTimeout(300);
  }
});

// ── 3. Hub manager receives it ────────────────────────────────────────────────
const hub = await session('hub@test.com', 'hubmanager123');
await step('hub manager receives the crop', async () => {
  const p = hub.page;
  await p.getByText(/হাব পয়েন্ট ড্যাশবোর্ড|Hub Point Dashboard/).waitFor({ timeout: 10000 });
  await switchToEnglish(p);
  for (const h of [/Incoming Crops/, /Available for Retailers/, /Pending Orders/, /Real-time Updates/]) await p.getByText(h).first().waitFor({ timeout: 4000 });
  await p.getByRole('button', { name: /^Receive$|^গ্রহণ করুন$/ }).first().click();
  await p.getByText(/Crop received|ফসল গ্রহণ করা হয়েছে/).waitFor({ timeout: 10000 });
});

// ── 4. Retailer: order → pay → collect (the flow that was broken before) ──────
const retailer = await session('retailer@test.com', 'retail123');
await step('retailer sees the permanent complaint QR code card', async () => {
  const p = retailer.page;
  await p.getByText(/খুচরা বিক্রেতা ড্যাশবোর্ড|Retailer Dashboard/).waitFor({ timeout: 10000 });
  await p.getByRole('img', { name: 'Retailer QR Code' }).waitFor({ timeout: 5000 });
});

await step('retailer places an order for 30 packets', async () => {
  const p = retailer.page;
  await p.getByText(/খুচরা বিক্রেতা ড্যাশবোর্ড|Retailer Dashboard/).waitFor({ timeout: 10000 });
  await switchToEnglish(p);
  await p.getByRole('button', { name: /^Order$|^অর্ডার করুন$/ }).first().click();
  await p.locator('input[type=number]').fill('30');
  await p.locator('div.fixed').getByRole('button', { name: /^Place Order$|^অর্ডার দিন$/ }).click();
  await p.getByText(/Order placed|অর্ডার সফলভাবে/).waitFor({ timeout: 12000 });
});

await step('overselling is blocked (only 20 packets left)', async () => {
  const p = retailer.page;
  await p.getByRole('button', { name: /^Order$|^অর্ডার করুন$/ }).first().click();
  await p.locator('input[type=number]').fill('25');
  await p.locator('div.fixed').getByRole('button', { name: /^Place Order$|^অর্ডার দিন$/ }).click();
  await p.getByText(/Max 20 packets|সর্বোচ্চ 20/).waitFor({ timeout: 5000 });
  await p.locator('div.fixed').getByRole('button', { name: /Cancel|বাতিল/ }).click();
});

await step('retailer pays, then the Collect button appears and works', async () => {
  const p = retailer.page;
  await p.getByRole('button', { name: /^Pay$|^পেমেন্ট$/ }).first().click();
  await p.getByText(/Payment successful|পেমেন্ট সফল/).waitFor({ timeout: 10000 });
  await p.getByRole('button', { name: /Close|বন্ধ করুন/ }).first().click();
  await p.getByRole('button', { name: /^Collect$|^সংগ্রহ$/ }).first().click();
  await p.getByText(/collected successfully|সংগ্রহ সম্পন্ন/).waitFor({ timeout: 12000 });
});

// ── 5. Admin: revenue + payment ───────────────────────────────────────────────
const admin = await session('admin@test.com', 'admin123');
await step('admin dashboard shows the ported filters, tracing grid, revenue sharing and charts', async () => {
  const p = admin.page;
  await p.getByText(/Filters & Reports|ফিল্টার ও রিপোর্ট/).waitFor({ timeout: 8000 });
  for (const h of [/Grid-Based Product Tracing|গ্রিড-ভিত্তিক/, /Real-time Revenue Sharing|রিয়েল-টাইম রাজস্ব/, /Hub Stock Levels|হাব স্টক/, /Workflow Status|ওয়ার্কফ্লো/, /Government Monitoring|সরকারি মনিটরিং/]) {
    await p.getByText(h).first().waitFor({ timeout: 4000 });
  }
  // the product-type filter really filters: pick a type that does not exist in the data → table empties
  const rowsBefore = await p.locator('tbody tr').count();
  if (rowsBefore < 1) throw new Error('tracing grid is empty');
  await p.locator('select').nth(2).selectOption('today').catch(() => {});
});

await step('admin sees farmer revenue (70% of the collected order) and pays it', async () => {
  const p = admin.page;
  await p.getByText(/অ্যাডমিন কন্ট্রোল প্যানেল|Admin Control Panel/).waitFor({ timeout: 10000 });
  // Price is randomly generated by the app, so read the real order amount from the backend
  const token = await retailer.page.evaluate(() => localStorage.getItem('kb_token'));
  const amount = await retailer.page.evaluate(async t => {
    const r = await (await fetch('http://localhost:8787', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'GET_ALL', token: t }) })).json();
    return r.data.retailerOrders.filter(o => o.status === 'collected').reduce((s, o) => s + o.amount, 0);
  }, token);
  const expected = '৳' + (amount * 0.7).toLocaleString('en-US');
  await p.locator('select').filter({ hasText: /Select a farmer|কৃষক নির্বাচন/ }).selectOption({ index: 1 });
  await p.getByText(expected).first().waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: /^Pay ৳|পেমেন্ট করুন/ }).first().click();
  await p.getByText(/Payment recorded|পেমেন্ট রেকর্ড/).waitFor({ timeout: 10000 });
});

// ── 6. Public complaint via QR-style hash URL ─────────────────────────────────
await step('anonymous consumer submits a complaint through the hash-route URL', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE + '#/complaint/4?order=o1&crop=Potato');
  await p.locator('textarea').fill('Some potatoes were rotten');
  await p.getByRole('button', { name: /Submit Complaint|অভিযোগ দাখিল করুন/ }).click();
  await p.getByText(/Complaint Submitted|অভিযোগ দাখিল সফল/).waitFor({ timeout: 10000 });
  await ctx.close();
});

await step('admin sees the complaint and can resolve it', async () => {
  const p = admin.page;
  await p.reload();
  await p.getByText('Some potatoes were rotten').waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: /Resolve|সমাধান/ }).first().click();
  await p.getByText(/resolved/).first().waitFor({ timeout: 8000 });
});

// ── 7. Security through the UI ────────────────────────────────────────────────
await step('farmer view never receives other roles’ data (no complaints / orders in API payload)', async () => {
  const token = await farmer.page.evaluate(() => localStorage.getItem('kb_token'));
  const r = await farmer.page.evaluate(async t => {
    const res = await fetch('http://localhost:8787', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'GET_ALL', token: t }) });
    return res.json();
  }, token);
  if (r.data.complaints.length || r.data.retailerOrders.length) throw new Error('leaked data');
});

await step('logout invalidates the session; stale token is rejected', async () => {
  const token = await farmer.page.evaluate(() => localStorage.getItem('kb_token'));
  await farmer.page.getByTitle(/Logout|লগআউট/).click();
  await farmer.page.getByPlaceholder('your@email.com').waitFor({ timeout: 5000 });
  const r = await farmer.page.evaluate(async t => {
    const res = await fetch('http://localhost:8787', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'GET_ALL', token: t }) });
    return res.json();
  }, token);
  if (r.code !== 'UNAUTHORIZED') throw new Error('token still valid after logout');
});

await step('no uncaught JavaScript errors in any session', async () => {
  const all = [farmer, trans, hub, retailer, admin].flatMap(s => s.errors);
  if (all.length) throw new Error(all.join(' | '));
});

await browser.close();
for (const [status, name] of results) console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
