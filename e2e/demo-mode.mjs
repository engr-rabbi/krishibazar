import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4174/krishibazar-ai/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const roles = [
  ['farmer@test.com',      /কৃষক ড্যাশবোর্ড|Farmer Dashboard/],
  ['transporter@test.com', /পরিবহনকারী ড্যাশবোর্ড|Transporter Dashboard/],
  ['hub@test.com',         /হাব পয়েন্ট ড্যাশবোর্ড|Hub Point Dashboard/],
  ['retailer@test.com',    /খুচরা বিক্রেতা ড্যাশবোর্ড|Retailer Dashboard/],
  ['admin@test.com',       /অ্যাডমিন কন্ট্রোল প্যানেল|Admin Control Panel/],
];
let failed = 0;
for (const [email, heading] of roles) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  try {
    await p.goto(BASE);
    await p.getByRole('button', { name: new RegExp(email) }).click();   // demo quick-fill button
    await p.getByRole('button', { name: /লগইন করুন|Login/ }).click();
    await p.getByText(heading).first().waitFor({ timeout: 8000 });
    if (errs.length) throw new Error(errs.join('|'));
    console.log('✓ demo login →', email);
  } catch (e) { failed++; console.log('✗ demo login →', email, String(e.message).split('\n')[0]); }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
