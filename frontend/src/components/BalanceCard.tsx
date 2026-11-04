import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Copy,
  Wallet as WalletIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { notify } from "@/lib/notify";
import { money, moneyParts } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Transfer, Wallet } from "@/api/contracts";

// The three tiles across the foot of the card. The design labels them THIS MONTH, which the
// API cannot answer - there is no aggregate endpoint, only the cursor-paged transfer list.
// They are summed from the transfers already loaded and labelled for that range instead, so
// the number and its caption agree.
function totals(transfers: Transfer[]) {
  let inbound = 0n;
  let outbound = 0n;
  for (const transfer of transfers) {
    if (transfer.direction === "received") inbound += BigInt(transfer.amountMinor);
    else outbound += BigInt(transfer.amountMinor);
  }
  return { inbound, outbound, count: transfers.length };
}

const tileBorders =
  "border-b px-6 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:px-7";

const Tile = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ArrowDownLeft;
  label: string;
  value: string;
}) => (
  <div className={`flex items-start gap-3 ${tileBorders}`}>
    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
      <Icon className="size-3.5 text-muted-foreground" />
    </span>
    <div>
      <p className="text-[11px] text-muted-foreground">
        {label}
        <span className="ml-2 text-[9px] text-muted-foreground/70">RECENT</span>
      </p>
      <p className="mt-2 text-xl font-medium tracking-tight">{value}</p>
    </div>
  </div>
);

const BalanceCard = ({
  wallet,
  transfers,
}: {
  wallet: Wallet;
  transfers: Transfer[];
}) => {
  const walletId = wallet.publicId ?? wallet.id;
  const balance = moneyParts(wallet.balanceMinor);
  const summary = totals(transfers);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(walletId);
      notify.success("Wallet ID copied");
    } catch {
      notify.error(null, "Select the wallet ID to copy it manually.");
    }
  };
  return (
    <motion.section
      className="mb-7 overflow-hidden rounded-xl border bg-card"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      transition={easeOut}
    >
      <div className="flex flex-col justify-between gap-8 p-6 sm:flex-row lg:p-7">
        <div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <WalletIcon className="size-4" />
            Available balance
          </p>
          <motion.div
            key={wallet.balanceMinor}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-5 flex items-baseline gap-3"
          >
            <span className="text-[44px] font-medium leading-none tracking-[-2px] sm:text-[50px]">
              {balance.whole}
              <span className="text-muted-foreground/60">
                .{balance.fraction}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {wallet.currency}
            </span>
          </motion.div>
          <p className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Available to send
          </p>
        </div>
        <div className="flex flex-col items-start justify-end gap-6 sm:items-end">
          <div className="rounded-lg border bg-muted/35 px-4 py-3">
            <p className="mb-2 text-[10px] font-medium tracking-[0.05em] text-muted-foreground">
              WALLET ID
            </p>
            <div className="flex items-center gap-5">
              <code className="break-all text-xs">{walletId}</code>
              <button
                type="button"
                aria-label="Copy wallet ID"
                onClick={copy}
                className="flex shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="grid border-t bg-muted/20 sm:grid-cols-3">
        <Tile
          icon={ArrowDownLeft}
          label="Money in"
          value={money(summary.inbound)}
        />
        <Tile
          icon={ArrowUpRight}
          label="Money out"
          value={money(summary.outbound)}
        />
        <Tile
          icon={ArrowLeftRight}
          label="Transactions"
          value={String(summary.count)}
        />
      </div>
    </motion.section>
  );
};
export default BalanceCard;
