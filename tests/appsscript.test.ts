import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ─── Minimal in-memory mock of the Google Apps Script services ────────────────

class MockSheet {
  rows: unknown[][] = [];
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  deleteRow(i: number) { this.rows.splice(i - 1, 1); }
  setFrozenRows() {}
  getRange(r: number, c: number, nr = 1, nc = 1) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sh = this;
    const api = {
      getValues() {
        const out: unknown[][] = [];
        for (let i = 0; i < nr; i++) {
          const row = sh.rows[r - 1 + i] || [];
          out.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? ''));
        }
        return out;
      },
      setValues(v: unknown[][]) {
        v.forEach((vals, i) => {
          const idx = r - 1 + i;
          sh.rows[idx] = sh.rows[idx] || [];
          vals.forEach((x, j) => { sh.rows[idx][c - 1 + j] = x; });
        });
      },
      setNumberFormat() { return api; },
      setFontWeight() { return api; },
      setBackground() { return api; },
      setFontColor() { return api; },
    };
    return api;
  }
}

function loadBackend() {
  const sheets: Record<string, MockSheet> = {};
  const cacheStore = new Map<string, string>();
  const ss = {
    getSheetByName: (n: string) => sheets[n] ?? null,
    insertSheet: (n: string) => (sheets[n] = new MockSheet()),
  };
  const driveFiles: Record<string, { name: string; mime: string; bytes: number[]; shared: boolean }> = {};
  const props: Record<string, string> = {};
  let folder: { getId(): string; createFile(b: { bytes: number[]; mime: string; name: string }): unknown } | null = null;
  const makeFolder = () => (folder = {
    getId: () => 'folder-1',
    createFile: (blob) => {
      const id = 'FILE' + crypto.randomBytes(10).toString('hex');
      driveFiles[id] = { name: blob.name, mime: blob.mime, bytes: blob.bytes, shared: false };
      return { getId: () => id, setSharing: () => { driveFiles[id].shared = true; } };
    },
  });
  const sandbox: Record<string, unknown> = {
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
      getFoldersByName: () => ({ hasNext: () => !!folder, next: () => folder }),
      createFolder: () => makeFolder(),
      getFolderById: () => { if (!folder) throw new Error('no folder'); return folder; },
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null, setProperty: (k: string, v: string) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => cacheStore.get(k) ?? null,
        put: (k: string, v: string) => { cacheStore.set(k, v); },
        remove: (k: string) => { cacheStore.delete(k); },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_a: string, input: string | number[]) =>
        Array.from(crypto.createHash('sha256').update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)).digest()),
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString('base64'),
      base64Decode: (b64: string) => Array.from(Buffer.from(b64, 'base64')).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name }),
      getUuid: () => crypto.randomUUID(),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s: string) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }),
    },
    Logger: { log() {} },
    console,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '../google-apps-script/Code.gs'), 'utf8');
  vm.runInContext(code, sandbox);

  const call = (body: Record<string, unknown>) => {
    const out = (sandbox.doPost as (e: unknown) => { getContent(): string })({
      postData: { contents: JSON.stringify(body) },
    });
    return JSON.parse(out.getContent());
  };
  return { sandbox, sheets, call, cacheStore, driveFiles };
}

type Backend = ReturnType<typeof loadBackend>;
type AddUser = (id: string, email: string, name: string, role: string, location: string, password: string) => string;
const login = (b: Backend, email: string, password: string) => b.call({ action: 'LOGIN', email, password });
const tokenFor = (b: Backend, email: string, password: string): string => {
  const r = login(b, email, password);
  if (!r.success) throw new Error('login failed: ' + r.error);
  return r.data.token;
};

const cropRow = (over: Record<string, unknown> = {}) => ({
  id: 'crop-1', categoryId: 'cat-vegetables', subcategoryId: 'sub-potato', type: 'ignored-by-server', packets: 50, weightPerPacket: 10, images: [], location: 'Jessore',
  predictedPrice: 25, qualityScore: 90, ...over,
});

