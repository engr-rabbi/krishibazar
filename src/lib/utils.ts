import type { CropStatus } from '../types';

/** Generate a random-ish unique ID */
export const generateId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Format ISO string to a localised display string */
export const formatDate = (iso?: string): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('bn-BD', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const formatDateTime = (iso?: string): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('bn-BD');
  } catch {
    return iso;
  }
};

/** Tailwind colour classes per crop status */
export const statusBadgeClass = (status: CropStatus | 'confirmed'): string => {
  const map: Record<CropStatus | 'confirmed', string> = {
    confirmed:        'bg-cyan-100   text-cyan-800',
    pending:          'bg-yellow-100 text-yellow-800',
    booked:           'bg-blue-100   text-blue-800',
    in_transit:       'bg-purple-100 text-purple-800',
    delivered_to_hub: 'bg-indigo-100 text-indigo-800',
    available_at_hub: 'bg-green-100  text-green-800',
    ordered:          'bg-orange-100 text-orange-800',
    collected:        'bg-emerald-100 text-emerald-800',
  };
  return map[status] ?? 'bg-gray-100 text-gray-800';
};

/** Human-readable status labels */
export const statusLabel = (status: CropStatus, lang: 'bn' | 'en'): string => {
  const labels: Record<CropStatus, [string, string]> = {
    pending:          ['অপেক্ষমান',      'Pending'],
    booked:           ['বুক করা হয়েছে', 'Booked'],
    in_transit:       ['পরিবহনে',         'In Transit'],
    delivered_to_hub: ['হাবে পৌঁছেছে',   'At Hub'],
    available_at_hub: ['হাবে উপলব্ধ',    'Available at Hub'],
    ordered:          ['অর্ডার করা হয়েছে','Ordered'],
    collected:        ['সংগ্রহ সম্পন্ন', 'Collected'],
  };
  const pair = labels[status] ?? ['অজানা', 'Unknown'];
  return lang === 'bn' ? pair[0] : pair[1];
};

/** Clamp a number between min and max */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Percentage helper */
export const pct = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 100);

/** Build a public complaint-page URL that works with HashRouter on GitHub Pages */
export const buildComplaintUrl = (retailerId: string, orderId: string, cropType?: string): string => {
  const base = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams({ order: orderId });
  if (cropType) params.set('crop', cropType);
  return `${base}#/complaint/${encodeURIComponent(retailerId)}?${params.toString()}`;
};
