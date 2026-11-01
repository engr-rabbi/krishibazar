// Runs the REAL google-apps-script/Code.gs in a VM behind an HTTP server, mimicking the Apps Script web app.
import vm from 'node:vm';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

class Sheet {
  rows = [];
  getLastRow() { return this.rows.length; }
  getMaxRows() { return 1000; }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
  setFrozenRows() {}
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const api = {
      getValues() { return Array.from({ length: nr }, (_, i) => { const row = sh.rows[r - 1 + i] || []; return Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? ''); }); },
      setValues(v) { v.forEach((vals, i) => { const idx = r - 1 + i; sh.rows[idx] ||= []; vals.forEach((x, j) => { sh.rows[idx][c - 1 + j] = x; }); }); },
      setNumberFormat() { return api; }, setFontWeight() { return api; }, setBackground() { return api; }, setFontColor() { return api; },
    };
    return api;
  }
}
const sheets = {}, cache = new Map();
const ss = { getSheetByName: n => sheets[n] ?? null, insertSheet: n => (sheets[n] = new Sheet()) };
const props = {}; let folder = null;
const makeFolder = () => (folder = { getId: () => 'folder-1', createFile: blob => { const id = 'FILE' + crypto.randomBytes(10).toString('hex'); return { getId: () => id, setSharing() {} }; } });
const sandbox = {
  DriveApp: { Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' }, getFoldersByName: () => ({ hasNext: () => !!folder, next: () => folder }), createFolder: () => makeFolder(), getFolderById: () => folder },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_a, i) => Array.from(crypto.createHash('sha256').update(typeof i === 'string' ? Buffer.from(i) : Buffer.from(i)).digest()),
    base64Encode: b => Buffer.from(b).toString('base64'), getUuid: () => crypto.randomUUID(),
    base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)), newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
  Logger: { log() {} }, console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8'), sandbox);
sandbox.setupSheets();

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }  // real Apps Script cannot answer preflight
  let body = '';
  req.on('data', d => (body += d));
  req.on('end', () => {
    if (req.method !== 'POST') { res.writeHead(200); return res.end(sandbox.doGet().getContent()); }
    if (!(req.headers['content-type'] || '').startsWith('text/plain')) { res.writeHead(400); return res.end('needs text/plain'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(sandbox.doPost({ postData: { contents: body } }).getContent());
  });
}).listen(8787, () => console.log('mock backend on :8787'));
