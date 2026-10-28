import { useTransfers } from "@/api/TransferApi";
import ApiFeedback from "@/components/ApiFeedback";
import PageHeading from "@/components/PageHeading";
import TransactionsTable from "@/components/TransactionsTable";
import {
  SlowRequestNotice,
  TransactionsTableSkeleton,
} from "@/components/LoadingStates";
import LoadingButton from "@/components/LoadingButton";

const TransactionsPage = () => {
  const query = useTransfers();
  return (
    <>
      <PageHeading
        title="Transactions"
        description="Completed transfers, newest first."
      />
      {query.isPending ? (
        <>
          <SlowRequestNotice />
          <TransactionsTableSkeleton />
        </>
      ) : (
        <>
          <ApiFeedback
            error={query.error}
            onRetry={() => {
              void (query.isFetchNextPageError
                ? query.fetchNextPage()
                : query.refetch());
            }}
          />
          <TransactionsTable transfers={query.transfers} full />
          {query.hasNextPage && (
            <LoadingButton
              className="mt-5"
              loading={query.isFetchingNextPage}
              loadingLabel="Loading transfers..."
              onClick={() => void query.fetchNextPage()}
            >
              Load older transfers
            </LoadingButton>
          )}
        </>
      )}
    </>
  );
};
export default TransactionsPage;
