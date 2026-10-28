import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Copy, Wallet } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { notify } from "@/lib/notify";
import StatusBadge from "@/components/StatusBadge";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Transfer, WalletUser } from "@/api/types";

const SummaryTile = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) => (
  <div className="flex items-start gap-3 border-b px-6 py-5 last:border-0 sm:border-r sm:border-b-0 lg:px-7">
    <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg border bg-background">
      <Icon className="size-3.5 text-muted-foreground" />
    </span>
    <div>
      <p className="text-[11px] text-muted-foreground">
        {label}
        <span className="ml-2 text-[9px] text-muted-foreground/70">THIS MONTH</span>
      </p>
      <p className="mt-2 text-xl font-medium tracking-tight">{value}</p>
    </div>
  </div>
);

// Sums are computed with BigInt and never with Number. The balances are minor units as
// strings, and adding them as numbers would start losing the last kobo somewhere above nine
// quadrillion - which is the same reason the API sends them as strings in the first place.
function totalFor(transfers: Transfer[], direction: Transfer["direction"]): string {
  const total = transfers
    .filter((transfer) => transfer.direction === direction && transfer.status === "completed")
    .reduce((sum, transfer) => sum + BigInt(transfer.amountMinor), 0n);
  return money(total);
}

const BalanceCard = ({ wallet, transfers }: { wallet: WalletUser; transfers: Transfer[] }) => {
  const copyWalletId = async () => {
    try {
      await navigator.clipboard.writeText(wallet.id);
      notify.success("Wallet ID copied");
    } catch {
      // The clipboard API is refused without a user gesture and over plain http, so this is
      // a real path rather than a defensive catch.
      notify.error(null, "Could not copy. Please select the wallet ID manually.");
    }
  };

  const [whole, fraction] = money(wallet.balanceMinor).split(".");

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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wallet className="size-4" />
            Available balance
          </div>
          <div className="mt-5 flex items-baseline gap-3">
            {/*
              Keyed on the balance, so a transfer settling swaps the old figure for the new
              one rather than having it blink. This is the only place in the app where motion
              is doing more than easing something in: money changing is the one thing on
              screen that genuinely is an event.
            */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={wallet.balanceMinor}
                className="text-[44px] font-medium leading-none tracking-[-2px] sm:text-[50px]"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={easeOut}
              >
                {whole}
                <span className="text-muted-foreground/60">.{fraction}</span>
              </motion.span>
            </AnimatePresence>
            <span className="text-xs text-muted-foreground">NGN</span>
          </div>
          <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Available to send
          </div>
        </div>

        <div className="flex flex-col items-start justify-between gap-6 sm:items-end">
          <StatusBadge status={wallet.status} />
          <div className="rounded-lg border bg-muted/35 px-4 py-3">
            <p className="mb-2 text-[10px] font-medium tracking-wider text-muted-foreground">
              WALLET ID
            </p>
            <div className="flex items-center gap-5">
              <code className="text-xs">{wallet.id}</code>
              <button
                type="button"
                aria-label="Copy wallet ID"
                onClick={copyWalletId}
                className="text-muted-foreground hover:text-foreground"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid border-t bg-muted/20 sm:grid-cols-3">
        <SummaryTile icon={ArrowDownLeft} label="Money in" value={totalFor(transfers, "received")} />
        <SummaryTile icon={ArrowUpRight} label="Money out" value={totalFor(transfers, "sent")} />
        <SummaryTile
          icon={ArrowLeftRight}
          label="Transactions"
          value={String(transfers.length).padStart(2, "0")}
        />
      </div>
    </motion.section>
  );
};

export default BalanceCard;
