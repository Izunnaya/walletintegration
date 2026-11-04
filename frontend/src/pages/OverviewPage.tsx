import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useMyWallet } from "@/api/WalletApi";
import { useTransfers } from "@/api/TransferApi";
import ApiFeedback from "@/components/ApiFeedback";
import BalanceCard from "@/components/BalanceCard";
import PageHeading from "@/components/PageHeading";
import TransactionsTable from "@/components/TransactionsTable";
import {
  BalanceCardSkeleton,
  SlowRequestNotice,
  TransactionsTableSkeleton,
} from "@/components/LoadingStates";
import { Button, buttonVariants } from "@/components/ui/button";

const OverviewPage = () => {
  const { session } = useAuth();
  const walletQuery = useMyWallet();
  const history = useTransfers();
  return (
    <>
      <PageHeading
        eyebrow="YOUR PERSONAL WALLET"
        title={`Hello, ${session?.user.name ?? "there"}`}
        description="A little clarity for your everyday money."
        action={
          <Link to="/transfer" className={buttonVariants()}>
            <ArrowUpRight />
            Send money
          </Link>
        }
      />
      {walletQuery.isPending ? (
        <>
          <SlowRequestNotice />
          <BalanceCardSkeleton />
        </>
      ) : walletQuery.wallet ? (
        <>
          <BalanceCard
            wallet={walletQuery.wallet}
            transfers={history.transfers}
          />
          <ApiFeedback error={walletQuery.error} />
        </>
      ) : (
        <ApiFeedback
          error={walletQuery.error}
          onRetry={() => void walletQuery.refetch()}
        />
      )}
      {history.isPending ? (
        <TransactionsTableSkeleton />
      ) : history.isError ? (
        <ApiFeedback
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      ) : (
        <TransactionsTable transfers={history.transfers} />
      )}
      <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" />
        <span>A clear record. Every transfer, every time.</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={walletQuery.isFetching}
          onClick={() => void walletQuery.refetch()}
        >
          Refresh balance
        </Button>
      </div>
    </>
  );
};
export default OverviewPage;
