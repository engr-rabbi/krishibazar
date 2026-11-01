/**
 * Pure business logic (no React, no network) so it can be unit-tested.
 * The Apps Script backend is authoritative for the same rules; these functions
 * give the UI an instant, consistent optimistic view and power demo mode.
 */
import type {
  Crop, CropStatus, HubPoint, RetailerOrder, Payment,
  FarmerRevenue, SystemMetrics, Booking,
} from '../types';

export const MAX_HISTORY = 30;
/** Bundled with the site (public/), so it never depends on a third-party host being reachable */
export const PLACEHOLDER_IMAGE = `${import.meta.env.BASE_URL}placeholder-crop.svg`;
/** Google Sheets cells hold at most 50,000 characters; stay safely below it */
export const MAX_IMAGES_CHARS = 40_000;
export const FARMER_SHARE = 0.7;
export interface Shares { farmer: number; transporter: number; hub: number } // fractions, sum = 1
export const DEFAULT_SHARES: Shares = { farmer: 0.7, transporter: 0.2, hub: 0.1 };

export const cropLocationFor = (status: CropStatus, meta: Record<string, unknown> = {}): string | undefined => {
  const map: Partial<Record<CropStatus, string>> = {
    booked:           'Booked for Transport',
    in_transit:       `In Transit - ${meta.route ?? 'To Hub'}`,
    delivered_to_hub: `Hub - ${meta.hubName ?? 'Processing'}`,
    available_at_hub: 'Hub - Available for Retailers',
    ordered:          `Hub - Ordered by ${meta.retailerName ?? 'Retailer'}`,
    collected:        `Retailer - ${meta.retailerName ?? 'Collected'}`,
  };
  return map[status];
};

/** Fields that change when a crop moves to a new status */
export function buildStatusPatch(
  crop: Crop, status: CropStatus, meta: Record<string, unknown> = {}, now = new Date().toISOString(),
): Partial<Crop> {
  const currentLocation = cropLocationFor(status, meta) ?? crop.currentLocation;
  const entry = { status, timestamp: now, updatedBy: String(meta.updatedBy ?? 'system'), location: currentLocation };
  return {
    status,
    currentLocation,
    statusHistory: [...crop.statusHistory, entry].slice(-MAX_HISTORY),
    ...(status === 'delivered_to_hub' ? { deliveredToHubTime: now } : {}),
    ...(status === 'collected' ? { collectedByRetailerTime: now } : {}),
  };
}

/** Effect of a retailer placing an order on the crop's stock */
export function applyOrderToCrop(crop: Crop, packets: number, retailerName: string): Partial<Crop> {
  const packetsRemaining = crop.packetsRemaining - packets;
  const currentLocation = `Hub - Ordered by ${retailerName}`;
  if (packetsRemaining > 0) return { packetsRemaining, currentLocation };
  return { ...buildStatusPatch(crop, 'ordered', { retailerName, updatedBy: 'retailer' }), packetsRemaining: 0 };
}

/** Effect of a retailer collecting an order on the crop */
export function applyCollectionToCrop(crop: Crop, order: RetailerOrder): Partial<Crop> {
  const packetsDelivered = crop.packetsDelivered + order.packets;
  if (packetsDelivered >= crop.packets) {
    return { ...buildStatusPatch(crop, 'collected', { retailerName: order.retailerName, updatedBy: 'retailer' }), packetsDelivered };
  }
  return { packetsDelivered };
}

/** Keep stored images within the spreadsheet cell limit. Never stores the local placeholder:
 *  a product without a photo simply has an empty list and the UI shows the fallback image. */
export function fitImages(images: string[]): string[] {
  const size = (a: string[]) => JSON.stringify(a).length;
  const clean = images.filter(u => u && u !== PLACEHOLDER_IMAGE).slice(0, 3);
  if (size(clean) <= MAX_IMAGES_CHARS) return clean;
  if (clean.length && size([clean[0]]) <= MAX_IMAGES_CHARS) return [clean[0]];
  return [];
}

/** Order cancellation puts the packets back on the shelf */
export function applyCancelToCrop(crop: Crop, packets: number): Partial<Crop> {
  const packetsRemaining = Math.min(crop.packets, crop.packetsRemaining + packets);
  if (crop.status === 'ordered') {
    return { ...buildStatusPatch(crop, 'available_at_hub', { updatedBy: 'admin' }), packetsRemaining };
  }
  return { packetsRemaining };
}

