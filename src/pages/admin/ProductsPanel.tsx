import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button, Badge, EmptyState, FormField, Input, Select } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/Confirm';
import { ProductImage } from '../../components/ui/ProductImage';
import { PhotoUploader } from '../../components/ui/PhotoUploader';
import { BackendRequired, FormModal, PanelHeader, SearchBox, needsBackend, useNotice, TABLE, TH } from '../../components/admin/kit';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAdmin } from '../../hooks/useAdmin';
import { useCropName } from '../../components/ui/Panels';
import { statusBadgeClass, statusLabel } from '../../lib/utils';
import type { Crop } from '../../types';

interface FormState {
  farmerId: string; categoryId: string; subcategoryId: string; packets: string; weightPerPacket: string;
  predictedPrice: string; qualityScore: string; location: string; images: string[]; status: 'pending' | 'available_at_hub'; hubPointId: string;
}
const blank: FormState = { farmerId: '', categoryId: '', subcategoryId: '', packets: '', weightPerPacket: '10', predictedPrice: '', qualityScore: '90', location: '', images: [], status: 'pending', hubPointId: '' };

export default function ProductsPanel() {
  const { crops, users, categories, hubPoints, retailerOrders, backendOutdated } = useData();
  const { lang, t } = useLanguage();
  const cropName = useCropName();
  const admin = useAdmin();
  const notice = useNotice();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [editing, setEditing] = useState<Crop | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Crop | null>(null);

  const farmers = useMemo(() => users.filter(u => u.role === 'farmer' && u.active !== false), [users]);
  const tops = categories.filter(c => c.parentId === '');
  const subs = categories.filter(c => c.parentId === form.categoryId);
  const activeHubs = hubPoints.filter(h => h.active !== false);
  const catName = (id?: string) => categories.find(c => c.id === id)?.name ?? '';

  const rows = useMemo(() => crops
    .filter(c => statusFilter === 'all' || c.status === statusFilter)
    .filter(c => catFilter === 'all' || c.categoryId === catFilter)
    .filter(c => `${c.type} ${c.farmerName} ${c.location}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [crops, statusFilter, catFilter, search]);

  if (needsBackend) return <BackendRequired />;

  const optLabel = (c: { name: string; nameBn: string }) => (lang === 'bn' && c.nameBn ? `${c.nameBn} (${c.name})` : c.name);
  const openNew = () => { setForm({ ...blank, hubPointId: activeHubs[0]?.id ?? '' }); setErrors({}); setServerError(''); setEditing('new'); };
  const openEdit = (c: Crop) => {
    setForm({ farmerId: c.farmerId, categoryId: c.categoryId ?? '', subcategoryId: c.subcategoryId ?? '', packets: String(c.packets), weightPerPacket: String(c.weightPerPacket),
      predictedPrice: String(c.predictedPrice), qualityScore: String(c.qualityScore), location: c.location, images: c.images, status: 'pending', hubPointId: c.hubPointId ?? '' });
    setErrors({}); setServerError(''); setEditing(c);
  };

  const validate = (isNew: boolean) => {
    const e: typeof errors = {};
    if (isNew && !form.farmerId) e.farmerId = t('কৃষক নির্বাচন করুন।', 'Choose a farmer.');
    if (!form.categoryId) e.categoryId = t('ক্যাটাগরি নির্বাচন করুন।', 'Choose a category.');
    else if (subs.length > 0 && !form.subcategoryId) e.subcategoryId = t('সাবক্যাটাগরি নির্বাচন করুন।', 'Choose a subcategory.');
    const packets = Number(form.packets), weight = Number(form.weightPerPacket), price = Number(form.predictedPrice), q = Number(form.qualityScore);
    if (!Number.isInteger(packets) || packets < 1) e.packets = t('প্যাকেট ১ বা তার বেশি পূর্ণসংখ্যা হতে হবে।', 'Packets must be a whole number of 1 or more.');
    if (!Number.isInteger(weight) || weight < 1) e.weightPerPacket = t('ওজন ১ বা তার বেশি পূর্ণসংখ্যা হতে হবে।', 'Weight must be a whole number of 1 or more.');
    if (form.predictedPrice === '' || !(price >= 0)) e.predictedPrice = t('দাম ০ বা তার বেশি হতে হবে।', 'Price must be 0 or more.');
    if (!(q >= 0 && q <= 100)) e.qualityScore = t('গুণমান ০–১০০ এর মধ্যে হতে হবে।', 'Quality must be between 0 and 100.');
    if (isNew && form.status === 'available_at_hub' && !form.hubPointId) e.hubPointId = t('হাব নির্বাচন করুন।', 'Choose a hub point.');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    const isNew = editing === 'new';
    if (!validate(isNew)) return;
    setBusy(true); setServerError('');
    const common = { categoryId: form.categoryId, subcategoryId: form.subcategoryId, packets: Number(form.packets), weightPerPacket: Number(form.weightPerPacket),
      predictedPrice: Number(form.predictedPrice), qualityScore: Number(form.qualityScore), location: form.location.trim(), images: form.images };
    const res = isNew
      ? await admin.create('crops', { ...common, farmerId: form.farmerId, status: form.status, hubPointId: form.status === 'available_at_hub' ? form.hubPointId : '' })
      : await admin.update('crops', (editing as Crop).id, common);
    setBusy(false);
    if (!res.ok) { setServerError(res.error ?? ''); return; }
    setEditing(null);
    notice.show('success', isNew ? t('পণ্য যোগ হয়েছে।', 'Product added.') : t('পণ্য আপডেট হয়েছে।', 'Product updated.'));
  };

  const doDelete = async () => {
    if (!deleteFor) return;
    const res = await admin.remove('crops', deleteFor.id);
    notice.show(res.ok ? 'success' : 'error', res.ok ? t('পণ্য মুছে ফেলা হয়েছে।', 'Product deleted.') : res.error ?? '');
    setDeleteFor(null);
  };

  const orderCount = (id: string) => retailerOrders.filter(o => o.cropId === id && o.status !== 'cancelled').length;
  const editingCrop = editing && editing !== 'new' ? editing : null;
  const committed = editingCrop ? editingCrop.packets - editingCrop.packetsRemaining : 0;

  return (
    <div className="space-y-4">
      <PanelHeader title={t('পণ্য ব্যবস্থাপনা', 'Product management')} subtitle={`${rows.length} / ${crops.length}`}
        action={<Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>{t('নতুন পণ্য', 'Add product')}</Button>} />
      {notice.node}
      <div className="flex flex-wrap gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('পণ্য, কৃষক বা স্থান খুঁজুন...', 'Search product, farmer or location...')} />
        <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="max-w-[190px]" aria-label="Category filter">
          <option value="all">{t('সব ক্যাটাগরি', 'All categories')}</option>
          {tops.map(c => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
        </Select>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="max-w-[190px]" aria-label="Status filter">
          <option value="all">{t('সব অবস্থা', 'All statuses')}</option>
          {(['pending', 'booked', 'in_transit', 'delivered_to_hub', 'available_at_hub', 'ordered', 'collected'] as const).map(s => <option key={s} value={s}>{statusLabel(s, lang)}</option>)}
        </Select>
      </div>

      {rows.length === 0 ? <EmptyState icon={<Plus className="h-10 w-10" />} title={t('কোনো পণ্য নেই', 'No products found')} /> : (
        <div className={TABLE}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              {['', t('পণ্য', 'Product'), t('কৃষক', 'Farmer'), t('ক্যাটাগরি', 'Category'), t('স্টক', 'Stock'), t('দাম/কেজি', 'Price/kg'), t('গুণমান', 'Quality'), t('অবস্থা', 'Status'), t('অ্যাকশন', 'Actions')].map((h, i) => <th key={i} className={TH}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-gray-50" data-testid={`product-row-${c.id}`}>
                  <td className="px-4 py-2"><ProductImage images={c.images} alt={c.type} className="h-12 w-12 rounded-lg" /></td>
                  <td className="px-4 py-3 font-medium text-gray-900">{cropName(c.type)}<div className="text-xs font-normal text-gray-500">{c.location}</div></td>
                  <td className="px-4 py-3 text-gray-600">{c.farmerName}</td>
                  <td className="px-4 py-3 text-gray-600">{catName(c.categoryId) || '—'}{c.subcategoryId && <span className="text-gray-400"> › {catName(c.subcategoryId)}</span>}</td>
                  <td className="px-4 py-3">{c.packetsRemaining}<span className="text-gray-400"> / {c.packets}</span></td>
                  <td className="px-4 py-3 text-green-700">৳{c.predictedPrice}</td>
                  <td className="px-4 py-3">{c.qualityScore}%</td>
                  <td className="px-4 py-3"><Badge className={statusBadgeClass(c.status)}>{statusLabel(c.status, lang)}</Badge></td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={t('সম্পাদনা', 'Edit')} title={t('সম্পাদনা', 'Edit')} onClick={() => openEdit(c)} icon={<Pencil className="h-4 w-4" />}>{''}</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" aria-label={t('মুছুন', 'Delete')} title={t('মুছুন', 'Delete')} onClick={() => setDeleteFor(c)} icon={<Trash2 className="h-4 w-4" />}>{''}</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormModal open={editing !== null} onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={serverError} maxWidth="max-w-2xl"
        title={editing === 'new' ? t('নতুন পণ্য', 'New product') : `${t('সম্পাদনা:', 'Edit:')} ${editingCrop ? cropName(editingCrop.type) : ''}`}>
        {editing === 'new' && (
          <FormField label={t('কৃষক', 'Farmer')} error={errors.farmerId} required>
            <Select value={form.farmerId} onChange={e => setForm(p => ({ ...p, farmerId: e.target.value, location: p.location || (farmers.find(f => f.id === e.target.value)?.location ?? '') }))}>
              <option value="">{t('নির্বাচন করুন', 'Select')}</option>
              {farmers.map(f => <option key={f.id} value={f.id}>{f.name} ({f.email})</option>)}
            </Select>
            {farmers.length === 0 && (
              <p className="mt-1 text-xs text-amber-700" data-testid="no-farmers-hint">
                {backendOutdated
                  ? t('কৃষকদের তালিকা আসছে না কারণ Apps Script পুরোনো — ওপরের লাল বার্তার ধাপগুলো অনুসরণ করুন।', 'The farmer list is empty because the Apps Script is out of date — follow the red message above.')
                  : t('কোনো সক্রিয় কৃষক নেই। আগে "কৃষক" ট্যাবে একজন কৃষক যোগ করুন।', 'There is no active farmer yet. Add one in the Farmers tab first.')}
              </p>
            )}
          </FormField>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('ক্যাটাগরি', 'Category')} error={errors.categoryId} required>
            <Select value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value, subcategoryId: '' }))}>
              <option value="">{t('নির্বাচন করুন', 'Select')}</option>
              {tops.filter(c => c.active || c.id === form.categoryId).map(c => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
            </Select>
            {tops.length === 0 && (
              <p className="mt-1 text-xs text-amber-700" data-testid="no-categories-hint">
                {backendOutdated
                  ? t('ক্যাটাগরি আসছে না কারণ Apps Script পুরোনো — ওপরের লাল বার্তার ধাপগুলো অনুসরণ করুন।', 'Categories are empty because the Apps Script is out of date — follow the red message above.')
                  : t('কোনো ক্যাটাগরি নেই। আগে "ক্যাটাগরি" ট্যাবে একটি তৈরি করুন।', 'There are no categories yet. Create one in the Categories tab first.')}
              </p>
            )}
          </FormField>
          {subs.length > 0 && (
            <FormField label={t('সাবক্যাটাগরি / ফসল', 'Subcategory / crop')} error={errors.subcategoryId} required>
              <Select value={form.subcategoryId} onChange={e => setForm(p => ({ ...p, subcategoryId: e.target.value }))}>
                <option value="">{t('নির্বাচন করুন', 'Select')}</option>
                {subs.filter(c => c.active || c.id === form.subcategoryId).map(c => <option key={c.id} value={c.id}>{optLabel(c)}</option>)}
              </Select>
            </FormField>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <FormField label={t('মোট প্যাকেট', 'Total packets')} error={errors.packets} required><Input type="number" min="1" value={form.packets} onChange={e => setForm(p => ({ ...p, packets: e.target.value }))} /></FormField>
          <FormField label={t('কেজি/প্যাকেট', 'kg / packet')} error={errors.weightPerPacket} required><Input type="number" min="1" value={form.weightPerPacket} onChange={e => setForm(p => ({ ...p, weightPerPacket: e.target.value }))} /></FormField>
          <FormField label={t('দাম (৳/কেজি)', 'Price (৳/kg)')} error={errors.predictedPrice} required><Input type="number" min="0" step="0.5" value={form.predictedPrice} onChange={e => setForm(p => ({ ...p, predictedPrice: e.target.value }))} /></FormField>
          <FormField label={t('গুণমান (%)', 'Quality (%)')} error={errors.qualityScore}><Input type="number" min="0" max="100" value={form.qualityScore} onChange={e => setForm(p => ({ ...p, qualityScore: e.target.value }))} /></FormField>
        </div>
        {editingCrop && (
          <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
            {t(`${committed} টি প্যাকেট ইতিমধ্যে অর্ডার/ডেলিভারি হয়েছে, তাই মোট প্যাকেট এর কম করা যাবে না। নতুন দাম শুধু ভবিষ্যৎ অর্ডারে প্রযোজ্য।`,
               `${committed} packets are already ordered or delivered, so the total cannot go below that. A new price only affects future orders.`)}
            {orderCount(editingCrop.id) > 0 && ` (${orderCount(editingCrop.id)} ${t('টি সক্রিয় অর্ডার', 'active order(s)')})`}
          </p>
        )}
        <FormField label={t('স্থান', 'Location')}><Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} /></FormField>
        {editing === 'new' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('প্রাথমিক অবস্থা', 'Initial status')}>
              <Select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as FormState['status'] }))}>
                <option value="pending">{t('অপেক্ষমান (কৃষক পরিবহন বুক করবেন)', 'Pending (farmer books transport)')}</option>
                <option value="available_at_hub">{t('হাবে উপলব্ধ (সরাসরি রিটেইলারদের জন্য)', 'Available at a hub (listed for retailers now)')}</option>
              </Select>
            </FormField>
            {form.status === 'available_at_hub' && (
              <FormField label={t('হাব পয়েন্ট', 'Hub point')} error={errors.hubPointId} required>
                <Select value={form.hubPointId} onChange={e => setForm(p => ({ ...p, hubPointId: e.target.value }))}>
                  <option value="">{t('নির্বাচন করুন', 'Select')}</option>
                  {activeHubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </Select>
              </FormField>
            )}
          </div>
        )}
        <FormField label={t('পণ্যের ছবি', 'Product photos')}><PhotoUploader value={form.images} onChange={images => setForm(p => ({ ...p, images }))} disabled={busy} /></FormField>
      </FormModal>

      <ConfirmDialog open={!!deleteFor} title={t('পণ্য স্থায়ীভাবে মুছবেন?', 'Permanently delete this product?')}
        message={<>{t('এটি আর ফেরত আনা যাবে না:', 'This cannot be undone:')} <b>{deleteFor ? cropName(deleteFor.type) : ''}</b> ({deleteFor?.farmerName}). {t('সক্রিয় অর্ডার বা বুকিং থাকলে আগে সেগুলো বাতিল করতে হবে।', 'Active orders or bookings must be cancelled first.')}</>}
        confirmLabel={t('হ্যাঁ, মুছুন', 'Yes, delete')} onCancel={() => setDeleteFor(null)} onConfirm={doDelete} />
    </div>
  );
}
