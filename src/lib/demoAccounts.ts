/**
 * Demo accounts for LOCAL / OFFLINE mode only (when VITE_APPS_SCRIPT_URL is not set).
 * This file is dynamically imported only in that mode and is excluded from
 * production builds that have a backend URL configured.
 */
import type { User } from '../types';

export const DEMO_ACCOUNTS: (User & { password: string })[] = [
  { id: '1', email: 'farmer@test.com',      password: 'farmer123',     name: 'আব্দুল করিম (Abdul Karim)',        role: 'farmer',      phone: '+8801711111111', location: 'Jessore, Bangladesh' },
  { id: '2', email: 'transporter@test.com', password: 'transport123',  name: 'রহিম উদ্দিন (Rahim Uddin)',        role: 'transporter', phone: '+8801722222222', location: 'Dhaka, Bangladesh' },
  { id: '3', email: 'hub@test.com',         password: 'hubmanager123', name: 'সালমা খাতুন (Salma Khatun)',       role: 'hub',         phone: '+8801733333333', location: 'Dhaka Hub Point' },
  { id: '4', email: 'retailer@test.com',    password: 'retail123',     name: 'নাসির আহমেদ (Nasir Ahmed)',        role: 'retailer',    phone: '+8801744444444', location: 'Dhaka Market' },
  { id: '5', email: 'admin@test.com',       password: 'admin123',      name: 'Dr. ফারহানা রহমান (Dr. Farhana)', role: 'admin',       phone: '+8801755555555', location: 'KrishiBazar AI HQ' },
];
