import { Link, Outlet } from "react-router-dom";
import { Wallet } from "lucide-react";
import PageTransition from "@/components/PageTransition";
const AuthLayout = () => (
  <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground">
    <PageTransition>
      <section className="w-full max-w-md rounded-2xl border bg-card p-6 sm:p-9">
        <Link
          to="/login"
          className="mb-8 inline-flex items-center gap-2 text-xl font-semibold"
        >
          <Wallet className="size-7" />
          folio.
        </Link>
        <Outlet />
      </section>
    </PageTransition>
  </main>
);
export default AuthLayout;
