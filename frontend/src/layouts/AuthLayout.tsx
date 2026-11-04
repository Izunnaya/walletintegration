import { Outlet } from "react-router-dom";
import { Wallet } from "lucide-react";
import PageTransition from "@/components/PageTransition";

// The design signs people in on the page itself, not inside a card: a 384px column on the
// plain background, opened by the wallet mark alone. There is no wordmark here, because
// nothing on this screen needs branding more than the first line of text does.
const AuthLayout = () => (
  <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
    <PageTransition>
      <section className="w-full max-w-96">
        <Wallet className="mb-8 size-9" />
        <Outlet />
      </section>
    </PageTransition>
  </main>
);
export default AuthLayout;
