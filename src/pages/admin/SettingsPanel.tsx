import React, { useEffect, useState } from 'react';
import { Check, X, ShieldCheck } from 'lucide-react';
import { Alert, Button, Card, FormField, Input } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/Confirm';
import { BackendRequired, EMAIL_RE, PHONE_RE, PanelHeader, needsBackend, useNotice, TABLE, TH } from '../../components/admin/kit';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAdmin } from '../../hooks/useAdmin';

const PERMISSIONS: { area: [string, string]; roles: Record<'farmer' | 'transporter' | 'hub' | 'retailer' | 'admin', boolean> }[] = [
  { area: ['নিজের পণ্য যোগ ও বুকিং', 'Add own products & book transport'], roles: { farmer: true, transporter: false, hub: false, retailer: false, admin: true } },
  { area: ['বুকিং গ্রহণ ও ডেলিভারি আপডেট', 'Accept bookings & update deliveries'], roles: { farmer: false, transporter: true, hub: false, retailer: false, admin: true } },
  { area: ['হাবে ফসল গ্রহণ', 'Receive crops at a hub'], roles: { farmer: false, transporter: false, hub: true, retailer: false, admin: true } },
  { area: ['অর্ডার দেওয়া, পেমেন্ট ও সংগ্রহ', 'Place, pay for & collect orders'], roles: { farmer: false, transporter: false, hub: false, retailer: true, admin: true } },
  { area: ['সব পণ্য/অর্ডার দেখা ও সম্পাদনা', 'View & edit all products and orders'], roles: { farmer: false, transporter: false, hub: false, retailer: false, admin: true } },
  { area: ['ব্যবহারকারী, হাব, ক্যাটাগরি ও সেটিংস পরিচালনা', 'Manage users, hubs, categories & settings'], roles: { farmer: false, transporter: false, hub: false, retailer: false, admin: true } },
  { area: ['কৃষকের পেমেন্ট রেকর্ড', 'Record farmer payments'], roles: { farmer: false, transporter: false, hub: false, retailer: false, admin: true } },
];

