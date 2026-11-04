import { NavLink, Link } from "react-router-dom";
import {
  ArrowLeftRight,
  ArrowUpRight,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  ScrollText,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/transfer", label: "Transfer", icon: ArrowUpRight },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
];
const adminLinks = [
  { to: "/admin/users", label: "User management", icon: Users },
  { to: "/admin/create", label: "Create account", icon: Plus },
  { to: "/admin/access", label: "Account access", icon: ShieldCheck },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
];

// Two letters from the name, which is what the design puts in the avatar. An email is the
// fallback because the name is the only field a user types freely, so it can arrive empty.
function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.trim() || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = { open: boolean; onNavigate: () => void };
const Sidebar = ({ open, onNavigate }: Props) => {
  const { theme, toggleTheme } = useTheme();
  const { session, signOut } = useAuth();
  const user = session?.user;
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 w-[232px] flex-col overflow-y-auto border-r bg-sidebar",
        open ? "flex" : "hidden md:flex",
      )}
    >
      <Link
        to="/"
        onClick={onNavigate}
        className="flex h-[84px] shrink-0 items-center gap-2.5 px-7"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
          <Wallet className="size-[18px]" strokeWidth={2.1} />
        </span>
        <span className="text-[23px] font-semibold tracking-[-1px]">
          folio<span className="text-muted-foreground">.</span>
        </span>
      </Link>
      <div className="mx-4 mb-7 flex items-center gap-3 rounded-lg border bg-background p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
          {initials(user?.name, user?.email)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">Personal wallet</p>
          <p className="mt-1 text-[11px] capitalize text-muted-foreground">
            {user?.role}
          </p>
        </div>
        <Lock className="size-3.5 shrink-0 text-muted-foreground" />
      </div>
      <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3">
        <p className="mb-2 px-3 text-[10px] font-medium tracking-[1.3px] text-muted-foreground">
          WORKSPACE
        </p>
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              cn("nav-item", isActive && "nav-active")
            }
          >
            <Icon className="size-[17px]" />
            {label}
          </NavLink>
        ))}
        {user?.role === "admin" && (
          <>
            <p className="mb-2 mt-8 px-3 text-[10px] font-medium tracking-[1.3px] text-muted-foreground">
              ADMINISTRATION
            </p>
            {adminLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn("nav-item", isActive && "nav-active")
                }
              >
                <Icon className="size-[17px]" />
                {label}
              </NavLink>
            ))}
          </>
        )}
        <button
          type="button"
          className="nav-item mt-4"
          onClick={() => {
            signOut();
            onNavigate();
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </button>
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
        <div className="mt-3 flex items-center gap-3 border-t pt-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {initials(user?.name, user?.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user?.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {user?.email}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </aside>
  );
};
export default Sidebar;
