/**
 * KrishiBazar AI — Google Apps Script backend (v2)
 * ================================================
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * "Anyone" only means the URL is reachable — every data action except the
 * public complaint form requires a session token obtained via LOGIN.
 *
 * Security model
 *  - Passwords are stored salted + iterated SHA-256 in the Users sheet.
 *  - Sessions are random tokens kept in CacheService (6 h TTL).
 *  - Every action is authorised by role AND ownership, server-side.
 *  - LockService serialises writes (no lost updates between users).
 *  - Order stock and collection are computed here, never trusted from the client.
 *  - Global per-minute rate limit + per-account login lockout.
 */

// ── Config ────────────────────────────────────────────────────────────────────
// Bump when the front-end needs something new from the backend. The site compares this number
// and tells the administrator if the deployed script is older than the site.
var BACKEND_VERSION     = 3;
var RATE_LIMIT_PER_MIN  = 600;
var LOGIN_MAX_ATTEMPTS  = 5;
var LOGIN_LOCK_SECONDS  = 900;
var SESSION_SECONDS     = 21600;
var MAX_CELL_CHARS      = 45000;   // Google Sheets hard limit is 50,000
var MAX_TEXT_CHARS      = 2000;
var MAX_BATCH_OPS       = 12;
var MAX_HISTORY         = 30;
var HASH_ITERATIONS     = 1000;
var MAX_IMAGE_B64       = 420000;  // ≈ 310 KB of image data per upload
var MAX_INLINE_IMAGE    = 20000;   // fallback thumbnail stored directly in the sheet
var UPLOADS_PER_HOUR    = 40;
var IMAGE_FOLDER_NAME   = 'KrishiBazar Product Images';
var DEFAULT_SETTINGS = {
  platformName: 'KrishiBazar AI', supportPhone: '', supportEmail: '',
  farmerShare: 70, transporterShare: 20, hubShare: 10, maintenanceMode: false
};
var COMPLAINT_MAX_CHARS = 500;

var CROP_STATUSES      = ['pending','booked','in_transit','delivered_to_hub','available_at_hub','ordered','collected'];
var BOOKING_STATUSES   = ['pending','confirmed','in_transit','delivered_to_hub'];
var ORDER_STATUSES     = ['pre_booked','pre_paid','collected','cancelled'];
var COMPLAINT_STATUSES = ['pending','investigating','resolved'];
var SEVERITIES         = ['low','medium','high'];
var ROLES              = ['farmer','transporter','hub','retailer','admin'];

var ORDER_NEXT   = { pre_booked: ['pre_paid', 'cancelled'], pre_paid: ['collected', 'cancelled'] };
var BOOKING_NEXT = { pending: 'confirmed', confirmed: 'in_transit', in_transit: 'delivered_to_hub' };
var CROP_TRANSITIONS = {
  farmer:      { pending: ['booked'] },
  transporter: { booked: ['in_transit'], in_transit: ['delivered_to_hub'] },
  hub:         { delivered_to_hub: ['available_at_hub'] }
};

// ── Sheet definitions (column 1 is always "id") ───────────────────────────────
var ENTITIES = {
  users: {
    sheet: 'Users',
    headers: ['id','email','name','role','phone','location','passwordHash','active','createdAt'],
    bool: ['active'], boolDefault: false
  },
  crops: {
    sheet: 'Crops',
    headers: ['id','farmerId','farmerName','type','packets','weightPerPacket','totalWeight','images',
              'status','bookingId','hubPointId','predictedPrice','location','qualityScore','createdAt',
              'scheduledPickupTime','deliveredToHubTime','collectedByRetailerTime','revenueSharing',
              'statusHistory','packetsDelivered','packetsRemaining','currentLocation','transporterId','transporterName',
              'categoryId','subcategoryId'],
    num: ['packets','weightPerPacket','totalWeight','predictedPrice','qualityScore','packetsDelivered','packetsRemaining'],
    json: ['images','revenueSharing','statusHistory'],
    jsonDefaults: { images: [], revenueSharing: { farmer: 70, transporter: 20, hub: 10 }, statusHistory: [] },
    updatable: ['status','bookingId','hubPointId','scheduledPickupTime','deliveredToHubTime',
                'collectedByRetailerTime','statusHistory','currentLocation','transporterId','transporterName']
  },
  bookings: {
    sheet: 'Bookings',
    headers: ['id','cropId','farmerId','transporterId','transporterName','vehicleCapacity','currentLoad',
              'availableCapacity','route','pickupTime','deliveryTime','status','hubPointId','scheduledDeliveryTime'],
    num: ['vehicleCapacity','currentLoad','availableCapacity'],
    updatable: ['status','deliveryTime']
  },
  hubPoints: {
    sheet: 'HubPoints',
    headers: ['id','name','location','capacity','managerId','managerName','phone','active'],
    num: ['capacity'], bool: ['active'], boolDefault: true
  },
  transporters: {
    sheet: 'Transporters',
    headers: ['id','name','vehicleCapacity','currentLoad','availableCapacity','location','status'],
    num: ['vehicleCapacity','currentLoad','availableCapacity']
  },
  retailerOrders: {
    sheet: 'RetailerOrders',
    headers: ['id','retailerId','retailerName','cropId','cropType','packets','hubPointId','status','amount','createdAt','collectedAt','note'],
    num: ['packets','amount'],
    updatable: ['status','packets','note']
  },
  complaints: {
    sheet: 'Complaints',
    headers: ['id','consumerId','retailerId','cropId','description','severity','status','createdAt'],
    updatable: ['status']
  },
  categories: {
    sheet: 'Categories',
    headers: ['id','name','nameBn','parentId','active'],
    bool: ['active'], boolDefault: true, optional: true
  },
  settings: {
    sheet: 'Settings',
    headers: ['id','value'],
    optional: true
  },
  payments: {
    sheet: 'FarmerPayments',
    headers: ['id','farmerId','amount','processedAt','status'],
    num: ['amount']
  }
};

// ── Errors & output ───────────────────────────────────────────────────────────
function AppError(message, code) {
  this.name = 'AppError';
  this.message = message;
  this.code = code || 'BAD_REQUEST';
}
AppError.prototype = Object.create(Error.prototype);

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Entry points ──────────────────────────────────────────────────────────────
function doGet() {
  return jsonOut({ status: 'ok', app: 'KrishiBazar AI Backend', version: BACKEND_VERSION });
}

var WRITE_ACTIONS = ['SUBMIT_COMPLAINT', 'BATCH', 'ADMIN'];

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (parseErr) { return jsonOut({ success: false, code: 'BAD_REQUEST', error: 'Invalid request body.' }); }

  // Only writes take the global lock; reads run concurrently so polling stays cheap.
  var needsLock = body && WRITE_ACTIONS.indexOf(body.action) > -1;
  var lock = LockService.getScriptLock();
  if (needsLock) {
    try { lock.waitLock(20000); }
    catch (err) { return jsonOut({ success: false, code: 'BUSY', error: 'Server is busy, please retry.' }); }
  }
  try {
    checkRateLimit();
    return jsonOut({ success: true, data: route(body) });
  } catch (err) {
    if (err instanceof AppError) return jsonOut({ success: false, code: err.code, error: err.message });
    Logger.log('Unhandled error: ' + (err && err.stack ? err.stack : err));
    return jsonOut({ success: false, code: 'INTERNAL', error: 'Internal server error.' });
  } finally {
    if (needsLock) lock.releaseLock();
  }
}

