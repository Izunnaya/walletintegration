import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import GlobalProgressBar from "@/components/GlobalProgressBar";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import WorkspaceFooter from "@/components/WorkspaceFooter";

// Everything that repeats on every screen: the sidebar, the top bar, the footer, the toaster
// and the progress bar. A page renders its own content and nothing else, which is the point
// of having this file.

const titles: Record<string, string> = {
  "/": "Overview",
  "/transfer": "Transfer",
  "/transactions": "Transactions",
  "/admin/users": "User management",
  "/admin/users/new": "Create account",
};

function breadcrumb(pathname: string): string {
  if (titles[pathname]) return titles[pathname];
  if (pathname.startsWith("/transactions/")) return "Transfer details";
  return "Workspace";
}

const Layout = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <GlobalProgressBar />
      <Toaster position="bottom-right" />

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
        onOpenHelp={() => setHelpOpen(true)}
      />

      <div className="md:pl-[232px]">
        <header className="flex h-16 items-center justify-between border-b px-5 lg:px-10">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu />
            </Button>
            <span className="text-xs text-muted-foreground">Workspace</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-xs font-medium">{breadcrumb(pathname)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Demo workspace
          </div>
        </header>

        <main className="mx-auto max-w-[1240px] px-5 py-9 lg:px-10 lg:py-10">
          {/*
            mode="wait" so the outgoing screen finishes leaving before the next one arrives;
            overlapping them makes the page jump while both are in the layout. initial={false}
            so the first screen after a cold load is simply there, rather than animating in
            while the user is already looking at it.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>

          <WorkspaceFooter />
        </main>
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Welcome to your demo workspace</DialogTitle>
            <DialogDescription>
              Explore transfers using the demo recipients, create accounts, or manage user
              access. All changes are temporary and no real funds move.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Layout;
