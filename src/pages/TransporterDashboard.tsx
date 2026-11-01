import React, { useState } from 'react';
import {
  Truck, Package, CheckCircle, MapPin, ArrowRight, Navigation, AlertCircle, Clock, Calendar,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { StatCard, Card, Button, Badge, Alert, EmptyState, LoadingSpinner, Modal } from '../components/ui';
import { RealtimePanel, useCropName } from '../components/ui/Panels';
import { ProductImage } from '../components/ui/ProductImage';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { statusBadgeClass, formatDateTime } from '../lib/utils';
import type { Booking, BookingStatus } from '../types';

const STATUS_FLOW: BookingStatus[] = ['pending', 'confirmed', 'in_transit', 'delivered_to_hub'];
const STATUS_LABEL: Record<BookingStatus, [string, string]> = {
  pending:          ['অপেক্ষমাণ', 'Pending'],
  confirmed:        ['নিশ্চিত', 'Confirmed'],
  in_transit:       ['পরিবহনে', 'In Transit'],
  delivered_to_hub: ['হাবে পৌঁছেছে', 'Delivered to Hub'],
};
const STATUS_ICON: Record<BookingStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4" />, confirmed: <CheckCircle className="h-4 w-4" />,
  in_transit: <Truck className="h-4 w-4" />, delivered_to_hub: <Package className="h-4 w-4" />,
};