function route(body) {
  if (!body || typeof body.action !== 'string') throw new AppError('Missing action.');
  switch (body.action) {
    case 'LOGIN':            return login(body.email, body.password);
    case 'SUBMIT_COMPLAINT': return submitComplaint(body.complaint);
    case 'LOGOUT':           return logout(body.token);
    case 'GET_ALL':          return getAllFor(requireUser(body.token));
    case 'BATCH':            return runBatch(requireUser(body.token), body.ops);
    case 'ADMIN':            return adminOp(requireAdmin(body.token), body);
    case 'UPLOAD_IMAGE':     return uploadImage(requireUser(body.token), body.dataUrl);
    default: throw new AppError('Unknown action.');
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function checkRateLimit() {
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  if (n > RATE_LIMIT_PER_MIN) throw new AppError('Too many requests. Please wait a minute.', 'RATE_LIMIT');
  cache.put(key, String(n), 90);
}

// ── Sheets helpers ────────────────────────────────────────────────────────────
function getSS() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(ent) {
  var sheet = getSS().getSheetByName(ent.sheet);
  if (!sheet) throw new AppError('Database is not set up (missing sheet ' + ent.sheet + '). Run setupSheets().', 'SETUP');
  return sheet;
}

function isIdField(h) { return h === 'id' || /Id$/.test(h); }

function safeParse(v, fallback) {
  try { var p = JSON.parse(v); return p === null || p === undefined ? fallback : p; }
  catch (e) { return fallback; }
}

function parseBool(v, dflt) {
  if (v === true || v === false) return v;
  var t = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return dflt;
}

function parseRow(ent, row) {
  var obj = {};
  ent.headers.forEach(function (h, i) {
    var v = row[i];
    if (v instanceof Date) v = v.toISOString();
    if (ent.bool && ent.bool.indexOf(h) > -1) obj[h] = parseBool(v, ent.boolDefault);
    else if (ent.json && ent.json.indexOf(h) > -1) obj[h] = safeParse(v, ent.jsonDefaults[h]);
    else if (ent.num && ent.num.indexOf(h) > -1) obj[h] = Number(v) || 0;
    else if (isIdField(h)) obj[h] = (v === '' || v === null || v === undefined) ? '' : String(v);
    else obj[h] = (v === null || v === undefined) ? '' : v;
  });
  return obj;
}

function serializeRow(ent, obj) {
  return ent.headers.map(function (h) {
    var v = obj[h];
    if (ent.bool && ent.bool.indexOf(h) > -1) return parseBool(v, ent.boolDefault) ? 'true' : 'false';
    if (ent.json && ent.json.indexOf(h) > -1) {
      if (v === undefined || v === null) v = ent.jsonDefaults[h];
      if (h === 'statusHistory' && v instanceof Array && v.length > MAX_HISTORY) v = v.slice(-MAX_HISTORY);
      v = JSON.stringify(v);
    } else if (v === undefined || v === null) v = '';
    else if (typeof v === 'object') v = JSON.stringify(v);
    if (typeof v === 'string' && v.length > MAX_CELL_CHARS) {
      throw new AppError('A value is too large to store (' + h + ').', 'TOO_LARGE');
    }
    return v;
  });
}

// Optional sheets (Categories, Settings) may not exist yet on older deployments.
function readAll(name) {
  var ent = ENTITIES[name];
  if (ent.optional && !getSS().getSheetByName(ent.sheet)) return [];
  var sheet = getSheet(ent);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, ent.headers.length).getValues();
  return values
    .filter(function (r) { return String(r[0]) !== ''; })
    .map(function (r) { return parseRow(ent, r); });
}

function findRowIndex(ent, id) {
  var sheet = getSheet(ent);
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function readOne(name, id) {
  var ent = ENTITIES[name];
  if (ent.optional && !getSS().getSheetByName(ent.sheet)) return null;
  var idx = findRowIndex(ent, id);
  if (idx === -1) return null;
  var vals = getSheet(ent).getRange(idx, 1, 1, ent.headers.length).getValues()[0];
  return parseRow(ent, vals);
}

// Plain-text format on every write → values can never be interpreted as formulas.
function writeRow(name, rowIndex, rec) {
  var ent = ENTITIES[name];
  var sheet = getSheet(ent);
  var range = sheet.getRange(rowIndex, 1, 1, ent.headers.length);
  range.setNumberFormat('@');
  range.setValues([serializeRow(ent, rec)]);
}

function deleteRecord(name, id) {
  var ent = ENTITIES[name];
  var idx = findRowIndex(ent, id);
  if (idx === -1) throw new AppError('Record not found.', 'NOT_FOUND');
  getSheet(ent).deleteRow(idx);
}

function genId(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

function insertRecord(name, rec) {
  var ent = ENTITIES[name];
  if (findRowIndex(ent, rec.id) !== -1) throw new AppError('Duplicate entry: ' + rec.id, 'DUPLICATE');
  var sheet = getSheet(ent);
  writeRow(name, Math.max(sheet.getLastRow(), 1) + 1, rec);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (var i = 1; i < HASH_ITERATIONS; i++) bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return Utilities.base64Encode(bytes);
}

function makePasswordRecord(password) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  return salt + '$' + hashPassword(password, salt);
}

function verifyPassword(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 2) return false;
  return hashPassword(password, parts[0]) === parts[1];
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone, location: u.location,
           active: u.active === true, createdAt: u.createdAt || '' };
}

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (!email || !password) throw new AppError('Email and password are required.');
  var cache = CacheService.getScriptCache();
  var lockKey = 'la:' + email;
  var attempts = Number(cache.get(lockKey) || 0);
  if (attempts >= LOGIN_MAX_ATTEMPTS) throw new AppError('Too many failed attempts. Try again in 15 minutes.', 'LOCKED');

  var user = readAll('users').filter(function (u) { return String(u.email).toLowerCase() === email; })[0];
  var ok = user && user.active === true && verifyPassword(password, user.passwordHash);
  if (!ok) {
    cache.put(lockKey, String(attempts + 1), LOGIN_LOCK_SECONDS);
    throw new AppError('Invalid email or password.', 'INVALID_CREDENTIALS');
  }
  if (getSettings().maintenanceMode && user.role !== 'admin') {
    throw new AppError('The platform is under maintenance. Please try again later.', 'MAINTENANCE');
  }
  cache.remove(lockKey);
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('s:' + token, JSON.stringify({ id: user.id }), SESSION_SECONDS);
  return { token: token, user: publicUser(user) };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('s:' + String(token));
  return { loggedOut: true };
}

// The session only stores the user id; role/name/active are re-read from the sheet on every
// request, so deactivating a user or changing their role takes effect immediately.
function requireUser(token) {
  if (!token) throw new AppError('Please log in.', 'UNAUTHORIZED');
  var raw = CacheService.getScriptCache().get('s:' + String(token));
  if (!raw) throw new AppError('Session expired. Please log in again.', 'UNAUTHORIZED');
  var user = readOne('users', JSON.parse(raw).id);
  if (!user || user.active !== true || ROLES.indexOf(user.role) === -1) {
    throw new AppError('Your account is not active. Please contact the administrator.', 'UNAUTHORIZED');
  }
  if (getSettings().maintenanceMode && user.role !== 'admin') {
    throw new AppError('The platform is under maintenance. Please try again later.', 'MAINTENANCE');
  }
  return user;
}

function requireAdmin(token) {
  var user = requireUser(token);
  if (user.role !== 'admin') throw new AppError('Administrator access is required.', 'FORBIDDEN');
  return user;
}

function coerceSetting(key, v) {
  var d = DEFAULT_SETTINGS[key];
  if (typeof d === 'number') { var n = Number(v); return isFinite(n) ? n : d; }
  if (typeof d === 'boolean') return parseBool(v, d);
  return String(v === undefined || v === null ? '' : v);
}

function getSettings() {
  var out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  readAll('settings').forEach(function (r) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, r.id)) out[r.id] = coerceSetting(r.id, r.value);
  });
  return out;
}

// ── Reads (scoped by role) ────────────────────────────────────────────────────
// A transporter can only be booked if there is an ACTIVE transporter account with the same id —
// otherwise nobody could ever see or progress the booking. (`onlyBookable` is false for the admin,
// who needs the complete list to edit vehicle capacities.)
function deriveTransporters(list, bookings, onlyBookable) {
  var live = {};
  readAll('users').forEach(function (u) { if (u.role === 'transporter' && u.active === true) live[u.id] = true; });
  return list
    .filter(function (t) { return !onlyBookable || live[t.id]; })
    .map(function (t) {
      var active = bookings
        .filter(function (b) { return b.transporterId === t.id && b.status !== 'delivered_to_hub'; })
        .reduce(function (s, b) { return s + b.currentLoad; }, 0);
      var load = t.currentLoad + active;
      return Object.assign({}, t, { currentLoad: load, availableCapacity: Math.max(0, t.vehicleCapacity - load),
                                    bookable: !!live[t.id] });
    });
}

function managedHubIds(user) {
  return readAll('hubPoints')
    .filter(function (h) { return h.managerId === user.id; })
    .map(function (h) { return h.id; });
}