let b: Backend;
beforeEach(() => {
  b = loadBackend();
  (b.sandbox.setupSheets as () => string)();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('setup & health', () => {
  it('creates all sheets with headers and seeds hubs/transporters/users', () => {
    expect(Object.keys(b.sheets).sort()).toEqual(
      ['Bookings', 'Categories', 'Complaints', 'Crops', 'FarmerPayments', 'HubPoints', 'RetailerOrders', 'Settings', 'Transporters', 'Users'].sort()
    );
    expect(b.sheets.Crops.rows[0][0]).toBe('id');
    expect(b.sheets.Users.getLastRow()).toBe(6);
    expect(b.sheets.HubPoints.getLastRow()).toBe(3);
  });

  it('never stores plaintext passwords', () => {
    const dump = JSON.stringify(b.sheets.Users.rows);
    expect(dump).not.toContain('farmer123');
    expect(dump).not.toContain('admin123');
  });
});

describe('authentication', () => {
  it('logs in with correct credentials and hides the hash', () => {
    const r = login(b, 'farmer@test.com', 'farmer123');
    expect(r.success).toBe(true);
    expect(r.data.user.role).toBe('farmer');
    expect(r.data.token.length).toBeGreaterThan(30);
    expect(JSON.stringify(r)).not.toContain('passwordHash');
  });

  it('rejects wrong password and unknown email with the same message', () => {
    const a = login(b, 'farmer@test.com', 'wrong');
    const c = login(b, 'nobody@test.com', 'whatever');
    expect(a.success).toBe(false);
    expect(a.error).toBe(c.error);
  });

  it('locks the account after 5 failed attempts, even with the right password', () => {
    for (let i = 0; i < 5; i++) login(b, 'farmer@test.com', 'bad');
    const r = login(b, 'farmer@test.com', 'farmer123');
    expect(r.success).toBe(false);
    expect(r.code).toBe('LOCKED');
  });

  it('rejects data requests without a token or with an expired session', () => {
    expect(b.call({ action: 'GET_ALL' }).code).toBe('UNAUTHORIZED');
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    b.cacheStore.delete('s:' + token);
    expect(b.call({ action: 'GET_ALL', token }).code).toBe('UNAUTHORIZED');
  });

  it('logout invalidates the token', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    b.call({ action: 'LOGOUT', token });
    expect(b.call({ action: 'GET_ALL', token }).code).toBe('UNAUTHORIZED');
  });

  it('setUserPassword changes the password', () => {
    (b.sandbox.setUserPassword as (e: string, p: string) => string)('farmer@test.com', 'NewStrongPass1');
    expect(login(b, 'farmer@test.com', 'farmer123').success).toBe(false);
    expect(login(b, 'farmer@test.com', 'NewStrongPass1').success).toBe(true);
  });
});

describe('crops: create, ownership, validation', () => {
  it('farmer adds a crop; server overrides ownership and derived fields', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    const r = b.call({ action: 'BATCH', token, ops: [{ op: 'insert', entity: 'crops',
      row: cropRow({ farmerId: 'SOMEONE-ELSE', status: 'collected', packetsDelivered: 999, totalWeight: 1 }) }] });
    expect(r.success).toBe(true);
    const all = b.call({ action: 'GET_ALL', token }).data;
    expect(all.crops).toHaveLength(1);
    const c = all.crops[0];
    expect(c.farmerId).toBe('1');
    expect(c.status).toBe('pending');
    expect(c.packetsDelivered).toBe(0);
    expect(c.totalWeight).toBe(500);
    expect(c.packetsRemaining).toBe(50);
  });

  it('rejects duplicate ids', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    const op = { op: 'insert', entity: 'crops', row: cropRow() };
    expect(b.call({ action: 'BATCH', token, ops: [op] }).success).toBe(true);
    const again = b.call({ action: 'BATCH', token, ops: [op] });
    expect(again.success).toBe(false);
    expect(again.code).toBe('DUPLICATE');
  });

  it('rejects invalid numbers and missing type', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    for (const bad of [{ packets: 0 }, { packets: -5 }, { packets: 1.5 }, { packets: 'abc' }, { categoryId: '' }, { qualityScore: 500 }]) {
      const r = b.call({ action: 'BATCH', token, ops: [{ op: 'insert', entity: 'crops', row: cropRow(bad) }] });
      expect(r.success, JSON.stringify(bad)).toBe(false);
    }
    expect(b.sheets.Crops.getLastRow()).toBe(1);
  });

  it('rejects a value that exceeds the Google Sheets cell limit', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    const huge = 'x'.repeat(46000);
    const r = b.call({ action: 'BATCH', token, ops: [{ op: 'insert', entity: 'crops', row: cropRow({ images: ['data:image/png;base64,' + huge] }) }] });
    expect(r.success).toBe(false);
    expect(['BAD_IMAGE', 'TOO_LARGE']).toContain(r.code);
    expect(b.sheets.Crops.getLastRow()).toBe(1);
  });

  it('non-farmers cannot add crops', () => {
    const token = tokenFor(b, 'retailer@test.com', 'retail123');
    const r = b.call({ action: 'BATCH', token, ops: [{ op: 'insert', entity: 'crops', row: cropRow() }] });
    expect(r.code).toBe('FORBIDDEN');
  });

  it('a batch with one bad operation writes nothing (all-or-nothing)', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    const r = b.call({ action: 'BATCH', token, ops: [
      { op: 'insert', entity: 'crops', row: cropRow({ id: 'good' }) },
      { op: 'insert', entity: 'crops', row: cropRow({ id: 'bad', packets: 0 }) },
    ] });
    expect(r.success).toBe(false);
    expect(b.sheets.Crops.getLastRow()).toBe(1);
  });
});

