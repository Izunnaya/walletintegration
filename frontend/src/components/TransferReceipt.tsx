import { ArrowLeft, Check } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Transfer } from "@/api/types";

type Props = {
  transfer: Transfer;
  success?: boolean;
  onBack?: () => void;
  backLabel?: string;
};

const TransferReceipt = ({ transfer, success = false, onBack, backLabel }: Props) => {
  const rows: [string, string][] = [
    ["Direction", transfer.direction === "sent" ? "Sent" : "Received"],
    ["Counterparty", transfer.counterpartyName],
    ["Counterparty wallet", transfer.counterpartyWallet],
    ["Transfer reference", transfer.reference],
    ["Time", new Date(transfer.createdAt).toLocaleString()],
    ["Status", "Completed"],
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
          {backLabel ?? "Back to workspace"}
        </Button>
      )}

      <div className="my-6 flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
        <Check className="size-5" />
      </div>

      <h2 className="text-xl font-semibold">
        {success ? "Transfer completed" : "Transfer details"}
      </h2>
      <p className="my-5 text-4xl tracking-tight">{money(transfer.amountMinor)}</p>

      <dl className="flex flex-col gap-5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2 border-b pb-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all text-right">{value}</dd>
          </div>
        ))}
      </dl>

      {transfer.note && (
        <p className="mt-5 text-sm">
          <span className="text-muted-foreground">Note: </span>
          {transfer.note}
        </p>
      )}
    </motion.section>
  );
};

export default TransferReceipt;
