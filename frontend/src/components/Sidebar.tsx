import { NavLink, Link } from "react-router-dom";
import {
  ArrowLeftRight,
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  ScrollText,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/transfer", label: "Send money", icon: ArrowUpRight },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
];
const adminLinks = [
  { to: "/admin/access", label: "Account access", icon: ShieldCheck },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
];
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
        <Wallet className="size-7" />
        <span className="text-[23px] font-semibold tracking-tight">folio.</span>
      </Link>
      <div className="mx-4 mb-7 rounded-lg border bg-background p-3">
        <p className="text-xs font-medium">{user?.name}</p>
        <p className="mt-1 break-all text-[11px] text-muted-foreground">
          {user?.email}
        </p>
        <p className="mt-2 text-[11px] capitalize text-muted-foreground">
          {user?.role}
        </p>
      </div>
      <nav aria-label="Main navigation" className="space-y-1 px-3">
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
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
        {user?.role === "admin" && (
          <>
            <p className="px-3 pb-2 pt-7 text-[10px] font-medium tracking-widest text-muted-foreground">
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
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>
      <div className="mt-auto space-y-3 p-4 pt-8">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            signOut();
            onNavigate();
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
        <Button variant="ghost" className="w-full" onClick={toggleTheme}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
      </div>
    </aside>
  );
};
export default Sidebar;
