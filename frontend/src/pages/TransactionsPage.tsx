import { Alert, AlertDescription } from "@/components/ui/alert";
import PageHeading from "@/components/PageHeading";
import PendingPanels from "@/components/PendingPanels";
import TransactionsTable from "@/components/TransactionsTable";
import { useTransfers } from "@/api/TransferApi";

const TransactionsPage = () => {
  const { transfers, isPending, isError, error } = useTransfers();

  if (isPending) return <PendingPanels label="Loading transactions" />;

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? "Your transactions could not be loaded."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeading title="Transactions" description="Every movement, all in one place." />
      <TransactionsTable transfers={transfers} full />
    </>
  );
};

export default TransactionsPage;