describe('authorization (role scoping)', () => {
  function seedCropFor(farmerEmail: string, farmerPw: string, id: string) {
    const t = tokenFor(b, farmerEmail, farmerPw);
    return b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'crops', row: cropRow({ id }) }] });
  }

  it('GET_ALL only returns the caller’s own crops to a farmer', () => {
    seedCropFor('farmer@test.com', 'farmer123', 'mine');
    (b.sandbox.addUser as AddUser)('9', 'other@test.com', 'Other Farmer', 'farmer', 'X', 'password123');
    seedCropFor('other@test.com', 'password123', 'theirs');
    const t = tokenFor(b, 'farmer@test.com', 'farmer123');
    const crops = b.call({ action: 'GET_ALL', token: t }).data.crops;
    expect(crops.map((c: { id: string }) => c.id)).toEqual(['mine']);
  });

  it('a farmer cannot read payments of others, complaints, or retailer orders', () => {
    const t = tokenFor(b, 'farmer@test.com', 'farmer123');
    const d = b.call({ action: 'GET_ALL', token: t }).data;
    expect(d.complaints).toEqual([]);
    expect(d.retailerOrders).toEqual([]);
    expect(d.payments).toEqual([]);
  });

  it('a farmer cannot modify another farmer’s crop', () => {
    (b.sandbox.addUser as AddUser)('9', 'other@test.com', 'Other Farmer', 'farmer', 'X', 'password123');
    seedCropFor('other@test.com', 'password123', 'theirs');
    const t = tokenFor(b, 'farmer@test.com', 'farmer123');
    const r = b.call({ action: 'BATCH', token: t, ops: [{ op: 'update', entity: 'crops', id: 'theirs', fields: { currentLocation: 'hacked' } }] });
    expect(r.code).toBe('FORBIDDEN');
  });

  it('a farmer cannot jump a crop to "collected" or edit server-controlled fields', () => {
    seedCropFor('farmer@test.com', 'farmer123', 'c1');
    const t = tokenFor(b, 'farmer@test.com', 'farmer123');
    const jump = b.call({ action: 'BATCH', token: t, ops: [{ op: 'update', entity: 'crops', id: 'c1', fields: { status: 'collected' } }] });
    expect(jump.code).toBe('FORBIDDEN');
    const stock = b.call({ action: 'BATCH', token: t, ops: [{ op: 'update', entity: 'crops', id: 'c1', fields: { packetsRemaining: 9999 } }] });
    expect(stock.code).toBe('FORBIDDEN');
  });

  it('only admins see complaints and payments', () => {
    const t = tokenFor(b, 'admin@test.com', 'admin123');
    const d = b.call({ action: 'GET_ALL', token: t }).data;
    expect(Array.isArray(d.complaints)).toBe(true);
    expect(Array.isArray(d.payments)).toBe(true);
  });

  it('non-admins cannot record payments', () => {
    const t = tokenFor(b, 'farmer@test.com', 'farmer123');
    const r = b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'payments', row: { id: 'p1', farmerId: '1', amount: 100 } }] });
    expect(r.code).toBe('FORBIDDEN');
  });

  it('rejects unknown actions, malformed bodies, and unknown entities', () => {
    const t = tokenFor(b, 'admin@test.com', 'admin123');
    expect(b.call({ action: 'DROP_TABLES' }).success).toBe(false);
    expect(b.call({}).success).toBe(false);
    expect(b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'users', row: { id: 'x' } }] }).success).toBe(false);
    expect(b.call({ action: 'BATCH', token: t, ops: [{ op: 'insert', entity: 'nope', row: { id: 'x' } }] }).success).toBe(false);
  });
});

