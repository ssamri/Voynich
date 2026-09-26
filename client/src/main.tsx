import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Spinner, Toaster } from './components/ui';
import AuthPage from './pages/AuthPage';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Providers = lazy(() => import('./pages/Providers'));
const Agents = lazy(() => import('./pages/Agents'));
const Sessions = lazy(() => import('./pages/Sessions'));
const SessionRoom = lazy(() => import('./pages/SessionRoom'));
const Library = lazy(() => import('./pages/Library'));
const MemoryPage = lazy(() => import('./pages/Memory'));
const Corpus = lazy(() => import('./pages/Corpus'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Lab = lazy(() => import('./pages/Lab'));
const Manuscript = lazy(() => import('./pages/Manuscript'));

function Gate() {
  const { loading, user } = useAuth();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-fg-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (!user) return <AuthPage />;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-fg-400">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="providers" element={<Providers />} />
          <Route path="agents" element={<Agents />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:id" element={<SessionRoom />} />
          <Route path="library" element={<Library />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="corpus" element={<Corpus />} />
          <Route path="lab" element={<Lab />} />
          <Route path="manuscript" element={<Manuscript />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Gate />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
