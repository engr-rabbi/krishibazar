import React, { useState } from 'react';
import {
  LayoutDashboard, Package, Sprout, Store, Users, Building, Tags, ShoppingCart, Settings as SettingsIcon,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { useLanguage } from '../contexts/LanguageContext';
import Overview from './admin/Overview';
import ProductsPanel from './admin/ProductsPanel';
import UsersPanel from './admin/UsersPanel';
import HubsPanel from './admin/HubsPanel';
import CategoriesPanel from './admin/CategoriesPanel';
import OrdersPanel from './admin/OrdersPanel';
import SettingsPanel from './admin/SettingsPanel';

type TabId = 'overview' | 'products' | 'farmers' | 'retailers' | 'orders' | 'hubs' | 'categories' | 'users' | 'settings';

/** Central administration console: one place to create, view, edit and delete every kind of platform data. */
export default function AdminDashboard() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<TabId>('overview');

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',   label: t('ওভারভিউ', 'Overview'),         icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'products',   label: t('পণ্য', 'Products'),            icon: <Package className="h-4 w-4" /> },
    { id: 'farmers',    label: t('কৃষক', 'Farmers'),             icon: <Sprout className="h-4 w-4" /> },
    { id: 'retailers',  label: t('রিটেইলার', 'Retailers'),       icon: <Store className="h-4 w-4" /> },
    { id: 'orders',     label: t('অর্ডার', 'Orders'),            icon: <ShoppingCart className="h-4 w-4" /> },
    { id: 'hubs',       label: t('হাব পয়েন্ট', 'Hub points'),   icon: <Building className="h-4 w-4" /> },
    { id: 'categories', label: t('ক্যাটাগরি', 'Categories'),     icon: <Tags className="h-4 w-4" /> },
    { id: 'users',      label: t('ব্যবহারকারী', 'Users'),        icon: <Users className="h-4 w-4" /> },
    { id: 'settings',   label: t('সেটিংস', 'Settings'),          icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  return (
    <Layout title={{ bn: 'অ্যাডমিন কন্ট্রোল প্যানেল', en: 'Admin Control Panel' }}>
      <div className="space-y-6">
        <nav aria-label="Admin sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-gray-200 px-1">
          {tabs.map(x => (
            <button
              key={x.id} type="button" role="tab" aria-selected={tab === x.id} data-testid={`tab-${x.id}`} onClick={() => setTab(x.id)}
              className={`flex flex-shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${tab === x.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {x.icon}{x.label}
            </button>
          ))}
        </nav>

        {tab === 'overview'   && <Overview />}
        {tab === 'products'   && <ProductsPanel />}
        {tab === 'farmers'    && <UsersPanel role="farmer" />}
        {tab === 'retailers'  && <UsersPanel role="retailer" />}
        {tab === 'orders'     && <OrdersPanel />}
        {tab === 'hubs'       && <HubsPanel />}
        {tab === 'categories' && <CategoriesPanel />}
        {tab === 'users'      && <UsersPanel role="all" />}
        {tab === 'settings'   && <SettingsPanel />}
      </div>
    </Layout>
  );
}
