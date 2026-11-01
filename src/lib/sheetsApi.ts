/**
 * Google Apps Script API client.
 *
 * The Apps Script Web App is the only thing that talks to Google Sheets; no
 * credentials ever live in this bundle. Authenticated calls carry a session
 * token (obtained via login) in the request body.
 */
import type { AppData, BatchOp, SheetsApiResponse, User } from '../types';
import { clearToken, getToken } from './session';

const APPS_SCRIPT_URL: string = import.meta.env.VITE_APPS_SCRIPT_URL ?? '';
export const SHEETS_ENABLED = APPS_SCRIPT_URL.length > 0;
export const UNAUTHORIZED_EVENT = 'kb:unauthorized';
/** The backend (Apps Script) version this build of the site needs. See BACKEND_VERSION in Code.gs. */
export const REQUIRED_BACKEND_VERSION = 3;
export const OUTDATED_BACKEND_MESSAGE =
  'The Google Apps Script backend is older than this website. Paste the new Code.gs, run setupSheets, then deploy a NEW VERSION (see SETUP_GUIDE.md → Upgrading).';
const TIMEOUT_MS = 30_000;

async function callApi<T>(payload: Record<string, unknown>, withToken = true): Promise<SheetsApiResponse<T>> {
  if (!SHEETS_ENABLED) return { success: false, error: 'Backend is not configured.', code: 'NOT_CONFIGURED' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = withToken ? { ...payload, token: getToken() } : payload;
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = (await response.json()) as SheetsApiResponse<T>;
    // A pre-v3 script answers new actions (ADMIN, UPLOAD_IMAGE …) with this exact message
    if (!json.success && json.error === 'Unknown action.') {
      return { success: false, code: 'OUTDATED_BACKEND', error: OUTDATED_BACKEND_MESSAGE };
    }
    if (!json.success && json.code === 'UNAUTHORIZED') {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return json;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return {
      success: false,
      code: aborted ? 'TIMEOUT' : 'NETWORK',
      error: aborted
        ? 'The server took too long to respond. Please try again.'
        : 'Could not reach the server. Check your internet connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const loginRequest = (email: string, password: string) =>
  callApi<{ token: string; user: User }>({ action: 'LOGIN', email, password }, false);

export const logoutRequest = () => callApi({ action: 'LOGOUT' });

export const fetchAll = () => callApi<AppData>({ action: 'GET_ALL' });

/** Apply several inserts/updates atomically in a single round-trip */
export const commitOps = (ops: BatchOp[]) => callApi({ action: 'BATCH', ops });

/** Public (no login) — used by the QR complaint page */
export const submitComplaintRequest = (complaint: Record<string, unknown>) =>
  callApi({ action: 'SUBMIT_COMPLAINT', complaint }, false);

/** Admin-only data management (users, hubs, categories, products, settings) */
export const adminRequest = (payload: Record<string, unknown>) =>
  callApi<{ id?: string }>({ action: 'ADMIN', ...payload });

/** Upload a product photo to Google Drive; resolves to a shareable thumbnail URL */
export const uploadImageRequest = (dataUrl: string) =>
  callApi<{ url: string; id: string }>({ action: 'UPLOAD_IMAGE', dataUrl });
