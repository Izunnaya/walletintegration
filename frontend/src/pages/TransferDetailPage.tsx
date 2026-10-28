import { useNavigate, useParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import PendingPanels from "@/components/PendingPanels";
import TransferReceipt from "@/components/TransferReceipt";
import { useTransfer } from "@/api/TransferApi";

// A transfer having its own URL is the reason this page exists. In the export the receipt was
// a state variable, so it could not be linked, bookmarked or reloaded, and the browser's back
// button left the application entirely.
const TransferDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { transfer, isPending, isError, error } = useTransfer(id);
  const navigate = useNavigate();

  if (isPending) return <PendingPanels label="Loading transfer" />;

  if (isError || !transfer) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? "That transfer could not be found."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TransferReceipt
      transfer={transfer}
      onBack={() => navigate("/transactions")}
      backLabel="Back to transactions"
    />
  );
};

export default TransferDetailPage;
