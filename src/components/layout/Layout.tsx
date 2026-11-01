import React, { ReactNode } from 'react';
import { LogOut, User, Bell, Globe, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useData } from '../../contexts/DataContext';

const ROLE_BADGE: Record<string, string> = {
  farmer:      'bg-green-100  text-green-800',
  transporter: 'bg-blue-100   text-blue-800',
  hub:         'bg-purple-100 text-purple-800',
  retailer:    'bg-orange-100 text-orange-800',
  admin:       'bg-red-100    text-red-800',
};

interface LayoutProps {
  children: ReactNode;
  title: { bn: string; en: string };
}

export default function Layout({ children, title }: LayoutProps) {
  const { user, logout }          = useAuth();
  const { lang, toggleLang, t }   = useLanguage();
  const { isLoading, refreshData, error, clearError, settings, backendOutdated } = useData();

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex flex-col">
      {/* ── Header ── */}
      <header className="bg-white shadow-md border-b-4 border-green-500 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

          {/* Brand + Title */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex-shrink-0">
              <p className="text-xl font-bold text-green-600 leading-tight">
                {settings.platformName && settings.platformName !== 'KrishiBazar AI' ? settings.platformName : t('কৃষিবাজার AI', 'KrishiBazar AI')}
              </p>
            </div>
            <div className="hidden sm:block h-6 w-px bg-gray-200" />
            <h2 className="text-sm sm:text-base font-semibold text-gray-700 truncate">
              {lang === 'bn' ? title.bn : title.en}
            </h2>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Refresh */}
            <button
              onClick={() => void refreshData()}
              disabled={isLoading}
              title={t('রিফ্রেশ', 'Refresh')}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            {/* Language */}
            <button
              onClick={toggleLang}
              className="hidden sm:flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors text-sm font-medium"
            >
              <Globe className="h-4 w-4" />
              {t('English', 'বাংলা')}
            </button>

            {/* Notification (placeholder) */}
            <button className="relative p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full" />
            </button>

            {/* User info */}
            <div className="hidden md:block text-right">
              <p className="text-xs font-medium text-gray-800 leading-tight">{user?.name}</p>
              <p className="text-xs text-gray-500">{user?.location}</p>
            </div>
            <span className={`hidden sm:inline px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${ROLE_BADGE[user?.role ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
              {user?.role}
            </span>
            <User className="h-8 w-8 p-1.5 rounded-full bg-gray-200 text-gray-600" />

            {/* Logout */}
            <button
              onClick={logout}
              title={t('লগআউট', 'Logout')}
              className="p-2 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {backendOutdated && (
          <div role="alert" data-testid="backend-outdated" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">{t('ব্যাকএন্ড (Google Apps Script) পুরোনো সংস্করণের', 'The backend (Google Apps Script) is out of date')}</p>
            {user?.role === 'admin' ? (
              <p className="mt-1">
                {t('ওয়েবসাইট নতুন, কিন্তু Apps Script-এর কোড পুরোনো, তাই কৃষক/ক্যাটাগরি তালিকা খালি দেখাচ্ছে এবং কিছু সুবিধা কাজ করবে না। করণীয়: ১) নতুন Code.gs পেস্ট করুন ২) setupSheets চালান ৩) Deploy → Manage deployments → Edit → New version। বিস্তারিত: SETUP_GUIDE.md → Upgrading।',
                   'The website is newer than the Apps Script code, so lists such as farmers and categories appear empty and some features will not work. Fix: 1) paste the new Code.gs  2) run setupSheets  3) Deploy → Manage deployments → Edit → New version. Details: SETUP_GUIDE.md → Upgrading.')}
              </p>
            ) : (
              <p className="mt-1">{t('কিছু সুবিধা এখন কাজ করছে না। অনুগ্রহ করে অ্যাডমিনকে জানান।', 'Some features are not working right now. Please let the administrator know.')}</p>
            )}
          </div>
        )}
        {settings.maintenanceMode && user?.role === 'admin' && (
          <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {t('রক্ষণাবেক্ষণ মোড চালু আছে: শুধু অ্যাডমিন সিস্টেম ব্যবহার করতে পারছেন।', 'Maintenance mode is ON: only administrators can use the platform.')}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span>{error}</span>
            <button onClick={clearError} className="font-medium underline flex-shrink-0">{t('বন্ধ করুন', 'Dismiss')}</button>
          </div>
        )}
        {children}
      </main>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <div>
            <p className="font-medium">{t('বাংলাদেশের কৃষকদের জন্য ❤️ দিয়ে তৈরি', 'Built with ❤️ for Bangladesh farmers')}</p>
            <p>{t('ন্যায্য মূল্য নিশ্চিত করা • বাজার সংযোগ', 'Ensuring Fair Prices • Connecting Markets')}</p>
          </div>
          <div className="flex items-center gap-3">
            {(settings.supportPhone || settings.supportEmail) && (
              <span className="text-gray-500">{t('যোগাযোগ:', 'Contact:')} {[settings.supportPhone, settings.supportEmail].filter(Boolean).join(' · ')}</span>
            )}
            <span className="text-gray-400">{settings.platformName || 'KrishiBazar AI'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
