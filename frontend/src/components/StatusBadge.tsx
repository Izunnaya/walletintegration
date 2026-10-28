import { Badge } from "@/components/ui/badge";
import type { WalletStatus } from "@/api/types";

// The colour is chosen in App.css from the data-status attribute rather than from a map of
// classes here, so a new status needs one CSS rule and no component change.
const labels: Record<WalletStatus | "completed", string> = {
  active: "Active",
  blocked: "Blocked",
  blacklisted: "Blacklisted",
  completed: "Completed",
};

const StatusBadge = ({ status }: { status: WalletStatus | "completed" }) => (
  <Badge variant="outline" data-status={labels[status]} className="status-badge">
    <span className="size-1.5 rounded-full bg-current" />
    {labels[status]}
  </Badge>
);

export default StatusBadge;
