import type {
  Crop, Booking, HubPoint, RetailerOrder, Complaint, Transporter, Category,
} from '../types';

export const seedTransporters: Transporter[] = [
  { id: '2', name: 'রহিম উদ্দিন (Rahim Uddin)', vehicleCapacity: 500, currentLoad: 0, availableCapacity: 500, location: 'Dhaka Route', status: 'available' },
];

export const seedCrops: Crop[] = [
  {
    id: '1', farmerId: '1', farmerName: 'আব্দুল করিম (Abdul Karim)',
    type: 'Potato', packets: 50, weightPerPacket: 10, totalWeight: 500,
    images: [],
    status: 'available_at_hub', predictedPrice: 25, location: 'Jessore, Bangladesh',
    qualityScore: 92, createdAt: '2025-06-15T00:00:00.000Z',
    revenueSharing: { farmer: 70, transporter: 20, hub: 10 },
    statusHistory: [{ status: 'available_at_hub', timestamp: '2025-06-19T00:00:00.000Z', updatedBy: 'hub_manager', location: 'Dhaka Central Hub' }],
    packetsDelivered: 30, packetsRemaining: 20,
    currentLocation: 'Hub - Available for Retailers', hubPointId: '1',
  },
  {
    id: '2', farmerId: '1', farmerName: 'আব্দুল করিম (Abdul Karim)',
    type: 'Tomato', packets: 30, weightPerPacket: 5, totalWeight: 150,
    images: [],
    status: 'available_at_hub', predictedPrice: 45, location: 'Jessore, Bangladesh',
    qualityScore: 88, createdAt: '2025-06-16T00:00:00.000Z',
    revenueSharing: { farmer: 70, transporter: 20, hub: 10 },
    statusHistory: [{ status: 'available_at_hub', timestamp: '2025-06-19T00:00:00.000Z', updatedBy: 'hub_manager', location: 'Dhaka Central Hub' }],
    packetsDelivered: 0, packetsRemaining: 30,
    currentLocation: 'Dhaka Central Hub', hubPointId: '1',
  },
];

export const seedBookings: Booking[] = [];

export const seedHubPoints: HubPoint[] = [
  { id: '1', name: 'Dhaka Central Hub', location: 'Dhaka, Bangladesh', capacity: 1000, currentStock: 0, managerId: '3',
    managerName: 'সালমা খাতুন (Salma Khatun)', expectedStock: 0, pendingOrders: 0, totalRevenue: 0, stockDetails: [] },
  { id: '2', name: 'Chittagong Hub', location: 'Chittagong, Bangladesh', capacity: 800, currentStock: 0, managerId: '3',
    managerName: 'সালমা খাতুন (Salma Khatun)', expectedStock: 0, pendingOrders: 0, totalRevenue: 0, stockDetails: [] },
];

export const seedRetailerOrders: RetailerOrder[] = [
  {
    id: 'order1', retailerId: '4', retailerName: 'নাসির আহমেদ (Nasir Ahmed)',
    cropId: '1', cropType: 'Potato', packets: 30, hubPointId: '1',
    status: 'collected', amount: 7500,
    createdAt: '2025-06-19T00:00:00.000Z', collectedAt: '2025-06-20T00:00:00.000Z',
  },
];

export const seedComplaints: Complaint[] = [];

export const seedCategories: Category[] = [
  { id: 'cat-vegetables', name: 'Vegetables', nameBn: 'সবজি', parentId: '', active: true },
  { id: 'cat-grains', name: 'Grains', nameBn: 'শস্য', parentId: '', active: true },
  { id: 'sub-potato', name: 'Potato', nameBn: 'আলু', parentId: 'cat-vegetables', active: true },
  { id: 'sub-onion', name: 'Onion', nameBn: 'পেঁয়াজ', parentId: 'cat-vegetables', active: true },
  { id: 'sub-carrot', name: 'Carrot', nameBn: 'গাজর', parentId: 'cat-vegetables', active: true },
  { id: 'sub-tomato', name: 'Tomato', nameBn: 'টমেটো', parentId: 'cat-vegetables', active: true },
  { id: 'sub-eggplant', name: 'Eggplant', nameBn: 'বেগুন', parentId: 'cat-vegetables', active: true },
  { id: 'sub-cucumber', name: 'Cucumber', nameBn: 'শসা', parentId: 'cat-vegetables', active: true },
  { id: 'sub-rice', name: 'Rice', nameBn: 'চাল', parentId: 'cat-grains', active: true },
];
