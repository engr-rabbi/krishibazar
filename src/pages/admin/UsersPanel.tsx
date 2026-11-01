import React, { useMemo, useState } from 'react';
import { Plus, Pencil, KeyRound, Trash2, Power, RefreshCw } from 'lucide-react';
import { Button, Badge, EmptyState, FormField, Input, Select } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/Confirm';
import {
  BackendRequired, FormModal, PanelHeader, SearchBox, StatusPill, needsBackend, useNotice,
  EMAIL_RE, PHONE_RE, randomPassword, TABLE, TH,
} from '../../components/admin/kit';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAdmin } from '../../hooks/useAdmin';
import { formatDate } from '../../lib/utils';
import type { User, UserRole } from '../../types';

const ROLES: UserRole[] = ['farmer', 'transporter', 'hub', 'retailer', 'admin'];
const ROLE_LABEL: Record<UserRole, [string, string]> = {
  farmer: ['কৃষক', 'Farmer'], transporter: ['পরিবহনকারী', 'Transporter'], hub: ['হাব ম্যানেজার', 'Hub manager'],
  retailer: ['খুচরা বিক্রেতা', 'Retailer'], admin: ['অ্যাডমিন', 'Administrator'],
};

interface FormState { name: string; email: string; phone: string; location: string; role: UserRole; password: string; vehicleCapacity: string; active: boolean }
const blank = (role: UserRole): FormState => ({ name: '', email: '', phone: '', location: '', role, password: '', vehicleCapacity: '500', active: true });

