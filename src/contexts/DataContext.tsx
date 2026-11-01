import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode,
} from 'react';
import type {
  Crop, Booking, HubPoint, RetailerOrder, Complaint, Transporter, Payment,
  SystemMetrics, FarmerRevenue, CropStatus, BatchOp, ComplaintStatus, User, Category, PlatformSettings,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { SHEETS_ENABLED, REQUIRED_BACKEND_VERSION, commitOps, fetchAll, submitComplaintRequest } from '../lib/sheetsApi';
import {
  seedCrops, seedBookings, seedHubPoints, seedRetailerOrders, seedComplaints, seedTransporters, seedCategories,
} from '../lib/seedData';
import { generateId } from '../lib/utils';
import {
  buildStatusPatch, applyOrderToCrop, applyCollectionToCrop, fitImages, deriveHubs,
  computeFarmerRevenues, computeSystemMetrics, type Shares,
} from '../lib/domain';
import { useAuth } from './AuthContext';

type NewCrop = Omit<Crop, 'id' | 'createdAt' | 'packetsDelivered' | 'packetsRemaining' | 'currentLocation' | 'statusHistory' | 'revenueSharing'>;
type NewBooking = Omit<Booking, 'id' | 'transporterName' | 'availableCapacity' | 'scheduledDeliveryTime'>;
type NewOrder = Omit<RetailerOrder, 'id' | 'createdAt'>;
type NewComplaint = Omit<Complaint, 'id' | 'createdAt'>;

/** Every mutation resolves to true on success, false when it was rejected or failed */
interface DataContextType {
  crops: Crop[];
  bookings: Booking[];
  hubPoints: HubPoint[];
  retailerOrders: RetailerOrder[];
  complaints: Complaint[];
  transporters: Transporter[];
  payments: Payment[];
  users: User[];
  categories: Category[];
  settings: PlatformSettings;
  systemMetrics: SystemMetrics;
  farmerRevenues: FarmerRevenue[];
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  /** true when the deployed Apps Script is older than this website */
  backendOutdated: boolean;

  addCrop: (crop: NewCrop) => Promise<boolean>;
  updateCropStatus: (cropId: string, status: CropStatus, meta?: Record<string, unknown>) => Promise<boolean>;
  addBooking: (booking: NewBooking) => Promise<boolean>;
  updateBookingStatus: (bookingId: string, status: Booking['status']) => Promise<boolean>;
  addRetailerOrder: (order: NewOrder) => Promise<boolean>;
  updateRetailerOrderStatus: (orderId: string, status: RetailerOrder['status']) => Promise<boolean>;
  addComplaint: (complaint: NewComplaint) => Promise<boolean>;
  updateComplaintStatus: (complaintId: string, status: ComplaintStatus) => Promise<boolean>;
  receiveCropAtHub: (cropId: string, hubPointId: string) => Promise<boolean>;
  collectCropFromHub: (orderId: string) => Promise<boolean>;
  processPaymentToFarmer: (farmerId: string, amount: number) => Promise<boolean>;
  getAvailableTransporters: () => Transporter[];
  getFarmerRevenue: (farmerId: string) => FarmerRevenue | undefined;
  refreshData: (opts?: { silent?: boolean }) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const update = (entity: Extract<BatchOp, { op: 'update' }>['entity'], id: string, fields: Record<string, unknown>): BatchOp =>
  ({ op: 'update', entity, id, fields });

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // With a backend the data comes from Sheets; without one, the app runs on local demo data.
  const [crops,          setCrops]          = useState<Crop[]>(SHEETS_ENABLED ? [] : seedCrops);
  const [bookings,       setBookings]       = useState<Booking[]>(SHEETS_ENABLED ? [] : seedBookings);
  const [rawHubs,        setRawHubs]        = useState<HubPoint[]>(SHEETS_ENABLED ? [] : seedHubPoints);
  const [retailerOrders, setRetailerOrders] = useState<RetailerOrder[]>(SHEETS_ENABLED ? [] : seedRetailerOrders);
  const [complaints,     setComplaints]     = useState<Complaint[]>(SHEETS_ENABLED ? [] : seedComplaints);
  const [transporters,   setTransporters]   = useState<Transporter[]>(SHEETS_ENABLED ? [] : seedTransporters);
  const [payments,       setPayments]       = useState<Payment[]>([]);
  const [users,          setUsers]          = useState<User[]>([]);
  const [categories,     setCategories]     = useState<Category[]>(SHEETS_ENABLED ? [] : seedCategories);
  const [settings,       setSettings]       = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [isLoading,      setIsLoading]      = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [backendOutdated, setBackendOutdated] = useState(false);

  const hubPoints = useMemo(() => deriveHubs(rawHubs, crops, retailerOrders), [rawHubs, crops, retailerOrders]);
  const shares: Shares = useMemo(() => ({
    farmer: settings.farmerShare / 100, transporter: settings.transporterShare / 100, hub: settings.hubShare / 100,
  }), [settings.farmerShare, settings.transporterShare, settings.hubShare]);
  const systemMetrics = useMemo(() => computeSystemMetrics(crops, bookings, retailerOrders, shares), [crops, bookings, retailerOrders, shares]);
  const farmerRevenues = useMemo(() => computeFarmerRevenues(crops, retailerOrders, payments, shares), [crops, retailerOrders, payments, shares]);

  // ── Loading ──────────────────────────────────────────────────────────────

  // `silent` refreshes (background polling) don't flash the loading state or clear messages
  const refreshData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!SHEETS_ENABLED || !user) return;
    if (!opts?.silent) { setIsLoading(true); setError(null); }
    const res = await fetchAll();
    if (res.success && res.data) {
      setCrops(res.data.crops ?? []);
      setBookings(res.data.bookings ?? []);
      setRawHubs(res.data.hubPoints ?? []);
      setRetailerOrders(res.data.retailerOrders ?? []);
      setComplaints(res.data.complaints ?? []);
      setTransporters(res.data.transporters ?? []);
      setPayments(res.data.payments ?? []);
      setUsers(res.data.users ?? []);
      setCategories(res.data.categories ?? []);
      setSettings({ ...DEFAULT_SETTINGS, ...(res.data.settings ?? {}) });
      setBackendOutdated((res.data.meta?.version ?? 2) < REQUIRED_BACKEND_VERSION);
    } else if (!res.success && res.code !== 'UNAUTHORIZED' && !opts?.silent) {
      setError(res.error ?? 'Failed to load data.');
    }
    if (!opts?.silent) setIsLoading(false);
  }, [user]);

  useEffect(() => { void refreshData(); }, [refreshData]);

  // Keep every open page in step with changes made elsewhere (e.g. by the admin): refresh quietly
  // while the tab is visible and when it regains focus. Transporters and hub managers wait for
  // hand-offs from other people, so they refresh more often (45 s) than everyone else (2 min).
  const pollMs = user?.role === 'transporter' || user?.role === 'hub' ? 45_000 : 120_000;
  useEffect(() => {
    if (!SHEETS_ENABLED || !user) return;
    let last = Date.now();
    const tick = () => { if (document.visibilityState === 'visible') { last = Date.now(); void refreshData({ silent: true }); } };
    const timer = window.setInterval(tick, pollMs);
    const onFocus = () => { if (Date.now() - last > 15_000) tick(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [user, refreshData, pollMs]);

  // Drop everything when the user logs out
  useEffect(() => {
    if (SHEETS_ENABLED && !user) {
      setCrops([]); setBookings([]); setRawHubs([]); setRetailerOrders([]);
      setComplaints([]); setTransporters([]); setPayments([]); setUsers([]); setCategories([]); setSettings(DEFAULT_SETTINGS); setError(null);
    }
  }, [user]);

  /** Send ops to the backend. On failure, show the reason and re-sync to the true state. */
  const commit = useCallback(async (ops: BatchOp[]): Promise<boolean> => {
    if (!SHEETS_ENABLED) return true;
    const res = await commitOps(ops);
    if (res.success) return true;
    if (res.code !== 'UNAUTHORIZED') {
      await refreshData();
      setError(res.error ?? 'Could not save your changes.');
    }
    return false;
  }, [refreshData]);

  /** The server decides stock/collection; pull its result after those actions */
  const commitAndResync = useCallback(async (ops: BatchOp[]): Promise<boolean> => {
    const ok = await commit(ops);
    if (ok && SHEETS_ENABLED) await refreshData();
    return ok;
  }, [commit, refreshData]);

  const patchCrop = (id: string, patch: Partial<Crop>) =>
    setCrops(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));

  // ── Mutations ────────────────────────────────────────────────────────────

  const addCrop = useCallback(async (data: NewCrop) => {
    const now = new Date().toISOString();
    const crop: Crop = {
      ...data,
      images: fitImages(data.images),
      id: generateId(), createdAt: now,
      revenueSharing: { farmer: 70, transporter: 20, hub: 10 },
      statusHistory: [{ status: 'pending', timestamp: now, updatedBy: 'farmer', location: data.location }],
      packetsDelivered: 0, packetsRemaining: data.packets,
      currentLocation: `Farm - ${data.location.split(',')[0]}`,
    };
    setCrops(prev => [...prev, crop]);
    return commit([{ op: 'insert', entity: 'crops', row: crop }]);
  }, [commit]);

  const updateCropStatus = useCallback(async (cropId: string, status: CropStatus, meta: Record<string, unknown> = {}) => {
    const crop = crops.find(c => c.id === cropId);
    if (!crop) return false;
    const patch = buildStatusPatch(crop, status, meta);
    patchCrop(cropId, patch);
    return commit([update('crops', cropId, patch)]);
  }, [crops, commit]);

  const addBooking = useCallback(async (data: NewBooking) => {
    const crop = crops.find(c => c.id === data.cropId);
    const transporter = transporters.find(t => t.id === data.transporterId);
    if (!crop || !transporter || transporter.availableCapacity < data.currentLoad) {
      setError('This transporter does not have enough capacity.');
      return false;
    }
    const id = generateId();
    const booking: Booking = {
      ...data, id,
      transporterName: transporter.name,
      availableCapacity: transporter.availableCapacity - data.currentLoad,
      scheduledDeliveryTime: new Date(new Date(data.pickupTime).getTime() + 4 * 3600000).toISOString(),
    };
    const cropPatch: Partial<Crop> = {
      ...buildStatusPatch(crop, 'booked', { updatedBy: 'farmer' }),
      bookingId: id, scheduledPickupTime: data.pickupTime, hubPointId: data.hubPointId,
      transporterId: data.transporterId, transporterName: transporter.name,
    };
    setBookings(prev => [...prev, booking]);
    patchCrop(crop.id, cropPatch);
    setTransporters(prev => prev.map(t => t.id === transporter.id
      ? { ...t, currentLoad: t.currentLoad + data.currentLoad, availableCapacity: t.availableCapacity - data.currentLoad } : t));
    return commit([
      { op: 'insert', entity: 'bookings', row: booking },
      update('crops', crop.id, cropPatch),
    ]);
  }, [crops, transporters, commit]);

  const updateBookingStatus = useCallback(async (bookingId: string, status: Booking['status']) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return false;
    const crop = crops.find(c => c.id === booking.cropId);
    const hub = rawHubs.find(h => h.id === booking.hubPointId);
    const now = new Date().toISOString();
    const bookingPatch: Partial<Booking> = { status, ...(status === 'delivered_to_hub' ? { deliveryTime: now } : {}) };
    const cropStatus: Partial<Record<Booking['status'], CropStatus>> = {
      confirmed: 'booked', in_transit: 'in_transit', delivered_to_hub: 'delivered_to_hub',
    };
    const target = cropStatus[status];

    const ops: BatchOp[] = [update('bookings', bookingId, bookingPatch)];
    setBookings(prev => prev.map(b => (b.id === bookingId ? { ...b, ...bookingPatch } : b)));
    if (crop && target) {
      const cropPatch = buildStatusPatch(crop, target, { updatedBy: 'transporter', route: booking.route, hubName: hub?.name });
      patchCrop(crop.id, cropPatch);
      ops.push(update('crops', crop.id, cropPatch));
    }
    if (status === 'delivered_to_hub') {
      setTransporters(prev => prev.map(t => t.id === booking.transporterId
        ? { ...t, currentLoad: Math.max(0, t.currentLoad - booking.currentLoad), availableCapacity: t.availableCapacity + booking.currentLoad } : t));
    }
    return commit(ops);
  }, [bookings, crops, rawHubs, commit]);

  const addRetailerOrder = useCallback(async (data: NewOrder) => {
    const crop = crops.find(c => c.id === data.cropId);
    if (!crop || crop.status !== 'available_at_hub') { setError('This crop is no longer available.'); return false; }
    if (data.packets > crop.packetsRemaining) { setError(`Only ${crop.packetsRemaining} packets are still available.`); return false; }
    const order: RetailerOrder = { ...data, id: generateId(), createdAt: new Date().toISOString() };
    setRetailerOrders(prev => [...prev, order]);
    patchCrop(crop.id, applyOrderToCrop(crop, data.packets, data.retailerName));
    // The server recomputes the amount and stock; we re-sync to show its numbers.
    return commitAndResync([{ op: 'insert', entity: 'retailerOrders', row: order }]);
  }, [crops, commitAndResync]);

  const updateRetailerOrderStatus = useCallback(async (orderId: string, status: RetailerOrder['status']) => {
    setRetailerOrders(prev => prev.map(o => (o.id === orderId ? { ...o, status } : o)));
    return commit([update('retailerOrders', orderId, { status })]);
  }, [commit]);

  const collectCropFromHub = useCallback(async (orderId: string) => {
    const order = retailerOrders.find(o => o.id === orderId);
    if (!order || order.status !== 'pre_paid') { setError('Please pay for the order before collecting it.'); return false; }
    const crop = crops.find(c => c.id === order.cropId);
    setRetailerOrders(prev => prev.map(o => (o.id === orderId ? { ...o, status: 'collected', collectedAt: new Date().toISOString() } : o)));
    if (crop) patchCrop(crop.id, applyCollectionToCrop(crop, order));
    return commitAndResync([update('retailerOrders', orderId, { status: 'collected' })]);
  }, [retailerOrders, crops, commitAndResync]);

  const receiveCropAtHub = useCallback(async (cropId: string, hubPointId: string) => {
    const crop = crops.find(c => c.id === cropId);
    const hub = rawHubs.find(h => h.id === hubPointId);
    if (!crop || !hub) return false;
    const patch = buildStatusPatch(crop, 'available_at_hub', { updatedBy: 'hub_manager', hubName: hub.name });
    patchCrop(cropId, patch);
    return commit([update('crops', cropId, patch)]);
  }, [crops, rawHubs, commit]);

  const addComplaint = useCallback(async (data: NewComplaint) => {
    const complaint: Complaint = { ...data, id: generateId(), createdAt: new Date().toISOString() };
    if (SHEETS_ENABLED) {
      const res = await submitComplaintRequest({
        retailerId: data.retailerId, cropId: data.cropId, description: data.description, severity: data.severity,
      });
      if (!res.success) return false;
    }
    setComplaints(prev => [...prev, complaint]);
    return true;
  }, []);

  const updateComplaintStatus = useCallback(async (complaintId: string, status: ComplaintStatus) => {
    setComplaints(prev => prev.map(c => (c.id === complaintId ? { ...c, status } : c)));
    return commit([update('complaints', complaintId, { status })]);
  }, [commit]);

  const processPaymentToFarmer = useCallback(async (farmerId: string, amount: number) => {
    const payment: Payment = { id: generateId(), farmerId, amount, processedAt: new Date().toISOString(), status: 'processed' };
    setPayments(prev => [...prev, payment]);
    return commit([{ op: 'insert', entity: 'payments', row: payment }]);
  }, [commit]);

  const getAvailableTransporters = useCallback(
    () => transporters.filter(t => t.availableCapacity > 0 && t.status === 'available'),
    [transporters],
  );
  const getFarmerRevenue = useCallback((farmerId: string) => farmerRevenues.find(fr => fr.farmerId === farmerId), [farmerRevenues]);
  const clearError = useCallback(() => setError(null), []);

  const value: DataContextType = {
    crops, bookings, hubPoints, retailerOrders, complaints, transporters, payments, users, categories, settings,
    systemMetrics, farmerRevenues, isLoading, error, clearError, backendOutdated,
    addCrop, updateCropStatus, addBooking, updateBookingStatus, addRetailerOrder,
    updateRetailerOrderStatus, addComplaint, updateComplaintStatus, receiveCropAtHub,
    collectCropFromHub, processPaymentToFarmer, getAvailableTransporters, getFarmerRevenue, refreshData,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
