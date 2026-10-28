import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./layouts/Layout";
import { useWorkspace } from "./components/WorkspaceProvider";
import OverviewPage from "./pages/OverviewPage";
import TransferPage from "./pages/TransferPage";
import TransactionsPage from "./pages/TransactionsPage";
import TransferDetailPage from "./pages/TransferDetailPage";
import UserManagementPage from "./pages/UserManagementPage";
import CreateAccountPage from "./pages/CreateAccountPage";
import LoginPage from "./pages/LoginPage";

// The export had a `Screen` union and a `setScreen` call, so nothing had a URL: a transfer
// receipt could not be linked, the back button left the app, and a refresh lost the screen.
// Every screen is a route here, and a transfer has an address of its own.

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
      <Route
        path="/"
        element={
          <Layout>
            <OverviewPage />
          </Layout>
        }
      />
      <Route
        path="/transfer"
        element={
          <Layout>
            <TransferPage />
          </Layout>
        }
      />
      <Route
        path="/transactions"
        element={
          <Layout>
            <TransactionsPage />
          </Layout>
        }
      />
      <Route
        path="/transactions/:id"
        element={
          <Layout>
            <TransferDetailPage />
          </Layout>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminRoute>
            <Layout>
              <UserManagementPage />
            </Layout>
          </AdminRoute>
        }
      />
      <Route
        path="/admin/users/new"
        element={
          <AdminRoute>
            <Layout>
              <CreateAccountPage />
            </Layout>
          </AdminRoute>
        }
      />

      {/* Outside the layout: signing in has no sidebar to sit in. */}
      <Route path="/login" element={<LoginPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default AppRoutes;
