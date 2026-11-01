import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Same in-memory Google mocks as appsscript.test.ts, trimmed to what the admin features need.
class MockSheet {
  rows: unknown[][] = [];
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  deleteRow(i: number) { this.rows.splice(i - 1, 1); }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sh = this;
    const api = {
      getValues() { return Array.from({ length: nr }, (_, i) => { const row = sh.rows[r - 1 + i] || []; return Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? ''); }); },
      setValues(v: unknown[][]) { v.forEach((vals, i) => { const idx = r - 1 + i; sh.rows[idx] = sh.rows[idx] || []; vals.forEach((x, j) => { sh.rows[idx][c - 1 + j] = x; }); }); },
      setNumberFormat() { return api; }, setFontWeight() { return api; }, setBackground() { return api; }, setFontColor() { return api; },
    };
    return api;
  }
}

function boot(opts: { driveFails?: boolean } = {}) {
  const sheets: Record<string, MockSheet> = {};
  const cache = new Map<string, string>();
  const props: Record<string, string> = {};
  const files: Record<string, { shared: boolean; mime: string }> = {};
  let folder: unknown = null;
  const makeFolder = () => (folder = {
    getId: () => 'folder-1',
    createFile: (blob: { mime: string }) => {
      if (opts.driveFails) throw new Error('Drive quota');
      const id = 'FILE' + crypto.randomBytes(10).toString('hex');
      files[id] = { shared: false, mime: blob.mime };
      return { getId: () => id, setSharing: () => { files[id].shared = true; } };
    },
  });
  const ss = { getSheetByName: (n: string) => sheets[n] ?? null, insertSheet: (n: string) => (sheets[n] = new MockSheet()) };
  const sandbox: Record<string, unknown> = {
    DriveApp: { Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' }, getFoldersByName: () => ({ hasNext: () => !!folder, next: () => folder }), createFolder: () => makeFolder(), getFolderById: () => folder },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null, setProperty: (k: string, v: string) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, v); }, remove: (k: string) => { cache.delete(k); } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a: string, i: string | number[]) => Array.from(crypto.createHash('sha256').update(typeof i === 'string' ? Buffer.from(i) : Buffer.from(i)).digest()),
      base64Encode: (b: number[]) => Buffer.from(b).toString('base64'), getUuid: () => crypto.randomUUID(),
      base64Decode: (s: string) => Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name }),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
    Logger: { log() {} }, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../google-apps-script/Code.gs'), 'utf8'), sandbox);
  (sandbox.setupSheets as () => string)();
  const call = (body: Record<string, unknown>) =>
    JSON.parse((sandbox.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: JSON.stringify(body) } }).getContent());
  const login = (email: string, pw: string) => { const r = call({ action: 'LOGIN', email, password: pw }); if (!r.success) throw new Error(r.error); return r.data.token as string; };
  return { sandbox, sheets, call, login, files, cache, props };
}

type B = ReturnType<typeof boot>;
let b: B, admin: string;
const A = (body: Record<string, unknown>) => b.call({ action: 'ADMIN', token: admin, ...body });
const ok = (r: { success: boolean; error?: string }) => { expect(r.success, r.error).toBe(true); return r; };
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');

beforeEach(() => { b = boot(); admin = b.login('admin@test.com', 'admin123'); });

describe('access control for the admin panel', () => {
  it('every admin operation is refused for every non-admin role, and without a token', () => {
    const ops = [
      { entity: 'users', op: 'create', row: { name: 'X', email: 'x@x.com', role: 'farmer', password: 'password123' } },
      { entity: 'hubPoints', op: 'create', row: { name: 'H', location: 'L', capacity: 10 } },
      { entity: 'categories', op: 'create', row: { name: 'Fruit' } },
      { entity: 'crops', op: 'delete', id: 'x' },
      { entity: 'settings', op: 'update', values: { platformName: 'Hacked' } },
    ];
    for (const [email, pw] of [['farmer@test.com', 'farmer123'], ['transporter@test.com', 'transport123'], ['hub@test.com', 'hubmanager123'], ['retailer@test.com', 'retail123']]) {
      const t = b.login(email, pw);
      for (const o of ops) expect(b.call({ action: 'ADMIN', token: t, ...o }).code, `${email} ${o.entity}`).toBe('FORBIDDEN');
    }
    for (const o of ops) expect(b.call({ action: 'ADMIN', ...o }).code).toBe('UNAUTHORIZED');
  });

  it('only admins receive the user list in GET_ALL', () => {
    expect(b.call({ action: 'GET_ALL', token: admin }).data.users.length).toBe(5);
    expect(b.call({ action: 'GET_ALL', token: b.login('farmer@test.com', 'farmer123') }).data.users).toEqual([]);
  });

  it('the user list never contains password hashes', () => {
    expect(JSON.stringify(b.call({ action: 'GET_ALL', token: admin }).data)).not.toMatch(/passwordHash|\$[A-Za-z0-9+/=]{20,}/);
  });
});