export default function UsersPanel({ role }: { role: UserRole | 'all' }) {
  const { users, transporters, isLoading } = useData();
  const { user: me } = useAuth();
  const { lang, t } = useLanguage();
  const admin = useAdmin();
  const notice = useNotice();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(blank('farmer'));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteFor, setDeleteFor] = useState<User | null>(null);
  const [deactivateFor, setDeactivateFor] = useState<User | null>(null);

  const fixedRole = role !== 'all' ? role : null;
  const noun = fixedRole ? t(ROLE_LABEL[fixedRole][0], ROLE_LABEL[fixedRole][1]) : t('ব্যবহারকারী', 'User');
  const roleName = (r: UserRole) => (lang === 'bn' ? ROLE_LABEL[r][0] : ROLE_LABEL[r][1]);

  const rows = useMemo(() => users
    .filter(u => (fixedRole ? u.role === fixedRole : roleFilter === 'all' || u.role === roleFilter))
    .filter(u => status === 'all' || (status === 'active') === (u.active !== false))
    .filter(u => `${u.name} ${u.email} ${u.phone ?? ''} ${u.location ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [users, fixedRole, roleFilter, status, search]);

  if (needsBackend) return <BackendRequired />;

  const openNew = () => { setForm(blank(fixedRole ?? 'farmer')); setErrors({}); setServerError(''); setEditing('new'); };
  const openEdit = (u: User) => {
    const cap = transporters.find(x => x.id === u.id)?.vehicleCapacity;
    setForm({ name: u.name, email: u.email, phone: u.phone ?? '', location: u.location ?? '', role: u.role, password: '', vehicleCapacity: String(cap ?? 500), active: u.active !== false });
    setErrors({}); setServerError(''); setEditing(u);
  };

  const validate = (isNew: boolean): boolean => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('নাম প্রয়োজন।', 'Name is required.');
    if (!EMAIL_RE.test(form.email.trim())) e.email = t('সঠিক ইমেইল দিন।', 'Enter a valid email address.');
    if (!PHONE_RE.test(form.phone)) e.phone = t('শুধু সংখ্যা, +, -, স্পেস ও বন্ধনী ব্যবহার করুন।', 'Use digits, +, -, spaces and brackets only.');
    if (isNew && form.password.length < 8) e.password = t('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।', 'Password must be at least 8 characters.');
    if (form.role === 'transporter' && !(Number(form.vehicleCapacity) >= 1)) e.vehicleCapacity = t('বৈধ ধারণক্ষমতা দিন।', 'Enter a valid capacity.');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    const isNew = editing === 'new';
    if (!validate(isNew)) return;
    setBusy(true); setServerError('');
    const base = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), location: form.location.trim() };
    const res = isNew
      ? await admin.create('users', { ...base, role: form.role, password: form.password, active: form.active, vehicleCapacity: Number(form.vehicleCapacity) })
      : await admin.update('users', (editing as User).id, { ...base, role: form.role, ...(form.role === 'transporter' ? { vehicleCapacity: Number(form.vehicleCapacity) } : {}) });
    setBusy(false);
    if (!res.ok) { setServerError(res.error ?? ''); return; }
    setEditing(null);
    notice.show('success', isNew ? t('ব্যবহারকারী তৈরি হয়েছে।', 'User created.') : t('তথ্য আপডেট হয়েছে।', 'Changes saved.'));
  };

  const toggleActive = async (u: User) => {
    const res = await admin.update('users', u.id, { active: u.active === false });
    notice.show(res.ok ? 'success' : 'error', res.ok ? (u.active === false ? t('অ্যাকাউন্ট সক্রিয় করা হয়েছে।', 'Account activated.') : t('অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।', 'Account deactivated.')) : res.error ?? '');
    setDeactivateFor(null);
  };

  const doReset = async () => {
    if (!resetFor) return;
    if (newPassword.length < 8) { setServerError(t('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।', 'Password must be at least 8 characters.')); return; }
    setBusy(true); setServerError('');
    const res = await admin.resetPassword(resetFor.id, newPassword);
    setBusy(false);
    if (!res.ok) { setServerError(res.error ?? ''); return; }
    setResetFor(null);
    notice.show('success', t('পাসওয়ার্ড পরিবর্তন হয়েছে। ব্যবহারকারীকে নতুন পাসওয়ার্ডটি জানিয়ে দিন।', 'Password changed. Share the new password with the user securely.'));
  };

  const doDelete = async () => {
    if (!deleteFor) return;
    const res = await admin.remove('users', deleteFor.id);
    notice.show(res.ok ? 'success' : 'error', res.ok ? t('ব্যবহারকারী মুছে ফেলা হয়েছে।', 'User deleted.') : res.error ?? '');
    setDeleteFor(null);
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        title={fixedRole ? `${noun} ${t('ব্যবস্থাপনা', 'management')}` : t('ব্যবহারকারী ও অনুমতি', 'Users & permissions')}
        subtitle={`${rows.length} / ${users.filter(u => !fixedRole || u.role === fixedRole).length}`}
        action={<Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>{t('নতুন', 'Add')} {noun}</Button>}
      />
      {notice.node}

      <div className="flex flex-wrap gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('নাম, ইমেইল, ফোন বা ঠিকানা খুঁজুন...', 'Search name, email, phone or location...')} />
        {!fixedRole && (
          <Select value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')} className="max-w-[180px]" aria-label="Role filter">
            <option value="all">{t('সব ভূমিকা', 'All roles')}</option>
            {ROLES.map(r => <option key={r} value={r}>{roleName(r)}</option>)}
          </Select>
        )}
        <Select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="max-w-[160px]" aria-label="Status filter">
          <option value="all">{t('সব অবস্থা', 'All statuses')}</option>
          <option value="active">{t('সক্রিয়', 'Active')}</option>
          <option value="inactive">{t('নিষ্ক্রিয়', 'Inactive')}</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Plus className="h-10 w-10" />} title={isLoading ? t('লোড হচ্ছে...', 'Loading...') : t('কিছু পাওয়া যায়নি', 'Nothing found')} />
      ) : (
        <div className={TABLE}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {[t('নাম', 'Name'), t('ইমেইল', 'Email'), t('ফোন', 'Phone'), t('ঠিকানা', 'Location'), ...(fixedRole ? [] : [t('ভূমিকা', 'Role')]), t('অবস্থা', 'Status'), t('যোগদান', 'Joined'), t('অ্যাকশন', 'Actions')].map(h => <th key={h} className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(u => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className={`hover:bg-gray-50 ${u.active === false ? 'opacity-70' : ''}`} data-testid={`user-row-${u.email}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}{self && <Badge className="ml-2 bg-blue-100 text-blue-800">{t('আপনি', 'You')}</Badge>}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3 text-gray-600">{u.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{u.location || '—'}</td>
                    {!fixedRole && <td className="px-4 py-3"><Badge className="bg-purple-100 text-purple-800">{roleName(u.role)}</Badge></td>}
                    <td className="px-4 py-3"><StatusPill active={u.active !== false} /></td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" aria-label={t('সম্পাদনা', 'Edit')} title={t('সম্পাদনা', 'Edit')} onClick={() => openEdit(u)} icon={<Pencil className="h-4 w-4" />}>{''}</Button>
                        <Button size="sm" variant="ghost" aria-label={t('পাসওয়ার্ড রিসেট', 'Reset password')} title={t('পাসওয়ার্ড রিসেট', 'Reset password')} onClick={() => { setResetFor(u); setNewPassword(''); setServerError(''); }} icon={<KeyRound className="h-4 w-4" />}>{''}</Button>
                        {!self && <Button size="sm" variant="ghost" aria-label={u.active === false ? t('সক্রিয় করুন', 'Activate') : t('নিষ্ক্রিয় করুন', 'Deactivate')} title={u.active === false ? t('সক্রিয় করুন', 'Activate') : t('নিষ্ক্রিয় করুন', 'Deactivate')} onClick={() => (u.active === false ? void toggleActive(u) : setDeactivateFor(u))} icon={<Power className="h-4 w-4" />}>{''}</Button>}
                        {!self && <Button size="sm" variant="ghost" aria-label={t('মুছুন', 'Delete')} title={t('মুছুন', 'Delete')} className="text-red-600" onClick={() => setDeleteFor(u)} icon={<Trash2 className="h-4 w-4" />}>{''}</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <FormModal
        open={editing !== null} onClose={() => setEditing(null)} onSubmit={save} busy={busy} error={serverError}
        title={editing === 'new' ? `${t('নতুন', 'New')} ${noun}` : `${t('সম্পাদনা:', 'Edit:')} ${(editing as User | null)?.name ?? ''}`}
      >
        <FormField label={t('পূর্ণ নাম', 'Full name')} error={errors.name} required><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></FormField>
        <FormField label={t('ইমেইল (লগইন আইডি)', 'Email (login ID)')} error={errors.email} required><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('ফোন', 'Phone')} error={errors.phone}><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+880 1XXX-XXXXXX" /></FormField>
          <FormField label={t('ঠিকানা', 'Location')}><Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} /></FormField>
        </div>
        {!fixedRole && (
          <FormField label={t('ভূমিকা', 'Role')} required>
            <Select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as UserRole }))} disabled={editing !== 'new' && (editing as User | null)?.id === me?.id}>
              {ROLES.map(r => <option key={r} value={r}>{roleName(r)}</option>)}
            </Select>
          </FormField>
        )}
        {form.role === 'transporter' && (
          <FormField label={t('গাড়ির ধারণক্ষমতা (প্যাকেট)', 'Vehicle capacity (packets)')} error={errors.vehicleCapacity}>
            <Input type="number" min="1" value={form.vehicleCapacity} onChange={e => setForm(p => ({ ...p, vehicleCapacity: e.target.value }))} />
          </FormField>
        )}
        {editing === 'new' && (
          <>
            <FormField label={t('প্রাথমিক পাসওয়ার্ড', 'Initial password')} error={errors.password} required>
              <div className="flex gap-2">
                <Input type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} autoComplete="new-password" />
                <Button type="button" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setForm(p => ({ ...p, password: randomPassword() }))}>{t('তৈরি', 'Generate')}</Button>
              </div>
            </FormField>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />
              {t('অ্যাকাউন্ট সক্রিয় থাকবে', 'Account is active')}
            </label>
          </>
        )}
      </FormModal>

      <FormModal
        open={!!resetFor} onClose={() => setResetFor(null)} onSubmit={doReset} busy={busy} error={serverError}
        title={`${t('পাসওয়ার্ড রিসেট:', 'Reset password:')} ${resetFor?.name ?? ''}`} submitLabel={t('পাসওয়ার্ড পরিবর্তন', 'Change password')} maxWidth="max-w-md"
      >
        <FormField label={t('নতুন পাসওয়ার্ড', 'New password')} required>
          <div className="flex gap-2">
            <Input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
            <Button type="button" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setNewPassword(randomPassword())}>{t('তৈরি', 'Generate')}</Button>
          </div>
        </FormField>
        <p className="text-xs text-gray-500">{t('পুরোনো পাসওয়ার্ড সাথে সাথে অকেজো হবে।', 'The old password stops working immediately.')}</p>
      </FormModal>

      <ConfirmDialog
        open={!!deactivateFor} danger title={t('অ্যাকাউন্ট নিষ্ক্রিয় করবেন?', 'Deactivate this account?')}
        message={<>{t('এই ব্যবহারকারী সাথে সাথে লগআউট হবেন এবং আর লগইন করতে পারবেন না:', 'This user will be signed out immediately and cannot log in:')} <b>{deactivateFor?.name}</b>. {t('তথ্য মুছবে না; যেকোনো সময় আবার সক্রিয় করা যাবে।', 'Their data is kept and you can reactivate them at any time.')}</>}
        confirmLabel={t('নিষ্ক্রিয় করুন', 'Deactivate')} onCancel={() => setDeactivateFor(null)} onConfirm={async () => { if (deactivateFor) await toggleActive(deactivateFor); }}
      />
      <ConfirmDialog
        open={!!deleteFor} danger title={t('ব্যবহারকারী স্থায়ীভাবে মুছবেন?', 'Permanently delete this user?')}
        message={<>{t('এটি আর ফেরত আনা যাবে না:', 'This cannot be undone:')} <b>{deleteFor?.name}</b> ({deleteFor?.email}). {t('যার ডেটা আছে তাকে মুছা যাবে না — নিষ্ক্রিয় করুন।', 'Users who still own data cannot be deleted — deactivate them instead.')}</>}
        confirmLabel={t('হ্যাঁ, মুছুন', 'Yes, delete')} onCancel={() => setDeleteFor(null)} onConfirm={doDelete}
      />
    </div>
  );
}
