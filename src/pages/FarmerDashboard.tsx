import React, { useState } from 'react';
import { Plus, Package, CheckCircle, DollarSign, Star, MapPin, Users, TrendingUp, Eye } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Button, StatCard, Card, Modal, FormField, Input, Select, Badge, EmptyState, ProgressBar, Alert, LoadingSpinner } from '../components/ui';
import { ProductImage } from '../components/ui/ProductImage';
import { PhotoUploader } from '../components/ui/PhotoUploader';
import { RealtimePanel, SampleBadge, useCropName } from '../components/ui/Panels';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { statusBadgeClass, statusLabel, formatDate, formatDateTime } from '../lib/utils';
import type { Crop, Transporter, HubPoint } from '../types';

// ─── Add Crop Form ─────────────────────────────────────────────────────────────

interface CropFormState {
  fallbackType: string;
  categoryId: string;
  subcategoryId: string;
  packets: string;
  weightPerPacket: string;
  images: string[];
}

const INITIAL_FORM: CropFormState = { fallbackType: '', categoryId: '', subcategoryId: '', packets: '', weightPerPacket: '', images: [] };


/** Used only if the category list could not be loaded (e.g. an old backend), so a farmer can still list a crop */
const FALLBACK_CROPS: [string, string, string][] = [
  ['Potato', 'আলু', 'Potato'], ['Tomato', 'টমেটো', 'Tomato'], ['Rice', 'চাল', 'Rice'], ['Onion', 'পেঁয়াজ', 'Onion'],
  ['Carrot', 'গাজর', 'Carrot'], ['Eggplant', 'বেগুন', 'Eggplant'], ['Cucumber', 'শসা', 'Cucumber'],
];

// ─── Tracking Modal ────────────────────────────────────────────────────────────

