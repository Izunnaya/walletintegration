import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./layouts/Layout";
import { useWorkspace } from "./components/WorkspaceProvider";

// One chunk per screen. Opening the overview used to download the admin screens, both forms
// and the receipt as well; now it downloads the overview. The Suspense boundary that covers
// the gap lives in Layout, around the Outlet.
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const TransferPage = lazy(() => import("./pages/TransferPage"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage"));
const TransferDetailPage = lazy(() => import("./pages/TransferDetailPage"));
const UserManagementPage = lazy(() => import("./pages/UserManagementPage"));
const CreateAccountPage = lazy(() => import("./pages/CreateAccountPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));

// The export had a `Screen` union and a `setScreen` call, so nothing had a URL: a transfer
// receipt could not be linked, the back button left the app, and a refresh lost the screen.
// Every screen is a route here, and a transfer has an address of its own.
//
// Layout is a layout route with an <Outlet/> rather than a wrapper repeated inside each
// element. Two things follow from that: the sidebar and top bar stay mounted across a
// navigation instead of being torn down and rebuilt, and the layout can hold the single
// AnimatePresence that lets an outgoing screen finish its exit.

// The admin screens are behind a check rather than merely hidden from the nav, because a
// hidden link is not a restriction - the URL still worked. It is a client-side check and
// cosmetic by nature: /admin/* on the API requires an admin token, and that is the control
// that actually holds. This only stops the UI offering what the server would refuse.
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { role } = useWorkspace();
  return role === "admin" ? <>{children}</> : <Navigate to="/" replace />;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/transfer" element={<TransferPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/transactions/:id" element={<TransferDetailPage />} />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <UserManagementPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users/new"
          element={
            <AdminRoute>
              <CreateAccountPage />
            </AdminRoute>
          }
        />
      </Route>

      {/* Outside the layout, so it needs its own boundary. */}
      <Route
        path="/login"
        element={
          <Suspense fallback={null}>
            <LoginPage />
          </Suspense>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default AppRoutes;