describe('users: farmers, retailers, others', () => {
  const farmer = { name: 'নতুন কৃষক', email: 'New.Farmer@Example.com', phone: '+880 1711-000000', location: 'Bogura', role: 'farmer', password: 'Str0ngPass!' };

  it('creates a farmer who can log in immediately (email normalised)', () => {
    ok(A({ entity: 'users', op: 'create', row: farmer }));
    expect(b.login('new.farmer@example.com', 'Str0ngPass!')).toBeTruthy();
    const u = b.call({ action: 'GET_ALL', token: admin }).data.users.find((x: { email: string }) => x.email === 'new.farmer@example.com');
    expect(u).toMatchObject({ role: 'farmer', active: true, phone: '+880 1711-000000' });
  });

  it('validates email, password, phone, role and duplicates', () => {
    for (const bad of [{ email: 'nope' }, { password: 'short' }, { phone: 'call me!' }, { role: 'superuser' }, { name: '  ' }]) {
      expect(A({ entity: 'users', op: 'create', row: { ...farmer, ...bad } }).success, JSON.stringify(bad)).toBe(false);
    }
    ok(A({ entity: 'users', op: 'create', row: farmer }));
    expect(A({ entity: 'users', op: 'create', row: { ...farmer, email: 'new.farmer@example.com' } }).code).toBe('DUPLICATE');
    expect(A({ entity: 'users', op: 'create', row: { ...farmer, email: 'farmer@test.com' } }).code).toBe('DUPLICATE');
  });

  it('a transporter created here is bookable (gets a Transporters row with capacity)', () => {
    const r = ok(A({ entity: 'users', op: 'create', row: { name: 'Truck Co', email: 't@x.com', role: 'transporter', password: 'password123', vehicleCapacity: 800 } }));
    const t = b.call({ action: 'GET_ALL', token: admin }).data.transporters.find((x: { id: string }) => x.id === r.data.id);
    expect(t).toMatchObject({ vehicleCapacity: 800, availableCapacity: 800, status: 'available' });
  });

  it('edits profile fields and cascades the new name to products, hubs and orders', () => {
    const farmerTok = b.login('farmer@test.com', 'farmer123');
    ok(b.call({ action: 'BATCH', token: farmerTok, ops: [{ op: 'insert', entity: 'crops', row: { id: 'c1', categoryId: 'cat-vegetables', subcategoryId: 'sub-potato', packets: 10, weightPerPacket: 5, predictedPrice: 20, qualityScore: 90, images: [], location: 'X' } }] }));
    ok(A({ entity: 'users', op: 'update', id: '1', fields: { name: 'Renamed Farmer', phone: '01800000000' } }));
    expect(b.call({ action: 'GET_ALL', token: admin }).data.crops[0].farmerName).toBe('Renamed Farmer');
    ok(A({ entity: 'users', op: 'update', id: '3', fields: { name: 'Hub Boss' } }));
    expect(b.call({ action: 'GET_ALL', token: admin }).data.hubPoints[0].managerName).toBe('Hub Boss');
  });

  it('deactivation blocks login AND kills an already-open session immediately', () => {
    const tok = b.login('retailer@test.com', 'retail123');
    expect(b.call({ action: 'GET_ALL', token: tok }).success).toBe(true);
    ok(A({ entity: 'users', op: 'update', id: '4', fields: { active: false } }));
    expect(b.call({ action: 'GET_ALL', token: tok }).code).toBe('UNAUTHORIZED');
    expect(b.call({ action: 'LOGIN', email: 'retailer@test.com', password: 'retail123' }).success).toBe(false);
    ok(A({ entity: 'users', op: 'update', id: '4', fields: { active: true } }));
    expect(b.login('retailer@test.com', 'retail123')).toBeTruthy();
  });

  it('role change takes effect immediately on an open session', () => {
    ok(A({ entity: 'users', op: 'create', row: { name: 'Temp', email: 'tmp@x.com', role: 'retailer', password: 'password123' } }));
    const tok = b.login('tmp@x.com', 'password123');
    const id = b.call({ action: 'GET_ALL', token: admin }).data.users.find((u: { email: string }) => u.email === 'tmp@x.com').id;
    ok(A({ entity: 'users', op: 'update', id, fields: { role: 'admin' } }));
    expect(A.length).toBeGreaterThan(-1);
    expect(b.call({ action: 'ADMIN', token: tok, entity: 'settings', op: 'update', values: { platformName: 'Now admin' } }).success).toBe(true);
  });

  it('an admin cannot lock themselves out: no self-deactivate / self-demote / self-delete', () => {
    expect(A({ entity: 'users', op: 'update', id: '5', fields: { active: false } }).code).toBe('FORBIDDEN');
    expect(A({ entity: 'users', op: 'update', id: '5', fields: { role: 'farmer' } }).code).toBe('FORBIDDEN');
    expect(A({ entity: 'users', op: 'delete', id: '5' }).code).toBe('FORBIDDEN');
  });

  it('INVARIANT: no sequence of admin operations can ever leave the platform without an active administrator', () => {
    // The explicit last-admin guard is unreachable through the API (the acting admin is itself an active admin and
    // self-changes are blocked), so we test the guarantee that matters: hammer the system with pseudo-random
    // create/deactivate/demote/delete operations from every admin and check the invariant after each step.
    for (const n of [2, 3]) ok(A({ entity: 'users', op: 'create', row: { name: 'Admin ' + n, email: `a${n}@x.com`, role: 'admin', password: 'password123' } }));
    const creds: Record<string, string> = { '5': 'admin@test.com' };
    const users = () => b.call({ action: 'GET_ALL', token: b.login('admin@test.com', 'admin123') }).data.users as { id: string; email: string; role: string; active: boolean }[];
    for (const u of users().filter(x => x.email.startsWith('a') && x.email.endsWith('@x.com'))) creds[u.id] = u.email;
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const ids = Object.keys(creds);
    let allowedOps = 0;
    for (let step = 0; step < 150; step++) {
      const actorId = ids[rnd(ids.length)], targetId = ids[rnd(ids.length)];
      let token: string;
      try { token = b.login(creds[actorId], creds[actorId] === 'admin@test.com' ? 'admin123' : 'password123'); } catch { continue; } // inactive actors cannot log in
      const fields = [{ active: false }, { active: true }, { role: 'farmer' }, { role: 'admin' }][rnd(4)];
      const r = rnd(5) === 0
        ? b.call({ action: 'ADMIN', token, entity: 'users', op: 'delete', id: targetId })
        : b.call({ action: 'ADMIN', token, entity: 'users', op: 'update', id: targetId, fields });
      if (r.success) allowedOps++;
      const activeAdmins = b.sheets.Users.rows.slice(1).filter(row => row[3] === 'admin' && String(row[7]) === 'true').length;
      expect(activeAdmins, `step ${step}`).toBeGreaterThanOrEqual(1);
    }
    expect(allowedOps).toBeGreaterThan(5);   // the test really exercised state changes
  });

  it('refuses to delete users that still own data (suggests deactivation), allows deleting clean ones', () => {
    const farmerTok = b.login('farmer@test.com', 'farmer123');
    ok(b.call({ action: 'BATCH', token: farmerTok, ops: [{ op: 'insert', entity: 'crops', row: { id: 'c1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 10, weightPerPacket: 5, predictedPrice: 20, qualityScore: 90, images: [], location: 'X' } }] }));
    const blocked = A({ entity: 'users', op: 'delete', id: '1' });
    expect(blocked.code).toBe('IN_USE');
    expect(blocked.error).toMatch(/Deactivate/);
    ok(A({ entity: 'users', op: 'create', row: { name: 'Clean', email: 'clean@x.com', role: 'retailer', password: 'password123' } }));
    const id = b.call({ action: 'GET_ALL', token: admin }).data.users.find((u: { email: string }) => u.email === 'clean@x.com').id;
    ok(A({ entity: 'users', op: 'delete', id }));
    expect(b.call({ action: 'GET_ALL', token: admin }).data.users.some((u: { id: string }) => u.id === id)).toBe(false);
  });

  it('resets a password (old one stops working) and enforces length', () => {
    expect(A({ entity: 'users', op: 'resetPassword', id: '1', password: 'short' }).success).toBe(false);
    ok(A({ entity: 'users', op: 'resetPassword', id: '1', password: 'BrandNewPass1' }));
    expect(b.call({ action: 'LOGIN', email: 'farmer@test.com', password: 'farmer123' }).success).toBe(false);
    expect(b.login('farmer@test.com', 'BrandNewPass1')).toBeTruthy();
  });

  it('only whitelisted fields can be edited (no passwordHash/id tampering)', () => {
    expect(A({ entity: 'users', op: 'update', id: '1', fields: { passwordHash: 'x$y' } }).code).toBe('FORBIDDEN');
    expect(A({ entity: 'users', op: 'update', id: '1', fields: { id: '999' } }).code).toBe('FORBIDDEN');
  });
});

describe('hub points', () => {
  it('create / edit / deactivate / delete with validation and manager checks', () => {
    const made = ok(A({ entity: 'hubPoints', op: 'create', row: { name: 'Rajshahi Hub', location: 'Rajshahi', capacity: 500, managerId: '3', phone: '01700000000' } }));
    const hubs = () => b.call({ action: 'GET_ALL', token: admin }).data.hubPoints;
    expect(hubs().find((h: { id: string }) => h.id === made.data.id)).toMatchObject({ name: 'Rajshahi Hub', active: true, managerId: '3', capacity: 500 });
    expect(A({ entity: 'hubPoints', op: 'create', row: { name: 'rajshahi hub', location: 'x', capacity: 5 } }).code).toBe('DUPLICATE');
    expect(A({ entity: 'hubPoints', op: 'create', row: { name: 'Bad', location: 'x', capacity: 0 } }).success).toBe(false);
    expect(A({ entity: 'hubPoints', op: 'create', row: { name: 'Bad2', location: 'x', capacity: 5, managerId: '1' } }).success).toBe(false); // a farmer can't manage a hub
    ok(A({ entity: 'hubPoints', op: 'update', id: made.data.id, fields: { active: false, capacity: 900 } }));
    expect(hubs().find((h: { id: string }) => h.id === made.data.id)).toMatchObject({ active: false, capacity: 900 });
    ok(A({ entity: 'hubPoints', op: 'delete', id: made.data.id }));
    expect(hubs().some((h: { id: string }) => h.id === made.data.id)).toBe(false);
  });

  it('refuses to delete a hub that has crops/orders, and an inactive hub rejects new bookings', () => {
    const farmerTok = b.login('farmer@test.com', 'farmer123');
    ok(b.call({ action: 'BATCH', token: farmerTok, ops: [{ op: 'insert', entity: 'crops', row: { id: 'c1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 10, weightPerPacket: 5, predictedPrice: 20, qualityScore: 90, images: [], location: 'X' } }] }));
    ok(A({ entity: 'hubPoints', op: 'update', id: '1', fields: { active: false } }));
    const r = b.call({ action: 'BATCH', token: farmerTok, ops: [{ op: 'insert', entity: 'bookings', row: { id: 'b1', cropId: 'c1', transporterId: '2', hubPointId: '1', currentLoad: 10, pickupTime: '2026-01-01T00:00:00.000Z' } }] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not accepting/);
    ok(A({ entity: 'hubPoints', op: 'update', id: '1', fields: { active: true } }));
    ok(b.call({ action: 'BATCH', token: farmerTok, ops: [{ op: 'insert', entity: 'bookings', row: { id: 'b1', cropId: 'c1', transporterId: '2', hubPointId: '1', currentLoad: 10, pickupTime: '2026-01-01T00:00:00.000Z' } }] }));
    expect(A({ entity: 'hubPoints', op: 'delete', id: '1' }).code).toBe('IN_USE');
  });
});

describe('categories & subcategories', () => {
  const cats = () => b.call({ action: 'GET_ALL', token: admin }).data.categories as { id: string; name: string; parentId: string; active: boolean }[];

  it('creates a category and a subcategory, rejects duplicates and 3-level nesting', () => {
    const fruit = ok(A({ entity: 'categories', op: 'create', row: { name: 'Fruits', nameBn: 'ফল' } })).data.id;
    const mango = ok(A({ entity: 'categories', op: 'create', row: { name: 'Mango', nameBn: 'আম', parentId: fruit } })).data.id;
    expect(cats().find(c => c.id === mango)).toMatchObject({ parentId: fruit, active: true });
    expect(A({ entity: 'categories', op: 'create', row: { name: 'fruits' } }).code).toBe('DUPLICATE');
    expect(A({ entity: 'categories', op: 'create', row: { name: 'Green Mango', parentId: mango } }).success).toBe(false);
    expect(A({ entity: 'categories', op: 'create', row: { name: '' } }).success).toBe(false);
  });

  it('a farmer can only list under an active category; the product type comes from the category, not the client', () => {
    const tok = b.login('farmer@test.com', 'farmer123');
    const row = { id: 'c1', categoryId: 'cat-vegetables', subcategoryId: 'sub-tomato', type: 'Gold Bars', packets: 5, weightPerPacket: 5, predictedPrice: 1, qualityScore: 80, images: [], location: 'X' };
    ok(b.call({ action: 'BATCH', token: tok, ops: [{ op: 'insert', entity: 'crops', row }] }));
    expect(b.call({ action: 'GET_ALL', token: tok }).data.crops[0].type).toBe('Tomato');
    ok(A({ entity: 'categories', op: 'update', id: 'sub-onion', fields: { active: false } }));
    expect(b.call({ action: 'BATCH', token: tok, ops: [{ op: 'insert', entity: 'crops', row: { ...row, id: 'c2', subcategoryId: 'sub-onion' } }] }).success).toBe(false);
    expect(b.call({ action: 'BATCH', token: tok, ops: [{ op: 'insert', entity: 'crops', row: { ...row, id: 'c3', subcategoryId: '' } }] }).error).toMatch(/subcategory/i); // top-level with children needs a sub
    expect(b.call({ action: 'BATCH', token: tok, ops: [{ op: 'insert', entity: 'crops', row: { ...row, id: 'c4', categoryId: 'nope' } }] }).success).toBe(false);
  });

  it('renaming a category updates existing products and orders; in-use categories cannot be deleted', () => {
    const tok = b.login('farmer@test.com', 'farmer123');
    ok(b.call({ action: 'BATCH', token: tok, ops: [{ op: 'insert', entity: 'crops', row: { id: 'c1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 5, weightPerPacket: 5, predictedPrice: 1, qualityScore: 80, images: [], location: 'X' } }] }));
    ok(A({ entity: 'categories', op: 'update', id: 'sub-rice', fields: { name: 'Basmati Rice' } }));
    expect(b.call({ action: 'GET_ALL', token: tok }).data.crops[0].type).toBe('Basmati Rice');
    expect(A({ entity: 'categories', op: 'delete', id: 'sub-rice' }).code).toBe('IN_USE');
    expect(A({ entity: 'categories', op: 'delete', id: 'cat-vegetables' }).code).toBe('IN_USE'); // has subcategories
    const empty = ok(A({ entity: 'categories', op: 'create', row: { name: 'Spices' } })).data.id;
    ok(A({ entity: 'categories', op: 'delete', id: empty }));
    expect(cats().some(c => c.id === empty)).toBe(false);
  });
});

describe('products (admin CRUD)', () => {
  const product = { farmerId: '1', categoryId: 'cat-vegetables', subcategoryId: 'sub-potato', packets: 40, weightPerPacket: 10, predictedPrice: 30, qualityScore: 88, location: 'Rangpur', images: [] };
  const crops = () => b.call({ action: 'GET_ALL', token: admin }).data.crops;

  it('creates a product for a farmer; can list stock directly at an active hub', () => {
    const a = ok(A({ entity: 'crops', op: 'create', row: product })).data.id;
    expect(crops().find((c: { id: string }) => c.id === a)).toMatchObject({ farmerId: '1', type: 'Potato', totalWeight: 400, packetsRemaining: 40, status: 'pending' });
    const h = ok(A({ entity: 'crops', op: 'create', row: { ...product, status: 'available_at_hub', hubPointId: '1' } })).data.id;
    expect(crops().find((c: { id: string }) => c.id === h)).toMatchObject({ status: 'available_at_hub', hubPointId: '1' });
    // a retailer immediately sees it and can order it
    const ret = b.login('retailer@test.com', 'retail123');
    expect(b.call({ action: 'GET_ALL', token: ret }).data.crops.some((c: { id: string }) => c.id === h)).toBe(true);
  });

  it('validates farmer, category, numbers and hub', () => {
    for (const bad of [{ farmerId: '3' }, { farmerId: 'zzz' }, { categoryId: 'x' }, { packets: 0 }, { weightPerPacket: -1 }, { predictedPrice: -5 }, { qualityScore: 101 }, { status: 'available_at_hub' }, { status: 'available_at_hub', hubPointId: 'nope' }]) {
      expect(A({ entity: 'crops', op: 'create', row: { ...product, ...bad } }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('edits price, weight and stock; protects packets that are already ordered', () => {
    const id = ok(A({ entity: 'crops', op: 'create', row: { ...product, status: 'available_at_hub', hubPointId: '1' } })).data.id;
    const ret = b.login('retailer@test.com', 'retail123');
    ok(b.call({ action: 'BATCH', token: ret, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: id, packets: 25 } }] }));
    expect(A({ entity: 'crops', op: 'update', id, fields: { packets: 20 } }).error).toMatch(/already ordered/);
    ok(A({ entity: 'crops', op: 'update', id, fields: { packets: 100, predictedPrice: 45, weightPerPacket: 20 } }));
    expect(crops().find((c: { id: string }) => c.id === id)).toMatchObject({ packets: 100, packetsRemaining: 75, predictedPrice: 45, totalWeight: 2000 });
    expect(A({ entity: 'crops', op: 'update', id, fields: { status: 'collected' } }).code).toBe('FORBIDDEN');
    expect(A({ entity: 'crops', op: 'update', id, fields: { farmerId: '9' } }).code).toBe('FORBIDDEN');
  });

  it('delete is blocked while orders exist; after cancelling it succeeds and cleans related rows', () => {
    const id = ok(A({ entity: 'crops', op: 'create', row: { ...product, status: 'available_at_hub', hubPointId: '1' } })).data.id;
    const ret = b.login('retailer@test.com', 'retail123');
    ok(b.call({ action: 'BATCH', token: ret, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: id, packets: 5 } }] }));
    expect(A({ entity: 'crops', op: 'delete', id }).code).toBe('IN_USE');
    ok(b.call({ action: 'BATCH', token: admin, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'cancelled' } }] }));
    ok(A({ entity: 'crops', op: 'delete', id }));
    const d = b.call({ action: 'GET_ALL', token: admin }).data;
    expect(d.crops.some((c: { id: string }) => c.id === id)).toBe(false);
    expect(d.retailerOrders.some((o: { id: string }) => o.id === 'o1')).toBe(false);
  });
});

describe('orders (admin management)', () => {
  function stocked(packets = 40) {
    const id = ok(A({ entity: 'crops', op: 'create', row: { farmerId: '1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets, weightPerPacket: 10, predictedPrice: 10, qualityScore: 90, location: 'X', images: [], status: 'available_at_hub', hubPointId: '1' } })).data.id;
    return id as string;
  }
  const ret = () => b.login('retailer@test.com', 'retail123');
  const crop = (id: string) => b.call({ action: 'GET_ALL', token: admin }).data.crops.find((c: { id: string }) => c.id === id);
  const order = (id: string) => b.call({ action: 'GET_ALL', token: admin }).data.retailerOrders.find((o: { id: string }) => o.id === id);
  const upd = (id: string, fields: Record<string, unknown>, token = admin) => b.call({ action: 'BATCH', token, ops: [{ op: 'update', entity: 'retailerOrders', id, fields }] });

  it('cancelling an order returns the stock and re-opens a fully-ordered product', () => {
    const c = stocked(10);
    ok(b.call({ action: 'BATCH', token: ret(), ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: c, packets: 10 } }] }));
    expect(crop(c)).toMatchObject({ status: 'ordered', packetsRemaining: 0 });
    ok(upd('o1', { status: 'cancelled' }));
    expect(order('o1').status).toBe('cancelled');
    expect(crop(c)).toMatchObject({ status: 'available_at_hub', packetsRemaining: 10 });
    expect(upd('o1', { status: 'cancelled' }).success).toBe(false);       // cannot cancel twice
    expect(upd('o1', { status: 'pre_paid' }).success).toBe(false);        // cancelled is final
  });

  it('a collected order cannot be cancelled; a retailer may cancel only their own un-collected order', () => {
    const c = stocked(10);
    ok(b.call({ action: 'BATCH', token: ret(), ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: c, packets: 4 } }] }));
    ok(upd('o1', { status: 'pre_paid' }, ret()));
    ok(upd('o1', { status: 'collected' }, ret()));
    expect(upd('o1', { status: 'cancelled' }).success).toBe(false);
    ok(b.call({ action: 'BATCH', token: ret(), ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o2', cropId: c, packets: 2 } }] }));
    ok(upd('o2', { status: 'cancelled' }, ret()));
  });

  it('admin edits quantity (pre-payment only), keeping unit price and stock consistent; note is admin-only', () => {
    const c = stocked(10);
    ok(b.call({ action: 'BATCH', token: ret(), ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: c, packets: 4 } }] }));
    expect(order('o1').amount).toBe(400);                                  // 4 × 10 kg × ৳10
    ok(upd('o1', { packets: 6, note: 'Customer asked for more' }));
    expect(order('o1')).toMatchObject({ packets: 6, amount: 600, note: 'Customer asked for more' });
    expect(crop(c).packetsRemaining).toBe(4);
    expect(upd('o1', { packets: 11 }).code).toBe('STOCK');
    expect(upd('o1', { packets: 3 }, ret()).code).toBe('FORBIDDEN');
    expect(upd('o1', { note: 'x' }, ret()).code).toBe('FORBIDDEN');
    ok(upd('o1', { status: 'pre_paid' }));
    expect(upd('o1', { packets: 2 }).error).toMatch(/before payment/);
  });

  it('admin can walk an order through its whole life on a retailer’s behalf', () => {
    const c = stocked(10);
    ok(b.call({ action: 'BATCH', token: ret(), ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: c, packets: 10 } }] }));
    ok(upd('o1', { status: 'pre_paid' })); ok(upd('o1', { status: 'collected' }));
    expect(crop(c)).toMatchObject({ status: 'collected', packetsDelivered: 10 });
  });
});

describe('platform settings & maintenance mode', () => {
  it('updates name/shares; shares must total 100 and revenue maths follows them', () => {
    ok(A({ entity: 'settings', op: 'update', values: { platformName: 'কৃষি হাট', farmerShare: 60, transporterShare: 25, hubShare: 15 } }));
    expect(b.call({ action: 'GET_ALL', token: admin }).data.settings).toMatchObject({ platformName: 'কৃষি হাট', farmerShare: 60, transporterShare: 25, hubShare: 15 });
    expect(A({ entity: 'settings', op: 'update', values: { farmerShare: 90 } }).error).toMatch(/add up to 100/);
    for (const bad of [{ farmerShare: -5 }, { farmerShare: 'x' }, { farmerShare: 33.5 }, { nonsense: 1 }, { platformName: '' }, { supportEmail: 'nope' }, { maintenanceMode: 'yes' }]) {
      expect(A({ entity: 'settings', op: 'update', values: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('every role can read the public settings', () => {
    const t = b.login('farmer@test.com', 'farmer123');
    expect(b.call({ action: 'GET_ALL', token: t }).data.settings.platformName).toBe('KrishiBazar AI');
  });

  it('maintenance mode blocks non-admin logins and open sessions, but never the admin', () => {
    const farmerTok = b.login('farmer@test.com', 'farmer123');
    ok(A({ entity: 'settings', op: 'update', values: { maintenanceMode: true } }));
    expect(b.call({ action: 'LOGIN', email: 'retailer@test.com', password: 'retail123' }).code).toBe('MAINTENANCE');
    expect(b.call({ action: 'GET_ALL', token: farmerTok }).code).toBe('MAINTENANCE');
    expect(b.call({ action: 'GET_ALL', token: admin }).success).toBe(true);
    ok(A({ entity: 'settings', op: 'update', values: { maintenanceMode: false } }));
    expect(b.call({ action: 'GET_ALL', token: farmerTok }).success).toBe(true);
  });

  it('the payment limit honours a changed farmer share', () => {
    ok(A({ entity: 'settings', op: 'update', values: { farmerShare: 50, transporterShare: 30, hubShare: 20 } }));
    const c = ok(A({ entity: 'crops', op: 'create', row: { farmerId: '1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 10, weightPerPacket: 10, predictedPrice: 10, qualityScore: 90, location: 'X', images: [], status: 'available_at_hub', hubPointId: '1' } })).data.id;
    const ret = b.login('retailer@test.com', 'retail123');
    ok(b.call({ action: 'BATCH', token: ret, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: c, packets: 10 } }] }));
    ok(b.call({ action: 'BATCH', token: ret, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'pre_paid' } }] }));
    ok(b.call({ action: 'BATCH', token: ret, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'collected' } }] }));
    // order = 10×10×10 = 1000 → farmer share 50% = 500
    expect(A({ entity: 'crops', op: 'noop' }).success).toBe(false);
    const over = b.call({ action: 'BATCH', token: admin, ops: [{ op: 'insert', entity: 'payments', row: { id: 'p1', farmerId: '1', amount: 501 } }] });
    expect(over.success).toBe(false);
    ok(b.call({ action: 'BATCH', token: admin, ops: [{ op: 'insert', entity: 'payments', row: { id: 'p1', farmerId: '1', amount: 500 } }] }));
  });
});

describe('product photos (Google Drive)', () => {
  const farmer = () => b.login('farmer@test.com', 'farmer123');

  it('stores a valid image in Drive, shares it by link, and returns a thumbnail URL', () => {
    const r = ok(b.call({ action: 'UPLOAD_IMAGE', token: farmer(), dataUrl: JPEG }));
    expect(r.data.url).toMatch(/^https:\/\/drive\.google\.com\/thumbnail\?id=FILE[0-9a-f]{20}&sz=w800$/);
    expect(Object.values(b.files)[0]).toMatchObject({ shared: true, mime: 'image/jpeg' });
    expect(b.props.IMAGE_FOLDER_ID).toBe('folder-1');   // folder is created once and remembered
  });

  it('rejects non-images, fake image types, oversize files, anonymous and unauthorised roles', () => {
    const t = farmer();
    for (const bad of ['', 'hello', 'data:text/html;base64,PGgxPg==', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'), 'data:image/png;base64,' + 'A'.repeat(430000)]) {
      expect(b.call({ action: 'UPLOAD_IMAGE', token: t, dataUrl: bad }).success, bad.slice(0, 40)).toBe(false);
    }
    expect(b.call({ action: 'UPLOAD_IMAGE', dataUrl: JPEG }).code).toBe('UNAUTHORIZED');
    expect(b.call({ action: 'UPLOAD_IMAGE', token: b.login('retailer@test.com', 'retail123'), dataUrl: JPEG }).code).toBe('FORBIDDEN');
    expect(Object.keys(b.files)).toHaveLength(0);
  });

  it('limits uploads per user per hour', () => {
    const t = farmer();
    let last;
    for (let i = 0; i < 41; i++) last = b.call({ action: 'UPLOAD_IMAGE', token: t, dataUrl: JPEG });
    expect(last.code).toBe('RATE_LIMIT');
  });

  it('reports a clear error when Drive refuses, instead of crashing', () => {
    const bad = boot({ driveFails: true });
    const t = bad.login('farmer@test.com', 'farmer123');
    const r = bad.call({ action: 'UPLOAD_IMAGE', token: t, dataUrl: JPEG });
    expect(r.code).toBe('IMAGE_STORAGE');
    expect(r.error).toMatch(/Drive/);
  });

  it('products only accept our Drive thumbnails or tiny inline previews — never arbitrary URLs', () => {
    const t = farmer();
    const base = { categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 5, weightPerPacket: 5, predictedPrice: 1, qualityScore: 80, location: 'X' };
    const drive = 'https://drive.google.com/thumbnail?id=ABCDEFGHIJKLMNOP&sz=w800';
    ok(b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'crops', row: { ...base, id: 'ok1', images: [drive] } }] }));
    ok(b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'crops', row: { ...base, id: 'ok2', images: [JPEG] } }] }));
    for (const evil of ['https://evil.example/pixel.gif', 'http://drive.google.com/thumbnail?id=ABCDEFGHIJKLMNOP&sz=w800', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://drive.google.com/thumbnail?id=ab&sz=w800']) {
      expect(b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'crops', row: { ...base, id: 'bad', images: [evil] } }] }).code, evil).toBe('BAD_IMAGE');
    }
    expect(b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'crops', row: { ...base, id: 'bad', images: [drive, drive, drive, drive] } }] }).success).toBe(false);
  });

  it('every role that can see a product receives its images', () => {
    const drive = 'https://drive.google.com/thumbnail?id=ABCDEFGHIJKLMNOP&sz=w800';
    const id = ok(A({ entity: 'crops', op: 'create', row: { farmerId: '1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 5, weightPerPacket: 5, predictedPrice: 1, qualityScore: 80, location: 'X', images: [drive], status: 'available_at_hub', hubPointId: '1' } })).data.id;
    const ret = b.login('retailer@test.com', 'retail123');
    ok(b.call({ action: 'BATCH', token: ret, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: id, packets: 1 } }] }));
    for (const [email, pw] of [['farmer@test.com', 'farmer123'], ['hub@test.com', 'hubmanager123'], ['retailer@test.com', 'retail123'], ['admin@test.com', 'admin123']]) {
      const crop = b.call({ action: 'GET_ALL', token: b.login(email, pw) }).data.crops.find((c: { id: string }) => c.id === id);
      expect(crop?.images, email).toEqual([drive]);
    }
  });
});

