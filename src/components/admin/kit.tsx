import React, { ReactNode, useCallback, useRef, useState } from 'react';
import { Search, ServerOff } from 'lucide-react';
import { Alert, Button, Modal, Badge } from '../ui';
import { useLanguage } from '../../contexts/LanguageContext';
import { SHEETS_ENABLED } from '../../lib/sheetsApi';

/** Success / error toast shown at the top of a panel; clears itself after a few seconds. */
export function useNotice() {
  const [n, setN] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((kind: 'success' | 'error', text: string) => {
    setN({ kind, text });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setN(null), 6000);
  }, []);
  const node = n ? (
    <div role={n.kind === 'error' ? 'alert' : 'status'} data-testid={`notice-${n.kind}`}>
      <Alert variant={n.kind}>{n.text}</Alert>
    </div>
  ) : null;
  return { show, node };
}

export function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  const { t } = useLanguage();
  return <Badge className={active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}>{active ? t('সক্রিয়', 'Active') : t('নিষ্ক্রিয়', 'Inactive')}</Badge>;
}

/** Modal with a form, an inline server/validation error, and a Save button that shows progress. */
export function FormModal({ open, title, onClose, onSubmit, submitLabel, error, busy, children, maxWidth = 'max-w-lg' }: {
  open: boolean; title: string; onClose: () => void; onSubmit: () => void; submitLabel?: string;
  error?: string; busy?: boolean; children: ReactNode; maxWidth?: string;
}) {
  const { t } = useLanguage();
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={title} maxWidth={maxWidth}>
      <form noValidate onSubmit={e => { e.preventDefault(); onSubmit(); }} className="space-y-4">
        {error && <div role="alert"><Alert variant="error">{error}</Alert></div>}
        {children}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-100 bg-white px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6">
          <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={onClose}>{t('বাতিল', 'Cancel')}</Button>
          <Button type="submit" className="flex-1" loading={busy}>{submitLabel ?? t('সংরক্ষণ করুন', 'Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Shown instead of management screens when running without the Google Sheets backend. */
export function BackendRequired() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <ServerOff className="h-10 w-10 text-gray-300" />
      <h3 className="text-lg font-semibold text-gray-800">{t('এই সুবিধার জন্য ব্যাকএন্ড প্রয়োজন', 'This feature needs the Google Sheets backend')}</h3>
      <p className="max-w-md text-sm text-gray-500">
        {t('ডেমো মোডে ডেটা সংরক্ষিত হয় না। SETUP_GUIDE.md অনুসরণ করে Apps Script URL সেট করুন।',
           'Demo mode does not store anything. Follow SETUP_GUIDE.md and set VITE_APPS_SCRIPT_URL to manage real data.')}
      </p>
    </div>
  );
}

export const needsBackend = !SHEETS_ENABLED;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[0-9+\-\s()]{0,30}$/;

export function randomPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export const TH = 'px-4 py-3 text-left font-medium';
export const TABLE = 'overflow-x-auto rounded-xl border border-gray-200 bg-white';