function getAllFor(user) {
  var role = user.role, uid = user.id;
  var crops = readAll('crops'), bookings = readAll('bookings'), orders = readAll('retailerOrders');
  var hubs = readAll('hubPoints');
  var transporters = deriveTransporters(readAll('transporters'), bookings, role !== 'admin');
  var payments = [], complaints = [], users = [];

  if (role === 'admin') {
    payments = readAll('payments');
    complaints = readAll('complaints');
    users = readAll('users').map(publicUser);
  } else if (role === 'farmer') {
    crops = crops.filter(function (c) { return c.farmerId === uid; });
    bookings = bookings.filter(function (b) { return b.farmerId === uid; });
    orders = [];
    payments = readAll('payments').filter(function (p) { return p.farmerId === uid; });
  } else if (role === 'transporter') {
    bookings = bookings.filter(function (b) { return b.transporterId === uid; });
    var cropIds = bookings.map(function (b) { return b.cropId; });
    crops = crops.filter(function (c) { return cropIds.indexOf(c.id) > -1; });
    transporters = transporters.filter(function (t) { return t.id === uid; });
    orders = [];
  } else if (role === 'hub') {
    var hubIds = managedHubIds(user);
    hubs = hubs.filter(function (h) { return hubIds.indexOf(h.id) > -1; });
    crops = crops.filter(function (c) { return hubIds.indexOf(c.hubPointId) > -1; });
    bookings = bookings.filter(function (b) { return hubIds.indexOf(b.hubPointId) > -1; });
    orders = orders.filter(function (o) { return hubIds.indexOf(o.hubPointId) > -1; });
    transporters = [];
  } else if (role === 'retailer') {
    orders = orders.filter(function (o) { return o.retailerId === uid; });
    var mine = orders.map(function (o) { return o.cropId; });
    crops = crops.filter(function (c) { return c.status === 'available_at_hub' || mine.indexOf(c.id) > -1; });
    bookings = [];
    transporters = [];
  }
  return { crops: crops, bookings: bookings, hubPoints: hubs, retailerOrders: orders,
           complaints: complaints, transporters: transporters, payments: payments,
           users: users, categories: readAll('categories'), settings: getSettings(),
           meta: { version: BACKEND_VERSION } };
}

// ── Public complaint form ─────────────────────────────────────────────────────
function submitComplaint(c) {
  if (!c || typeof c !== 'object') throw new AppError('Invalid complaint.');
  var description = String(c.description || '').trim();
  if (!description) throw new AppError('Please describe the issue.');
  if (description.length > COMPLAINT_MAX_CHARS) throw new AppError('Description is too long (max ' + COMPLAINT_MAX_CHARS + ').');
  if (SEVERITIES.indexOf(c.severity) === -1) throw new AppError('Invalid severity.');
  var retailerId = String(c.retailerId || '');
  var retailer = readOne('users', retailerId);
  if (!retailer || retailer.role !== 'retailer') throw new AppError('Unknown retailer.');
  var rec = {
    id: Utilities.getUuid(),
    consumerId: 'consumer-' + Utilities.getUuid().slice(0, 8),
    retailerId: retailerId,
    cropId: String(c.cropId || '').slice(0, 100),
    description: description,
    severity: c.severity,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  insertRecord('complaints', rec);
  return { id: rec.id };
}

// ── Writes: batch with two phases (validate everything, then write) ───────────
function runBatch(user, ops) {
  if (!(ops instanceof Array) || ops.length === 0) throw new AppError('No operations.');
  if (ops.length > MAX_BATCH_OPS) throw new AppError('Too many operations in one request.');
  var ctx = { originals: {}, pending: {}, inserts: [], insertedIds: {}, newBookings: [] };

  ops.forEach(function (op) {
    if (!op || typeof op !== 'object' || !ENTITIES[op.entity]) throw new AppError('Invalid operation.');
    if (op.op === 'insert') prepareInsert(user, op, ctx);
    else if (op.op === 'update') prepareUpdate(user, op, ctx);
    else throw new AppError('Unknown operation type.');
  });

  // Serialise first so any size error aborts before the first write.
  ctx.inserts.forEach(function (i) { serializeRow(ENTITIES[i.name], i.rec); });
  Object.keys(ctx.pending).forEach(function (k) {
    serializeRow(ENTITIES[k.split(':')[0]], ctx.pending[k]);
  });

  ctx.inserts.forEach(function (i) { insertRecord(i.name, i.rec); });
  Object.keys(ctx.pending).forEach(function (k) {
    var name = k.split(':')[0];
    var rec = ctx.pending[k];
    writeRow(name, findRowIndex(ENTITIES[name], rec.id), rec);
  });
  return { applied: ops.length };
}

var DRIVE_URL = /^https:\/\/drive\.google\.com\/thumbnail\?id=[A-Za-z0-9_-]{10,}&sz=w\d{2,4}$/;
var INLINE_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

// Only our own Drive thumbnails or small inline previews may be stored — never arbitrary URLs.
// `existing` = images already stored on the product: those may stay as they are (older deployments
// stored other URLs), but anything NEW must pass the allowlist.
function cleanImages(arr, existing) {
  if (arr === undefined || arr === null) return [];
  if (!(arr instanceof Array) || arr.length > 3) throw new AppError('You can attach up to 3 images.');
  var total = 0;
  var out = arr.map(function (u) {
    u = String(u);
    var kept = existing instanceof Array && existing.indexOf(u) > -1;
    var ok = kept || DRIVE_URL.test(u) || (INLINE_IMG.test(u) && u.length <= MAX_INLINE_IMAGE);
    if (!ok) throw new AppError('Unsupported image. Please upload the photo again.', 'BAD_IMAGE');
    total += u.length;
    return u;
  });
  if (total > MAX_CELL_CHARS - 2000) throw new AppError('Images are too large to store.', 'TOO_LARGE');
  return out;
}

function pick(obj, keys) {
  var out = {};
  keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

function posInt(v, max, label) {
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > max) throw new AppError(label + ' must be a whole number between 1 and ' + max + '.');
  return n;
}

function cleanText(v, label, required, max) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (required && !s) throw new AppError(label + ' is required.');
  if (s.length > (max || MAX_TEXT_CHARS)) throw new AppError(label + ' is too long.');
  return s;
}

function categoriesExist() { return readAll('categories').length > 0; }

// A product points at a top-level category and (optionally) one of its subcategories.
// The stored `type` is derived from the category name — the client's value is never trusted.
function resolveCategory(categoryId, subcategoryId, mustBeActive) {
  var cat = readOne('categories', String(categoryId || ''));
  if (!cat || cat.parentId !== '') throw new AppError('Please choose a valid category.');
  if (mustBeActive && cat.active !== true) throw new AppError('This category is not active.');
  var subs = readAll('categories').filter(function (c) { return c.parentId === cat.id && (!mustBeActive || c.active); });
  var sub = null;
  if (subcategoryId) {
    sub = readOne('categories', String(subcategoryId));
    if (!sub || sub.parentId !== cat.id) throw new AppError('Please choose a valid subcategory.');
    if (mustBeActive && sub.active !== true) throw new AppError('This subcategory is not active.');
  } else if (subs.length > 0) {
    throw new AppError('Please choose a subcategory.');
  }
  return { categoryId: cat.id, subcategoryId: sub ? sub.id : '', type: sub ? sub.name : cat.name };
}

function getCrop(ctx, id) {
  var key = 'crops:' + id;
  if (ctx.pending[key]) return ctx.pending[key];
  var orig = ctx.originals[key] || (ctx.originals[key] = readOne('crops', id));
  if (!orig) throw new AppError('Crop not found.', 'NOT_FOUND');
  ctx.pending[key] = JSON.parse(JSON.stringify(orig));
  return ctx.pending[key];
}

function addHistory(crop, status, by, location) {
  var h = crop.statusHistory instanceof Array ? crop.statusHistory : [];
  h.push({ status: status, timestamp: new Date().toISOString(), updatedBy: by, location: location });
  crop.statusHistory = h.slice(-MAX_HISTORY);
}

