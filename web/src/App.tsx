import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { useCallback } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { queryClient, useMe } from "./api";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { LivingPage } from "./pages/LivingPage";
import { MePage } from "./pages/MePage";
import { PrayerPage } from "./pages/PrayerPage";
import { TestimoniesPage } from "./pages/TestimoniesPage";
import { TestimonyDetailPage } from "./pages/TestimonyDetailPage";
import { useTelegramInit } from "./telegram";

/** Client-side guard for the admin UI. The server enforces admin-only actions regardless. */
function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { data: me } = useMe();
  return me?.isAdmin ? children : <Navigate to="/" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="prayer" element={<PrayerPage />} />
        <Route path="living" element={<LivingPage />} />
        <Route path="testimonies" element={<TestimoniesPage />} />
        <Route path="testimonies/:id" element={<TestimonyDetailPage />} />
        <Route path="me" element={<MePage />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  // tg.ready() + tg.expand() on mount; refetch stale data when the user returns to the app.
  useTelegramInit(useCallback(() => focusManager.setFocused(true), []));

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <AppRoutes />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
