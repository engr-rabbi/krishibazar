import React, { useMemo, useState } from 'react';
import { Pencil, XCircle, CheckCircle, CreditCard } from 'lucide-react';
import { Button, Badge, EmptyState, FormField, Input, Select, Textarea } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/Confirm';
import { BackendRequired, FormModal, PanelHeader, SearchBox, needsBackend, useNotice, TABLE, TH } from '../../components/admin/kit';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAdmin } from '../../hooks/useAdmin';
import { useCropName } from '../../components/ui/Panels';
import { formatDate } from '../../lib/utils';
import type { OrderStatus, RetailerOrder } from '../../types';

const STATUS: Record<OrderStatus, { cls: string; label: [string, string] }> = {
  pre_booked: { cls: 'bg-yellow-100 text-yellow-800', label: ['প্রি-বুকড', 'Pre-booked'] },
  pre_paid:   { cls: 'bg-blue-100 text-blue-800',     label: ['পরিশোধিত', 'Paid'] },
  collected:  { cls: 'bg-emerald-100 text-emerald-800', label: ['সংগৃহীত', 'Collected'] },
  cancelled:  { cls: 'bg-red-100 text-red-700',       label: ['বাতিল', 'Cancelled'] },
};

export default function OrdersPanel() {
  const { retailerOrders, hubPoints, crops } = useData();
  const { lang, t } = useLanguage();
  const cropName = useCropName();
  const admin = useAdmin();
  const notice = useNotice();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | OrderStatus>('all');
  const [editing, setEditing] = useState<RetailerOrder | null>(null);
  const [packets, setPackets] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelFor, setCancelFor] = useState<RetailerOrder | null>(null);

  const rows = useMemo(() => retailerOrders
    .filter(o => status === 'all' || o.status === status)
    .filter(o => `${o.retailerName} ${o.cropType} ${o.id}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [retailerOrders, status, search]);

  if (needsBackend) return <BackendRequired />;

  const label = (s: OrderStatus) => (lang === 'bn' ? STATUS[s].label[0] : STATUS[s].label[1]);
  const hubName = (id: string) => hubPoints.find(h => h.id === id)?.name ?? '—';
  const total = rows.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.amount, 0);

  const advance = async (o: RetailerOrder, to: OrderStatus) => {
    const res = await admin.updateOrder(o.id, { status: to });
    notice.show(res.ok ? 'success' : 'error', res.ok ? t('অর্ডারের অবস্থা আপডেট হয়েছে।', 'Order status updated.') : res.error ?? '');
  };

  const openEdit = (o: RetailerOrder) => { setEditing(o); setPackets(String(o.packets)); setNote(o.note ?? ''); setError(''); };
  const saveEdit = async () => {
    if (!editing) return;
    const fields: Record<string, unknown> = {};
    if (editing.status === 'pre_booked' && Number(packets) !== editing.packets) {
      const n = Number(packets);
      if (!Number.isInteger(n) || n < 1) { setError(t('প্যাকেট ১ বা তার বেশি পূর্ণসংখ্যা হতে হবে।', 'Packets must be a whole number of 1 or more.')); return; }
      fields.packets = n;
    }
    if (note !== (editing.note ?? '')) fields.note = note;
    if (Object.keys(fields).length === 0) { setEditing(null); return; }
    setBusy(true); setError('');
    const res = await admin.updateOrder(editing.id, fields);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? ''); return; }
    setEditing(null);
    notice.show('success', t('অর্ডার আপডেট হয়েছে।', 'Order updated.'));
  };

  const doCancel = async () => {
    if (!cancelFor) return;
    const res = await admin.updateOrder(cancelFor.id, { status: 'cancelled' });
    notice.show(res.ok ? 'success' : 'error', res.ok ? t('অর্ডার বাতিল হয়েছে; প্যাকেটগুলো স্টকে ফিরে গেছে।', 'Order cancelled; the packets are back in stock.') : res.error ?? '');
    setCancelFor(null);
  };

  return (
    <div className="space-y-4">
      <PanelHeader title={t('অর্ডার ব্যবস্থাপনা', 'Order management')} subtitle={`${rows.length} ${t('টি অর্ডার', 'orders')} · ৳${total.toLocaleString()}`} />
      {notice.node}
      <div className="flex flex-wrap gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('রিটেইলার, পণ্য বা অর্ডার আইডি খুঁজুন...', 'Search retailer, product or order ID...')} />
        <Select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="max-w-[190px]" aria-label="Order status filter">
          <option value="all">{t('সব অবস্থা', 'All statuses')}</option>
          {(Object.keys(STATUS) as OrderStatus[]).map(s => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
      </div>

      {rows.length === 0 ? <EmptyState icon={<CreditCard className="h-10 w-10" />} title={t('কোনো অর্ডার নেই', 'No orders found')} /> : (
        <div className={TABLE}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              {[t('অর্ডার', 'Order'), t('রিটেইলার', 'Retailer'), t('পণ্য', 'Product'), t('প্যাকেট', 'Pkt'), t('পরিমাণ', 'Amount'), t('হাব', 'Hub'), t('অবস্থা', 'Status'), t('তারিখ', 'Date'), t('অ্যাকশন', 'Actions')].map(h => <th key={h} className={TH}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(o => (
                <tr key={o.id} className={`hover:bg-gray-50 ${o.status === 'cancelled' ? 'opacity-60' : ''}`} data-testid={`order-row-${o.id}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.id.slice(0, 10)}{o.note && <div className="font-sans text-gray-400" title={o.note}>📝</div>}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{o.retailerName}</td>
                  <td className="px-4 py-3">{cropName(crops.find(c => c.id === o.cropId)?.type ?? o.cropType)}</td>
                  <td className="px-4 py-3">{o.packets}</td>
                  <td className="px-4 py-3 font-semibold text-green-700">৳{o.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{hubName(o.hubPointId)}</td>
                  <td className="px-4 py-3"><Badge className={STATUS[o.status].cls}>{label(o.status)}</Badge></td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(o.createdAt)}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
                    {o.status === 'pre_booked' && <Button size="sm" variant="secondary" icon={<CreditCard className="h-3 w-3" />} onClick={() => void advance(o, 'pre_paid')}>{t('পরিশোধিত', 'Mark paid')}</Button>}
                    {o.status === 'pre_paid' && <Button size="sm" variant="secondary" icon={<CheckCircle className="h-3 w-3" />} onClick={() => void advance(o, 'collected')}>{t('সংগৃহীত', 'Mark collected')}</Button>}
                    {o.status !== 'cancelled' && <Button size="sm" variant="ghost" aria-label={t('সম্পাদনা', 'Edit')} title={t('সম্পাদনা', 'Edit')} onClick={() => openEdit(o)} icon={<Pencil className="h-4 w-4" />}>{''}</Button>}
                    {(o.status === 'pre_booked' || o.status === 'pre_paid') && <Button size="sm" variant="ghost" className="text-red-600" aria-label={t('বাতিল', 'Cancel order')} title={t('বাতিল', 'Cancel order')} onClick={() => setCancelFor(o)} icon={<XCircle className="h-4 w-4" />}>{''}</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">{t('অর্ডার মুছে ফেলা যায় না (হিসাবের স্বচ্ছতার জন্য) — বাতিল করুন; স্টক নিজে থেকেই ফিরে আসবে।', 'Orders are never deleted (to keep the accounts auditable) — cancel them instead; stock returns automatically.')}</p>

      <FormModal open={!!editing} onClose={() => setEditing(null)} onSubmit={saveEdit} busy={busy} error={error} maxWidth="max-w-md"
        title={`${t('অর্ডার সম্পাদনা —', 'Edit order —')} ${editing?.retailerName ?? ''}`}>
        <FormField label={t('প্যাকেট সংখ্যা', 'Packets')}>
          <Input type="number" min="1" value={packets} onChange={e => setPackets(e.target.value)} disabled={editing?.status !== 'pre_booked'} />
          {editing?.status !== 'pre_booked' && <p className="mt-1 text-xs text-gray-500">{t('পেমেন্টের পর পরিমাণ বদলানো যায় না।', 'The quantity cannot be changed after payment.')}</p>}
        </FormField>
        <FormField label={t('অ্যাডমিন নোট', 'Admin note')}><Textarea rows={3} value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></FormField>
      </FormModal>

      <ConfirmDialog open={!!cancelFor} title={t('অর্ডার বাতিল করবেন?', 'Cancel this order?')}
        message={<>{cancelFor?.retailerName} — {cancelFor?.packets} {t('প্যাকেট', 'packets')} (৳{cancelFor?.amount.toLocaleString()}). {t('প্যাকেটগুলো স্টকে ফিরে যাবে। এটি পূর্বাবস্থায় ফেরানো যায় না।', 'The packets return to stock. This cannot be undone.')}</>}
        confirmLabel={t('হ্যাঁ, বাতিল করুন', 'Yes, cancel order')} onCancel={() => setCancelFor(null)} onConfirm={doCancel} />
    </div>
  );
}
