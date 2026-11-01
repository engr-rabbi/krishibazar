import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Power } from 'lucide-react';
import { Button, EmptyState, FormField, Input, Select, ProgressBar } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/Confirm';
import { BackendRequired, FormModal, PanelHeader, SearchBox, StatusPill, needsBackend, useNotice, PHONE_RE, TABLE, TH } from '../../components/admin/kit';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAdmin } from '../../hooks/useAdmin';
import type { HubPoint } from '../../types';

interface FormState { name: string; location: string; capacity: string; managerId: string; phone: string; active: boolean }
const blank: FormState = { name: '', location: '', capacity: '1000', managerId: '', phone: '', active: true };

export default function HubsPanel() {
  const { hubPoints, users } = useData();
  const { t } = useLanguage();
  const admin = useAdmin();
  const notice = useNotice();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<HubPoint | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<HubPoint | null>(null);
  const [deactivateFor, setDeactivateFor] = useState<HubPoint | null>(null);

  const managers = useMemo(() => users.filter(u => u.role === 'hub' && u.active !== false), [users]);
  const rows = useMemo(() => hubPoints.filter(h => `${h.name} ${h.location} ${h.managerName}`.toLowerCase().includes(search.trim().toLowerCase())), [hubPoints, search]);

  if (needsBackend) return <BackendRequired />;

  const openNew = () => { setForm(blank); setErrors({}); setServerError(''); setEditing('new'); };
  const openEdit = (h: HubPoint) => {
    setForm({ name: h.name, location: h.location, capacity: String(h.capacity), managerId: h.managerId, phone: h.phone ?? '', active: h.active !== false });
    setErrors({}); setServerError(''); setEditing(h);
  };

  const validate = () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('নাম প্রয়োজন।', 'Name is required.');
    if (!form.location.trim()) e.location = t('অবস্থান প্রয়োজন।', 'Location is required.');
    const cap = Number(form.capacity);
    if (!Number.isInteger(cap) || cap < 1) e.capacity = t('ধারণক্ষমতা ১ বা তার বেশি পূর্ণসংখ্যা হতে হবে।', 'Capacity must be a whole number of 1 or more.');
    if (!PHONE_RE.test(form.phone)) e.phone = t('শুধু সংখ্যা, +, -, স্পেস ও বন্ধনী ব্যবহার করুন।', 'Use digits, +, -, spaces and brackets only.');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true); setServerError('');
    const data = { name: form.name.trim(), location: form.location.trim(), capacity: Number(form.capacity), managerId: form.managerId, phone: form.phone.trim(), active: form.active };
    const isNew = editing === 'new';
    const res = isNew ? await admin.create('hubPoints', data) : await admin.update('hubPoints', (editing as HubPoint).id, data);
    setBusy(false);
    if (!res.ok) { setServerError(res.error ?? ''); return; }
    setEditing(null);
    notice.show('success', isNew ? t('হাব পয়েন্ট তৈরি হয়েছে।', 'Hub point created.') : t('হাব পয়েন্ট আপডেট হয়েছে।', 'Hub point updated.'));
  };

  const setActive = async (h: HubPoint, active: boolean) => {
    const res = await admin.update('hubPoints', h.id, { active });
    notice.show(res.ok ? 'success' : 'error', res.ok ? (active ? t('হাব পয়েন্ট সক্রিয় হয়েছে।', 'Hub point activated.') : t('হাব পয়েন্ট নিষ্ক্রিয় হয়েছে।', 'Hub point deactivated.')) : res.error ?? '');
    setDeactivateFor(null);
  };

  const doDelete = async () => {
    if (!deleteFor) return;
    const res = await admin.remove('hubPoints', deleteFor.id);
    notice.show(res.ok ? 'success' : 'error', res.ok ? t('হাব পয়েন্ট মুছে ফেলা হয়েছে।', 'Hub point deleted.') : res.error ?? '');
    setDeleteFor(null);
  };

  return (
    <div className="space-y-4">
      <PanelHeader title={t('হাব পয়েন্ট ব্যবস্থাপনা', 'Hub point management')} subtitle={`${hubPoints.length} ${t('টি হাব', 'hubs')}`}
        action={<Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>{t('নতুন হাব', 'Add hub point')}</Button>} />
      {notice.node}
      <SearchBox value={search} onChange={setSearch} placeholder={t('হাবের নাম, অবস্থান বা ম্যানেজার খুঁজুন...', 'Search hub name, location or manager...')} />

      {rows.length === 0 ? <EmptyState icon={<Plus className="h-10 w-10" />} title={t('কোনো হাব পয়েন্ট নেই', 'No hub points')} /> : (
        <div className={TABLE}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              {[t('নাম', 'Name'), t('অবস্থান', 'Location'), t('ম্যানেজার', 'Manager'), t('ফোন', 'Phone'), t('স্টক / ধারণক্ষমতা', 'Stock / capacity'), t('অবস্থা', 'Status'), t('অ্যাকশন', 'Actions')].map(h => <th key={h} className={TH}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(h => (
                <tr key={h.id} className={`hover:bg-gray-50 ${h.active === false ? 'opacity-70' : ''}`} data-testid={`hub-row-${h.name}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{h.name}</td>
                  <td className="px-4 py-3 text-gray-600">{h.location}</td>
                  <td className="px-4 py-3 text-gray-600">{h.managerName || <span className="text-amber-600">{t('নিয়োগ নেই', 'Unassigned')}</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{h.phone || '—'}</td>
                  <td className="min-w-[160px] px-4 py-3"><ProgressBar value={h.currentStock} max={h.capacity} label={`${h.currentStock} / ${h.capacity}`} /></td>
                  <td className="px-4 py-3"><StatusPill active={h.active !== false} /></td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={t('সম্পাদনা', 'Edit')} title={t('সম্পাদনা', 'Edit')} onClick={() => openEdit(h)} icon={<Pencil className="h-4 w-4" />}>{''}</Button>
                    <Button size="sm" variant="ghost" aria-label={h.active === false ? t('সক্রিয় করুন', 'Activate') : t('নিষ্ক্রিয় করুন', 'Deactivate')} title={h.active === false ? t('সক্রিয় করুন', 'Activate') : t('নিষ্ক্রিয় করুন', 'Deactivate')}
                      onClick={() => (h.active === false ? void setActive(h, true) : setDeactivateFor(h))} icon={<Power className="h-4 w-4" />}>{''}</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" aria-label={t('মুছুন', 'Delete')} title={t('মুছুন', 'Delete')} onClick={() => setDeleteFor(h)} icon={<Trash2 className="h-4 w-4" />}>{''}</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormModal open={editing !== null} onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={serverError}
        title={editing === 'new' ? t('নতুন হাব পয়েন্ট', 'New hub point') : `${t('সম্পাদনা:', 'Edit:')} ${(editing as HubPoint | null)?.name ?? ''}`}>
        <FormField label={t('হাবের নাম', 'Hub name')} error={errors.name} required><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></FormField>
        <FormField label={t('অবস্থান / ঠিকানা', 'Location / address')} error={errors.location} required><Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('ধারণক্ষমতা (প্যাকেট)', 'Capacity (packets)')} error={errors.capacity} required><Input type="number" min="1" value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} /></FormField>
          <FormField label={t('যোগাযোগের ফোন', 'Contact phone')} error={errors.phone}><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></FormField>
        </div>
        <FormField label={t('হাব ম্যানেজার', 'Hub manager')}>
          <Select value={form.managerId} onChange={e => setForm(p => ({ ...p, managerId: e.target.value }))}>
            <option value="">{t('— নিয়োগ নেই —', '— Unassigned —')}</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
          </Select>
          {managers.length === 0 && <p className="mt-1 text-xs text-amber-600">{t('আগে "ব্যবহারকারী" ট্যাবে একজন হাব ম্যানেজার তৈরি করুন।', 'Create a Hub manager in the Users tab first.')}</p>}
        </FormField>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />
          {t('সক্রিয় (নতুন ডেলিভারি গ্রহণ করে)', 'Active (accepts new deliveries)')}
        </label>
      </FormModal>

      <ConfirmDialog open={!!deactivateFor} danger={false} title={t('হাব নিষ্ক্রিয় করবেন?', 'Deactivate this hub point?')}
        message={<>{t('নতুন বুকিংয়ে', 'It will no longer appear in new bookings:')} <b>{deactivateFor?.name}</b> {t('আর দেখাবে না। বিদ্যমান স্টক ও অর্ডার অক্ষত থাকবে।', '— existing stock and orders are not affected.')}</>}
        confirmLabel={t('নিষ্ক্রিয় করুন', 'Deactivate')} onCancel={() => setDeactivateFor(null)} onConfirm={async () => { if (deactivateFor) await setActive(deactivateFor, false); }} />
      <ConfirmDialog open={!!deleteFor} title={t('হাব পয়েন্ট স্থায়ীভাবে মুছবেন?', 'Permanently delete this hub point?')}
        message={<>{t('এটি আর ফেরত আনা যাবে না:', 'This cannot be undone:')} <b>{deleteFor?.name}</b>. {t('ফসল, অর্ডার বা বুকিং থাকলে মুছা যাবে না — নিষ্ক্রিয় করুন।', 'A hub with crops, orders or bookings cannot be deleted — deactivate it instead.')}</>}
        confirmLabel={t('হ্যাঁ, মুছুন', 'Yes, delete')} onCancel={() => setDeleteFor(null)} onConfirm={doDelete} />
    </div>
  );
}
