import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
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
        eyebrow="YOUR WALLET"
        title={`Hello, ${session?.user.name ?? "there"}`}
        description="Your balance and latest transfers."
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
            userId={session?.user.id ?? ""}
          />
          <Button
            variant="outline"
            className="mb-6"
            disabled={walletQuery.isFetching}
            onClick={() => void walletQuery.refetch()}
          >
            Refresh balance
          </Button>
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
    </>
  );
};
export default OverviewPage;
