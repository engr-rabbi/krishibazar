import { useCallback } from 'react';
import { adminRequest, commitOps, uploadImageRequest } from '../lib/sheetsApi';
import { useData } from '../contexts/DataContext';
import type { BatchOp } from '../types';

export interface AdminResult { ok: boolean; error?: string; id?: string }

/**
 * Admin mutations. Unlike the role dashboards these never touch local state optimistically:
 * the server is the judge (it validates, enforces permissions and may refuse), and on success we
 * re-read everything so every page reflects exactly what is stored in the spreadsheet.
 * The error text is returned so forms can show the reason right where the user is looking.
 */
export function useAdmin() {
  const { refreshData } = useData();

  const run = useCallback(async (payload: Record<string, unknown>): Promise<AdminResult> => {
    const res = await adminRequest(payload);
    if (!res.success) return { ok: false, error: res.error ?? 'Request failed.' };
    await refreshData({ silent: true });
    return { ok: true, id: res.data?.id };
  }, [refreshData]);

  const create = useCallback((entity: string, row: Record<string, unknown>) => run({ op: 'create', entity, row }), [run]);
  const update = useCallback((entity: string, id: string, fields: Record<string, unknown>) => run({ op: 'update', entity, id, fields }), [run]);
  const remove = useCallback((entity: string, id: string) => run({ op: 'delete', entity, id }), [run]);
  const resetPassword = useCallback((id: string, password: string) => run({ op: 'resetPassword', entity: 'users', id, password }), [run]);
  const saveSettings = useCallback((values: Record<string, unknown>) => run({ op: 'update', entity: 'settings', values }), [run]);

  const updateOrder = useCallback(async (orderId: string, fields: Record<string, unknown>): Promise<AdminResult> => {
    const op: BatchOp = { op: 'update', entity: 'retailerOrders', id: orderId, fields };
    const res = await commitOps([op]);
    if (!res.success) return { ok: false, error: res.error ?? 'Request failed.' };
    await refreshData({ silent: true });
    return { ok: true };
  }, [refreshData]);

  const uploadImage = useCallback(async (dataUrl: string): Promise<{ url?: string; error?: string }> => {
    const res = await uploadImageRequest(dataUrl);
    return res.success && res.data ? { url: res.data.url } : { error: res.error };
  }, []);

  return { create, update, remove, resetPassword, saveSettings, updateOrder, uploadImage };
}
