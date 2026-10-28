import { Copy, Wallet as WalletIcon } from "lucide-react";
import { motion } from "framer-motion";
import { notify } from "@/lib/notify";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Wallet } from "@/api/contracts";

const BalanceCard = ({
  wallet,
  userId,
}: {
  wallet: Wallet;
  userId: string;
}) => {
  const walletId = wallet.publicId ?? wallet.id;
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
      className="mb-7 overflow-hidden rounded-xl border bg-card p-6 lg:p-7"
      variants={panelVariants}
      initial="initial"
      animate="animate"
      transition={easeOut}
    >
      <div className="flex flex-col justify-between gap-8 sm:flex-row">
        <div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <WalletIcon className="size-4" />
            Wallet balance
          </p>
          <motion.p
            key={wallet.balanceMinor}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-5 break-all text-4xl font-medium tracking-tight sm:text-5xl"
          >
            {money(wallet.balanceMinor)}
          </motion.p>
          <p className="mt-4 text-xs text-muted-foreground">
            {wallet.currency} · Nigerian Naira
          </p>
        </div>
        <dl className="space-y-4 text-xs">
          <div>
            <dt className="text-muted-foreground">Wallet ID</dt>
            <dd className="mt-2 flex items-center gap-3">
              <code className="break-all">{walletId}</code>
              <button aria-label="Copy wallet ID" onClick={copy}>
                <Copy className="size-4" />
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Your user ID</dt>
            <dd className="mt-2 font-mono">{userId}</dd>
          </div>
        </dl>
      </div>
    </motion.section>
  );
};
export default BalanceCard;