function prepareInsert(user, op, ctx) {
  var name = op.entity, role = user.role;
  var row = op.row;
  if (!row || typeof row !== 'object') throw new AppError('Invalid row.');
  var id = cleanText(row.id, 'id', true);
  if (/[\s\/\\'"]/.test(id) || id.length > 100) throw new AppError('Invalid id.');
  if (ctx.insertedIds[name + ':' + id]) throw new AppError('Duplicate entry: ' + id, 'DUPLICATE');
  var rec;

  if (name === 'crops') {
    if (role !== 'farmer') throw new AppError('Only farmers can add crops.', 'FORBIDDEN');
    var packets = posInt(row.packets, 100000, 'Packets');
    var weight = posInt(row.weightPerPacket, 1000, 'Weight per packet');
    var quality = Number(row.qualityScore);
    var price = Number(row.predictedPrice);
    if (!isFinite(quality) || quality < 0 || quality > 100) throw new AppError('Invalid quality score.');
    if (!isFinite(price) || price < 0 || price > 100000) throw new AppError('Invalid price.');
    rec = pick(row, ENTITIES.crops.headers);
    rec.id = id; rec.farmerId = user.id; rec.farmerName = user.name;
    if (categoriesExist()) {
      var rc = resolveCategory(row.categoryId, row.subcategoryId, true);
      rec.categoryId = rc.categoryId; rec.subcategoryId = rc.subcategoryId; rec.type = rc.type;
    } else {
      rec.type = cleanText(row.type, 'Crop type', true, 100);
      rec.categoryId = ''; rec.subcategoryId = '';
    }
    rec.location = cleanText(row.location, 'Location', false);
    rec.packets = packets; rec.weightPerPacket = weight; rec.totalWeight = packets * weight;
    rec.qualityScore = quality; rec.predictedPrice = price;
    rec.status = 'pending'; rec.packetsDelivered = 0; rec.packetsRemaining = packets;
    rec.bookingId = ''; rec.hubPointId = ''; rec.transporterId = ''; rec.transporterName = '';
    rec.createdAt = new Date().toISOString();
    rec.images = cleanImages(row.images);
    var sh = getSettings();
    rec.revenueSharing = { farmer: sh.farmerShare, transporter: sh.transporterShare, hub: sh.hubShare };
    rec.statusHistory = [];
    addHistory(rec, 'pending', 'farmer', rec.location);
  } else if (name === 'bookings') {
    if (role !== 'farmer') throw new AppError('Only farmers can book transport.', 'FORBIDDEN');
    var crop = readOne('crops', String(row.cropId));
    if (!crop || crop.farmerId !== user.id) throw new AppError('Crop not found.', 'NOT_FOUND');
    if (crop.status !== 'pending') throw new AppError('This crop is already booked.');
    var hub = readOne('hubPoints', String(row.hubPointId));
    if (!hub) throw new AppError('Unknown hub.');
    if (hub.active !== true) throw new AppError('This hub is not accepting deliveries right now.');
    var tr = deriveTransporters(readAll('transporters'), readAll('bookings').concat(ctx.newBookings), true)
      .filter(function (t) { return t.id === String(row.transporterId); })[0];
    if (!tr) throw new AppError('This transporter is not available. Please choose another one.');
    var load = posInt(row.currentLoad, 100000, 'Load');
    if (load !== crop.packets) throw new AppError('Load must equal the crop packet count.');
    if (tr.availableCapacity < load) throw new AppError('Transporter does not have enough capacity.');
    var pickup = new Date(row.pickupTime);
    if (isNaN(pickup.getTime())) throw new AppError('Invalid pickup time.');
    rec = pick(row, ENTITIES.bookings.headers);
    rec.id = id; rec.cropId = crop.id; rec.farmerId = user.id;
    rec.transporterId = tr.id; rec.transporterName = tr.name;
    rec.vehicleCapacity = tr.vehicleCapacity; rec.currentLoad = load;
    rec.availableCapacity = tr.availableCapacity - load;
    rec.route = cleanText(row.route, 'Route', false);
    rec.pickupTime = pickup.toISOString();
    rec.scheduledDeliveryTime = new Date(pickup.getTime() + 4 * 3600000).toISOString();
    rec.deliveryTime = ''; rec.status = 'pending'; rec.hubPointId = hub.id;
    ctx.newBookings.push(rec);
  } else if (name === 'retailerOrders') {
    if (role !== 'retailer') throw new AppError('Only retailers can place orders.', 'FORBIDDEN');
    var oc = getCrop(ctx, String(row.cropId));
    var n = posInt(row.packets, 100000, 'Packets');
    if (oc.status !== 'available_at_hub') throw new AppError('This crop is not available for ordering.');
    if (n > oc.packetsRemaining) throw new AppError('Only ' + oc.packetsRemaining + ' packets are still available.', 'STOCK');
    rec = pick(row, ENTITIES.retailerOrders.headers);
    rec.id = id; rec.retailerId = user.id; rec.retailerName = user.name;
    rec.cropId = oc.id; rec.cropType = oc.type; rec.packets = n; rec.hubPointId = oc.hubPointId;
    rec.amount = n * oc.weightPerPacket * oc.predictedPrice;
    rec.status = 'pre_booked'; rec.createdAt = new Date().toISOString(); rec.collectedAt = '';
    oc.packetsRemaining -= n;
    oc.currentLocation = 'Hub - Ordered by ' + user.name;
    if (oc.packetsRemaining === 0) { oc.status = 'ordered'; addHistory(oc, 'ordered', 'retailer', oc.currentLocation); }
  } else if (name === 'payments') {
    if (role !== 'admin') throw new AppError('Only admins can record payments.', 'FORBIDDEN');
    var amount = Number(row.amount);
    if (!isFinite(amount) || amount <= 0) throw new AppError('Invalid payment amount.');
    var farmerId = cleanText(row.farmerId, 'Farmer', true);
    if (amount > farmerUnpaid(farmerId) + 0.01) throw new AppError('Payment exceeds the amount owed to this farmer.');
    rec = { id: id, farmerId: farmerId, amount: amount, processedAt: new Date().toISOString(), status: 'processed' };
  } else {
    throw new AppError('This data cannot be added.', 'FORBIDDEN');
  }
  ctx.insertedIds[name + ':' + id] = true;
  ctx.inserts.push({ name: name, rec: rec });
}

function farmerUnpaid(farmerId) {
  var cropIds = readAll('crops').filter(function (c) { return c.farmerId === farmerId; }).map(function (c) { return c.id; });
  var owed = readAll('retailerOrders')
    .filter(function (o) { return o.status === 'collected' && cropIds.indexOf(o.cropId) > -1; })
    .reduce(function (s, o) { return s + o.amount * (getSettings().farmerShare / 100); }, 0);
  var paid = readAll('payments')
    .filter(function (p) { return p.farmerId === farmerId; })
    .reduce(function (s, p) { return s + p.amount; }, 0);
  return Math.max(0, owed - paid);
}

function canUpdate(user, name, rec) {
  var role = user.role;
  if (role === 'admin') return true;
  if (name === 'crops') {
    if (role === 'farmer') return rec.farmerId === user.id;
    if (role === 'transporter') return rec.transporterId === user.id;
    if (role === 'hub') return managedHubIds(user).indexOf(rec.hubPointId) > -1;
    return false;
  }
  if (name === 'bookings') return role === 'transporter' && rec.transporterId === user.id;
  if (name === 'retailerOrders') return role === 'retailer' && rec.retailerId === user.id;
  return false;
}

function prepareUpdate(user, op, ctx) {
  var name = op.entity, ent = ENTITIES[name];
  if (!ent.updatable) throw new AppError('This data cannot be edited.', 'FORBIDDEN');
  var fields = op.fields;
  if (!fields || typeof fields !== 'object') throw new AppError('Invalid fields.');
  var key = name + ':' + op.id;
  var original = ctx.originals[key] || (ctx.originals[key] = readOne(name, String(op.id)));
  if (!original) throw new AppError('Record not found.', 'NOT_FOUND');
  if (!canUpdate(user, name, original)) throw new AppError('You are not allowed to change this record.', 'FORBIDDEN');
  Object.keys(fields).forEach(function (f) {
    if (ent.updatable.indexOf(f) === -1) throw new AppError('Field cannot be edited: ' + f, 'FORBIDDEN');
  });

  var rec = ctx.pending[key] || JSON.parse(JSON.stringify(original));
  var newStatus = fields.status;
  var changed = newStatus !== undefined && newStatus !== original.status;

  if (name === 'crops') {
    if (newStatus !== undefined && CROP_STATUSES.indexOf(newStatus) === -1) throw new AppError('Invalid status.');
    if (changed && user.role !== 'admin') {
      var allowed = (CROP_TRANSITIONS[user.role] || {})[original.status] || [];
      if (allowed.indexOf(newStatus) === -1) throw new AppError('That status change is not allowed.', 'FORBIDDEN');
    }
    if (fields.statusHistory !== undefined && !(fields.statusHistory instanceof Array)) throw new AppError('Invalid history.');
  } else if (name === 'bookings') {
    if (newStatus !== undefined && BOOKING_STATUSES.indexOf(newStatus) === -1) throw new AppError('Invalid status.');
    if (changed && user.role !== 'admin' && BOOKING_NEXT[original.status] !== newStatus) {
      throw new AppError('That status change is not allowed.', 'FORBIDDEN');
    }
  } else if (name === 'retailerOrders') {
    var isAdmin = user.role === 'admin';
    if ((fields.packets !== undefined || fields.note !== undefined) && !isAdmin) {
      throw new AppError('Only an administrator can edit order details.', 'FORBIDDEN');
    }
    if (newStatus !== undefined && newStatus !== original.status) {
      if (ORDER_STATUSES.indexOf(newStatus) === -1) throw new AppError('Invalid status.');
      if ((ORDER_NEXT[original.status] || []).indexOf(newStatus) === -1) {
        throw new AppError(original.status === 'pre_booked' && newStatus === 'collected'
          ? 'Order must be paid before collection.'
          : 'That status change is not allowed (' + original.status + ' → ' + newStatus + ').');
      }
    } else if (newStatus !== undefined) {
      throw new AppError('The order is already ' + newStatus + '.');
    }
    if (fields.packets !== undefined) {
      if (original.status !== 'pre_booked') throw new AppError('Quantity can only be changed before payment.');
      var np = posInt(fields.packets, 100000, 'Packets');
      var crop0 = getCrop(ctx, original.cropId);
      var delta = np - original.packets;
      if (crop0.packetsRemaining - delta < 0) throw new AppError('Not enough stock: only ' + crop0.packetsRemaining + ' more packets are available.', 'STOCK');
      crop0.packetsRemaining -= delta;
      if (crop0.packetsRemaining === 0 && crop0.status === 'available_at_hub') { crop0.status = 'ordered'; addHistory(crop0, 'ordered', 'admin', 'Hub - Fully ordered'); }
      if (crop0.packetsRemaining > 0 && crop0.status === 'ordered') { crop0.status = 'available_at_hub'; addHistory(crop0, 'available_at_hub', 'admin', 'Hub - Available for Retailers'); }
      fields = Object.assign({}, fields, { packets: np, amount: np * (original.amount / original.packets) });
    }
    if (fields.note !== undefined) fields = Object.assign({}, fields, { note: cleanText(fields.note, 'Note', false, 500) });
    if (newStatus === 'cancelled') {
      var cc = getCrop(ctx, original.cropId);
      cc.packetsRemaining = Math.min(cc.packets, cc.packetsRemaining + (fields.packets !== undefined ? fields.packets : original.packets));
      if (cc.status === 'ordered') {
        cc.status = 'available_at_hub';
        cc.currentLocation = 'Hub - Available for Retailers';
        addHistory(cc, 'available_at_hub', user.role, cc.currentLocation);
      }
    }
  } else if (name === 'complaints') {
    if (COMPLAINT_STATUSES.indexOf(newStatus) === -1) throw new AppError('Invalid status.');
  }

  Object.keys(fields).forEach(function (f) {
    var v = fields[f];
    rec[f] = (typeof v === 'string') ? cleanText(v, f, false) : v;
  });
  if (name === 'retailerOrders' && fields.amount !== undefined) rec.amount = fields.amount;

  // Server-authoritative side effects of collecting an order
  if (name === 'retailerOrders' && newStatus === 'collected') {
    rec.collectedAt = new Date().toISOString();
    var crop = getCrop(ctx, original.cropId);
    crop.packetsDelivered += original.packets;
    if (crop.packetsDelivered >= crop.packets) {
      crop.status = 'collected';
      crop.collectedByRetailerTime = rec.collectedAt;
      crop.currentLocation = 'Retailer - ' + original.retailerName;
      addHistory(crop, 'collected', 'retailer', crop.currentLocation);
    }
  }
  ctx.pending[key] = rec;
}

// ── Image upload (Google Drive) ───────────────────────────────────────────────
function imageFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('IMAGE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ } }
  var found = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);
  props.setProperty('IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

function looksLikeImage(bytes, mime) {
  var b = function (i) { return bytes[i] & 255; };
  if (mime === 'image/jpeg') return b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (mime === 'image/png')  return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (mime === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45;
  return false;
}

function uploadImage(user, dataUrl) {
  if (user.role !== 'farmer' && user.role !== 'admin') throw new AppError('You cannot upload product photos.', 'FORBIDDEN');
  var cache = CacheService.getScriptCache();
  var key = 'up:' + user.id + ':' + Math.floor(Date.now() / 3600000);
  var count = Number(cache.get(key) || 0) + 1;
  if (count > UPLOADS_PER_HOUR) throw new AppError('Upload limit reached. Please try again later.', 'RATE_LIMIT');
  cache.put(key, String(count), 3700);

  var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new AppError('Please upload a JPEG, PNG or WebP image.', 'BAD_IMAGE');
  if (m[2].length > MAX_IMAGE_B64) throw new AppError('That image is too large (max ≈300 KB after resizing).', 'TOO_LARGE');
  var bytes = Utilities.base64Decode(m[2]);
  if (!looksLikeImage(bytes, m[1])) throw new AppError('That file is not a valid image.', 'BAD_IMAGE');

  try {
    var ext = m[1] === 'image/png' ? '.png' : m[1] === 'image/webp' ? '.webp' : '.jpg';
    var file = imageFolder().createFile(Utilities.newBlob(bytes, m[1], genId('product-') + ext));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800' };
  } catch (err) {
    Logger.log('Drive upload failed: ' + err);
    throw new AppError('The photo could not be stored. Ask the administrator to check Google Drive sharing permissions.', 'IMAGE_STORAGE');
  }
}

// ── Admin operations ──────────────────────────────────────────────────────────
function adminOp(admin, body) {
  var handlers = { users: adminUsers, hubPoints: adminHubs, categories: adminCategories, crops: adminCrops, settings: adminSettings };
  var h = handlers[body.entity];
  if (!h) throw new AppError('Unknown entity.');
  if (['create', 'update', 'delete', 'resetPassword'].indexOf(body.op) === -1) throw new AppError('Unknown operation.');
  return h(admin, body.op, body);
}

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var PHONE_RE = /^[0-9+\-\s()]{0,30}$/;

function cleanEmail(v) {
  var e = cleanText(v, 'Email', true, 120).toLowerCase();
  if (!EMAIL_RE.test(e)) throw new AppError('Please enter a valid email address.');
  return e;
}
function cleanPhone(v) {
  var p = cleanText(v, 'Phone', false, 30);
  if (!PHONE_RE.test(p)) throw new AppError('Phone may contain only digits, +, -, spaces and brackets.');
  return p;
}
function cleanPassword(v) {
  var p = String(v === undefined || v === null ? '' : v);
  if (p.length < 8) throw new AppError('Password must be at least 8 characters.');
  if (p.length > 100) throw new AppError('Password is too long.');
  return p;
}

function userDependencies(u) {
  var n = 0, parts = [];
  function add(count, label) { if (count > 0) { n += count; parts.push(count + ' ' + label); } }
  if (u.role === 'farmer')      add(readAll('crops').filter(function (c) { return c.farmerId === u.id; }).length, 'product(s)');
  if (u.role === 'retailer')    add(readAll('retailerOrders').filter(function (o) { return o.retailerId === u.id; }).length, 'order(s)');
  if (u.role === 'hub')         add(readAll('hubPoints').filter(function (h) { return h.managerId === u.id; }).length, 'hub point(s)');
  if (u.role === 'transporter') add(readAll('bookings').filter(function (b) { return b.transporterId === u.id; }).length, 'booking(s)');
  return { count: n, text: parts.join(', ') };
}

function activeAdminCount(exceptId) {
  return readAll('users').filter(function (u) { return u.role === 'admin' && u.active === true && u.id !== exceptId; }).length;
}

// Names are stored redundantly on other sheets; keep them in step when a user is renamed.
function updateColumnWhere(name, matchCol, matchVal, setCol, newVal) {
  var ent = ENTITIES[name], sheet = getSheet(ent), last = sheet.getLastRow();
  if (last < 2) return;
  var mi = ent.headers.indexOf(matchCol), si = ent.headers.indexOf(setCol);
  var vals = sheet.getRange(2, 1, last - 1, ent.headers.length).getValues();
  vals.forEach(function (row, i) {
    if (String(row[mi]) === String(matchVal) && row[si] !== newVal) {
      var r = sheet.getRange(i + 2, si + 1, 1, 1);
      r.setNumberFormat('@');
      r.setValues([[newVal]]);
    }
  });
}
function cascadeUserName(u) {
  updateColumnWhere('crops', 'farmerId', u.id, 'farmerName', u.name);
  updateColumnWhere('crops', 'transporterId', u.id, 'transporterName', u.name);
  updateColumnWhere('retailerOrders', 'retailerId', u.id, 'retailerName', u.name);
  updateColumnWhere('hubPoints', 'managerId', u.id, 'managerName', u.name);
  updateColumnWhere('bookings', 'transporterId', u.id, 'transporterName', u.name);
  updateColumnWhere('transporters', 'id', u.id, 'name', u.name);
}

function uniqueEmail(email, exceptId) {
  var dup = readAll('users').filter(function (u) { return String(u.email).toLowerCase() === email && u.id !== exceptId; })[0];
  if (dup) throw new AppError('Another account already uses this email.', 'DUPLICATE');
}

function adminUsers(admin, op, body) {
  if (op === 'create') {
    var row = body.row || {};
    var role = String(row.role);
    if (ROLES.indexOf(role) === -1) throw new AppError('Please choose a valid role.');
    var email = cleanEmail(row.email);
    uniqueEmail(email, '');
    var rec = {
      id: genId('u-'), email: email, name: cleanText(row.name, 'Name', true, 100), role: role,
      phone: cleanPhone(row.phone), location: cleanText(row.location, 'Location', false, 200),
      passwordHash: makePasswordRecord(cleanPassword(row.password)), active: row.active === false ? false : true,
      createdAt: new Date().toISOString()
    };
    insertRecord('users', rec);
    if (role === 'transporter') {
      var cap = row.vehicleCapacity === undefined || row.vehicleCapacity === '' ? 500 : posInt(row.vehicleCapacity, 100000, 'Vehicle capacity');
      insertRecord('transporters', { id: rec.id, name: rec.name, vehicleCapacity: cap, currentLoad: 0, availableCapacity: cap,
                                     location: rec.location, status: 'available' });
    }
    return { id: rec.id };
  }

  var u = readOne('users', String(body.id));
  if (!u) throw new AppError('User not found.', 'NOT_FOUND');
  var self = u.id === admin.id;

  if (op === 'resetPassword') {
    u.passwordHash = makePasswordRecord(cleanPassword(body.password));
    writeRow('users', findRowIndex(ENTITIES.users, u.id), u);
    return { updated: true };
  }

  if (op === 'delete') {
    if (self) throw new AppError('You cannot delete your own account.', 'FORBIDDEN');
    if (u.role === 'admin' && u.active && activeAdminCount(u.id) === 0) throw new AppError('You cannot delete the last administrator.', 'FORBIDDEN');
    var dep = userDependencies(u);
    if (dep.count > 0) throw new AppError('This user still has ' + dep.text + '. Deactivate the account instead of deleting it.', 'IN_USE');
    deleteRecord('users', u.id);
    if (u.role === 'transporter' && readOne('transporters', u.id)) deleteRecord('transporters', u.id);
    return { deleted: true };
  }

  // update
  var f = body.fields || {};
  var allowed = ['name', 'email', 'phone', 'location', 'role', 'active', 'vehicleCapacity'];
  Object.keys(f).forEach(function (k) { if (allowed.indexOf(k) === -1) throw new AppError('Field cannot be edited: ' + k, 'FORBIDDEN'); });
  if (f.name !== undefined)     u.name = cleanText(f.name, 'Name', true, 100);
  if (f.email !== undefined)    { u.email = cleanEmail(f.email); uniqueEmail(u.email, u.id); }
  if (f.phone !== undefined)    u.phone = cleanPhone(f.phone);
  if (f.location !== undefined) u.location = cleanText(f.location, 'Location', false, 200);
  if (f.role !== undefined && f.role !== u.role) {
    if (ROLES.indexOf(f.role) === -1) throw new AppError('Please choose a valid role.');
    if (self) throw new AppError('You cannot change your own role.', 'FORBIDDEN');
    var depR = userDependencies(u);
    if (depR.count > 0) throw new AppError('The role cannot change while the user has ' + depR.text + '.', 'IN_USE');
    if (u.role === 'admin' && u.active && activeAdminCount(u.id) === 0) throw new AppError('You cannot demote the last administrator.', 'FORBIDDEN');
    u.role = f.role;
    if (u.role === 'transporter' && !readOne('transporters', u.id)) {
      var cap0 = f.vehicleCapacity === undefined ? 500 : posInt(f.vehicleCapacity, 100000, 'Vehicle capacity');
      insertRecord('transporters', { id: u.id, name: u.name, vehicleCapacity: cap0, currentLoad: 0, availableCapacity: cap0,
                                     location: u.location, status: 'available' });
    }
  }
  if (f.active !== undefined && f.active !== u.active) {
    if (self) throw new AppError('You cannot deactivate your own account.', 'FORBIDDEN');
    if (f.active === false && u.role === 'admin' && activeAdminCount(u.id) === 0) throw new AppError('You cannot deactivate the last administrator.', 'FORBIDDEN');
    u.active = f.active === true;
  }
  writeRow('users', findRowIndex(ENTITIES.users, u.id), u);
  cascadeUserName(u);
  if (u.role === 'transporter' && f.vehicleCapacity !== undefined) {
    var cap2 = posInt(f.vehicleCapacity, 100000, 'Vehicle capacity');
    updateColumnWhere('transporters', 'id', u.id, 'vehicleCapacity', cap2);
  }
  return { updated: true };
}

function currentHubStock(hubId) {
  return readAll('crops')
    .filter(function (c) { return c.hubPointId === hubId && (c.status === 'available_at_hub' || c.status === 'ordered'); })
    .reduce(function (sum, c) { return sum + Math.max(0, c.packets - c.packetsDelivered); }, 0);
}

function cleanManager(managerId) {
  if (!managerId) return { id: '', name: '' };
  var m = readOne('users', String(managerId));
  if (!m || m.role !== 'hub') throw new AppError('The manager must be an existing user with the Hub Manager role.');
  if (m.active !== true) throw new AppError('The selected manager account is inactive.');
  return { id: m.id, name: m.name };
}

function adminHubs(admin, op, body) {
  var hubs = readAll('hubPoints');
  function uniqueName(name, exceptId) {
    if (hubs.some(function (h) { return h.name.toLowerCase() === name.toLowerCase() && h.id !== exceptId; })) {
      throw new AppError('A hub point with this name already exists.', 'DUPLICATE');
    }
  }
  if (op === 'create') {
    var r = body.row || {};
    var name = cleanText(r.name, 'Name', true, 100); uniqueName(name, '');
    var mgr = cleanManager(r.managerId);
    var rec = { id: genId('hub-'), name: name, location: cleanText(r.location, 'Location', true, 200),
                capacity: posInt(r.capacity, 1000000, 'Capacity'), managerId: mgr.id, managerName: mgr.name,
                phone: cleanPhone(r.phone), active: r.active === false ? false : true };
    insertRecord('hubPoints', rec);
    return { id: rec.id };
  }
  var hub = readOne('hubPoints', String(body.id));
  if (!hub) throw new AppError('Hub point not found.', 'NOT_FOUND');

  if (op === 'delete') {
    var used = readAll('crops').filter(function (c) { return c.hubPointId === hub.id; }).length +
               readAll('retailerOrders').filter(function (o) { return o.hubPointId === hub.id; }).length +
               readAll('bookings').filter(function (b) { return b.hubPointId === hub.id; }).length;
    if (used > 0) throw new AppError('This hub point has ' + used + ' related record(s). Deactivate it instead of deleting it.', 'IN_USE');
    deleteRecord('hubPoints', hub.id);
    return { deleted: true };
  }
  var f = body.fields || {};
  ['name', 'location', 'capacity', 'managerId', 'phone', 'active'].forEach(function () {});
  Object.keys(f).forEach(function (k) {
    if (['name', 'location', 'capacity', 'managerId', 'phone', 'active'].indexOf(k) === -1) throw new AppError('Field cannot be edited: ' + k, 'FORBIDDEN');
  });
  if (f.name !== undefined)     { hub.name = cleanText(f.name, 'Name', true, 100); uniqueName(hub.name, hub.id); }
  if (f.location !== undefined) hub.location = cleanText(f.location, 'Location', true, 200);
  if (f.capacity !== undefined) {
    hub.capacity = posInt(f.capacity, 1000000, 'Capacity');
    var stock = currentHubStock(hub.id);
    if (hub.capacity < stock) throw new AppError('Capacity cannot be lower than the current stock (' + stock + ' packets).');
  }
  if (f.managerId !== undefined) { var m = cleanManager(f.managerId); hub.managerId = m.id; hub.managerName = m.name; }
  if (f.phone !== undefined)    hub.phone = cleanPhone(f.phone);
  if (f.active !== undefined)   hub.active = f.active === true;
  writeRow('hubPoints', findRowIndex(ENTITIES.hubPoints, hub.id), hub);
  return { updated: true };
}

function adminCategories(admin, op, body) {
  var all = readAll('categories');
  function uniqueName(name, exceptId) {
    if (all.some(function (c) { return c.name.toLowerCase() === name.toLowerCase() && c.id !== exceptId; })) {
      throw new AppError('A category with this name already exists.', 'DUPLICATE');
    }
  }
  if (op === 'create') {
    var r = body.row || {};
    var name = cleanText(r.name, 'Name', true, 60); uniqueName(name, '');
    var parentId = r.parentId ? String(r.parentId) : '';
    if (parentId) {
      var parent = readOne('categories', parentId);
      if (!parent || parent.parentId !== '') throw new AppError('A subcategory must belong to a top-level category.');
    }
    var rec = { id: genId(parentId ? 'sub-' : 'cat-'), name: name, nameBn: cleanText(r.nameBn, 'Bengali name', false, 60),
                parentId: parentId, active: r.active === false ? false : true };
    insertRecord('categories', rec);
    return { id: rec.id };
  }
  var cat = readOne('categories', String(body.id));
  if (!cat) throw new AppError('Category not found.', 'NOT_FOUND');
  var crops = readAll('crops');
  var usedBy = function (c) { return c.categoryId === cat.id || c.subcategoryId === cat.id; };

  if (op === 'delete') {
    if (all.some(function (c) { return c.parentId === cat.id; })) throw new AppError('Delete or move its subcategories first.', 'IN_USE');
    var n = crops.filter(usedBy).length;
    if (n > 0) throw new AppError(n + ' product(s) use this category. Deactivate it instead of deleting it.', 'IN_USE');
    deleteRecord('categories', cat.id);
    return { deleted: true };
  }
  var f = body.fields || {};
  Object.keys(f).forEach(function (k) { if (['name', 'nameBn', 'active'].indexOf(k) === -1) throw new AppError('Field cannot be edited: ' + k, 'FORBIDDEN'); });
  var renamed = false;
  if (f.name !== undefined) {
    var nn = cleanText(f.name, 'Name', true, 60); uniqueName(nn, cat.id);
    renamed = nn !== cat.name; cat.name = nn;
  }
  if (f.nameBn !== undefined) cat.nameBn = cleanText(f.nameBn, 'Bengali name', false, 60);
  if (f.active !== undefined) cat.active = f.active === true;
  writeRow('categories', findRowIndex(ENTITIES.categories, cat.id), cat);
  if (renamed) {
    // product "type" mirrors its leaf category's name
    crops.filter(function (c) { return c.subcategoryId === cat.id || (c.categoryId === cat.id && c.subcategoryId === ''); }).forEach(function (c) {
      updateColumnWhere('crops', 'id', c.id, 'type', cat.name);
      updateColumnWhere('retailerOrders', 'cropId', c.id, 'cropType', cat.name);
    });
  }
  return { updated: true };
}

function adminProductFields(src, existing) {
  var out = {};
  if (src.categoryId !== undefined || !existing) {
    var rc = resolveCategory(src.categoryId, src.subcategoryId, !existing || src.categoryId !== existing.categoryId || (src.subcategoryId || '') !== existing.subcategoryId);
    out.categoryId = rc.categoryId; out.subcategoryId = rc.subcategoryId; out.type = rc.type;
  }
  if (src.weightPerPacket !== undefined || !existing) out.weightPerPacket = posInt(src.weightPerPacket, 1000, 'Weight per packet');
  if (src.predictedPrice !== undefined || !existing) {
    var p = Number(src.predictedPrice);
    if (!isFinite(p) || p < 0 || p > 100000) throw new AppError('Price must be between 0 and 100000.');
    out.predictedPrice = p;
  }
  if (src.qualityScore !== undefined || !existing) {
    var q = Number(src.qualityScore === undefined || src.qualityScore === '' ? 90 : src.qualityScore);
    if (!isFinite(q) || q < 0 || q > 100) throw new AppError('Quality score must be between 0 and 100.');
    out.qualityScore = q;
  }
  if (src.location !== undefined || !existing) out.location = cleanText(src.location, 'Location', false, 200);
  if (src.images !== undefined || !existing) out.images = cleanImages(src.images, existing ? existing.images : null);
  return out;
}

function adminCrops(admin, op, body) {
  if (op === 'create') {
    var r = body.row || {};
    var farmer = readOne('users', String(r.farmerId));
    if (!farmer || farmer.role !== 'farmer') throw new AppError('Please choose a farmer.');
    if (farmer.active !== true) throw new AppError('This farmer account is inactive.');
    var base = adminProductFields(r, null);
    var packets = posInt(r.packets, 100000, 'Packets');
    var status = r.status === 'available_at_hub' ? 'available_at_hub' : 'pending';
    var hubId = '';
    if (status === 'available_at_hub') {
      var hub = readOne('hubPoints', String(r.hubPointId));
      if (!hub || hub.active !== true) throw new AppError('Choose an active hub point for stock that is already at a hub.');
      hubId = hub.id;
    }
    var sh = getSettings();
    var rec = Object.assign({
      id: genId('p-'), farmerId: farmer.id, farmerName: farmer.name, packets: packets,
      totalWeight: packets * base.weightPerPacket, status: status, bookingId: '', hubPointId: hubId,
      createdAt: new Date().toISOString(), scheduledPickupTime: '', deliveredToHubTime: '', collectedByRetailerTime: '',
      revenueSharing: { farmer: sh.farmerShare, transporter: sh.transporterShare, hub: sh.hubShare },
      statusHistory: [], packetsDelivered: 0, packetsRemaining: packets,
      currentLocation: status === 'available_at_hub' ? 'Hub - Available for Retailers' : 'Farm - ' + String(base.location).split(',')[0],
      transporterId: '', transporterName: ''
    }, base);
    addHistory(rec, status, 'admin', rec.currentLocation);
    insertRecord('crops', rec);
    return { id: rec.id };
  }
  var crop = readOne('crops', String(body.id));
  if (!crop) throw new AppError('Product not found.', 'NOT_FOUND');

  if (op === 'delete') {
    var live = readAll('retailerOrders').filter(function (o) { return o.cropId === crop.id && o.status !== 'cancelled'; }).length;
    var active = readAll('bookings').filter(function (b) { return b.cropId === crop.id && b.status !== 'delivered_to_hub'; }).length;
    if (live > 0) throw new AppError('This product has ' + live + ' order(s). Cancel them first.', 'IN_USE');
    if (active > 0) throw new AppError('This product has an active transport booking.', 'IN_USE');
    readAll('bookings').filter(function (b) { return b.cropId === crop.id; }).forEach(function (b) { deleteRecord('bookings', b.id); });
    readAll('retailerOrders').filter(function (o) { return o.cropId === crop.id; }).forEach(function (o) { deleteRecord('retailerOrders', o.id); });
    deleteRecord('crops', crop.id);
    return { deleted: true };
  }
  var f = body.fields || {};
  var editable = ['categoryId', 'subcategoryId', 'packets', 'weightPerPacket', 'predictedPrice', 'qualityScore', 'location', 'images'];
  Object.keys(f).forEach(function (k) { if (editable.indexOf(k) === -1) throw new AppError('Field cannot be edited: ' + k, 'FORBIDDEN'); });
  var merged = Object.assign({}, f);
  if ((f.categoryId !== undefined) !== (f.subcategoryId !== undefined) && f.categoryId === undefined) merged.categoryId = crop.categoryId;
  Object.assign(crop, adminProductFields(merged, crop));
  if (f.packets !== undefined) {
    var np = posInt(f.packets, 100000, 'Packets');
    var committed = crop.packets - crop.packetsRemaining;      // ordered or already collected
    if (np < committed) throw new AppError('At least ' + committed + ' packets are already ordered or delivered.');
    crop.packets = np; crop.packetsRemaining = np - committed;
    if (crop.packetsRemaining > 0 && crop.status === 'ordered') { crop.status = 'available_at_hub'; addHistory(crop, 'available_at_hub', 'admin', 'Hub - Available for Retailers'); }
    if (crop.packetsRemaining === 0 && crop.status === 'available_at_hub') { crop.status = 'ordered'; addHistory(crop, 'ordered', 'admin', 'Hub - Fully ordered'); }
  }
  crop.totalWeight = crop.packets * crop.weightPerPacket;
  writeRow('crops', findRowIndex(ENTITIES.crops, crop.id), crop);
  return { updated: true };
}

function adminSettings(admin, op, body) {
  if (op !== 'update') throw new AppError('Settings can only be updated.');
  var v = body.values;
  if (!v || typeof v !== 'object') throw new AppError('No settings supplied.');
  var cur = getSettings(), next = Object.assign({}, cur);
  Object.keys(v).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) throw new AppError('Unknown setting: ' + k);
    var d = DEFAULT_SETTINGS[k];
    if (typeof d === 'number') {
      var n = Number(v[k]);
      if (!isFinite(n) || n < 0 || n > 100 || Math.floor(n) !== n) throw new AppError(k + ' must be a whole number between 0 and 100.');
      next[k] = n;
    } else if (typeof d === 'boolean') {
      if (v[k] !== true && v[k] !== false) throw new AppError(k + ' must be true or false.');
      next[k] = v[k];
    } else {
      next[k] = cleanText(v[k], k, k === 'platformName', k === 'platformName' ? 60 : 120);
    }
  });
  if (next.farmerShare + next.transporterShare + next.hubShare !== 100) {
    throw new AppError('Farmer, transporter and hub shares must add up to 100% (currently ' + (next.farmerShare + next.transporterShare + next.hubShare) + '%).');
  }
  if (next.supportEmail && !EMAIL_RE.test(next.supportEmail)) throw new AppError('Support email is not valid.');
  if (next.supportPhone && !PHONE_RE.test(next.supportPhone)) throw new AppError('Support phone is not valid.');
  Object.keys(next).forEach(function (k) {
    var idx = findRowIndex(ENTITIES.settings, k);
    var rec = { id: k, value: String(next[k]) };
    if (idx === -1) insertRecord('settings', rec); else writeRow('settings', idx, rec);
  });
  return { updated: true };
}

// ── Setup & utilities (run manually from the Apps Script editor) ──────────────
// Safe to re-run: creates missing sheets, adds new columns to existing ones, never deletes data.
function ensureSheet(ss, ent) {
  var sheet = ss.getSheetByName(ent.sheet) || ss.insertSheet(ent.sheet);
  var cols = ent.headers.length;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, sheet.getMaxRows(), cols).setNumberFormat('@');
    sheet.getRange(1, 1, 1, cols).setValues([ent.headers]);
    sheet.setFrozenRows(1);
  } else {
    var existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].filter(function (h) { return h !== ''; });
    var prefixOk = existing.every(function (h, i) { return ent.headers[i] === h; });
    if (prefixOk && existing.length < cols) {
      sheet.getRange(1, 1, sheet.getMaxRows(), cols).setNumberFormat('@');
      sheet.getRange(1, 1, 1, cols).setValues([ent.headers]);
    }
  }
  sheet.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#16a34a').setFontColor('#ffffff');
  return sheet;
}

