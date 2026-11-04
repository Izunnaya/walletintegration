import { useTransfers } from "@/api/TransferApi";
import ApiFeedback from "@/components/ApiFeedback";
import PageHeading from "@/components/PageHeading";
import TransactionsTable from "@/components/TransactionsTable";
import {
  SlowRequestNotice,
  TransactionsTableSkeleton,
} from "@/components/LoadingStates";

const TransactionsPage = () => {
  const query = useTransfers();
  return (
    <>
      <PageHeading
        title="Transactions"
        description="Every movement, all in one place."
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
          {/* The design pages this table rather than appending to it, so the next button
              owns fetching the following cursor page. */}
          <TransactionsTable
            transfers={query.transfers}
            pages={query.data?.pages.map((apiPage) => apiPage.transfers) ?? []}
            full
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
          />
        </>
      )}
    </>
  );
};
export default TransactionsPage;
