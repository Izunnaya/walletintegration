import { ArrowLeft, Check } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Transfer } from "@/api/contracts";
type Props = {
  transfer: Transfer;
  success?: boolean;
  onBack?: () => void;
  backLabel?: string;
};
const TransferReceipt = ({
  transfer,
  success = false,
  onBack,
  backLabel,
}: Props) => {
  const rows = [
    ["Transfer ID", transfer.id],
    ["Direction", transfer.direction === "sent" ? "Sent" : "Received"],
    ["Source wallet", transfer.sourceWalletId],
    ["Destination wallet", transfer.destinationWalletId],
    ["Reference", transfer.reference],
    ["Time", new Date(transfer.createdAt).toLocaleString()],
    ["Currency", transfer.currency],
  ];
  return (
    <motion.section
      className="max-w-xl rounded-xl border bg-card p-6"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      transition={easeOut}
    >
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          {backLabel ?? "Back to transfers"}
        </Button>
      )}
      <Check className="my-6 size-9 text-success" />
      <h2 className="text-xl font-semibold">
        {success ? "Transfer completed" : "Transfer details"}
      </h2>
      <p className="my-5 break-all text-4xl tracking-tight">
        {money(transfer.amountMinor)}
      </p>
      <dl className="space-y-4 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-wrap justify-between gap-2 border-b pb-3"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </motion.section>
  );
};
export default TransferReceipt;