describe('full supply-chain flow (farmer → transporter → hub → retailer → admin)', () => {
  it('runs end to end with server-authoritative stock and payments', () => {
    const farmer = tokenFor(b, 'farmer@test.com', 'farmer123');
    const trans = tokenFor(b, 'transporter@test.com', 'transport123');
    const hub = tokenFor(b, 'hub@test.com', 'hubmanager123');
    const retailer = tokenFor(b, 'retailer@test.com', 'retail123');
    const admin = tokenFor(b, 'admin@test.com', 'admin123');
    const ok = (r: { success: boolean; error?: string }) => { expect(r.success, r.error).toBe(true); return r; };

    // 1. farmer adds crop and books transporter "2"
    ok(b.call({ action: 'BATCH', token: farmer, ops: [{ op: 'insert', entity: 'crops', row: cropRow({ id: 'c1' }) }] }));
    ok(b.call({ action: 'BATCH', token: farmer, ops: [
      { op: 'insert', entity: 'bookings', row: { id: 'b1', cropId: 'c1', transporterId: '2', hubPointId: '1', currentLoad: 50, route: 'Jessore → Dhaka', pickupTime: '2026-01-01T00:00:00.000Z' } },
      { op: 'update', entity: 'crops', id: 'c1', fields: { status: 'booked', bookingId: 'b1', hubPointId: '1', transporterId: '2', transporterName: 'x' } },
    ] }));

    // transporter capacity is derived from active bookings
    const farmerView = b.call({ action: 'GET_ALL', token: farmer }).data;
    const t2 = farmerView.transporters.find((t: { id: string }) => t.id === '2');
    expect(t2.currentLoad).toBe(50);
    expect(t2.availableCapacity).toBe(450);

    // 2. transporter progresses the booking and crop
    ok(b.call({ action: 'BATCH', token: trans, ops: [{ op: 'update', entity: 'bookings', id: 'b1', fields: { status: 'confirmed' } }] }));
    ok(b.call({ action: 'BATCH', token: trans, ops: [
      { op: 'update', entity: 'bookings', id: 'b1', fields: { status: 'in_transit' } },
      { op: 'update', entity: 'crops', id: 'c1', fields: { status: 'in_transit' } },
    ] }));
    // cannot skip steps
    expect(b.call({ action: 'BATCH', token: trans, ops: [{ op: 'update', entity: 'bookings', id: 'b1', fields: { status: 'pending' } }] }).success).toBe(false);
    ok(b.call({ action: 'BATCH', token: trans, ops: [
      { op: 'update', entity: 'bookings', id: 'b1', fields: { status: 'delivered_to_hub' } },
      { op: 'update', entity: 'crops', id: 'c1', fields: { status: 'delivered_to_hub' } },
    ] }));
    // capacity is released once delivered
    const after = b.call({ action: 'GET_ALL', token: farmer }).data.transporters.find((t: { id: string }) => t.id === '2');
    expect(after.currentLoad).toBe(0);

    // 3. hub manager receives (hub manager id '3' is a number-like string; scoping must still work)
    const hubView = b.call({ action: 'GET_ALL', token: hub }).data;
    expect(hubView.hubPoints.map((h: { id: string }) => h.id).sort()).toEqual(['1', '2']);
    expect(hubView.crops).toHaveLength(1);
    ok(b.call({ action: 'BATCH', token: hub, ops: [{ op: 'update', entity: 'crops', id: 'c1', fields: { status: 'available_at_hub' } }] }));

    // 4. retailer orders 30 of 50 — server computes amount and decrements stock
    const o1 = ok(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o1', cropId: 'c1', packets: 30, amount: 1 } }] }));
    expect(o1.success).toBe(true);
    let rv = b.call({ action: 'GET_ALL', token: retailer }).data;
    expect(rv.crops[0].packetsRemaining).toBe(20);
    expect(rv.crops[0].status).toBe('available_at_hub'); // still orderable
    expect(rv.retailerOrders[0].amount).toBe(30 * 10 * 25); // client-supplied amount ignored

    // overselling is rejected
    const over = b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o2', cropId: 'c1', packets: 21 } }] });
    expect(over.success).toBe(false);
    expect(over.code).toBe('STOCK');
    // can order the rest
    ok(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'insert', entity: 'retailerOrders', row: { id: 'o3', cropId: 'c1', packets: 20 } }] }));
    rv = b.call({ action: 'GET_ALL', token: retailer }).data;
    expect(rv.crops[0].status).toBe('ordered');

    // cannot collect before paying
    const early = b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'collected' } }] });
    expect(early.success).toBe(false);

    // pay + collect o1 (30/50 delivered → crop not fully collected)
    ok(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'pre_paid' } }] }));
    ok(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'collected' } }] }));
    let fc = b.call({ action: 'GET_ALL', token: farmer }).data.crops[0];
    expect(fc.packetsDelivered).toBe(30);
    expect(fc.status).toBe('ordered');
    // collecting twice is rejected (no double counting)
    expect(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o1', fields: { status: 'collected' } }] }).success).toBe(false);

    // pay + collect o3 → crop fully collected
    ok(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o3', fields: { status: 'pre_paid' } }] }));
    ok(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'retailerOrders', id: 'o3', fields: { status: 'collected' } }] }));
    fc = b.call({ action: 'GET_ALL', token: farmer }).data.crops[0];
    expect(fc.packetsDelivered).toBe(50);
    expect(fc.status).toBe('collected');

    // 5. admin pays the farmer: 70% of (30+20)*10*25 = 8750; overpaying is rejected
    const owed = 50 * 10 * 25 * 0.7;
    const overpay = b.call({ action: 'BATCH', token: admin, ops: [{ op: 'insert', entity: 'payments', row: { id: 'p1', farmerId: '1', amount: owed + 1 } }] });
    expect(overpay.success).toBe(false);
    ok(b.call({ action: 'BATCH', token: admin, ops: [{ op: 'insert', entity: 'payments', row: { id: 'p1', farmerId: '1', amount: owed } }] }));
    expect(b.call({ action: 'BATCH', token: admin, ops: [{ op: 'insert', entity: 'payments', row: { id: 'p2', farmerId: '1', amount: 1 } }] }).success).toBe(false);
    const fp = b.call({ action: 'GET_ALL', token: farmer }).data.payments;
    expect(fp).toHaveLength(1);
    expect(fp[0].amount).toBe(owed);
  });

  it('refuses a booking that exceeds transporter capacity (using a real transporter account)', () => {
    const adminTok = tokenFor(b, 'admin@test.com', 'admin123');
    const made = b.call({ action: 'ADMIN', token: adminTok, entity: 'users', op: 'create',
      row: { name: 'Small Truck', email: 'small@x.com', role: 'transporter', password: 'password123', vehicleCapacity: 50 } });
    expect(made.success, made.error).toBe(true);
    const farmer = tokenFor(b, 'farmer@test.com', 'farmer123');
    b.call({ action: 'BATCH', token: farmer, ops: [{ op: 'insert', entity: 'crops', row: cropRow({ id: 'big', packets: 100 }) }] });
    const r = b.call({ action: 'BATCH', token: farmer, ops: [{ op: 'insert', entity: 'bookings', row: { id: 'bx', cropId: 'big', transporterId: made.data.id, hubPointId: '1', currentLoad: 100, pickupTime: '2026-01-01T00:00:00.000Z' } }] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/capacity/i);
  });
});

