import React, { useMemo, useState } from 'react';
import {
  Users, Package, MapPin, CheckCircle, TrendingUp, DollarSign, Filter, User, CreditCard,
  Shield, AlertTriangle, Bell,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Card, Button, Badge, Alert, EmptyState, LoadingSpinner, Select, FormField } from '../../components/ui';
import { SampleBadge, useCropName } from '../../components/ui/Panels';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { formatDate } from '../../lib/utils';
import type { Crop } from '../../types';

type Period = 'all' | 'today' | 'week' | 'month';
const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = { today: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
const PIE_COLORS = ['#FCD34D', '#A78BFA', '#60A5FA', '#FB923C', '#34D399'];

// Illustrative monthly prices carried over from the original design — NOT live market data.
const PRICE_SAMPLE = [
  { month: 'Jan', potato: 22, tomato: 40, rice: 35 }, { month: 'Feb', potato: 25, tomato: 42, rice: 37 },
  { month: 'Mar', potato: 23, tomato: 45, rice: 36 }, { month: 'Apr', potato: 27, tomato: 48, rice: 38 },
  { month: 'May', potato: 25, tomato: 45, rice: 37 }, { month: 'Jun', potato: 28, tomato: 50, rice: 40 },
];

export default function AdminOverview() {
  const {
    crops, bookings, hubPoints, retailerOrders, complaints, systemMetrics, farmerRevenues,
    processPaymentToFarmer, updateComplaintStatus, isLoading,
  } = useData();
  const { t } = useLanguage();
  const cropName = useCropName();

  const [typeFilter, setTypeFilter] = useState('all');
  const [hubFilter, setHubFilter] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [selectedFarmer, setSelectedFarmer] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const cropTypes = useMemo(() => Array.from(new Set(crops.map(c => c.type))).sort(), [crops]);

  const filteredCrops: Crop[] = useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - PERIOD_MS[period];
    return crops.filter(c =>
      (typeFilter === 'all' || c.type === typeFilter) &&
      (hubFilter === 'all' || c.hubPointId === hubFilter) &&
      new Date(c.createdAt).getTime() >= since);
  }, [crops, typeFilter, hubFilter, period]);

  const wf = useMemo(() => ({
    booked:     filteredCrops.filter(c => c.status !== 'pending').length,
    accepted:   bookings.filter(b => ['confirmed', 'in_transit', 'delivered_to_hub'].includes(b.status)).length,
    delivered:  filteredCrops.filter(c => ['delivered_to_hub', 'available_at_hub', 'ordered', 'collected'].includes(c.status)).length,
    processed:  filteredCrops.filter(c => ['available_at_hub', 'ordered', 'collected'].includes(c.status)).length,
    ordered:    filteredCrops.filter(c => ['ordered', 'collected'].includes(c.status)).length,
    completed:  filteredCrops.filter(c => c.status === 'collected').length,
  }), [filteredCrops, bookings]);

  const tracing = useMemo(() => {
    const rows = new Map<string, { packets: number; weight: number; atHub: number; withRetailer: number; inTransit: number; delivered: number; remaining: number; revenue: number }>();
    filteredCrops.forEach(c => {
      const r = rows.get(c.type) ?? { packets: 0, weight: 0, atHub: 0, withRetailer: 0, inTransit: 0, delivered: 0, remaining: 0, revenue: 0 };
      r.packets += c.packets; r.weight += c.totalWeight; r.delivered += c.packetsDelivered; r.remaining += c.packetsRemaining;
      r.withRetailer += c.packetsDelivered;
      if (c.status === 'in_transit') r.inTransit += c.packets;
      else if (['delivered_to_hub', 'available_at_hub', 'ordered', 'collected'].includes(c.status)) r.atHub += Math.max(0, c.packets - c.packetsDelivered);
      r.revenue += retailerOrders.filter(o => o.cropId === c.id && o.status === 'collected').reduce((s, o) => s + o.amount, 0);
      rows.set(c.type, r);
    });
    return Array.from(rows.entries());
  }, [filteredCrops, retailerOrders]);

  const hubStock = hubPoints.map(h => ({
    name: h.name.split(' ')[0], currentStock: h.currentStock, expectedStock: h.expectedStock, capacity: h.capacity,
    revenue: h.totalRevenue,
  }));

  const workflowData = [
    { name: t('অপেক্ষমাণ', 'Pending'),   value: filteredCrops.filter(c => c.status === 'pending').length },
    { name: t('ট্রানজিটে', 'In Transit'), value: filteredCrops.filter(c => c.status === 'in_transit').length },
    { name: t('হাবে', 'At Hub'),         value: filteredCrops.filter(c => ['delivered_to_hub', 'available_at_hub'].includes(c.status)).length },
    { name: t('অর্ডার', 'Ordered'),      value: filteredCrops.filter(c => c.status === 'ordered').length },
    { name: t('সম্পন্ন', 'Completed'),   value: filteredCrops.filter(c => c.status === 'collected').length },
  ];

  const activeComplaints = complaints.filter(c => c.status !== 'resolved').length;
  const busyHub = hubPoints.find(h => h.capacity > 0 && h.currentStock / h.capacity > 0.8);
  const avgQuality = filteredCrops.length ? Math.round(filteredCrops.reduce((s, c) => s + c.qualityScore, 0) / filteredCrops.length) : 0;
  const farmer = farmerRevenues.find(f => f.farmerId === selectedFarmer);
  const rev = systemMetrics;

  const pay = async (farmerId: string, amount: number) => {
    const ok = await processPaymentToFarmer(farmerId, Math.round(amount * 100) / 100);
    if (!ok) return;
    setSuccessMsg(t('পেমেন্ট রেকর্ড করা হয়েছে।', 'Payment recorded.'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  if (isLoading && crops.length === 0) return <LoadingSpinner message={t('লোড হচ্ছে...', 'Loading...')} />;

  const statCard = (label: string, value: number, sub: string, icon: React.ReactNode, color: string) => (
    <Card accentColor={color} key={label}>
      <div className="flex items-center justify-between">
        <div><p className="text-xs font-medium text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-900">{value}</p><p className="text-xs text-gray-500">{sub}</p></div>
        {icon}
      </div>
    </Card>
  );

  return (
      <div className="space-y-6">
        {successMsg && <Alert variant="success">{successMsg}</Alert>}

        {/* Filters & reports */}
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900">{t('ফিল্টার ও রিপোর্ট', 'Filters & Reports')}</h3>
            <span className="flex items-center gap-1 text-sm text-gray-500"><Filter className="h-4 w-4" />{t('রিয়েল-টাইম ডেটা', 'Real-time data')}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField label={t('ফসলের ধরন', 'Product Type')}>
              <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="all">{t('সব ফসল', 'All Products')}</option>
                {cropTypes.map(ct => <option key={ct} value={ct}>{cropName(ct)}</option>)}
              </Select>
            </FormField>
            <FormField label={t('হাব পয়েন্ট', 'Hub Point')}>
              <Select value={hubFilter} onChange={e => setHubFilter(e.target.value)}>
                <option value="all">{t('সব হাব', 'All Hubs')}</option>
                {hubPoints.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </FormField>
            <FormField label={t('সময়কাল', 'Time Period')}>
              <Select value={period} onChange={e => setPeriod(e.target.value as Period)}>
                <option value="all">{t('সব সময়', 'All time')}</option>
                <option value="today">{t('আজ', 'Today')}</option>
                <option value="week">{t('এই সপ্তাহ', 'This Week')}</option>
                <option value="month">{t('এই মাস', 'This Month')}</option>
              </Select>
            </FormField>
          </div>
        </Card>

        {/* Workflow stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {statCard(t('কৃষক বুকিং', 'Farmer Bookings'), wf.booked, t('মোট ফসল', 'Total crops'), <Users className="h-8 w-8 text-green-500" />, 'border-green-500')}
          {statCard(t('পরিবহন গ্রহণ', 'Transport Accepted'), wf.accepted, t('নিশ্চিত', 'Confirmed'), <Package className="h-8 w-8 text-blue-500" />, 'border-blue-500')}
          {statCard(t('হাবে পৌঁছেছে', 'Delivered to Hub'), wf.delivered, t('ডেলিভার', 'Delivered'), <MapPin className="h-8 w-8 text-purple-500" />, 'border-purple-500')}
          {statCard(t('হাব প্রক্রিয়াকরণ', 'Hub Processed'), wf.processed, t('উপলব্ধ', 'Available'), <CheckCircle className="h-8 w-8 text-indigo-500" />, 'border-indigo-500')}
          {statCard(t('খুচরা অর্ডার', 'Retailer Orders'), wf.ordered, t('অর্ডার', 'Ordered'), <TrendingUp className="h-8 w-8 text-orange-500" />, 'border-orange-500')}
          {statCard(t('সম্পন্ন', 'Completed'), wf.completed, t('সংগ্রহ', 'Collected'), <DollarSign className="h-8 w-8 text-emerald-500" />, 'border-emerald-500')}
        </div>

        {/* Grid-based product tracing */}
        <Card>
          <h3 className="mb-4 text-xl font-bold text-gray-900">{t('গ্রিড-ভিত্তিক পণ্য ট্র্যাকিং', 'Grid-Based Product Tracing')}</h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  {[t('ক্রমিক', 'Serial'), t('ফসলের ধরন', 'Crop Type'), t('মোট প্যাকেট', 'Total Packets'), t('মোট ওজন', 'Total Weight'),
                    t('হাবে', 'At Hub'), t('খুচরা বিক্রেতার কাছে', 'With Retailer'), t('ট্রানজিটে', 'In Transit'),
                    t('ডেলিভার', 'Delivered'), t('অবশিষ্ট', 'Remaining'), t('রাজস্ব', 'Revenue')].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tracing.map(([type, r], i) => (
                  <tr key={type} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-3">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{cropName(type)}</td>
                    <td className="px-4 py-3">{r.packets}</td>
                    <td className="px-4 py-3">{r.weight} {t('কেজি', 'kg')}</td>
                    <td className="px-4 py-3">{r.atHub}</td>
                    <td className="px-4 py-3">{r.withRetailer}</td>
                    <td className="px-4 py-3">{r.inTransit}</td>
                    <td className="px-4 py-3">{r.delivered}</td>
                    <td className="px-4 py-3">{r.remaining}</td>
                    <td className="px-4 py-3 font-semibold text-green-600">৳{r.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tracing.length === 0 && <EmptyState icon={<Package className="h-10 w-10" />} title={t('কোন পণ্য ডেটা নেই', 'No product data available')} />}
          </div>
        </Card>

        {/* Revenue sharing */}
        <Card className="bg-gradient-to-r from-green-600 to-emerald-600 text-white">
          <div className="mb-4 flex items-center gap-2"><DollarSign className="h-6 w-6" /><h3 className="text-xl font-bold">{t('রিয়েল-টাইম রাজস্ব বিতরণ', 'Real-time Revenue Sharing')}</h3></div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              [t('মোট রাজস্ব', 'Total Revenue'), rev.totalRevenue, t('সব লেনদেন', 'All transactions')],
              [t('কৃষকের অংশ (৭০%)', 'Farmer Share (70%)'), rev.revenueByRole.farmers, t('ন্যায্য মূল্য নিশ্চিত', 'Fair pricing ensured')],
              [t('পরিবহন অংশ (২০%)', 'Transport Share (20%)'), rev.revenueByRole.transporters, t('লজিস্টিক খরচ', 'Logistics cost')],
              [t('হাব অংশ (১০%)', 'Hub Share (10%)'), rev.revenueByRole.hubs, t('স্টোরেজ ও বিতরণ', 'Storage & distribution')],
            ].map(([label, value, sub]) => (
              <div key={String(label)} className="rounded-lg bg-white/15 p-4">
                <h4 className="text-sm font-semibold">{label}</h4>
                <p className="text-2xl font-bold">৳{Math.round(Number(value)).toLocaleString()}</p>
                <p className="text-xs opacity-80">{sub}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg bg-white/10 p-4">
            <h4 className="mb-3 flex items-center gap-2 font-semibold"><User className="h-4 w-4" />{t('কৃষক-নির্দিষ্ট রাজস্ব বিতরণ', 'Farmer-Specific Revenue Distribution')}</h4>
            <select value={selectedFarmer} onChange={e => setSelectedFarmer(e.target.value)}
              className="w-full max-w-md rounded-lg border border-white/30 bg-white px-3 py-2 text-sm text-gray-900">
              <option value="">{t('কৃষক নির্বাচন করুন', 'Select a farmer')}</option>
              {farmerRevenues.map(f => <option key={f.farmerId} value={f.farmerId}>{f.farmerName}</option>)}
            </select>
            {farmer && (
              <div className="mt-4 space-y-2 text-sm">
                <h5 className="text-base font-bold">{farmer.farmerName}</h5>
                <div className="flex justify-between"><span>{t('মোট রাজস্ব:', 'Total Revenue:')}</span><span>৳{farmer.totalRevenue.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>{t('ফসল ডেলিভার:', 'Crops Delivered:')}</span><span>{farmer.cropsDelivered}</span></div>
                <div className="flex justify-between"><span>{t('অপেক্ষমাণ পেমেন্ট:', 'Pending Payment:')}</span><span>৳{farmer.pendingPayment.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>{t('পেইড পরিমাণ:', 'Paid Amount:')}</span><span>৳{farmer.paidAmount.toFixed(2)}</span></div>
                {farmer.pendingPayment > 0 && (
                  <Button variant="secondary" icon={<CreditCard className="h-4 w-4" />} onClick={() => pay(farmer.farmerId, farmer.pendingPayment)}>
                    {t(`৳${farmer.pendingPayment.toFixed(2)} পেমেন্ট করুন`, `Pay ৳${farmer.pendingPayment.toFixed(2)}`)}
                  </Button>
                )}
                {farmer.crops.length > 0 && (
                  <div className="border-t border-white/20 pt-2">
                    <h6 className="mb-1 font-semibold">{t('ফসলের বিস্তারিত:', 'Crop Details:')}</h6>
                    {farmer.crops.map((c, i) => (
                      <div key={i} className="flex justify-between"><span>{cropName(c.cropType)} ({c.packets} {t('প্যাকেট', 'packets')})</span><span>৳{c.revenue.toFixed(2)}</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="mt-3 text-xs opacity-80">{t('পেমেন্ট শুধু হিসাবের খাতায় রেকর্ড হয়; কোনো MFS/ব্যাংক সংযুক্ত নেই।', 'Payments are recorded in the ledger only; no bank/MFS is connected yet.')}</p>
        </Card>

        {/* Government monitoring (illustrative) */}
        <Card className="bg-gradient-to-r from-indigo-600 to-blue-700 text-white">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><Shield className="h-6 w-6" /><h3 className="text-xl font-bold">{t('সরকারি মনিটরিং', 'Government Monitoring')}</h3></div>
            <SampleBadge />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-white/15 p-4 text-sm">
              <h4 className="mb-2 font-semibold">{t('কৃষি মন্ত্রণালয়', 'Ministry of Agriculture')}</h4>
              <p>{t('উপকৃত কৃষক:', 'Farmers benefited:')} {rev.totalFarmers}</p>
              <p className="opacity-80">{t('রিপোর্ট সংযোগ: প্রস্তুত নয়', 'Reporting integration: not connected')}</p>
            </div>
            <div className="rounded-lg bg-white/15 p-4 text-sm">
              <h4 className="mb-2 font-semibold">{t('খাদ্য সরবরাহ', 'Food Supply')}</h4>
              <p>{t('বর্তমান সরবরাহ:', 'Current supply:')} {rev.cropsAtHubs + rev.cropsCollected} {t('ফসল', 'crops')}</p>
              <p className="opacity-80">{t('নষ্ট হওয়া কমেছে: ১৮%', 'Spoilage reduced: 18%')}</p>
            </div>
            <div className="rounded-lg bg-white/15 p-4 text-sm">
              <h4 className="mb-2 font-semibold">{t('এসডিজি অগ্রগতি', 'SDG Progress')}</h4>
              <p>{t('এসডিজি ২ (শূন্য ক্ষুধা):', 'SDG 2 (Zero Hunger):')} 78%</p>
              <p>{t('এসডিজি ১ (দারিদ্র্য নিরসন):', 'SDG 1 (No Poverty):')} 65%</p>
              <p>{t('কৃষকদের রাজস্ব:', 'Revenue to farmers:')} ৳{Math.round(rev.revenueByRole.farmers).toLocaleString()}</p>
            </div>
          </div>
        </Card>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-4 text-xl font-bold text-gray-900">{t('হাব স্টক লেভেল', 'Hub Stock Levels')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hubStock}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Legend />
                <Bar dataKey="currentStock" fill="#22C55E" name={t('বর্তমান স্টক', 'Current Stock')} />
                <Bar dataKey="expectedStock" fill="#3B82F6" name={t('প্রত্যাশিত স্টক', 'Expected Stock')} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
              {hubStock.map(h => (
                <div key={h.name} className="rounded bg-gray-50 p-2">
                  <p className="font-semibold">{h.name}</p>
                  <p>{t('স্টক:', 'Stock:')} {h.currentStock}/{h.capacity}</p>
                  <p>{t('রাজস্ব:', 'Revenue:')} ৳{h.revenue.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="mb-4 text-xl font-bold text-gray-900">{t('ওয়ার্কফ্লো স্ট্যাটাস', 'Workflow Status')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={workflowData} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={4} dataKey="value">
                  {workflowData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">{t('দামের প্রবণতা (৳/কেজি)', 'Price Trends (৳/kg)')}</h3><SampleBadge />
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={PRICE_SAMPLE}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                <Line type="monotone" dataKey="potato" stroke="#22C55E" strokeWidth={2} name={t('আলু', 'Potato')} />
                <Line type="monotone" dataKey="tomato" stroke="#EF4444" strokeWidth={2} name={t('টমেটো', 'Tomato')} />
                <Line type="monotone" dataKey="rice" stroke="#3B82F6" strokeWidth={2} name={t('চাল', 'Rice')} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <h3 className="mb-4 text-xl font-bold text-gray-900">{t('ফসলের বিতরণ', 'Crop Distribution')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={tracing.map(([type, r]) => ({ name: cropName(type), packets: r.packets }))}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip />
                <Bar dataKey="packets" fill="#22C55E" radius={[4, 4, 0, 0]} name={t('প্যাকেট', 'Packets')} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Complaints + alerts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">{t('সাম্প্রতিক অভিযোগ', 'Recent Complaints')}</h3>
              <Badge className="bg-red-100 text-red-800">{activeComplaints} {t('টি সক্রিয়', 'active')}</Badge>
            </div>
            {complaints.length === 0 ? (
              <EmptyState icon={<AlertTriangle className="h-10 w-10" />} title={t('কোন অভিযোগ নেই', 'No complaints')} />
            ) : (
              <div className="space-y-3">
                {[...complaints].reverse().slice(0, 5).map(c => (
                  <div key={c.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <Badge className={c.severity === 'high' ? 'bg-red-100 text-red-800' : c.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}>
                        {c.severity === 'high' ? t('উচ্চ', 'High') : c.severity === 'medium' ? t('মাঝারি', 'Medium') : t('নিম্ন', 'Low')}
                      </Badge>
                      <span className="text-xs text-gray-500">{formatDate(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-800">{c.description}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <Badge className={c.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}>{c.status}</Badge>
                      {c.status !== 'resolved' && (
                        <div className="flex gap-1">
                          {c.status === 'pending' && <Button size="sm" variant="secondary" onClick={() => void updateComplaintStatus(c.id, 'investigating')}>{t('তদন্ত করুন', 'Investigate')}</Button>}
                          <Button size="sm" onClick={() => void updateComplaintStatus(c.id, 'resolved')}>{t('সমাধান', 'Resolve')}</Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">{t('সিস্টেম সতর্কতা', 'System Alerts')}</h3><Bell className="h-5 w-5 text-gray-400" />
            </div>
            <div className="space-y-3 text-sm">
              {busyHub && (
                <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3">
                  <p className="font-semibold text-amber-900">{t('উচ্চ হাব ব্যবহার', 'High Hub Utilization')}</p>
                  <p className="text-amber-800">{busyHub.name}: {Math.round((busyHub.currentStock / busyHub.capacity) * 100)}%</p>
                </div>
              )}
              <div className="rounded-lg border-l-4 border-blue-400 bg-blue-50 p-3">
                <p className="font-semibold text-blue-900">{t('লাইভ অবস্থা', 'Live Status')}</p>
                <p className="text-blue-800">{rev.cropsInTransit} {t('ফসল ট্রানজিটে,', 'crops in transit,')} {rev.cropsAtHubs} {t('হাবে', 'at hubs')}</p>
              </div>
              <div className="rounded-lg border-l-4 border-green-400 bg-green-50 p-3">
                <p className="font-semibold text-green-900">{t('ওয়ার্কফ্লো দক্ষতা', 'Workflow Efficiency')}</p>
                <p className="text-green-800">{wf.booked ? Math.round((wf.completed / wf.booked) * 100) : 0}% {t('সম্পূর্ণতার হার', 'completion rate')}</p>
              </div>
              <div className="rounded-lg border-l-4 border-purple-400 bg-purple-50 p-3">
                <p className="font-semibold text-purple-900">{t('গড় ফসলের গুণমান', 'Average crop quality')}</p>
                <p className="text-purple-800">{avgQuality}% <span className="text-xs opacity-70">({t('সিমুলেটেড স্কোর', 'simulated score')})</span></p>
              </div>
            </div>
          </Card>
        </div>
      </div>
  );
}