function TrackingModal({ crop, onClose }: { crop: Crop; onClose: () => void }) {
  const { t } = useLanguage();
  const PIPELINE: Crop['status'][] = ['pending','booked','in_transit','delivered_to_hub','available_at_hub','ordered','collected'];

  return (
    <Modal open onClose={onClose} title={t(`${crop.type} — ট্র্যাকিং`, `${crop.type} — Tracking`)} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">{t('অবস্থান', 'Location')}:</span> <span className="font-medium">{crop.currentLocation}</span></div>
          <div><span className="text-gray-500">{t('ডেলিভার', 'Delivered')}:</span> <span className="font-medium text-blue-600">{crop.packetsDelivered}/{crop.packets}</span></div>
          {crop.transporterName && <div><span className="text-gray-500">{t('পরিবহনকারী', 'Transporter')}:</span> <span className="font-medium">{crop.transporterName}</span></div>}
          {crop.scheduledPickupTime && <div><span className="text-gray-500">{t('সংগ্রহ', 'Pickup')}:</span> <span className="font-medium">{formatDate(crop.scheduledPickupTime)}</span></div>}
        </div>

        {/* Pipeline stepper */}
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">{t('অগ্রগতি', 'Progress')}</p>
          <div className="space-y-2">
            {PIPELINE.map((step, i) => {
              const currentIdx = PIPELINE.indexOf(crop.status);
              const done = i <= currentIdx;
              const active = i === currentIdx;
              return (
                <div key={step} className={`flex items-center gap-3 p-2 rounded-lg ${active ? 'bg-green-50' : ''}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={`text-sm ${active ? 'font-semibold text-green-700' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                    {statusLabel(step, 'en')}
                  </span>
                  {active && <span className="ml-auto text-xs text-green-600 font-medium">{t('বর্তমান', 'Current')}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Status history */}
        {crop.statusHistory.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">{t('ইতিহাস', 'History')}</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {[...crop.statusHistory].reverse().map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-gray-400 flex-shrink-0">{formatDate(h.timestamp)}</span>
                  <span className="font-medium text-gray-700">{h.status.toUpperCase()}</span>
                  <span className="text-gray-500 truncate">{h.location}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Button variant="secondary" className="w-full" onClick={onClose}>{t('বন্ধ করুন', 'Close')}</Button>
      </div>
    </Modal>
  );
}

// ─── Transporter Selection Modal ───────────────────────────────────────────────

function TransporterModal({
  crop, transporters, hubs, onSelect, onClose,
}: { crop: Crop; transporters: Transporter[]; hubs: HubPoint[]; onSelect: (tid: string, hubId: string) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const [hubId, setHubId] = useState(hubs[0]?.id ?? '');
  return (
    <Modal open onClose={onClose} title={t('পরিবহনকারী নির্বাচন করুন', 'Select Transporter')} maxWidth="max-w-2xl">
      <div className="mb-4">
        <FormField label={t('গন্তব্য হাব পয়েন্ট', 'Destination hub point')} required>
          <Select value={hubId} onChange={e => setHubId(e.target.value)}>
            {hubs.map(h => <option key={h.id} value={h.id}>{h.name} — {h.location}</option>)}
          </Select>
        </FormField>
        {hubs.length === 0 && <Alert variant="warning">{t('এখন কোনো সক্রিয় হাব নেই।', 'There is no active hub point right now.')}</Alert>}
      </div>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {transporters.length === 0 && (
          <Alert variant="warning">{t('কোনো পরিবহনকারী উপলব্ধ নেই।', 'No transporters available.')}</Alert>
        )}
        {transporters.map(t_ => {
          const enough = t_.availableCapacity >= crop.packets;
          return (
            <div key={t_.id} className={`border rounded-xl p-4 ${enough ? 'border-gray-200 hover:border-green-300 hover:bg-green-50' : 'border-gray-100 bg-gray-50 opacity-60'} transition-colors`}>
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{t_.name}</p>
                  <p className="text-xs text-gray-500">{t_.location}</p>
                  <ProgressBar value={t_.currentLoad} max={t_.vehicleCapacity} label={`${t_.availableCapacity} ${t('উপলব্ধ', 'available')}`} />
                </div>
                <Button
                  onClick={() => onSelect(t_.id, hubId)}
                  disabled={!enough || !hubId}
                  size="sm"
                  title={!enough ? t('পর্যাপ্ত ক্ষমতা নেই', 'Insufficient capacity') : ''}
                >
                  {t('নির্বাচন', 'Select')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <Button variant="secondary" className="w-full" onClick={onClose}>{t('বাতিল', 'Cancel')}</Button>
      </div>
    </Modal>
  );
}

// ─── Details Modal ─────────────────────────────────────────────────────────────

function DetailsModal({ crop, onClose }: { crop: Crop; onClose: () => void }) {
  const { lang, t } = useLanguage();
  const cropName = useCropName();
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-4 py-1 text-sm"><span className="text-gray-500">{k}</span><span className="text-right font-medium text-gray-900">{v}</span></div>
  );
  return (
    <Modal open onClose={onClose} title={`${cropName(crop.type)} — ${t('বিস্তারিত', 'Details')}`} maxWidth="max-w-xl">
      <div className="space-y-5">
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('ফসলের বিবরণ', 'Crop Details')}</h4>
          <Row k={t('ধরন', 'Type')} v={cropName(crop.type)} />
          <Row k={t('প্যাকেট', 'Packets')} v={crop.packets} />
          <Row k={t('মোট ওজন', 'Total Weight')} v={`${crop.totalWeight} kg`} />
          <Row k={t('আনুমানিক দাম', 'Predicted Price')} v={`৳${crop.predictedPrice}/kg`} />
          <Row k={t('গুণমান স্কোর', 'Quality Score')} v={`${crop.qualityScore}%`} />
          <Row k={t('মোট আনুমানিক আয়', 'Total Est. Income')} v={`৳${(crop.predictedPrice * crop.totalWeight).toLocaleString()}`} />
          <Row k={t('অবস্থা', 'Status')} v={<Badge className={statusBadgeClass(crop.status)}>{statusLabel(crop.status, lang)}</Badge>} />
          <Row k={t('ডেলিভার / অবশিষ্ট', 'Delivered / Remaining')} v={`${crop.packetsDelivered} / ${crop.packetsRemaining}`} />
        </section>
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('পরিবহন তথ্য', 'Transport Info')}</h4>
          <Row k={t('পরিবহনকারী', 'Transporter')} v={crop.transporterName ?? '—'} />
          <Row k={t('পিকআপের সময়', 'Pickup Time')} v={formatDateTime(crop.scheduledPickupTime)} />
          <Row k={t('হাবে পৌঁছেছে', 'Delivered to Hub')} v={formatDateTime(crop.deliveredToHubTime)} />
        </section>
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('খুচরা বিক্রেতার সংগ্রহ', 'Retailer Collection')}</h4>
          <Row k={t('সংগ্রহের সময়', 'Collected')} v={formatDateTime(crop.collectedByRetailerTime)} />
          <Row k={t('বর্তমান অবস্থান', 'Current Location')} v={crop.currentLocation} />
        </section>
        {crop.statusHistory.length > 0 && (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('স্ট্যাটাস ইতিহাস', 'Status History')}</h4>
            <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {[...crop.statusHistory].reverse().map((h, i) => (
                <div key={i} className="flex gap-2"><span className="text-gray-400">{formatDateTime(h.timestamp)}</span><span className="font-medium">{h.status}</span><span className="text-gray-500">{t('আপডেট:', 'by')} {h.updatedBy}</span></div>
              ))}
            </div>
          </section>
        )}
        <Button variant="secondary" className="w-full" onClick={onClose}>{t('বন্ধ করুন', 'Close')}</Button>
      </div>
    </Modal>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function FarmerDashboard() {
  const { user }                                    = useAuth();
  const { crops, addCrop, addBooking, getAvailableTransporters, getFarmerRevenue, isLoading, categories, hubPoints } = useData();
  const { lang, t }                                 = useLanguage();

  const [showAddCrop,   setShowAddCrop]   = useState(false);
  const [trackingCrop,  setTrackingCrop]  = useState<Crop | null>(null);
  const [bookingCrop,   setBookingCrop]   = useState<Crop | null>(null);
  const [detailsCrop,   setDetailsCrop]   = useState<Crop | null>(null);
  const cropName = useCropName();
  const [form,          setForm]          = useState<CropFormState>(INITIAL_FORM);
  const [formErrors,    setFormErrors]    = useState<Partial<CropFormState>>({});
  const [submitting,    setSubmitting]    = useState(false);
  const [successMsg,    setSuccessMsg]    = useState('');

  const farmerCrops         = crops.filter(c => c.farmerId === user?.id);
  const availableTransporters = getAvailableTransporters();

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalDelivered  = farmerCrops.reduce((s, c) => s + c.packetsDelivered, 0);
  const totalRemaining  = farmerCrops.reduce((s, c) => s + c.packetsRemaining, 0);
  const estimatedIncome = farmerCrops.reduce((s, c) => s + c.predictedPrice * c.totalWeight, 0);
  const inTransitCount  = farmerCrops.filter(c => c.status === 'in_transit').length;
  const atHubCount      = farmerCrops.filter(c => c.status === 'available_at_hub').length;
  const completedCount  = farmerCrops.filter(c => c.status === 'collected').length;
  const completion      = totalDelivered + totalRemaining > 0 ? Math.round((totalDelivered / (totalDelivered + totalRemaining)) * 100) : 0;
  const myRevenue       = user ? getFarmerRevenue(user.id) : undefined;
  const avgQuality      = farmerCrops.length ? Math.round(farmerCrops.reduce((s, c) => s + c.qualityScore, 0) / farmerCrops.length) : 0;

  const topCategories = categories.filter(c => c.parentId === '' && c.active);
  const noCategoriesLoaded = categories.length === 0;                       // old backend / empty list → built-in crop list
  const noActiveCategories = categories.length > 0 && topCategories.length === 0; // admin switched all of them off
  const subCategories = categories.filter(c => c.parentId === form.categoryId && c.active);
  const activeHubs = hubPoints.filter(h => h.active !== false);

  // ── Form helpers ─────────────────────────────────────────────────────────

  const validateForm = (): boolean => {
    const errs: Partial<CropFormState> = {};
    if (noCategoriesLoaded) { if (!form.fallbackType) errs.fallbackType = t('ফসল নির্বাচন করুন।', 'Please choose a crop.'); }
    else if (!form.categoryId)                  errs.categoryId     = t('ক্যাটাগরি নির্বাচন করুন।', 'Please choose a category.');
    else if (subCategories.length > 0 && !form.subcategoryId) errs.subcategoryId = t('সাবক্যাটাগরি নির্বাচন করুন।', 'Please choose a subcategory.');
    if (!form.packets || parseInt(form.packets) <= 0) errs.packets  = t('বৈধ প্যাকেট সংখ্যা দিন।', 'Enter valid packet count.');
    if (!form.weightPerPacket || parseInt(form.weightPerPacket) <= 0) errs.weightPerPacket = t('বৈধ ওজন দিন।', 'Enter valid weight.');
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddCrop = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    const packets       = parseInt(form.packets);
    const weightPerPkt  = parseInt(form.weightPerPacket);
    const predictedPrice = Math.floor(Math.random() * 50) + 20;
    const qualityScore   = Math.floor(Math.random() * 20) + 80;
    const leaf = noCategoriesLoaded ? undefined : categories.find(c => c.id === (form.subcategoryId || form.categoryId));
    const ok = await addCrop({
      farmerId: user!.id, farmerName: user!.name,
      type: noCategoriesLoaded ? form.fallbackType : (leaf?.name ?? ''), categoryId: form.categoryId, subcategoryId: form.subcategoryId,
      packets, weightPerPacket: weightPerPkt,
      totalWeight: packets * weightPerPkt,
      images: form.images,
      status: 'pending', predictedPrice, location: user!.location ?? 'Bangladesh', qualityScore,
    });
    setSubmitting(false);
    if (!ok) return;
    setForm(INITIAL_FORM); setFormErrors({});
    setShowAddCrop(false);
    setSuccessMsg(t('ফসল সফলভাবে যোগ করা হয়েছে!', 'Crop added successfully!'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleBookTransport = async (cropId: string, transporterId: string, hubPointId: string) => {
    const crop = farmerCrops.find(c => c.id === cropId);
    const transporter = availableTransporters.find(t => t.id === transporterId);
    if (!crop || !transporter) return;
    const pickupTime = new Date(Date.now() + 24 * 3600000).toISOString();
    const ok = await addBooking({
      cropId, farmerId: user!.id, transporterId,
      vehicleCapacity: transporter.vehicleCapacity, currentLoad: crop.packets,
      route: `${user!.location} → Dhaka`, pickupTime, status: 'pending', hubPointId,
    });
    setBookingCrop(null);
    if (!ok) return;
    setSuccessMsg(t(`পরিবহন বুক হয়েছে: ${transporter.name}। তিনি নিজের ড্যাশবোর্ডে বুকিংটি দেখতে পাবেন।`, `Transport booked with ${transporter.name}. They will see the booking on their dashboard.`));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  if (isLoading && farmerCrops.length === 0) return <LoadingSpinner message={t('ডেটা লোড হচ্ছে...', 'Loading data...')} />;

  return (
    <Layout title={{ bn: 'কৃষক ড্যাশবোর্ড', en: 'Farmer Dashboard' }}>
      <div className="space-y-6">

        {successMsg && <Alert variant="success">{successMsg}</Alert>}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t('মোট ফসল', 'Total Crops')}       value={farmerCrops.length}   sub={`${farmerCrops.filter(c=>c.status==='collected').length} ${t('সম্পন্ন','completed')}`} icon={<Package className="h-10 w-10 text-green-500"/>} accentColor="border-green-500"/>
          <StatCard label={t('ডেলিভার','Delivered')}           value={totalDelivered}        sub={`${totalRemaining} ${t('অবশিষ্ট','remaining')}`}   icon={<CheckCircle className="h-10 w-10 text-blue-500"/>}   accentColor="border-blue-500"/>
          <StatCard label={t('আনুমানিক আয়','Est. Income')}    value={`৳${estimatedIncome}`} sub={t('৭০% কৃষকের অংশ','70% farmer share')}             icon={<DollarSign className="h-10 w-10 text-orange-500"/>} accentColor="border-orange-500"/>
          <StatCard label={t('গুণমান স্কোর','Quality Score')}  value={`${avgQuality}%`}      sub={t('AI যাচাইকৃত','AI verified')}                     icon={<Star className="h-10 w-10 text-purple-500"/>}       accentColor="border-purple-500"/>
        </div>

        <RealtimePanel
          title={t('রিয়েল-টাইম আপডেট', 'Real-time Updates')}
          icon={<TrendingUp className="h-5 w-5" />}
          gradient="from-green-600 to-blue-600"
          columns={[
            { title: t('আজকের কার্যক্রম', "Today's Activities"), lines: [
              `${inTransitCount} ${t('টি ফসল পরিবহনে', 'crops in transit')}`,
              `${atHubCount} ${t('টি হাবে উপলব্ধ', 'available at hub')}`,
              `${completedCount} ${t('টি সংগ্রহ সম্পন্ন', 'completed')}`] },
            { title: t('ডেলিভারি ট্র্যাকিং', 'Delivery Tracking'), lines: [
              `${t('মোট ডেলিভার:', 'Total Delivered:')} ${totalDelivered} ${t('প্যাকেট', 'packets')}`,
              `${t('অবশিষ্ট:', 'Remaining:')} ${totalRemaining} ${t('প্যাকেট', 'packets')}`,
              `${t('সম্পূর্ণতার হার:', 'Completion:')} ${completion}%`] },
            { title: t('পেমেন্ট স্ট্যাটাস', 'Payment Status'), lines: [
              `${t('আয় (৭০%):', 'Earned (70%):')} ৳${Math.round(myRevenue?.totalRevenue ?? 0).toLocaleString()}`,
              `${t('পরিশোধিত:', 'Paid:')} ৳${Math.round(myRevenue?.paidAmount ?? 0).toLocaleString()}`,
              `${t('অপেক্ষমাণ:', 'Pending:')} ৳${Math.round(myRevenue?.pendingPayment ?? 0).toLocaleString()}`] },
          ]}
        />

        {/* AI Market Insights */}
        <Card className="bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-6 w-6" />
            <h3 className="font-bold text-lg">{t('AI বাজার পূর্বাভাস','AI Market Forecast')}</h3>
            <span className="ml-auto"><SampleBadge /></span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { crop: t('আলু','Potato'), trend: '↗️', price: '৳২৫-৩০', note: t('দাম বৃদ্ধি সম্ভব','Price increase expected') },
              { crop: t('টমেটো','Tomato'), trend: '🔥', price: '৳৪৫-৫০', note: t('উচ্চ চাহিদা','High demand') },
              { crop: t('আবহাওয়া','Weather'), trend: '☔', price: '—', note: t('আগামী ২ দিন বৃষ্টি','Rain next 2 days') },
            ].map(item => (
              <div key={item.crop} className="bg-white/15 rounded-xl p-3">
                <p className="font-semibold">{item.crop} {item.trend}</p>
                <p className="text-sm opacity-90">{item.price !== '—' ? `${t('আনুমানিক','Predicted')}: ${item.price}/kg` : ''}</p>
                <p className="text-xs opacity-75">{item.note}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Crop list header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">{t('আমার ফসল','My Crops')}</h3>
          <Button onClick={() => { setShowAddCrop(true); setForm(INITIAL_FORM); setFormErrors({}); }} icon={<Plus className="h-4 w-4"/>}>
            {t('নতুন ফসল','Add Crop')}
          </Button>
        </div>

        {/* Add Crop Modal */}
        <Modal open={showAddCrop} onClose={() => setShowAddCrop(false)} title={t('নতুন ফসল যোগ করুন','Add New Crop')}>
          <div className="space-y-4">
            {noActiveCategories && (
              <Alert variant="warning">{t('কোনো সক্রিয় ক্যাটাগরি নেই। অ্যাডমিনকে ক্যাটাগরি সক্রিয় করতে বলুন।', 'There are no active categories. Ask the administrator to activate one.')}</Alert>
            )}
            {noCategoriesLoaded ? (
              <FormField label={t('ফসল','Crop')} error={formErrors.fallbackType} required>
                <Select value={form.fallbackType} onChange={e => setForm(p => ({ ...p, fallbackType: e.target.value }))}>
                  <option value="">{t('নির্বাচন করুন','Select')}</option>
                  {FALLBACK_CROPS.map(([value, bn, en]) => <option key={value} value={value}>{lang === 'bn' ? `${bn} (${en})` : en}</option>)}
                </Select>
              </FormField>
            ) : (
              <FormField label={t('ক্যাটাগরি','Category')} error={formErrors.categoryId} required>
                <Select value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value, subcategoryId: '' }))}>
                  <option value="">{t('নির্বাচন করুন','Select')}</option>
                  {topCategories.map(c => <option key={c.id} value={c.id}>{lang === 'bn' && c.nameBn ? `${c.nameBn} (${c.name})` : c.name}</option>)}
                </Select>
              </FormField>
            )}
            {subCategories.length > 0 && (
              <FormField label={t('সাবক্যাটাগরি / ফসল','Subcategory / Crop')} error={formErrors.subcategoryId} required>
                <Select value={form.subcategoryId} onChange={e => setForm(p => ({ ...p, subcategoryId: e.target.value }))}>
                  <option value="">{t('নির্বাচন করুন','Select')}</option>
                  {subCategories.map(c => <option key={c.id} value={c.id}>{lang === 'bn' && c.nameBn ? `${c.nameBn} (${c.name})` : c.name}</option>)}
                </Select>
              </FormField>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t('প্যাকেট সংখ্যা','Packets')} error={formErrors.packets} required>
                <Input type="number" min="1" value={form.packets} onChange={e => setForm(p => ({ ...p, packets: e.target.value }))} placeholder="50" />
              </FormField>
              <FormField label={t('প্রতি প্যাকেট ওজন (কেজি)','Weight/Packet (kg)')} error={formErrors.weightPerPacket} required>
                <Select value={form.weightPerPacket} onChange={e => setForm(p => ({ ...p, weightPerPacket: e.target.value }))}>
                  <option value="">{t('নির্বাচন করুন','Select')}</option>
                  {[5,10,15,20,25].map(w => <option key={w} value={w}>{w} kg</option>)}
                </Select>
              </FormField>
            </div>
            <FormField label={t('ফসলের ছবি','Crop Images')}>
              <PhotoUploader value={form.images} onChange={images => setForm(p => ({ ...p, images }))} disabled={submitting} />
            </FormField>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowAddCrop(false)}>{t('বাতিল','Cancel')}</Button>
              <Button className="flex-1" loading={submitting} onClick={handleAddCrop}>{t('যোগ করুন','Add Crop')}</Button>
            </div>
          </div>
        </Modal>

        {/* Crops Grid */}
        {farmerCrops.length === 0 ? (
          <EmptyState icon={<Package className="h-16 w-16" />}
            title={t('কোনো ফসল নেই','No crops yet')}
            description={t('নতুন ফসল যোগ করে শুরু করুন','Add your first crop to get started')}
            action={<Button onClick={() => setShowAddCrop(true)} icon={<Plus className="h-4 w-4"/>}>{t('ফসল যোগ করুন','Add Crop')}</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {farmerCrops.map(crop => (
              <Card key={crop.id} className="overflow-hidden p-0">
                <ProductImage images={crop.images} alt={crop.type} className="w-full h-40" />
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-gray-900">{cropName(crop.type)}</h4>
                    <Badge className={statusBadgeClass(crop.status)}>{statusLabel(crop.status, lang)}</Badge>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between"><span>{t('প্যাকেট','Packets')}</span><span className="font-medium">{crop.packets}</span></div>
                    <div className="flex justify-between"><span>{t('ডেলিভার/অবশিষ্ট','Delivered/Remaining')}</span><span className="font-medium">{crop.packetsDelivered}/{crop.packetsRemaining}</span></div>
                    <div className="flex justify-between"><span>{t('মোট ওজন','Total Weight')}</span><span className="font-medium">{crop.totalWeight} kg</span></div>
                    <div className="flex justify-between"><span>{t('আনুমানিক দাম','Est. Price')}</span><span className="font-medium text-green-600">৳{crop.predictedPrice}/kg</span></div>
                    <div className="flex justify-between"><span>{t('গুণমান','Quality')}</span><span className="font-medium">{crop.qualityScore}%</span></div>
                    {crop.transporterName && <div className="flex justify-between text-xs"><span>{t('পরিবহনকারী','Transporter')}</span><span className="font-medium text-right max-w-[130px] truncate">{crop.transporterName}</span></div>}
                    {crop.scheduledPickupTime && <div className="flex justify-between text-xs"><span>{t('সংগ্রহ','Pickup')}</span><span className="font-medium">{formatDate(crop.scheduledPickupTime)}</span></div>}
                    {crop.deliveredToHubTime && <div className="flex justify-between text-xs"><span>{t('হাবে পৌঁছেছে','Delivered')}</span><span className="font-medium">{formatDate(crop.deliveredToHubTime)}</span></div>}
                    <div className="flex justify-between text-xs"><span>{t('অবস্থান','Location')}</span><span className="font-medium text-purple-600 text-right max-w-[120px] truncate">{crop.currentLocation}</span></div>
                  </div>
                  <ProgressBar value={crop.packetsDelivered} max={crop.packets} label={t('ডেলিভারি অগ্রগতি','Delivery Progress')} />
                  <div className="flex gap-2 pt-1">
                    {crop.status === 'pending' && (
                      <Button size="sm" className="flex-1" icon={<Users className="h-3 w-3"/>} onClick={() => setBookingCrop(crop)}>
                        {t('বুক','Book')}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" icon={<MapPin className="h-3 w-3"/>} onClick={() => setTrackingCrop(crop)}>
                      {t('ট্র্যাক','Track')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Eye className="h-3 w-3"/>} onClick={() => setDetailsCrop(crop)}>
                      {t('বিস্তারিত','Details')}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Modals */}
        {trackingCrop && <TrackingModal crop={trackingCrop} onClose={() => setTrackingCrop(null)} />}
        {detailsCrop && <DetailsModal crop={detailsCrop} onClose={() => setDetailsCrop(null)} />}
        {bookingCrop  && (
          <TransporterModal
            crop={bookingCrop}
            transporters={availableTransporters}
            hubs={activeHubs}
            onSelect={(tid, hubId) => handleBookTransport(bookingCrop.id, tid, hubId)}
            onClose={() => setBookingCrop(null)}
          />
        )}
      </div>
    </Layout>
  );
}
