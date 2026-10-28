import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import Layout from "./layouts/Layout";
import AuthLayout from "./layouts/AuthLayout";
import { RouteFallback } from "./components/LoadingStates";

const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const TransferPage = lazy(() => import("./pages/TransferPage"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage"));
const TransferDetailPage = lazy(() => import("./pages/TransferDetailPage"));
const AccountAccessPage = lazy(() => import("./pages/AccountAccessPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const CreateAccountPage = lazy(() => import("./pages/CreateAccountPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

const RequireSession = () => {
  const { session, expired } = useAuth();
  const location = useLocation();
  return session ? (
    <Outlet />
  ) : (
    <Navigate
      to={expired ? "/login?expired=1" : "/login"}
      state={{ from: location.pathname }}
      replace
    />
  );
};
const RequireAdmin = () => {
  const { session } = useAuth();
  return session?.user.role === "admin" ? (
    <Outlet />
  ) : (
    <Navigate to="/" replace />
  );
};
const PublicAccountRoute = () => {
  const { session } = useAuth();
  return session ? <Navigate to="/" replace /> : <AuthLayout />;
};
const AppRoutes = () => (
  <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route element={<PublicAccountRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<CreateAccountPage />} />
      </Route>
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/transfer" element={<TransferPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/transactions/:id" element={<TransferDetailPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/access" element={<AccountAccessPage />} />
            <Route path="/admin/audit" element={<AuditLogPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);
export default AppRoutes;