/** Hub numbers are derived from crops and orders — never stored, so they cannot drift */
export function deriveHubs(hubs: HubPoint[], crops: Crop[], orders: RetailerOrder[]): HubPoint[] {
  return hubs.map(hub => {
    const atHub = crops.filter(c => c.hubPointId === hub.id);
    const hubOrders = orders.filter(o => o.hubPointId === hub.id);
    return {
      ...hub,
      stockDetails: [],
      currentStock: atHub
        .filter(c => c.status === 'available_at_hub' || c.status === 'ordered')
        .reduce((s, c) => s + Math.max(0, c.packets - c.packetsDelivered), 0),
      expectedStock: atHub
        .filter(c => ['booked', 'in_transit', 'delivered_to_hub'].includes(c.status))
        .reduce((s, c) => s + c.packets, 0),
      pendingOrders: hubOrders
        .filter(o => o.status === 'pre_booked' || o.status === 'pre_paid')
        .reduce((s, o) => s + o.packets, 0),
      totalRevenue: hubOrders
        .filter(o => o.status === 'collected')
        .reduce((s, o) => s + o.amount, 0),
    };
  });
}

export function computeFarmerRevenues(crops: Crop[], orders: RetailerOrder[], payments: Payment[], shares: Shares = DEFAULT_SHARES): FarmerRevenue[] {
  const map = new Map<string, FarmerRevenue>();
  crops.forEach(crop => {
    if (!map.has(crop.farmerId)) {
      map.set(crop.farmerId, {
        farmerId: crop.farmerId, farmerName: crop.farmerName,
        totalRevenue: 0, cropsDelivered: 0, pendingPayment: 0, paidAmount: 0, crops: [],
      });
    }
    const fr = map.get(crop.farmerId)!;
    orders.filter(o => o.cropId === crop.id && o.status === 'collected').forEach(order => {
      const revenue = order.amount * shares.farmer;
      fr.totalRevenue += revenue;
      fr.cropsDelivered += 1;
      fr.crops.push({
        cropId: crop.id, cropType: crop.type, packets: order.packets, revenue, status: crop.status,
        retailerName: order.retailerName, collectedAt: order.collectedAt,
        packetsDelivered: crop.packetsDelivered, packetsRemaining: crop.packetsRemaining,
      });
    });
  });
  map.forEach(fr => {
    fr.paidAmount = payments.filter(p => p.farmerId === fr.farmerId).reduce((s, p) => s + p.amount, 0);
    fr.pendingPayment = Math.max(0, fr.totalRevenue - fr.paidAmount);
  });
  return Array.from(map.values());
}

export function computeSystemMetrics(crops: Crop[], bookings: Booking[], orders: RetailerOrder[], shares: Shares = DEFAULT_SHARES): SystemMetrics {
  const totalRevenue = orders.filter(o => o.status === 'collected').reduce((s, o) => s + o.amount, 0);
  const productBreakdown: SystemMetrics['productBreakdown'] = {};

  crops.forEach(crop => {
    const pb = (productBreakdown[crop.type] ??= { totalPackets: 0, atHubs: 0, withRetailers: 0, inTransit: 0 });
    pb.totalPackets += crop.packets;
    pb.withRetailers += crop.packetsDelivered;
    if (crop.status === 'in_transit') pb.inTransit += crop.packets;
    else if (['delivered_to_hub', 'available_at_hub', 'ordered', 'collected'].includes(crop.status)) {
      pb.atHubs += Math.max(0, crop.packets - crop.packetsDelivered);
    }
  });

  return {
    totalFarmers: new Set(crops.map(c => c.farmerId)).size,
    totalCrops: crops.length,
    totalBookings: bookings.length,
    totalRevenue,
    cropsInTransit: crops.filter(c => c.status === 'in_transit').length,
    cropsAtHubs: crops.filter(c => ['delivered_to_hub', 'available_at_hub', 'ordered'].includes(c.status)).length,
    cropsCollected: crops.filter(c => c.status === 'collected').length,
    revenueByRole: { farmers: totalRevenue * shares.farmer, transporters: totalRevenue * shares.transporter, hubs: totalRevenue * shares.hub },
    productBreakdown,
  };
}

/** Shrink a photo in the browser so it fits inside a spreadsheet cell */
export async function compressImage(file: File, maxSide = 800, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