export default function TransporterDashboard() {
  const { user } = useAuth();
  const { crops, bookings, hubPoints, updateBookingStatus, isLoading } = useData();
  const { lang, t } = useLanguage();
  const cropName = useCropName();
  const [successMsg, setSuccessMsg] = useState('');
  const [routeFor, setRouteFor] = useState<Booking | null>(null);

  const mine = bookings.filter(b => b.transporterId === user?.id);
  const active = mine.filter(b => b.status !== 'delivered_to_hub');
  const completed = mine.filter(b => b.status === 'delivered_to_hub');

  const totalCapacity = mine.reduce((s, b) => s + b.vehicleCapacity, 0);
  const currentLoad = active.reduce((s, b) => s + b.currentLoad, 0);
  const utilization = totalCapacity > 0 ? Math.round((mine.reduce((s, b) => s + b.currentLoad, 0) / totalCapacity) * 100) : 0;

  const next = (s: BookingStatus): BookingStatus | null => {
    const i = STATUS_FLOW.indexOf(s);
    return i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
  };

  const advance = async (b: Booking, to: BookingStatus) => {
    const ok = await updateBookingStatus(b.id, to);
    if (!ok) return;
    const hub = hubPoints.find(h => h.id === b.hubPointId);
    const msg: Partial<Record<BookingStatus, string>> = {
      confirmed: t('বুকিং নিশ্চিত করা হয়েছে!', 'Booking confirmed!'),
      in_transit: t('এখন ট্রানজিটে!', 'Now in transit!'),
      delivered_to_hub: `${t('সফলভাবে ডেলিভার হয়েছে!', 'Successfully delivered!')} ${t('হাব ম্যানেজার এখন ফসল গ্রহণ করবেন।', 'The hub manager will now receive the crops.')}${hub ? ` (${hub.name})` : ''}`,
    };
    setSuccessMsg(msg[to] ?? t('স্ট্যাটাস আপডেট হয়েছে!', 'Status updated!'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  if (isLoading && mine.length === 0) return <LoadingSpinner message={t('লোড হচ্ছে...', 'Loading...')} />;

  const routeCrop = routeFor ? crops.find(c => c.id === routeFor.cropId) : undefined;
  const routeHub = routeFor ? hubPoints.find(h => h.id === routeFor.hubPointId) : undefined;

  return (
    <Layout title={{ bn: 'পরিবহনকারী ড্যাশবোর্ড', en: 'Transporter Dashboard' }}>
      <div className="space-y-6">
        {successMsg && <Alert variant="success">{successMsg}</Alert>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t('মোট বুকিং', 'Total Bookings')} value={mine.length} icon={<Package className="h-10 w-10 text-blue-500" />} accentColor="border-blue-500" />
          <StatCard label={t('সম্পন্ন ডেলিভারি', 'Completed Deliveries')} value={completed.length} sub={t('ডেলিভারি', 'deliveries')} icon={<CheckCircle className="h-10 w-10 text-green-500" />} accentColor="border-green-500" />
          <StatCard label={t('বর্তমান লোড', 'Current Load')} value={currentLoad} sub={t('প্যাকেট', 'packets')} icon={<Truck className="h-10 w-10 text-purple-500" />} accentColor="border-purple-500" />
          <StatCard label={t('ব্যবহার হার', 'Utilization Rate')} value={`${utilization}%`} icon={<AlertCircle className="h-10 w-10 text-orange-500" />} accentColor="border-orange-500" />
        </div>

        <RealtimePanel
          title={t('রিয়েল-টাইম আপডেট', 'Real-time Updates')}
          icon={<Navigation className="h-5 w-5" />}
          gradient="from-blue-600 to-indigo-600"
          columns={[
            { title: t('আজকের কার্যক্রম', "Today's Activities"), lines: [
              `${mine.filter(b => b.status === 'pending').length} ${t('টি নতুন বুকিং', 'new bookings')}`,
              `${mine.filter(b => b.status === 'in_transit').length} ${t('টি ট্রানজিটে', 'in transit')}`,
              `${completed.length} ${t('টি ডেলিভার সম্পন্ন', 'deliveries completed')}`] },
            { title: t('AI রুট অপটিমাইজেশন', 'AI Route Optimization'), sample: true, lines: [
              'Jessore → Faridpur → Dhaka', `${t('আনুমানিক সময়:', 'Est. Time:')} 4.5 ${t('ঘন্টা', 'hours')}`, `${t('জ্বালানি সাশ্রয়:', 'Fuel Savings:')} 15%`] },
            { title: t('ট্রাফিক আপডেট', 'Traffic Updates'), sample: true, lines: [
              `🟢 Jessore-Magura: ${t('পরিষ্কার', 'Clear')}`, `🟡 Faridpur-Dhaka: ${t('মাঝারি', 'Moderate')}`] },
          ]}
        />

        <section>
          <h3 className="mb-4 text-xl font-bold text-gray-900">{t('বুকিং তালিকা', 'Booking List')}</h3>
          {mine.length === 0 ? (
            <EmptyState icon={<Truck className="h-12 w-12" />} title={t('কোন বুকিং নেই', 'No bookings available')} description={t('কৃষকরা বুক করলে এখানে দেখাবে', 'Bookings appear here when farmers book you')} />
          ) : (
            <div className="space-y-4">
              {[...active, ...completed].map(b => {
                const crop = crops.find(c => c.id === b.cropId);
                const hub = hubPoints.find(h => h.id === b.hubPointId);
                const nx = next(b.status);
                return (
                  <Card key={b.id} className={b.status === 'delivered_to_hub' ? 'bg-gray-50' : ''}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <ProductImage images={crop?.images} alt={crop?.type ?? ''} className="h-24 w-full flex-shrink-0 rounded-lg lg:w-32" />
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-bold text-gray-900">{crop ? cropName(crop.type) : '—'}</h4>
                          <Badge className={statusBadgeClass(b.status)}>{STATUS_ICON[b.status]}{lang === 'bn' ? STATUS_LABEL[b.status][0] : STATUS_LABEL[b.status][1]}</Badge>
                        </div>
                        <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-gray-600 sm:grid-cols-2">
                          <p><span className="text-gray-400">{t('কৃষক', 'Farmer')}:</span> {crop?.farmerName ?? '—'}</p>
                          <p><span className="text-gray-400">{t('প্যাকেট', 'Packets')}:</span> {b.currentLoad} · {crop?.totalWeight ?? 0} kg</p>
                          <p><span className="text-gray-400">{t('থেকে', 'From')}:</span> {crop?.location ?? '—'}</p>
                          <p><span className="text-gray-400">{t('গন্তব্য', 'To')}:</span> {hub ? `${hub.name}, ${hub.location}` : '—'}</p>
                          <p><span className="text-gray-400">{t('রুট', 'Route')}:</span> {b.route}</p>
                          <p><span className="text-gray-400">{t('পিকআপ', 'Pickup')}:</span> {formatDateTime(b.pickupTime)}</p>
                          <p><span className="text-gray-400">{t('আনুমানিক পৌঁছানো', 'Expected arrival')}:</span> {formatDateTime(b.scheduledDeliveryTime)}</p>
                          {b.deliveryTime && <p><span className="text-gray-400">{t('ডেলিভারি সময়', 'Delivery time')}:</span> {formatDateTime(b.deliveryTime)}</p>}
                        </div>
                        <div className="flex items-center gap-1 pt-1">
                          {STATUS_FLOW.map((step, i) => (
                            <React.Fragment key={step}>
                              <div className={`h-2 flex-1 rounded-full ${STATUS_FLOW.indexOf(b.status) >= i ? 'bg-green-500' : 'bg-gray-200'}`} />
                              {i < STATUS_FLOW.length - 1 && <ArrowRight className="h-3 w-3 flex-shrink-0 text-gray-300" />}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2 lg:flex-col">
                        <Button size="sm" variant="secondary" icon={<MapPin className="h-3 w-3" />} onClick={() => setRouteFor(b)}>{t('রুট ম্যাপ', 'Route Map')}</Button>
                        {nx && <Button size="sm" icon={<Truck className="h-3 w-3" />} onClick={() => advance(b, nx)}>{lang === 'bn' ? STATUS_LABEL[nx][0] : STATUS_LABEL[nx][1]}</Button>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <Modal open={!!routeFor} onClose={() => setRouteFor(null)} title={t('রুট ম্যাপ', 'Route Map')}>
          {routeFor && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="mb-2 flex items-center gap-2"><MapPin className="h-4 w-4 text-green-600" /><span className="text-gray-500">{t('থেকে:', 'From:')}</span> <b>{routeCrop?.location ?? '—'}</b></p>
                <p className="mb-2 flex items-center gap-2"><MapPin className="h-4 w-4 text-red-600" /><span className="text-gray-500">{t('গন্তব্য:', 'To:')}</span> <b>{routeHub ? `${routeHub.name}, ${routeHub.location}` : '—'}</b></p>
                <p className="flex items-center gap-2"><Calendar className="h-4 w-4 text-blue-600" /><span className="text-gray-500">{t('রুট:', 'Route:')}</span> <b>{routeFor.route}</b></p>
              </div>
              <p className="text-xs text-gray-500">{t('Google Maps ইন্টিগ্রেশন এখানে বিস্তারিত রুট দেখাবে (এখনো সংযুক্ত নয়)।', 'A Google Maps integration would show the detailed route here (not connected yet).')}</p>
              <Button variant="secondary" className="w-full" onClick={() => setRouteFor(null)}>{t('বন্ধ করুন', 'Close')}</Button>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
