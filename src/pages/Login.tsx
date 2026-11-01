import React, { useEffect, useState } from 'react';
import { Sprout, Truck, Building, Store, Shield, Eye, EyeOff, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, Alert, Input, FormField } from '../components/ui';
import type { UserRole } from '../types';

const ROLE_META: Record<UserRole, { labelBn: string; labelEn: string; Icon: typeof Sprout; color: string }> = {
  farmer:      { labelBn: 'কৃষক',          labelEn: 'Farmer',      Icon: Sprout,   color: 'green'  },
  transporter: { labelBn: 'পরিবহনকারী',     labelEn: 'Transporter', Icon: Truck,    color: 'blue'   },
  hub:         { labelBn: 'হাব ম্যানেজার',  labelEn: 'Hub Manager', Icon: Building, color: 'purple' },
  retailer:    { labelBn: 'খুচরা বিক্রেতা', labelEn: 'Retailer',    Icon: Store,    color: 'orange' },
  admin:       { labelBn: 'অ্যাডমিন',       labelEn: 'Admin',       Icon: Shield,   color: 'red'    },
};

interface DemoAccount { email: string; password: string; role: UserRole }

const COLOR_MAP: Record<string, string> = {
  green:  'border-green-200  hover:bg-green-50  text-green-700',
  blue:   'border-blue-200   hover:bg-blue-50   text-blue-700',
  purple: 'border-purple-200 hover:bg-purple-50 text-purple-700',
  orange: 'border-orange-200 hover:bg-orange-50 text-orange-700',
  red:    'border-red-200    hover:bg-red-50    text-red-700',
};

export default function Login() {
  const { login }              = useAuth();
  const { lang, toggleLang, t } = useLanguage();

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPw,       setShowPw]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [fieldErrors,  setFieldErrors]  = useState<{ email?: string; password?: string }>({});
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  // Quick-fill buttons exist only in local demo mode (no backend configured)
  useEffect(() => {
    if (import.meta.env.VITE_APPS_SCRIPT_URL) return;
    void import('../lib/demoAccounts').then(m => setDemoAccounts(m.DEMO_ACCOUNTS));
  }, []);

  const validate = () => {
    const errs: typeof fieldErrors = {};
    if (!email.trim())    errs.email    = t('ইমেইল প্রয়োজন।', 'Email is required.');
    if (!password.trim()) errs.password = t('পাসওয়ার্ড প্রয়োজন।', 'Password is required.');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError('');
    try {
      const res = await login(email, password);
      if (!res.ok) setError(res.error ?? t('ইমেইল বা পাসওয়ার্ড ভুল।', 'Invalid email or password.'));
    } catch {
      setError(t('লগইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।', 'Login failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-green-50 to-blue-50">
      <div className="w-full max-w-md space-y-6">

        {/* Language toggle */}
        <div className="flex justify-end">
          <button
            onClick={toggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            <Globe className="h-4 w-4" />
            {t('English', 'বাংলা')}
          </button>
        </div>

        {/* Brand */}
        <div className="text-center">
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-green-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg">
            <Sprout className="h-10 w-10 text-white" />
          </div>
          <h1 className="mt-5 text-3xl font-extrabold text-gray-900">
            {t('কৃষিবাজার AI', 'KrishiBazar AI')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('কৃষকদের ক্ষমতায়ন • বাজার সংযোগ', 'Empowering Farmers • Connecting Markets')}
          </p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-5">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <FormField label={t('ইমেইল', 'Email')} error={fieldErrors.email} required>
              <Input
                type="email" value={email} autoComplete="email"
                placeholder="your@email.com"
                onChange={e => { setEmail(e.target.value); setFieldErrors(p => ({ ...p, email: undefined })); }}
              />
            </FormField>

            <FormField label={t('পাসওয়ার্ড', 'Password')} error={fieldErrors.password} required>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'} value={password} autoComplete="current-password"
                  placeholder="••••••••"
                  onChange={e => { setPassword(e.target.value); setFieldErrors(p => ({ ...p, password: undefined })); }}
                  className="pr-10"
                />
                <button
                  type="button" tabIndex={-1}
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </FormField>

            {error && <Alert variant="error">{error}</Alert>}

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {t('লগইন করুন', 'Login')}
            </Button>
          </form>

          {demoAccounts.length > 0 && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-gray-400">{t('ডেমো মোড', 'Demo mode')}</span>
                </div>
              </div>
              <div className="space-y-2">
                {demoAccounts.map(acc => {
                  const meta = ROLE_META[acc.role];
                  const Icon = meta.Icon;
                  return (
                    <button
                      key={acc.email} type="button"
                      onClick={() => { setEmail(acc.email); setPassword(acc.password); setError(''); setFieldErrors({}); }}
                      className={`w-full flex items-center justify-between p-3 border-2 rounded-xl transition-colors ${COLOR_MAP[meta.color]}`}
                    >
                      <span className="flex items-center gap-2 font-medium text-sm">
                        <Icon className="h-4 w-4" />
                        {lang === 'bn' ? meta.labelBn : meta.labelEn}
                      </span>
                      <span className="text-xs opacity-70">{acc.email}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400">
          {t('বাংলাদেশের কৃষকদের জন্য ❤️ দিয়ে তৈরি', 'Built with ❤️ for Bangladesh farmers')}
        </p>
      </div>
    </div>
  );
}
