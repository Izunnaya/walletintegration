import { useState } from "react";
import { useLocation } from "react-router-dom";
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
import Sidebar from "@/components/Sidebar";
import WorkspaceFooter from "@/components/WorkspaceFooter";

// Everything that repeats on every screen: the sidebar, the top bar, the footer and the
// toaster. A page renders its own content and nothing else, which is the point of having
// this file.

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

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
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
          {/* Keyed on the path so the entrance animation replays when the route changes. */}
          <div key={pathname} className="page-enter">
            {children}
          </div>
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
