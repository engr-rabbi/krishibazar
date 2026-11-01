import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Power, CornerDownRight } from 'lucide-react';
import { Button, Badge, EmptyState, FormField, Input } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/Confirm';
import { BackendRequired, FormModal, PanelHeader, StatusPill, needsBackend, useNotice } from '../../components/admin/kit';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAdmin } from '../../hooks/useAdmin';
import type { Category } from '../../types';

interface Editing { mode: 'new' | 'edit'; category?: Category; parent?: Category }

export default function CategoriesPanel() {
  const { categories, crops } = useData();
  const { t } = useLanguage();
  const admin = useAdmin();
  const notice = useNotice();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Category | null>(null);

  const tops = useMemo(() => categories.filter(c => c.parentId === '').sort((a, b) => a.name.localeCompare(b.name)), [categories]);
  const subsOf = (id: string) => categories.filter(c => c.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  const productCount = (c: Category) => crops.filter(p => p.categoryId === c.id || p.subcategoryId === c.id).length;

  if (needsBackend) return <BackendRequired />;

  const openNew = (parent?: Category) => { setName(''); setNameBn(''); setError(''); setFieldError(''); setEditing({ mode: 'new', parent }); };
  const openEdit = (c: Category) => { setName(c.name); setNameBn(c.nameBn); setError(''); setFieldError(''); setEditing({ mode: 'edit', category: c }); };

  const save = async () => {
    if (!name.trim()) { setFieldError(t('নাম প্রয়োজন।', 'Name is required.')); return; }
    setFieldError(''); setBusy(true); setError('');
    const res = editing?.mode === 'new'
      ? await admin.create('categories', { name: name.trim(), nameBn: nameBn.trim(), parentId: editing.parent?.id ?? '' })
      : await admin.update('categories', editing!.category!.id, { name: name.trim(), nameBn: nameBn.trim() });
    setBusy(false);
    if (!res.ok) { setError(res.error ?? ''); return; }
    const wasNew = editing?.mode === 'new';
    setEditing(null);
    notice.show('success', wasNew ? t('ক্যাটাগরি তৈরি হয়েছে।', 'Category created.') : t('ক্যাটাগরি আপডেট হয়েছে।', 'Category updated.'));
  };

  const toggle = async (c: Category) => {
    const res = await admin.update('categories', c.id, { active: !c.active });
    notice.show(res.ok ? 'success' : 'error', res.ok ? (c.active ? t('নিষ্ক্রিয় করা হয়েছে (নতুন পণ্যে দেখাবে না)।', 'Deactivated (hidden from new products).') : t('সক্রিয় করা হয়েছে।', 'Activated.')) : res.error ?? '');
  };

  const doDelete = async () => {
    if (!deleteFor) return;
    const res = await admin.remove('categories', deleteFor.id);
    notice.show(res.ok ? 'success' : 'error', res.ok ? t('ক্যাটাগরি মুছে ফেলা হয়েছে।', 'Category deleted.') : res.error ?? '');
    setDeleteFor(null);
  };

  const row = (c: Category, depth: 0 | 1) => (
    <div key={c.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${depth ? 'bg-gray-50 pl-10' : 'bg-white'}`} data-testid={`category-row-${c.name}`}>
      {depth === 1 && <CornerDownRight className="h-4 w-4 text-gray-300" />}
      <div className="min-w-[160px] flex-1">
        <p className="font-medium text-gray-900">{c.name}{c.nameBn && <span className="ml-2 text-sm text-gray-500">{c.nameBn}</span>}</p>
        <p className="text-xs text-gray-500">{productCount(c)} {t('টি পণ্য', 'product(s)')}{depth === 0 && ` · ${subsOf(c.id).length} ${t('টি সাবক্যাটাগরি', 'subcategories')}`}</p>
      </div>
      <StatusPill active={c.active} />
      <div className="flex gap-1">
        {depth === 0 && <Button size="sm" variant="secondary" icon={<Plus className="h-3 w-3" />} onClick={() => openNew(c)}>{t('সাব', 'Sub')}</Button>}
        <Button size="sm" variant="ghost" aria-label={t('সম্পাদনা', 'Edit')} title={t('সম্পাদনা', 'Edit')} onClick={() => openEdit(c)} icon={<Pencil className="h-4 w-4" />}>{''}</Button>
        <Button size="sm" variant="ghost" aria-label={c.active ? t('নিষ্ক্রিয় করুন', 'Deactivate') : t('সক্রিয় করুন', 'Activate')} title={c.active ? t('নিষ্ক্রিয় করুন', 'Deactivate') : t('সক্রিয় করুন', 'Activate')} onClick={() => void toggle(c)} icon={<Power className="h-4 w-4" />}>{''}</Button>
        <Button size="sm" variant="ghost" className="text-red-600" aria-label={t('মুছুন', 'Delete')} title={t('মুছুন', 'Delete')} onClick={() => setDeleteFor(c)} icon={<Trash2 className="h-4 w-4" />}>{''}</Button>
      </div>
    </div>
  );

  const title = editing?.mode === 'edit' ? `${t('সম্পাদনা:', 'Edit:')} ${editing.category?.name}`
    : editing?.parent ? `${t('নতুন সাবক্যাটাগরি —', 'New subcategory in')} ${editing.parent.name}` : t('নতুন ক্যাটাগরি', 'New category');

  return (
    <div className="space-y-4">
      <PanelHeader title={t('ক্যাটাগরি ও সাবক্যাটাগরি', 'Categories & subcategories')} subtitle={t('কৃষকের পণ্য যোগ করার ফর্মে এই তালিকা দেখায়।', 'Farmers choose from this list when adding a product.')}
        action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => openNew()}>{t('নতুন ক্যাটাগরি', 'Add category')}</Button>} />
      {notice.node}
      {tops.length === 0 ? <EmptyState icon={<Plus className="h-10 w-10" />} title={t('কোনো ক্যাটাগরি নেই', 'No categories yet')} /> : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
          {tops.map(c => <React.Fragment key={c.id}>{row(c, 0)}{subsOf(c.id).map(s => row(s, 1))}</React.Fragment>)}
        </div>
      )}
      <p className="text-xs text-gray-500"><Badge className="mr-1 bg-blue-100 text-blue-800">{t('টিপ', 'Tip')}</Badge>{t('নাম বদলালে বিদ্যমান পণ্য ও অর্ডারেও নতুন নাম দেখাবে। ব্যবহৃত ক্যাটাগরি মুছা যায় না — নিষ্ক্রিয় করুন।', 'Renaming also updates existing products and orders. A category in use cannot be deleted — deactivate it instead.')}</p>

      <FormModal open={!!editing} onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={error} title={title} maxWidth="max-w-md">
        <FormField label={t('নাম (ইংরেজি)', 'Name (English)')} error={fieldError} required><Input value={name} onChange={e => setName(e.target.value)} maxLength={60} /></FormField>
        <FormField label={t('নাম (বাংলা)', 'Name (Bengali)')}><Input value={nameBn} onChange={e => setNameBn(e.target.value)} maxLength={60} /></FormField>
      </FormModal>

      <ConfirmDialog open={!!deleteFor} title={t('ক্যাটাগরি মুছবেন?', 'Delete this category?')}
        message={<>{t('এটি আর ফেরত আনা যাবে না:', 'This cannot be undone:')} <b>{deleteFor?.name}</b>.</>}
        confirmLabel={t('হ্যাঁ, মুছুন', 'Yes, delete')} onCancel={() => setDeleteFor(null)} onConfirm={doDelete} />
    </div>
  );
}