describe('transporters: a booking must be visible to someone', () => {
  const farmer = () => b.login('farmer@test.com', 'farmer123');
  const transportersFor = (token: string) => b.call({ action: 'GET_ALL', token }).data.transporters as { id: string; name: string; bookable?: boolean }[];
  const addCrop = (token: string, id = 'c1') => ok(b.call({ action: 'BATCH', token, ops: [{ op: 'insert', entity: 'crops', row: { id, categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 10, weightPerPacket: 5, predictedPrice: 20, qualityScore: 90, images: [], location: 'X' } }] }));
  const book = (token: string, transporterId: string, cropId = 'c1', id = 'b1') => b.call({ action: 'BATCH', token, ops: [
    { op: 'insert', entity: 'bookings', row: { id, cropId, transporterId, hubPointId: '1', currentLoad: 10, route: 'A → B', pickupTime: '2026-01-01T00:00:00.000Z' } },
    { op: 'update', entity: 'crops', id: cropId, fields: { status: 'booked', bookingId: id, hubPointId: '1', transporterId } }] });

  it('a fresh deployment offers only transporters that have a login account', () => {
    expect(transportersFor(farmer()).map(t => t.id)).toEqual(['2']);
    expect(b.sheets.Transporters.getLastRow()).toBe(2);               // seed no longer contains logins-less "ghost" transporters
  });

  it('ghost transporters left over from an older deployment are hidden from farmers AND refused by the server', () => {
    b.sheets.Transporters.rows.push(['T2', 'Ghost Karim', 500, 150, 350, 'Dhaka Route', 'available']);   // as seeded by v2.0
    const t = farmer(); addCrop(t);
    expect(transportersFor(t).map(x => x.id)).toEqual(['2']);
    const r = book(t, 'T2');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not available/);
    // …but the admin still sees the complete list (needed to edit capacities)
    expect(transportersFor(admin).map(x => x.id).sort()).toEqual(['2', 'T2']);
  });

  it('every transporter a farmer can pick can actually see the booking', () => {
    const made = ok(A({ entity: 'users', op: 'create', row: { name: 'Truck Co', email: 'truck@x.com', role: 'transporter', password: 'password123', vehicleCapacity: 300 } }));
    const t = farmer(); addCrop(t);
    const offered = transportersFor(t).map(x => x.id);
    expect(offered).toContain(made.data.id);
    for (const id of offered) {
      b.sheets.Bookings.rows.length = 1;                              // reset between iterations
      b.sheets.Crops.rows[1][8] = 'pending';
      const email = id === '2' ? 'transporter@test.com' : 'truck@x.com';
      const pw = id === '2' ? 'transport123' : 'password123';
      ok(book(t, id));
      const seen = b.call({ action: 'GET_ALL', token: b.login(email, pw) }).data.bookings;
      expect(seen.map((x: { id: string }) => x.id), `transporter ${id}`).toEqual(['b1']);
    }
  });

  it('a deactivated transporter disappears from the farmer’s list at once and cannot be booked', () => {
    ok(A({ entity: 'users', op: 'update', id: '2', fields: { active: false } }));
    const t = farmer(); addCrop(t);
    expect(transportersFor(t)).toEqual([]);
    expect(book(t, '2').success).toBe(false);
    ok(A({ entity: 'users', op: 'update', id: '2', fields: { active: true } }));
    expect(transportersFor(t).map(x => x.id)).toEqual(['2']);
  });

  it('changing a user’s role to transporter creates the vehicle row so they become bookable', () => {
    const r = ok(A({ entity: 'users', op: 'create', row: { name: 'Was retailer', email: 'wr@x.com', role: 'retailer', password: 'password123' } }));
    expect(transportersFor(farmer()).map(x => x.id)).toEqual(['2']);
    ok(A({ entity: 'users', op: 'update', id: r.data.id, fields: { role: 'transporter', vehicleCapacity: 120 } }));
    const list = transportersFor(farmer());
    expect(list.find(x => x.id === r.data.id)).toMatchObject({ vehicleCapacity: 120 });
  });

  it('the Apps Script editor helper addUser also creates the vehicle row', () => {
    (b.sandbox.addUser as (...a: string[]) => string)('77', 'ed@x.com', 'Editor Added', 'transporter', 'Dhaka', 'password123');
    expect(transportersFor(farmer()).map(x => x.id).sort()).toEqual(['2', '77']);
  });
});

