import { describe, it, expect } from 'vitest';
import {
  buildStatusPatch, applyOrderToCrop, applyCollectionToCrop, applyCancelToCrop, fitImages, deriveHubs,
  computeFarmerRevenues, computeSystemMetrics, PLACEHOLDER_IMAGE, MAX_IMAGES_CHARS, MAX_HISTORY,
} from '../src/lib/domain';
import type { Crop, RetailerOrder, HubPoint, Payment } from '../src/types';

const crop = (over: Partial<Crop> = {}): Crop => ({
  id: 'c1', farmerId: '1', farmerName: 'Karim', type: 'Potato', packets: 50, weightPerPacket: 10, totalWeight: 500,
  images: [], status: 'available_at_hub', predictedPrice: 25, location: 'Jessore', qualityScore: 90,
  createdAt: '2026-01-01T00:00:00.000Z', revenueSharing: { farmer: 70, transporter: 20, hub: 10 },
  statusHistory: [], packetsDelivered: 0, packetsRemaining: 50, currentLocation: 'Hub', hubPointId: '1', ...over,
});
const order = (over: Partial<RetailerOrder> = {}): RetailerOrder => ({
  id: 'o1', retailerId: '4', retailerName: 'Nasir', cropId: 'c1', cropType: 'Potato', packets: 30, hubPointId: '1',
  status: 'pre_booked', amount: 7500, createdAt: '2026-01-02T00:00:00.000Z', ...over,
});
const hub = (): HubPoint => ({
  id: '1', name: 'Dhaka', location: 'Dhaka', capacity: 1000, currentStock: 999, managerId: '3', managerName: 'S',
  expectedStock: 999, pendingOrders: 999, totalRevenue: 999, stockDetails: [],
});

describe('buildStatusPatch', () => {
  it('appends history, sets location and timestamps', () => {
    const p = buildStatusPatch(crop(), 'delivered_to_hub', { hubName: 'Dhaka', updatedBy: 'transporter' }, '2026-02-01T00:00:00.000Z');
    expect(p.status).toBe('delivered_to_hub');
    expect(p.currentLocation).toBe('Hub - Dhaka');
    expect(p.deliveredToHubTime).toBe('2026-02-01T00:00:00.000Z');
    expect(p.statusHistory).toHaveLength(1);
  });
  it('caps history length', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ status: 'booked' as const, timestamp: String(i), updatedBy: 'x', location: 'y' }));
    expect(buildStatusPatch(crop({ statusHistory: history }), 'in_transit').statusHistory).toHaveLength(MAX_HISTORY);
  });
});

describe('order → crop stock (no double decrement)', () => {
  it('partial order keeps the crop orderable and reduces remaining once', () => {
    const p = applyOrderToCrop(crop(), 30, 'Nasir');
    expect(p.packetsRemaining).toBe(20);
    expect(p.status).toBeUndefined();
  });
  it('ordering the last packets marks the crop as ordered', () => {
    const p = applyOrderToCrop(crop({ packetsRemaining: 20 }), 20, 'Nasir');
    expect(p.packetsRemaining).toBe(0);
    expect(p.status).toBe('ordered');
  });
  it('collection increments delivered and only completes when everything is delivered', () => {
    expect(applyCollectionToCrop(crop(), order({ packets: 30 }))).toEqual({ packetsDelivered: 30 });
    const done = applyCollectionToCrop(crop({ packetsDelivered: 30 }), order({ packets: 20 }));
    expect(done.status).toBe('collected');
    expect(done.packetsDelivered).toBe(50);
  });
  it('ordering then collecting the same packets leaves remaining untouched by collection', () => {
    const afterOrder = { ...crop(), ...applyOrderToCrop(crop(), 30, 'N') } as Crop;
    const afterCollect = { ...afterOrder, ...applyCollectionToCrop(afterOrder, order({ packets: 30 })) } as Crop;
    expect(afterCollect.packetsRemaining).toBe(20);
    expect(afterCollect.packetsDelivered).toBe(30);
  });
});

