import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import PrivateRoute from './components/layout/PrivateRoute';
import { LoadingSpinner } from './components/ui';

import Login                from './pages/Login';
import FarmerDashboard      from './pages/FarmerDashboard';
import TransporterDashboard from './pages/TransporterDashboard';
import HubDashboard         from './pages/HubDashboard';
import RetailerDashboard    from './pages/RetailerDashboard';
import AdminDashboard       from './pages/AdminDashboard';
import ConsumerComplaint    from './pages/ConsumerComplaint';

// ── Role-based dashboard router ───────────────────────────────────────────────

function DashboardRouter() {
  const { user } = useAuth();
  switch (user?.role) {
    case 'farmer':      return <FarmerDashboard />;
    case 'transporter': return <TransporterDashboard />;
    case 'hub':         return <HubDashboard />;
    case 'retailer':    return <RetailerDashboard />;
    case 'admin':       return <AdminDashboard />;
    default:            return <Navigate to="/login" replace />;
  }
}

// ── App content (inside providers) ───────────────────────────────────────────

function AppContent() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner message="Starting KrishiBazar AI..." />;

  return (
    <Routes>
      {/* Public */}
      <Route path="/login"                   element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/complaint/:retailerId"   element={<ConsumerComplaint />} />

      {/* Protected */}
      <Route path="/dashboard" element={
        <PrivateRoute>
          <DashboardRouter />
        </PrivateRoute>
      } />

      {/* Fallback */}
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <DataProvider>
          <HashRouter>
            <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
              <AppContent />
            </div>
          </HashRouter>
        </DataProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