describe('backend version handshake', () => {
  it('reports its version on the health check and with every GET_ALL', () => {
    const health = JSON.parse((b.sandbox.doGet as () => { getContent(): string })().getContent());
    expect(health.version).toBe(3);
    expect(b.call({ action: 'GET_ALL', token: admin }).data.meta).toEqual({ version: 3 });
  });
});

describe('legacy product photos from an older deployment', () => {
  it('can still be edited (kept as-is) but no NEW non-allowlisted image may be added', () => {
    const id = ok(A({ entity: 'crops', op: 'create', row: { farmerId: '1', categoryId: 'cat-grains', subcategoryId: 'sub-rice', packets: 5, weightPerPacket: 5, predictedPrice: 10, qualityScore: 90, location: 'X', images: [] } })).data.id;
    const legacy = 'https://images.pexels.com/photos/1458702/pexels-photo-1458702.jpeg';
    const row = b.sheets.Crops.rows.findIndex(r => r[0] === id);
    b.sheets.Crops.rows[row][7] = JSON.stringify([legacy]);             // as written by v2.0
    ok(A({ entity: 'crops', op: 'update', id, fields: { predictedPrice: 99, images: [legacy] } }));
    expect(b.call({ action: 'GET_ALL', token: admin }).data.crops.find((c: { id: string }) => c.id === id)).toMatchObject({ predictedPrice: 99, images: [legacy] });
    expect(A({ entity: 'crops', op: 'update', id, fields: { images: [legacy, 'https://evil.example/x.png'] } }).code).toBe('BAD_IMAGE');
  });
});