function setupSheets() {
  var ss = getSS();
  Object.keys(ENTITIES).forEach(function (name) { ensureSheet(ss, ENTITIES[name]); });
  var now = new Date().toISOString();

  if (readAll('hubPoints').length === 0) {
    writeRow('hubPoints', 2, { id: '1', name: 'Dhaka Central Hub', location: 'Dhaka, Bangladesh', capacity: 1000, managerId: '3', managerName: 'সালমা খাতুন (Salma Khatun)', phone: '', active: true });
    writeRow('hubPoints', 3, { id: '2', name: 'Chittagong Hub', location: 'Chittagong, Bangladesh', capacity: 800, managerId: '3', managerName: 'সালমা খাতুন (Salma Khatun)', phone: '', active: true });
  }
  if (readAll('transporters').length === 0) {
    // Only transporters that have a login are bookable, so seed exactly one (matches the demo user id '2').
    writeRow('transporters', 2, { id: '2', name: 'রহিম উদ্দিন (Rahim Uddin)', vehicleCapacity: 500, currentLoad: 0,
      availableCapacity: 500, location: 'Dhaka Route', status: 'available' });
  }
  if (readAll('users').length === 0) {
    // DEMO accounts. CHANGE THESE PASSWORDS before real use: setUserPassword(email, newPassword)
    [['1', 'farmer@test.com', 'আব্দুল করিম (Abdul Karim)', 'farmer', 'Jessore, Bangladesh', 'farmer123'],
     ['2', 'transporter@test.com', 'রহিম উদ্দিন (Rahim Uddin)', 'transporter', 'Dhaka, Bangladesh', 'transport123'],
     ['3', 'hub@test.com', 'সালমা খাতুন (Salma Khatun)', 'hub', 'Dhaka Hub Point', 'hubmanager123'],
     ['4', 'retailer@test.com', 'নাসির আহমেদ (Nasir Ahmed)', 'retailer', 'Dhaka Market', 'retail123'],
     ['5', 'admin@test.com', 'Dr. ফারহানা রহমান (Dr. Farhana)', 'admin', 'KrishiBazar AI HQ', 'admin123']
    ].forEach(function (u, i) {
      writeRow('users', i + 2, { id: u[0], email: u[1], name: u[2], role: u[3], phone: '', location: u[4],
        passwordHash: makePasswordRecord(u[5]), active: true, createdAt: now });
    });
  }
  if (readAll('categories').length === 0) {
    var cats = [['cat-vegetables', 'Vegetables', 'সবজি', ''], ['cat-grains', 'Grains', 'শস্য', ''],
      ['sub-potato', 'Potato', 'আলু', 'cat-vegetables'], ['sub-onion', 'Onion', 'পেঁয়াজ', 'cat-vegetables'],
      ['sub-carrot', 'Carrot', 'গাজর', 'cat-vegetables'], ['sub-tomato', 'Tomato', 'টমেটো', 'cat-vegetables'],
      ['sub-eggplant', 'Eggplant', 'বেগুন', 'cat-vegetables'], ['sub-cucumber', 'Cucumber', 'শসা', 'cat-vegetables'],
      ['sub-rice', 'Rice', 'চাল', 'cat-grains']];
    cats.forEach(function (c, i) { writeRow('categories', i + 2, { id: c[0], name: c[1], nameBn: c[2], parentId: c[3], active: true }); });
  }
  if (readAll('settings').length === 0) {
    Object.keys(DEFAULT_SETTINGS).forEach(function (k, i) { writeRow('settings', i + 2, { id: k, value: String(DEFAULT_SETTINGS[k]) }); });
  }
  return 'Setup complete. Demo users created — change their passwords with setUserPassword().';
}

function setUserPassword(email, newPassword) {
  if (!newPassword || String(newPassword).length < 8) throw new Error('Password must be at least 8 characters.');
  var users = readAll('users');
  var u = users.filter(function (x) { return String(x.email).toLowerCase() === String(email).toLowerCase(); })[0];
  if (!u) throw new Error('User not found: ' + email);
  u.passwordHash = makePasswordRecord(String(newPassword));
  writeRow('users', findRowIndex(ENTITIES.users, u.id), u);
  return 'Password updated for ' + email;
}

// Emergency access: promote or create an administrator from the editor if you ever lock yourself out.
function addUser(id, email, name, role, location, password) {
  if (ROLES.indexOf(role) === -1) throw new Error('Invalid role.');
  if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
  insertRecord('users', { id: String(id), email: String(email).toLowerCase(), name: name, role: role, phone: '',
    location: location || '', passwordHash: makePasswordRecord(String(password)), active: true, createdAt: new Date().toISOString() });
  if (role === 'transporter' && !readOne('transporters', String(id))) {
    insertRecord('transporters', { id: String(id), name: name, vehicleCapacity: 500, currentLoad: 0, availableCapacity: 500,
                                   location: location || '', status: 'available' });
  }
  return 'User added: ' + email;
}
