// ─── User & Auth ─────────────────────────────────────────────────────────────

export type UserRole = 'farmer' | 'transporter' | 'hub' | 'retailer' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  location?: string;
  active?: boolean;
  createdAt?: string;
}

// ─── Crop ─────────────────────────────────────────────────────────────────────

export type CropStatus =
  | 'pending'
  | 'booked'
  | 'in_transit'
  | 'delivered_to_hub'
  | 'available_at_hub'
  | 'ordered'
  | 'collected';

export interface StatusHistoryEntry {
  status: CropStatus;
  timestamp: string; // ISO string — safe to serialise to Sheets
  updatedBy: string;
  location: string;
}

export interface RevenueSharing {
  farmer: number;   // percentage
  transporter: number;
  hub: number;
}

export interface Crop {
  id: string;
  farmerId: string;
  farmerName: string;
  type: string;
  packets: number;
  weightPerPacket: number;
  totalWeight: number;
  images: string[];
  status: CropStatus;
  bookingId?: string;
  hubPointId?: string;
  predictedPrice: number;
  actualPrice?: number;
  location: string;
  qualityScore: number;
  createdAt: string;
  scheduledPickupTime?: string;
  deliveredToHubTime?: string;
  collectedByRetailerTime?: string;
  revenueSharing: RevenueSharing;
  statusHistory: StatusHistoryEntry[];
  packetsDelivered: number;
  packetsRemaining: number;
  currentLocation: string;
  transporterId?: string;
  transporterName?: string;
  categoryId?: string;
  subcategoryId?: string;
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export type BookingStatus = 'pending' | 'confirmed' | 'in_transit' | 'delivered_to_hub';

export interface Booking {
  id: string;
  cropId: string;
  farmerId: string;
  transporterId: string;
  transporterName: string;
  vehicleCapacity: number;
  currentLoad: number;
  availableCapacity: number;
  route: string;
  pickupTime: string;
  deliveryTime?: string;
  status: BookingStatus;
  hubPointId: string;
  scheduledDeliveryTime?: string;
}

// ─── Hub ──────────────────────────────────────────────────────────────────────

export type StockStatus = 'in_stock' | 'ordered' | 'delivered';

export interface StockDetail {
  cropId: string;
  cropType: string;
  packets: number;
  weight: number;
  farmerName: string;
  status: StockStatus;
  retailerName?: string;
  deliveredAt?: string;
  collectedAt?: string;
  packetsDelivered: number;
  packetsRemaining: number;
}

export interface HubPoint {
  id: string;
  name: string;
  location: string;
  capacity: number;
  currentStock: number;
  managerId: string;
  managerName: string;
  phone?: string;
  active?: boolean;
  expectedStock: number;
  pendingOrders: number;
  totalRevenue: number;
  stockDetails: StockDetail[];
}

// ─── Retailer Order ───────────────────────────────────────────────────────────

export type OrderStatus = 'pre_booked' | 'pre_paid' | 'collected' | 'cancelled';

export interface RetailerOrder {
  id: string;
  retailerId: string;
  retailerName: string;
  cropId: string;
  cropType: string;
  packets: number;
  hubPointId: string;
  status: OrderStatus;
  amount: number;
  createdAt: string;
  collectedAt?: string;
  note?: string;
}

// ─── Complaint ────────────────────────────────────────────────────────────────

export type ComplaintSeverity = 'low' | 'medium' | 'high';
export type ComplaintStatus = 'pending' | 'investigating' | 'resolved';

export interface Complaint {
  id: string;
  consumerId: string;
  retailerId: string;
  cropId?: string;
  description: string;
  severity: ComplaintSeverity;
  status: ComplaintStatus;
  createdAt: string;
}

// ─── Transporter ──────────────────────────────────────────────────────────────

export type TransporterStatus = 'available' | 'busy' | 'in_transit';

export interface Transporter {
  id: string;
  name: string;
  vehicleCapacity: number;
  currentLoad: number;
  availableCapacity: number;
  location: string;
  status: TransporterStatus;
  bookable?: boolean;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface ProductBreakdown {
  totalPackets: number;
  atHubs: number;
  withRetailers: number;
  inTransit: number;
}

export interface SystemMetrics {
  totalFarmers: number;
  totalCrops: number;
  totalBookings: number;
  totalRevenue: number;
  cropsInTransit: number;
  cropsAtHubs: number;
  cropsCollected: number;
  revenueByRole: {
    farmers: number;
    transporters: number;
    hubs: number;
  };
  productBreakdown: Record<string, ProductBreakdown>;
}

export interface FarmerRevenueCrop {
  cropId: string;
  cropType: string;
  packets: number;
  revenue: number;
  status: CropStatus;
  retailerName?: string;
  collectedAt?: string;
  packetsDelivered: number;
  packetsRemaining: number;
}

export interface FarmerRevenue {
  farmerId: string;
  farmerName: string;
  totalRevenue: number;
  cropsDelivered: number;
  pendingPayment: number;
  paidAmount: number;
  crops: FarmerRevenueCrop[];
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface Payment {
  id: string;
  farmerId: string;
  amount: number;
  processedAt: string;
  status: string;
}

// ─── Google Sheets API ────────────────────────────────────────────────────────

export interface SheetsApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/** Everything the backend returns for GET_ALL (already scoped to the caller's role) */
export interface Category {
  id: string;
  name: string;
  nameBn: string;
  parentId: string;   // '' for a top-level category
  active: boolean;
}

export interface PlatformSettings {
  platformName: string;
  supportPhone: string;
  supportEmail: string;
  farmerShare: number;
  transporterShare: number;
  hubShare: number;
  maintenanceMode: boolean;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  platformName: 'KrishiBazar AI', supportPhone: '', supportEmail: '',
  farmerShare: 70, transporterShare: 20, hubShare: 10, maintenanceMode: false,
};

export interface AppData {
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
  meta?: { version: number };
}

export type EntityName = 'crops' | 'bookings' | 'retailerOrders' | 'payments';

export type BatchOp =
  | { op: 'insert'; entity: EntityName; row: object }
  | { op: 'update'; entity: EntityName | 'complaints'; id: string; fields: Record<string, unknown> };
