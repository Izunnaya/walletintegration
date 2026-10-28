import { useNavigate, useParams } from "react-router-dom";
import ApiFeedback from "@/components/ApiFeedback";
import { ReceiptSkeleton, SlowRequestNotice } from "@/components/LoadingStates";
import TransferReceipt from "@/components/TransferReceipt";
import { useTransfer } from "@/api/TransferApi";

const TransferDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { transfer, isPending, isError, error, refetch } = useTransfer(id);
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div aria-busy="true">
        <SlowRequestNotice />
        <ReceiptSkeleton />
      </div>
    );
  }

  if (isError || !transfer) {
    return (
      <ApiFeedback
        error={error ?? new Error("That transfer could not be found.")}
        onRetry={() => void refetch()}
      />
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
