import React, { useState } from 'react';
import {
  Building, Package, ShoppingCart, TrendingUp, CheckCircle, AlertTriangle, Users, DollarSign, Calendar, Truck,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { StatCard, Card, Button, Badge, Alert, EmptyState, LoadingSpinner, ProgressBar } from '../components/ui';
import { RealtimePanel, useCropName } from '../components/ui/Panels';
import { ProductImage } from '../components/ui/ProductImage';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { statusBadgeClass, statusLabel, formatDate } from '../lib/utils';

export default function HubDashboard() {
  const { user } = useAuth();
  const { crops, hubPoints, retailerOrders, receiveCropAtHub, isLoading } = useData();
  const { lang, t } = useLanguage();
  const cropName = useCropName();
  const [successMsg, setSuccessMsg] = useState('');

  // A manager may run several hubs
  const myHubs = hubPoints.filter(h => h.managerId === user?.id);
  const mine = (hubId?: string) => myHubs.some(h => h.id === hubId);

  const cropsToReceive = crops.filter(c => mine(c.hubPointId) && c.status === 'delivered_to_hub');
  const incomingCrops  = crops.filter(c => mine(c.hubPointId) && ['booked', 'in_transit'].includes(c.status));
  const availableCrops = crops.filter(c => mine(c.hubPointId) && c.status === 'available_at_hub');
  const stockCrops     = crops.filter(c => mine(c.hubPointId) && ['available_at_hub', 'ordered'].includes(c.status));
  const hubOrders      = retailerOrders.filter(o => mine(o.hubPointId));
  const pendingOrders  = hubOrders.filter(o => ['pre_booked', 'pre_paid'].includes(o.status));

  const totalStock    = myHubs.reduce((s, h) => s + h.currentStock, 0);
  const expected      = myHubs.reduce((s, h) => s + h.expectedStock, 0);
  const revenue       = myHubs.reduce((s, h) => s + h.totalRevenue, 0);

  const handleReceive = async (cropId: string, hubId: string) => {
    const ok = await receiveCropAtHub(cropId, hubId);
    if (!ok) return;
    setSuccessMsg(t('ফসল গ্রহণ করা হয়েছে! এখন খুচরা বিক্রেতারা অর্ডার করতে পারবেন।', 'Crop received! Retailers can now place orders for it.'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  if (isLoading && myHubs.length === 0) return <LoadingSpinner message={t('লোড হচ্ছে...', 'Loading...')} />;
  if (myHubs.length === 0) return (
    <Layout title={{ bn: 'হাব পয়েন্ট ড্যাশবোর্ড', en: 'Hub Point Dashboard' }}>
      <Alert variant="warning">{t('আপনার কোনো হাব নিয়োগ নেই।', 'No hub is assigned to your account.')}</Alert>
    </Layout>
  );

  return (
    <Layout title={{ bn: 'হাব পয়েন্ট ড্যাশবোর্ড', en: 'Hub Point Dashboard' }}>
      <div className="space-y-6">
        {successMsg && <Alert variant="success">{successMsg}</Alert>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label={t('বর্তমান স্টক', 'Current Stock')} value={totalStock} sub={t('প্যাকেট', 'packets')} icon={<Package className="h-9 w-9 text-purple-500" />} accentColor="border-purple-500" />
          <StatCard label={t('প্রত্যাশিত স্টক', 'Expected Stock')} value={expected} sub={t('আগত', 'incoming')} icon={<TrendingUp className="h-9 w-9 text-blue-500" />} accentColor="border-blue-500" />
          <StatCard label={t('গ্রহণ অপেক্ষমাণ', 'Awaiting Receipt')} value={cropsToReceive.length} sub={t('জরুরি', 'urgent')} icon={<AlertTriangle className="h-9 w-9 text-red-500" />} accentColor="border-red-500" />
          <StatCard label={t('অপেক্ষমাণ অর্ডার', 'Pending Orders')} value={pendingOrders.length} icon={<Users className="h-9 w-9 text-orange-500" />} accentColor="border-orange-500" />
          <StatCard label={t('মোট রাজস্ব', 'Total Revenue')} value={`৳${revenue.toLocaleString()}`} sub={t('হাব অংশ: ১০%', 'Hub share: 10%')} icon={<DollarSign className="h-9 w-9 text-green-500" />} accentColor="border-green-500" />
        </div>

        <RealtimePanel
          title={t('রিয়েল-টাইম আপডেট', 'Real-time Updates')}
          icon={<Calendar className="h-5 w-5" />}
          gradient="from-purple-600 to-indigo-600"
          columns={[
            { title: t('আজকের কার্যক্রম', "Today's Activities"), lines: [
              `${cropsToReceive.length} ${t('টি ফসল গ্রহণের জন্য অপেক্ষমাণ', 'crops awaiting receipt')}`,
              `${availableCrops.length} ${t('টি ফসল খুচরা বিক্রেতাদের জন্য প্রস্তুত', 'crops ready for retailers')}`] },
            { title: t('পরিবহনকারী আপডেট', 'Transporter Updates'), lines: [
              `${incomingCrops.filter(c => c.status === 'in_transit').length} ${t('টি ট্রানজিটে', 'in transit')}`,
              `${incomingCrops.filter(c => c.status === 'booked').length} ${t('টি বুক করা', 'booked')}`] },
            { title: t('খুচরা বিক্রেতা', 'Retailers'), lines: [
              `${pendingOrders.length} ${t('টি অর্ডার অপেক্ষমাণ', 'orders pending')}`,
              `${hubOrders.filter(o => o.status === 'collected').length} ${t('টি সংগ্রহ সম্পন্ন', 'collected')}`] },
          ]}
        />

        {/* Hub overview */}
        {myHubs.map(hub => {
          const util = hub.capacity ? Math.round((hub.currentStock / hub.capacity) * 100) : 0;
          return (
            <Card key={hub.id}>
              <div className="flex items-center gap-4">
                <Building className="h-10 w-10 text-purple-500" />
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900">{hub.name}</h3>
                  <p className="text-sm text-gray-500">{hub.location} · {t('ম্যানেজার', 'Manager')}: {hub.managerName}</p>
                </div>
                <div className="text-right"><p className="text-2xl font-bold text-purple-600">{util}%</p><p className="text-xs text-gray-500">{t('ক্যাপাসিটি ব্যবহার', 'Capacity used')}</p></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div className="rounded bg-gray-50 p-3"><p className="text-gray-500">{t('স্টক', 'Stock')}</p><p className="font-bold">{hub.currentStock}/{hub.capacity}</p></div>
                <div className="rounded bg-gray-50 p-3"><p className="text-gray-500">{t('আগত', 'Incoming')}</p><p className="font-bold">{hub.expectedStock}</p></div>
                <div className="rounded bg-gray-50 p-3"><p className="text-gray-500">{t('অপেক্ষমাণ অর্ডার', 'Pending orders')}</p><p className="font-bold">{hub.pendingOrders}</p></div>
                <div className="rounded bg-gray-50 p-3"><p className="text-gray-500">{t('রাজস্ব', 'Revenue')}</p><p className="font-bold">৳{hub.totalRevenue.toLocaleString()}</p></div>
              </div>
              <div className="mt-3"><ProgressBar value={hub.currentStock} max={hub.capacity} label={t('ব্যবহার', 'Utilization')} /></div>
            </Card>
          );
        })}

        {/* Crops ready to receive */}
        {cropsToReceive.length > 0 && (
          <section>
            <h3 className="mb-3 text-xl font-bold text-gray-900">🚨 {t('গ্রহণের জন্য অপেক্ষমাণ ফসল', 'Crops Ready to Receive')}</h3>
            <div className="space-y-3">
              {cropsToReceive.map(crop => (
                <Card key={crop.id} accentColor="border-red-500">
                  <div className="flex items-center justify-between gap-4">
                    <ProductImage images={crop.images} alt={crop.type} className="h-16 w-16 flex-shrink-0 rounded-lg" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{cropName(crop.type)}</h4>
                      <p className="text-sm text-gray-600">{crop.farmerName} · {crop.packets} {t('প্যাকেট', 'packets')} · {crop.totalWeight} kg · {t('গুণমান', 'Quality')} {crop.qualityScore}%</p>
                      <p className="text-xs text-gray-500">{t('ট্রান্সপোর্টার', 'Transporter')}: {crop.transporterName ?? '—'} · {t('ডেলিভার', 'Delivered')}: {formatDate(crop.deliveredToHubTime)}</p>
                    </div>
                    <Button size="sm" icon={<CheckCircle className="h-4 w-4" />} onClick={() => handleReceive(crop.id, crop.hubPointId!)}>{t('গ্রহণ করুন', 'Receive')}</Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Incoming crops */}
        <section>
          <h3 className="mb-3 text-xl font-bold text-gray-900">{t('আগত ফসল', 'Incoming Crops')}</h3>
          {incomingCrops.length === 0 ? (
            <EmptyState icon={<Truck className="h-10 w-10" />} title={t('কোনো আগত ফসল নেই', 'No incoming crops')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {incomingCrops.map(crop => (
                <Card key={crop.id}>
                  <ProductImage images={crop.images} alt={crop.type} className="-mx-6 -mt-6 mb-3 h-28 w-[calc(100%+3rem)] rounded-t-xl" />
                  <div className="mb-1 flex items-center justify-between">
                    <h4 className="font-semibold text-gray-900">{cropName(crop.type)}</h4>
                    <Badge className={statusBadgeClass(crop.status)}>{statusLabel(crop.status, lang)}</Badge>
                  </div>
                  <p className="text-sm text-gray-600">{crop.farmerName} · {crop.packets} {t('প্যাকেট', 'packets')} · {crop.totalWeight} kg</p>
                  <p className="text-xs text-gray-500">{t('ট্রান্সপোর্টার', 'Transporter')}: {crop.transporterName ?? '—'} · {t('অবস্থান', 'Location')}: {crop.currentLocation}</p>
                  {crop.scheduledPickupTime && <p className="text-xs text-gray-500">{t('পিকআপ', 'Pickup')}: {formatDate(crop.scheduledPickupTime)}</p>}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Available for retailers */}
        <section>
          <h3 className="mb-3 text-xl font-bold text-gray-900">{t('খুচরা বিক্রেতার জন্য উপলব্ধ', 'Available for Retailers')}</h3>
          {availableCrops.length === 0 ? (
            <EmptyState icon={<Package className="h-10 w-10" />} title={t('স্টক খালি', 'No stock available')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {availableCrops.map(crop => (
                <Card key={crop.id} accentColor="border-green-500">
                  <ProductImage images={crop.images} alt={crop.type} className="mb-3 h-28 w-full rounded-lg" />
                  <h4 className="mb-1 font-semibold text-gray-900">{cropName(crop.type)}</h4>
                  <div className="space-y-1 text-sm text-gray-600">
                    <div className="flex justify-between"><span>{t('উপলব্ধ প্যাকেট', 'Available packets')}</span><span className="font-medium">{crop.packetsRemaining}/{crop.packets}</span></div>
                    <div className="flex justify-between"><span>{t('কৃষক', 'Farmer')}</span><span className="font-medium">{crop.farmerName}</span></div>
                    <div className="flex justify-between"><span>{t('গুণমান', 'Quality')}</span><span className="font-medium">{crop.qualityScore}%</span></div>
                    <div className="flex justify-between"><span>{t('দাম', 'Price')}</span><span className="font-medium text-green-600">৳{crop.predictedPrice}/kg</span></div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Stock table */}
        {stockCrops.length > 0 && (
          <section>
            <h3 className="mb-3 text-xl font-bold text-gray-900">{t('বর্তমান স্টক', 'Current Stock')}</h3>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr>
                  {[t('ফসল', 'Crop'), t('কৃষক', 'Farmer'), t('প্যাকেট', 'Packets'), t('ওজন', 'Weight'), t('অবস্থা', 'Status')].map(h => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {stockCrops.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold">{cropName(c.type)}</td>
                      <td className="px-4 py-3 text-gray-600">{c.farmerName}</td>
                      <td className="px-4 py-3">{Math.max(0, c.packets - c.packetsDelivered)}</td>
                      <td className="px-4 py-3">{c.totalWeight} kg</td>
                      <td className="px-4 py-3"><Badge className={statusBadgeClass(c.status)}>{statusLabel(c.status, lang)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Pending orders */}
        <section>
          <h3 className="mb-3 text-xl font-bold text-gray-900">{t('অপেক্ষমাণ অর্ডার', 'Pending Orders')}</h3>
          {hubOrders.length === 0 ? (
            <EmptyState icon={<ShoppingCart className="h-10 w-10" />} title={t('কোনো অর্ডার নেই', 'No orders yet')} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr>
                  {[t('খুচরা বিক্রেতা', 'Retailer'), t('ফসল', 'Crop'), t('প্যাকেট', 'Pkt'), t('পরিমাণ', 'Amount'), t('অবস্থা', 'Status'), t('তারিখ', 'Date')].map(h => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {hubOrders.map(o => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{o.retailerName}</td>
                      <td className="px-4 py-3">{cropName(o.cropType)}</td>
                      <td className="px-4 py-3">{o.packets}</td>
                      <td className="px-4 py-3 font-semibold text-green-600">৳{o.amount.toLocaleString()}</td>
                      <td className="px-4 py-3"><Badge className={o.status === 'collected' ? 'bg-emerald-100 text-emerald-800' : o.status === 'pre_paid' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}>{o.status}</Badge></td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