export default function SettingsPanel() {
  const { settings } = useData();
  const { t } = useLanguage();
  const admin = useAdmin();
  const notice = useNotice();
  const [form, setForm] = useState({ platformName: '', supportPhone: '', supportEmail: '', farmerShare: '70', transporterShare: '20', hubShare: '10' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  useEffect(() => {
    setForm({ platformName: settings.platformName, supportPhone: settings.supportPhone, supportEmail: settings.supportEmail,
      farmerShare: String(settings.farmerShare), transporterShare: String(settings.transporterShare), hubShare: String(settings.hubShare) });
  }, [settings]);

  if (needsBackend) return <BackendRequired />;

  const total = Number(form.farmerShare) + Number(form.transporterShare) + Number(form.hubShare);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.platformName.trim()) e.platformName = t('নাম প্রয়োজন।', 'Name is required.');
    if (form.supportEmail && !EMAIL_RE.test(form.supportEmail)) e.supportEmail = t('সঠিক ইমেইল দিন।', 'Enter a valid email.');
    if (!PHONE_RE.test(form.supportPhone)) e.supportPhone = t('সঠিক ফোন নম্বর দিন।', 'Enter a valid phone number.');
    for (const k of ['farmerShare', 'transporterShare', 'hubShare'] as const) {
      const n = Number(form[k]);
      if (form[k] === '' || !Number.isInteger(n) || n < 0 || n > 100) e[k] = t('০–১০০ এর পূর্ণসংখ্যা দিন।', 'Whole number 0–100.');
    }
    if (!e.farmerShare && !e.transporterShare && !e.hubShare && total !== 100) e.total = t(`তিনটি অংশের যোগফল ১০০% হতে হবে (এখন ${total}%)।`, `The three shares must add up to 100% (currently ${total}%).`);
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true); setServerError('');
    const res = await admin.saveSettings({
      platformName: form.platformName.trim(), supportPhone: form.supportPhone.trim(), supportEmail: form.supportEmail.trim(),
      farmerShare: Number(form.farmerShare), transporterShare: Number(form.transporterShare), hubShare: Number(form.hubShare),
    });
    setBusy(false);
    if (!res.ok) { setServerError(res.error ?? ''); return; }
    notice.show('success', t('সেটিংস সংরক্ষিত হয়েছে।', 'Settings saved.'));
  };

  const setMaintenance = async (on: boolean) => {
    const res = await admin.saveSettings({ maintenanceMode: on });
    notice.show(res.ok ? 'success' : 'error', res.ok ? (on ? t('রক্ষণাবেক্ষণ মোড চালু হয়েছে।', 'Maintenance mode is ON.') : t('রক্ষণাবেক্ষণ মোড বন্ধ হয়েছে।', 'Maintenance mode is OFF.')) : res.error ?? '');
    setConfirmMaintenance(false);
  };

  return (
    <div className="space-y-6">
      <PanelHeader title={t('প্ল্যাটফর্ম সেটিংস', 'Platform settings')} subtitle={t('কোড পরিবর্তন ছাড়াই এখান থেকে সব বদলানো যায়।', 'Change these any time — no code changes needed.')} />
      {notice.node}

      <Card>
        <h4 className="mb-4 font-semibold text-gray-900">{t('সাধারণ তথ্য', 'General')}</h4>
        <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4">
          {serverError && <div role="alert"><Alert variant="error">{serverError}</Alert></div>}
          <FormField label={t('প্ল্যাটফর্মের নাম', 'Platform name')} error={errors.platformName} required><Input value={form.platformName} maxLength={60} onChange={e => setForm(p => ({ ...p, platformName: e.target.value }))} /></FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('সহায়তা ফোন', 'Support phone')} error={errors.supportPhone}><Input value={form.supportPhone} onChange={e => setForm(p => ({ ...p, supportPhone: e.target.value }))} /></FormField>
            <FormField label={t('সহায়তা ইমেইল', 'Support email')} error={errors.supportEmail}><Input value={form.supportEmail} onChange={e => setForm(p => ({ ...p, supportEmail: e.target.value }))} /></FormField>
          </div>

          <div>
            <h4 className="mb-1 mt-2 font-semibold text-gray-900">{t('রাজস্ব বণ্টন (%)', 'Revenue sharing (%)')}</h4>
            <p className="mb-3 text-xs text-gray-500">{t('সংগৃহীত অর্ডারের টাকা এই অনুপাতে ভাগ হয়। বদলালে সব হিসাব (আগেরগুলোসহ) নতুন অনুপাতে দেখাবে।', 'Collected-order revenue is split in this ratio. Changing it recalculates all reports, including past orders.')}</p>
            <div className="grid grid-cols-3 gap-4">
              <FormField label={t('কৃষক', 'Farmer')} error={errors.farmerShare}><Input type="number" min="0" max="100" value={form.farmerShare} onChange={e => setForm(p => ({ ...p, farmerShare: e.target.value }))} /></FormField>
              <FormField label={t('পরিবহন', 'Transporter')} error={errors.transporterShare}><Input type="number" min="0" max="100" value={form.transporterShare} onChange={e => setForm(p => ({ ...p, transporterShare: e.target.value }))} /></FormField>
              <FormField label={t('হাব', 'Hub')} error={errors.hubShare}><Input type="number" min="0" max="100" value={form.hubShare} onChange={e => setForm(p => ({ ...p, hubShare: e.target.value }))} /></FormField>
            </div>
            <p className={`mt-2 text-sm font-medium ${total === 100 ? 'text-emerald-600' : 'text-red-600'}`} data-testid="share-total">{t('মোট:', 'Total:')} {Number.isFinite(total) ? total : 0}%{errors.total && ` — ${errors.total}`}</p>
          </div>
          <Button type="submit" loading={busy}>{t('সেটিংস সংরক্ষণ করুন', 'Save settings')}</Button>
        </form>
      </Card>

      <Card accentColor={settings.maintenanceMode ? 'border-amber-500' : 'border-gray-200'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">{t('রক্ষণাবেক্ষণ মোড', 'Maintenance mode')}</h4>
            <p className="text-sm text-gray-500">{t('চালু থাকলে শুধু অ্যাডমিন লগইন করতে পারবেন; বাকিরা সাথে সাথে বের হয়ে যাবেন।', 'While ON, only administrators can use the platform; everyone else is blocked immediately.')}</p>
          </div>
          <Button variant={settings.maintenanceMode ? 'primary' : 'danger'} onClick={() => (settings.maintenanceMode ? void setMaintenance(false) : setConfirmMaintenance(true))}>
            {settings.maintenanceMode ? t('বন্ধ করুন', 'Turn OFF') : t('চালু করুন', 'Turn ON')}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-green-600" /><h4 className="font-semibold text-gray-900">{t('ভূমিকা ও অনুমতি', 'Roles & permissions')}</h4></div>
        <p className="mb-3 text-xs text-gray-500">{t('অনুমতিগুলো সার্ভারে প্রয়োগ হয়। কারও ভূমিকা বদলাতে বা অ্যাকাউন্ট নিষ্ক্রিয় করতে "ব্যবহারকারী" ট্যাব ব্যবহার করুন — পরিবর্তন সাথে সাথে কার্যকর হয়।', 'These rules are enforced on the server. To change someone\'s role or switch an account off, use the Users tab — it takes effect immediately.')}</p>
        <div className={TABLE}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr>
              <th className={TH}>{t('কাজ', 'Capability')}</th>
              {[t('কৃষক', 'Farmer'), t('পরিবহন', 'Transporter'), t('হাব', 'Hub'), t('রিটেইলার', 'Retailer'), t('অ্যাডমিন', 'Admin')].map(h => <th key={h} className="px-3 py-3 text-center font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {PERMISSIONS.map(p => (
                <tr key={p.area[1]}>
                  <td className="px-4 py-2 text-gray-700">{t(p.area[0], p.area[1])}</td>
                  {(['farmer', 'transporter', 'hub', 'retailer', 'admin'] as const).map(r => (
                    <td key={r} className="px-3 py-2 text-center">{p.roles[r] ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <X className="mx-auto h-4 w-4 text-gray-300" />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog open={confirmMaintenance} title={t('রক্ষণাবেক্ষণ মোড চালু করবেন?', 'Turn maintenance mode ON?')}
        message={t('অ্যাডমিন ছাড়া সবাই সাথে সাথে সিস্টেম ব্যবহার বন্ধ করে দেবে এবং লগইন করতে পারবে না।', 'Everyone except administrators will be blocked immediately and cannot log in.')}
        confirmLabel={t('চালু করুন', 'Turn ON')} onCancel={() => setConfirmMaintenance(false)} onConfirm={() => setMaintenance(true)} />
    </div>
  );
}