describe('number-like ids stored as numbers by Sheets', () => {
  it('still match string user ids', () => {
    // Simulate Google Sheets converting the manager id "3" into the number 3
    b.sheets.HubPoints.rows[1][4] = 3;
    const hub = tokenFor(b, 'hub@test.com', 'hubmanager123');
    const d = b.call({ action: 'GET_ALL', token: hub }).data;
    expect(d.hubPoints.length).toBeGreaterThan(0);
    expect(typeof d.hubPoints[0].managerId).toBe('string');
  });
});

describe('public complaint form', () => {
  const retailerId = '4';
  it('accepts a valid complaint with server-generated ids and no login', () => {
    const r = b.call({ action: 'SUBMIT_COMPLAINT', complaint: { retailerId, description: 'Rotten tomatoes', severity: 'high', consumerId: 'spoofed', status: 'resolved' } });
    expect(r.success).toBe(true);
    const admin = tokenFor(b, 'admin@test.com', 'admin123');
    const c = b.call({ action: 'GET_ALL', token: admin }).data.complaints[0];
    expect(c.status).toBe('pending');
    expect(c.consumerId).not.toBe('spoofed');
  });

  it('validates input', () => {
    const base = { retailerId, description: 'ok', severity: 'low' };
    expect(b.call({ action: 'SUBMIT_COMPLAINT', complaint: { ...base, description: '   ' } }).success).toBe(false);
    expect(b.call({ action: 'SUBMIT_COMPLAINT', complaint: { ...base, description: 'x'.repeat(501) } }).success).toBe(false);
    expect(b.call({ action: 'SUBMIT_COMPLAINT', complaint: { ...base, severity: 'apocalyptic' } }).success).toBe(false);
    expect(b.call({ action: 'SUBMIT_COMPLAINT', complaint: { ...base, retailerId: 'ghost' } }).success).toBe(false);
    expect(b.call({ action: 'SUBMIT_COMPLAINT', complaint: { ...base, retailerId: '1' } }).success).toBe(false); // a farmer is not a retailer
    expect(b.sheets.Complaints.getLastRow()).toBe(1);
  });

  it('admin can update complaint status; others cannot', () => {
    b.call({ action: 'SUBMIT_COMPLAINT', complaint: { retailerId, description: 'bad', severity: 'low' } });
    const admin = tokenFor(b, 'admin@test.com', 'admin123');
    const id = b.call({ action: 'GET_ALL', token: admin }).data.complaints[0].id;
    expect(b.call({ action: 'BATCH', token: admin, ops: [{ op: 'update', entity: 'complaints', id, fields: { status: 'resolved' } }] }).success).toBe(true);
    expect(b.call({ action: 'BATCH', token: admin, ops: [{ op: 'update', entity: 'complaints', id, fields: { status: 'bogus' } }] }).success).toBe(false);
    const retailer = tokenFor(b, 'retailer@test.com', 'retail123');
    expect(b.call({ action: 'BATCH', token: retailer, ops: [{ op: 'update', entity: 'complaints', id, fields: { status: 'resolved' } }] }).success).toBe(false);
  });
});

describe('abuse protection', () => {
  it('rate-limits after too many requests per minute', () => {
    b.sandbox.RATE_LIMIT_PER_MIN = 5;
    const results = Array.from({ length: 8 }, () => b.call({ action: 'LOGOUT' }));
    expect(results.slice(0, 5).every(r => r.success)).toBe(true);
    expect(results[7].code).toBe('RATE_LIMIT');
  });

  it('does not leak internal error details', () => {
    const out = (b.sandbox.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: '{not json' } }).getContent();
    expect(JSON.parse(out).success).toBe(false);
    expect(out).not.toMatch(/SyntaxError|at /);
  });

  it('stores text as plain text so "=FORMULA()" cannot execute (format forced)', () => {
    const token = tokenFor(b, 'farmer@test.com', 'farmer123');
    const r = b.call({ action: 'BATCH', token, ops: [{ op: 'insert', entity: 'crops', row: cropRow({ location: '=IMPORTXML("http://evil")' }) }] });
    expect(r.success).toBe(true);
    // value is stored verbatim (a text cell), not evaluated
    expect(b.sheets.Crops.rows[1][12]).toBe('=IMPORTXML("http://evil")');
  });
});
