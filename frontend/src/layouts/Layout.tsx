import { Suspense, useState } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteFallback } from "@/components/LoadingStates";
import GlobalProgressBar from "@/components/GlobalProgressBar";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import WorkspaceFooter from "@/components/WorkspaceFooter";

const titles: Record<string, string> = {
  "/": "Overview",
  "/transfer": "Send money",
  "/transactions": "Transactions",
  "/admin/access": "Account access",
  "/admin/audit": "Audit log",
};
const Layout = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();
  const outlet = useOutlet();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <GlobalProgressBar />
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/25 md:hidden"
        />
      )}
      <Sidebar
        open={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
      />
      <div className="md:pl-[232px]">
        <header className="flex h-16 items-center gap-3 border-b px-5 lg:px-10">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu />
          </Button>
          <span className="text-xs text-muted-foreground">Wallet</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-xs font-medium">
            {titles[pathname] ?? "Transfer details"}
          </span>
        </header>
        <main className="mx-auto max-w-[1240px] px-5 py-9 lg:px-10 lg:py-10">
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={pathname}>
              <Suspense fallback={<RouteFallback />}>{outlet}</Suspense>
            </PageTransition>
          </AnimatePresence>
          <WorkspaceFooter />
        </main>
      </div>
    </div>
  );
};
export default Layout;
