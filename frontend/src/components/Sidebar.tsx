import { NavLink, Link } from "react-router-dom";
import {
  ArrowLeftRight,
  ArrowUpRight,
  CircleHelp,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { cn } from "@/lib/utils";

// NavLink rather than a button and a comparison. It knows which route is current, so the
// active style and aria-current come from the router instead of a state variable that has to
// be kept in step with it.

const workspaceLinks = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/transfer", label: "Transfer", icon: ArrowUpRight },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
];

const adminLinks = [
  { to: "/admin/users", label: "User management", icon: Users },
  { to: "/admin/users/new", label: "Create account", icon: Plus },
];

type Props = {
  open: boolean;
  onNavigate: () => void;
  onOpenHelp: () => void;
};

const SidebarLink = ({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof Wallet;
  onNavigate: () => void;
}) => (
  <NavLink
    to={to}
    end
    onClick={onNavigate}
    className={({ isActive }) => cn("nav-item", isActive && "nav-active")}
  >
    {({ isActive }) => (
      <>
        <Icon className="size-[17px]" />
        {label}
        {isActive && <span className="ml-auto size-1.5 rounded-full bg-foreground" />}
      </>
    )}
  </NavLink>
);

const Sidebar = ({ open, onNavigate, onOpenHelp }: Props) => {
  const { role, theme, toggleTheme } = useWorkspace();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r bg-sidebar transition-transform md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <Link to="/" onClick={onNavigate} className="flex h-[84px] items-center gap-2.5 px-7">
        <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
          <Wallet className="size-4.5" strokeWidth={2.1} />
        </span>
        <span className="text-[23px] font-semibold tracking-[-1px]">
          folio<span className="text-muted-foreground">.</span>
        </span>
      </Link>

      <div className="mx-4 mb-7 flex items-center gap-3 rounded-lg border bg-background px-3 py-3">
        <span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold">
          AM
        </span>
        <div className="flex-1">
          <p className="text-xs font-medium">Personal workspace</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Demo account</p>
        </div>
        <LockKeyhole className="size-3.5 text-muted-foreground" />
      </div>

      <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3">
        <p className="mb-2 px-3 text-[10px] font-medium tracking-[1.3px] text-muted-foreground">
          WORKSPACE
        </p>
        {workspaceLinks.map((link) => (
          <SidebarLink key={link.to} {...link} onNavigate={onNavigate} />
        ))}

        {role === "admin" && (
          <>
            <p className="mb-2 mt-8 px-3 text-[10px] font-medium tracking-[1.3px] text-muted-foreground">
              ADMINISTRATION
            </p>
            {adminLinks.map((link) => (
              <SidebarLink key={link.to} {...link} onNavigate={onNavigate} />
            ))}
          </>
        )}

        <NavLink to="/login" onClick={onNavigate} className="nav-item mt-4">
          <LockKeyhole className="size-4" />
          Sign in
        </NavLink>
      </nav>

      <div className="mt-auto px-4 pb-4">
        <div className="mb-5 rounded-lg border p-3.5">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="size-4" />
            A little peace of mind.
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Your money, with a clearer view.
            <br />
            Every movement accounted for.
          </p>
        </div>

        <button type="button" className="nav-item w-full" onClick={onOpenHelp}>
          <CircleHelp className="size-4" />
          Help &amp; support
          <ArrowUpRight className="ml-auto size-3.5" />
        </button>

        <div className="mt-3 flex items-center gap-3 border-t pt-4">
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
            AM
          </span>
          <div className="flex-1">
            <p className="text-xs font-medium">Alex Morgan</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">alex@studio.co</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Toggle dark mode" onClick={toggleTheme}>
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