describe('fitImages (Google Sheets 50k-char cell limit)', () => {
  it('stores nothing for a product without photos — the UI shows the bundled fallback, never a stored placeholder', () => {
    expect(fitImages([])).toEqual([]);
    expect(fitImages([PLACEHOLDER_IMAGE])).toEqual([]);
  });
  it('keeps small image sets unchanged, at most 3', () => {
    expect(fitImages(['a', 'b'])).toEqual(['a', 'b']);
    expect(fitImages(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
  });
  it('drops to the first image when the set is too large', () => {
    const big = 'x'.repeat(MAX_IMAGES_CHARS - 100);
    expect(fitImages([big, big])).toEqual([big]);
  });
  it('stores no image when even one is too large', () => {
    expect(fitImages(['x'.repeat(MAX_IMAGES_CHARS + 10)])).toEqual([]);
  });
});

describe('order cancellation', () => {
  it('returns packets to stock and re-opens a fully ordered product', () => {
    const fully = crop({ status: 'ordered', packetsRemaining: 0 });
    const p = applyCancelToCrop(fully, 10);
    expect(p.packetsRemaining).toBe(10);
    expect(p.status).toBe('available_at_hub');
  });
  it('never exceeds the original packet count and leaves an open product open', () => {
    const p = applyCancelToCrop(crop({ packetsRemaining: 45 }), 30);
    expect(p.packetsRemaining).toBe(50);
    expect(p.status).toBeUndefined();
  });
});

describe('configurable revenue shares', () => {
  it('uses the shares from platform settings', () => {
    const shares = { farmer: 0.5, transporter: 0.3, hub: 0.2 };
    const m = computeSystemMetrics([crop()], [], [order({ status: 'collected', amount: 1000 })], shares);
    expect(m.revenueByRole).toEqual({ farmers: 500, transporters: 300, hubs: 200 });
    const [fr] = computeFarmerRevenues([crop()], [order({ status: 'collected', amount: 1000 })], [], shares);
    expect(fr.totalRevenue).toBe(500);
  });
  it('cancelled orders count neither as pending nor as revenue', () => {
    const [h] = deriveHubs([hub()], [crop()], [order({ status: 'cancelled', packets: 9, amount: 999 })]);
    expect(h.pendingOrders).toBe(0);
    expect(h.totalRevenue).toBe(0);
  });
});

describe('deriveHubs', () => {
  it('ignores stored counters and derives them from crops and orders', () => {
    const crops = [
      crop({ id: 'a', packetsDelivered: 30, packetsRemaining: 20 }),                       // 20 physically at hub
      crop({ id: 'b', status: 'in_transit', packets: 40 }),                                 // expected
      crop({ id: 'c', status: 'delivered_to_hub', packets: 10 }),                           // expected (not yet received)
      crop({ id: 'd', status: 'collected', packets: 5, packetsDelivered: 5, packetsRemaining: 0 }),
    ];
    const orders = [
      order({ id: '1', status: 'pre_booked', packets: 5 }),
      order({ id: '2', status: 'pre_paid', packets: 3 }),
      order({ id: '3', status: 'collected', packets: 30, amount: 7500 }),
    ];
    const [h] = deriveHubs([hub()], crops, orders);
    expect(h.currentStock).toBe(20);
    expect(h.expectedStock).toBe(50);
    expect(h.pendingOrders).toBe(8);
    expect(h.totalRevenue).toBe(7500);
  });
});

describe('revenue and metrics', () => {
  it('farmer gets 70% of collected orders, minus payments already made', () => {
    const payments: Payment[] = [{ id: 'p', farmerId: '1', amount: 1000, processedAt: 'x', status: 'processed' }];
    const [fr] = computeFarmerRevenues([crop()], [order({ status: 'collected', amount: 7500 }), order({ id: 'o2', status: 'pre_paid', amount: 999 })], payments);
    expect(fr.totalRevenue).toBe(5250);
    expect(fr.paidAmount).toBe(1000);
    expect(fr.pendingPayment).toBe(4250);
  });
  it('pending payment never goes negative', () => {
    const [fr] = computeFarmerRevenues([crop()], [order({ status: 'collected', amount: 100 })],
      [{ id: 'p', farmerId: '1', amount: 5000, processedAt: 'x', status: 'processed' }]);
    expect(fr.pendingPayment).toBe(0);
  });
  it('system revenue only counts collected orders and splits 70/20/10', () => {
    const m = computeSystemMetrics([crop()], [], [order({ status: 'collected', amount: 1000 }), order({ id: 'x', status: 'pre_booked', amount: 5000 })]);
    expect(m.totalRevenue).toBe(1000);
    expect(m.revenueByRole).toEqual({ farmers: 700, transporters: 200, hubs: 100 });
  });
});
