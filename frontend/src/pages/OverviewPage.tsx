import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import BalanceCard from "@/components/BalanceCard";
import PageHeading from "@/components/PageHeading";
import PendingPanels from "@/components/PendingPanels";
import TransactionsTable from "@/components/TransactionsTable";
import { useMyWallet } from "@/api/WalletApi";
import { useTransfers } from "@/api/TransferApi";

const OverviewPage = () => {
  const { wallet, isPending: walletPending, isError, error } = useMyWallet();
  const { transfers, isPending: transfersPending } = useTransfers();

  if (walletPending || transfersPending) return <PendingPanels label="Loading wallet" />;

  if (isError || !wallet) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? "Your wallet could not be loaded. Try again in a moment."}
        </AlertDescription>
      </Alert>
    );
  }

  const restricted = wallet.status !== "active";

  return (
    <>
      <PageHeading
        eyebrow="YOUR PERSONAL WALLET"
        title="Good morning, Alex"
        description="A little clarity for your everyday money."
        action={
          // A restricted wallet gets a disabled button rather than a dead link, because a
          // link that goes nowhere is worse than a control that says it is unavailable.
          restricted ? (
            <Button disabled className="mt-5">
              <ArrowUpRight data-icon="inline-start" />
              Send money
            </Button>
          ) : (
            <Link to="/transfer" className={cn(buttonVariants(), "mt-5")}>
              <ArrowUpRight data-icon="inline-start" />
              Send money
            </Link>
          )
        }
      />

      {restricted && (
        <Alert className="mb-6">
          <AlertDescription>
            Your account is restricted. You can&apos;t send or receive transfers.
          </AlertDescription>
        </Alert>
      )}

      <BalanceCard wallet={wallet} transfers={transfers} />
      <TransactionsTable transfers={transfers} />

      <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        <span>A clear record. Every transfer, every time.</span>
        <span className="ml-auto hidden sm:block">NGN · Nigerian Naira</span>
      </div>
    </>
  );
};

export default OverviewPage;
