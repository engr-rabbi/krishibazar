import React, { useEffect, useState } from 'react';
import { ShoppingCart, Package, CheckCircle, QrCode, Plus, CreditCard, TrendingUp, Download } from 'lucide-react';
import QRCode from 'qrcode';
import Layout from '../components/layout/Layout';
import { StatCard, Card, Button, Badge, Modal, FormField, Select, Alert, EmptyState, LoadingSpinner } from '../components/ui';
import { RealtimePanel, useCropName } from '../components/ui/Panels';
import { ProductImage } from '../components/ui/ProductImage';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { formatDate, buildComplaintUrl } from '../lib/utils';

export default function RetailerDashboard() {
  const { user }    = useAuth();
  const { crops, hubPoints, retailerOrders, addRetailerOrder, updateRetailerOrderStatus, collectCropFromHub, isLoading } = useData();
  const { t }       = useLanguage();
  const cropName    = useCropName();
  const [retailerQr, setRetailerQr] = useState('');

  const [showOrder,  setShowOrder]  = useState(false);
  const [qrDataUrl,  setQrDataUrl]  = useState('');
  const [qrModal,    setQrModal]    = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error,      setError]      = useState('');
  const [paying,     setPaying]     = useState<string | null>(null);
  const [collecting, setCollecting] = useState<string | null>(null);

  const [orderForm, setOrderForm] = useState({ cropId: '', hubPointId: '', packets: '' });

  const myOrders   = retailerOrders.filter(o => o.retailerId === user?.id);
  const available  = crops.filter(c => c.status === 'available_at_hub' && c.packetsRemaining > 0);

  // The retailer's permanent complaint QR code (customers scan it to report a problem)
  useEffect(() => {
    if (!user) return;
    QRCode.toDataURL(buildComplaintUrl(user.id, ''), { width: 220, margin: 2 }).then(setRetailerQr).catch(() => setRetailerQr(''));
  }, [user]);

  const handlePlaceOrder = async () => {
    const crop = crops.find(c => c.id === orderForm.cropId);
    if (!crop || !orderForm.packets || parseInt(orderForm.packets) <= 0) {
      setError(t('সব তথ্য সঠিকভাবে দিন।', 'Please fill all fields correctly.'));
      return;
    }
    const packets = parseInt(orderForm.packets);
    if (packets > crop.packetsRemaining) {
      setError(t(`সর্বোচ্চ ${crop.packetsRemaining} প্যাকেট উপলব্ধ।`, `Max ${crop.packetsRemaining} packets available.`));
      return;
    }
    setError('');
    const ok = await addRetailerOrder({
      retailerId: user!.id, retailerName: user!.name,
      cropId: crop.id, cropType: crop.type, packets,
      hubPointId: crop.hubPointId ?? orderForm.hubPointId,
      status: 'pre_booked', amount: packets * crop.weightPerPacket * crop.predictedPrice,
    });
    if (!ok) { setShowOrder(false); return; }
    setOrderForm({ cropId: '', hubPointId: '', packets: '' });
    setShowOrder(false);
    setSuccessMsg(t('অর্ডার সফলভাবে দেওয়া হয়েছে!', 'Order placed successfully!'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handlePay = async (orderId: string) => {
    setPaying(orderId);
    // NOTE: no real payment gateway is connected yet — this only records the order as paid.
    const ok = await updateRetailerOrderStatus(orderId, 'pre_paid');
    if (!ok) { setPaying(null); return; }
    const order = myOrders.find(o => o.id === orderId);
    if (order) {
      // generate QR
      const qrText = buildComplaintUrl(user!.id, orderId, order.cropType);
      const dataUrl = await QRCode.toDataURL(qrText, { width: 300, margin: 2 });
      setQrDataUrl(dataUrl);
      setQrModal(true);
    }
    setPaying(null);
    setSuccessMsg(t('পেমেন্ট সফল!', 'Payment successful!'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleCollect = async (orderId: string) => {
    setCollecting(orderId);
    const ok = await collectCropFromHub(orderId);
    setCollecting(null);
    if (!ok) return;
    setSuccessMsg(t('ফসল সংগ্রহ সম্পন্ন!', 'Crop collected successfully!'));
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  if (isLoading && myOrders.length === 0) return <LoadingSpinner message={t('লোড হচ্ছে...', 'Loading...')} />;

  return (
    <Layout title={{ bn: 'খুচরা বিক্রেতা ড্যাশবোর্ড', en: 'Retailer Dashboard' }}>
      <div className="space-y-6">
        {successMsg && <Alert variant="success">{successMsg}</Alert>}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={t('মোট অর্ডার','Total Orders')}    value={myOrders.length}                              icon={<ShoppingCart className="h-10 w-10 text-orange-500"/>} accentColor="border-orange-500"/>
          <StatCard label={t('মুলতুবি','Pending')}             value={myOrders.filter(o=>o.status==='pre_booked').length} icon={<Package className="h-10 w-10 text-blue-500"/>}   accentColor="border-blue-500"/>
          <StatCard label={t('সম্পন্ন','Collected')}           value={myOrders.filter(o=>o.status==='collected').length}  icon={<CheckCircle className="h-10 w-10 text-green-500"/>} accentColor="border-green-500"/>
          <StatCard label={t('মোট ব্যয়','Total Spent')}        value={`৳${myOrders.reduce((s,o)=>s+o.amount,0).toLocaleString()}`} icon={<CreditCard className="h-10 w-10 text-purple-500"/>} accentColor="border-purple-500"/>
        </div>

        <RealtimePanel
          title={t('রিয়েল-টাইম আপডেট', 'Real-time Updates')}
          icon={<TrendingUp className="h-5 w-5" />}
          gradient="from-orange-500 to-red-500"
          columns={[
            { title: t('হাবে উপলব্ধ', 'Available at Hub'), lines: [
              `${available.length} ${t('টি ফসল অর্ডারের জন্য প্রস্তুত', 'crops ready for order')}`] },
            { title: t('আজকের কার্যক্রম', "Today's Activities"), lines: [
              `${myOrders.filter(o => o.status === 'pre_paid').length} ${t('টি পেইড অর্ডার সংগ্রহের জন্য প্রস্তুত', 'paid orders ready for pickup')}`,
              `${myOrders.filter(o => o.status === 'pre_booked').length} ${t('টি অর্ডার পেমেন্ট অপেক্ষমাণ', 'orders awaiting payment')}`] },
            { title: t('গ্রাহক সেবা', 'Customer Service'), lines: [
              t('QR কোড স্ক্যান করে অভিযোগ জানান', 'Scan the QR code to submit complaints')] },
          ]}
        />

        <Card>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            {retailerQr && <img src={retailerQr} alt="Retailer QR Code" className="h-32 w-32 rounded-lg border border-gray-200" />}
            <div className="flex-1 text-center sm:text-left">
              <h3 className="flex items-center justify-center gap-2 text-xl font-bold text-gray-900 sm:justify-start"><QrCode className="h-5 w-5 text-green-600" />{t('আপনার QR কোড', 'Your QR Code')}</h3>
              <p className="mt-1 text-sm text-gray-600">{t('গ্রাহকরা এই QR কোড স্ক্যান করে অভিযোগ জানাতে পারবেন', 'Customers can scan this QR code to submit complaints')}</p>
              <p className="mt-1 text-xs text-gray-500">{t('খুচরা বিক্রেতা আইডি:', 'Retailer ID:')} <span className="font-mono">{user?.id}</span></p>
              {retailerQr && (
                <a href={retailerQr} download="retailer-complaint-qr.png" className="mt-3 inline-block">
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />}>{t('ডাউনলোড', 'Download')}</Button>
                </a>
              )}
            </div>
          </div>
        </Card>

        {/* Available crops */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-gray-800">{t('উপলব্ধ ফসল','Available Crops')}</h3>
            <Button size="sm" icon={<Plus className="h-4 w-4"/>} onClick={() => { setShowOrder(true); setError(''); }}>
              {t('অর্ডার দিন','Place Order')}
            </Button>
          </div>
          {available.length === 0 ? (
            <EmptyState icon={<Package className="h-12 w-12"/>} title={t('বর্তমানে হাবে কোন ফসল উপলব্ধ নেই','No crops currently available at hub')} description={t('হাব ম্যানেজার ফসল গ্রহণ করলে এখানে দেখাবে','Crops appear here when the hub manager receives them')} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {available.map(crop => (
                <Card key={crop.id}>
                  <ProductImage images={crop.images} alt={crop.type} className="-mx-6 -mt-6 mb-3 h-32 w-[calc(100%+3rem)] rounded-t-xl" />
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-bold text-gray-900">{cropName(crop.type)}</h4>
                      <p className="text-xs text-gray-500">{crop.farmerName}</p>
                    </div>
                    <Badge className="bg-green-100 text-green-800">{t('উপলব্ধ', 'Available')}</Badge>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between"><span>{t('উপলব্ধ প্যাকেট:', 'Available packets:')}</span><span className="font-medium">{crop.packetsRemaining}</span></div>
                    <div className="flex justify-between"><span>{t('প্রতি প্যাকেট:', 'Per packet:')}</span><span className="font-medium">{crop.weightPerPacket} {t('কেজি', 'kg')}</span></div>
                    <div className="flex justify-between"><span>{t('গুণমান:', 'Quality:')}</span><span className="font-medium">{crop.qualityScore}%</span></div>
                    <div className="flex justify-between"><span>{t('দাম:', 'Price:')}</span><span className="font-medium text-green-600">৳{crop.predictedPrice}/{t('কেজি', 'kg')}</span></div>
                    <div className="flex justify-between"><span>{t('হাব:', 'Hub:')}</span><span className="font-medium text-purple-600 truncate text-right max-w-[140px]">{hubPoints.find(h => h.id === crop.hubPointId)?.name ?? '—'}</span></div>
                  </div>
                  <Button size="sm" className="w-full mt-3" onClick={() => { setOrderForm({cropId: crop.id, hubPointId: crop.hubPointId ?? '', packets: ''}); setShowOrder(true); setError(''); }}>
                    {t('অর্ডার করুন', 'Order')}
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* My orders */}
        <div>
          <h3 className="text-lg font-bold text-gray-800 mb-3">{t('আমার অর্ডার','My Orders')}</h3>
          {myOrders.length === 0 ? (
            <EmptyState icon={<ShoppingCart className="h-12 w-12"/>} title={t('কোনো অর্ডার নেই','No orders yet')} />
          ) : (
            <div className="space-y-3">
              {myOrders.map(order => (
                <Card key={order.id}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{cropName(order.cropType)}</p>
                        <Badge className={order.status === 'collected' ? 'bg-emerald-100 text-emerald-800' : order.status === 'pre_paid' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}>
                          {order.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{order.packets} {t('প্যাকেট','pkt')} • ৳{order.amount.toLocaleString()} • {hubPoints.find(h => h.id === order.hubPointId)?.name ?? ''} • {formatDate(order.createdAt)}{order.collectedAt ? ` • ${t('সংগ্রহ', 'Collected')}: ${formatDate(order.collectedAt)}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      {order.status === 'pre_booked' && (
                        <Button size="sm" loading={paying === order.id} icon={<CreditCard className="h-3 w-3"/>} onClick={() => handlePay(order.id)}>
                          {t('পেমেন্ট','Pay')}
                        </Button>
                      )}
                      {order.status === 'pre_paid' && (
                        <Button size="sm" loading={collecting === order.id} icon={<CheckCircle className="h-3 w-3"/>} onClick={() => handleCollect(order.id)}>
                          {t('সংগ্রহ','Collect')}
                        </Button>
                      )}
                      {order.status === 'collected' && (
                        <Button size="sm" variant="secondary" icon={<QrCode className="h-3 w-3"/>} onClick={async () => {
                          const url = buildComplaintUrl(user!.id, order.id, order.cropType);
                          const du = await QRCode.toDataURL(url, { width: 200 });
                          setQrDataUrl(du); setQrModal(true);
                        }}>
                          QR
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Order modal */}
        <Modal open={showOrder} onClose={() => setShowOrder(false)} title={t('নতুন অর্ডার','New Order')}>
          <div className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <FormField label={t('ফসল নির্বাচন করুন','Select Crop')} required>
              <Select value={orderForm.cropId} onChange={e => setOrderForm(p => ({ ...p, cropId: e.target.value }))}>
                <option value="">{t('নির্বাচন করুন','Select')}</option>
                {available.map(c => (
                  <option key={c.id} value={c.id}>{cropName(c.type)} — {c.packetsRemaining} {t('প্যাকেট উপলব্ধ','pkt available')}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('প্যাকেট সংখ্যা','Number of Packets')} required>
              <input type="number" min="1" value={orderForm.packets} onChange={e => setOrderForm(p => ({...p, packets: e.target.value}))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500" placeholder="10" />
            </FormField>
            {orderForm.cropId && orderForm.packets && (() => {
              const c = crops.find(x => x.id === orderForm.cropId);
              const p = parseInt(orderForm.packets);
              if (!c || isNaN(p)) return null;
              const total = p * c.weightPerPacket * c.predictedPrice;
              return <Alert variant="info">{t(`মোট পরিমাণ: ৳${total.toLocaleString()}`, `Total amount: ৳${total.toLocaleString()}`)}</Alert>;
            })()}
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowOrder(false)}>{t('বাতিল','Cancel')}</Button>
              <Button className="flex-1" onClick={handlePlaceOrder}>{t('অর্ডার দিন','Place Order')}</Button>
            </div>
          </div>
        </Modal>

        {/* QR modal */}
        <Modal open={qrModal} onClose={() => setQrModal(false)} title={t('QR কোড — গ্রাহক অভিযোগ','QR Code — Consumer Complaint')}>
          <div className="text-center space-y-4">
            {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className="mx-auto w-48 h-48" />}
            <p className="text-sm text-gray-500">{t('গ্রাহকদের এই QR কোড স্ক্যান করতে দিন','Let customers scan this QR code to report issues')}</p>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setQrModal(false)}>{t('বন্ধ করুন','Close')}</Button>
              <a href={qrDataUrl} download="qr-complaint.png" className="flex-1">
                <Button className="w-full">{t('ডাউনলোড করুন','Download')}</Button>
              </a>
            </div>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
