// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function loadApi(url: string | undefined) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (url !== undefined) vi.stubEnv('VITE_APPS_SCRIPT_URL', url);
  return import('../src/lib/sheetsApi');
}

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sheetsApi', () => {
  it('reports "not configured" and never calls fetch without a backend URL', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const api = await loadApi('');
    expect(api.SHEETS_ENABLED).toBe(false);
    const res = await api.fetchAll();
    expect(res.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs JSON as text/plain (no CORS preflight) and attaches the session token in the body', async () => {
    localStorage.setItem('kb_token', 'tok123');
    const fetchSpy = vi.fn().mockResolvedValue(okResponse({ success: true, data: {} })); vi.stubGlobal('fetch', fetchSpy);
    const api = await loadApi('https://script.example/exec');
    await api.commitOps([{ op: 'update', entity: 'crops', id: 'c1', fields: { status: 'booked' } }]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://script.example/exec');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toContain('text/plain');
    const body = JSON.parse(init.body);
    expect(body.action).toBe('BATCH');
    expect(body.token).toBe('tok123');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('does not send a token with login or public complaints', async () => {
    localStorage.setItem('kb_token', 'tok123');
    const fetchSpy = vi.fn().mockResolvedValue(okResponse({ success: true })); vi.stubGlobal('fetch', fetchSpy);
    const api = await loadApi('https://script.example/exec');
    await api.loginRequest('a@b.c', 'pw');
    await api.submitComplaintRequest({ description: 'x' });
    for (const call of fetchSpy.mock.calls) expect(JSON.parse(call[1].body).token).toBeUndefined();
  });

  it('turns network failures into a friendly error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const api = await loadApi('https://script.example/exec');
    const res = await api.fetchAll();
    expect(res.success).toBe(false);
    expect(res.code).toBe('NETWORK');
    expect(res.error).toMatch(/internet/i);
  });

  it('handles HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response));
    const api = await loadApi('https://script.example/exec');
    expect((await api.fetchAll()).success).toBe(false);
  });

  it('clears the token and fires the unauthorized event when the session has expired', async () => {
    localStorage.setItem('kb_token', 'old');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ success: false, code: 'UNAUTHORIZED', error: 'Session expired.' })));
    const api = await loadApi('https://script.example/exec');
    const handler = vi.fn();
    window.addEventListener(api.UNAUTHORIZED_EVENT, handler);
    await api.fetchAll();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kb_token')).toBeNull();
  });
});