describe('upgrading an existing v2.0 deployment', () => {
  it('re-running setupSheets adds the new columns without touching existing data', () => {
    // Recreate the OLD layout (before categories/active/note existed) with data in it
    const old = boot();
    old.sheets.Users.rows[0] = ['id', 'email', 'name', 'role', 'phone', 'location', 'passwordHash', 'active'];
    old.sheets.Users.rows = old.sheets.Users.rows.map(r => r.slice(0, 8));
    old.sheets.HubPoints.rows = old.sheets.HubPoints.rows.map(r => r.slice(0, 6));
    delete old.sheets.Categories; delete old.sheets.Settings;
    old.sheets.Users.rows[1][7] = 'true';
    const before = old.sheets.Users.rows[1].slice();
    (old.sandbox.setupSheets as () => string)();
    expect(old.sheets.Users.rows[0]).toContain('createdAt');
    expect(old.sheets.HubPoints.rows[0].slice(-2)).toEqual(['phone', 'active']);
    expect(old.sheets.Users.rows[1].slice(0, 8)).toEqual(before);
    expect(old.sheets.Categories.getLastRow()).toBeGreaterThan(5);
    expect(old.login('farmer@test.com', 'farmer123')).toBeTruthy();
  });

  it('keeps working before setup is re-run (missing optional sheets are tolerated)', () => {
    const old = boot();
    delete old.sheets.Categories; delete old.sheets.Settings;
    const t = old.login('farmer@test.com', 'farmer123');
    const d = old.call({ action: 'GET_ALL', token: t }).data;
    expect(d.categories).toEqual([]);
    expect(d.settings.platformName).toBe('KrishiBazar AI');
    // without categories a farmer can still add a product with a free-text type (legacy behaviour)
    expect(old.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'crops', row: { id: 'c1', type: 'Potato', packets: 5, weightPerPacket: 5, predictedPrice: 1, qualityScore: 80, images: [], location: 'X' } }] }).success).toBe(true);
  });
});
