import { useState } from "react";
import { useMyWallet } from "@/api/WalletApi";
import { useTransferAttempt } from "@/forms/transfer-form/useTransferAttempt";
import TransferForm from "@/forms/transfer-form/TransferForm";
import type { TransferFormData } from "@/forms/transfer-form/TransferForm";
import TransferConfirmDialog from "@/components/TransferConfirmDialog";
import TransferReceipt from "@/components/TransferReceipt";
import ApiFeedback from "@/components/ApiFeedback";
import PageHeading from "@/components/PageHeading";
import { FormSkeleton, SlowRequestNotice } from "@/components/LoadingStates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const TransferPage = () => {
  const query = useMyWallet();
  const transfer = useTransferAttempt(query.wallet?.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const onReview = (data: TransferFormData) => {
    if (transfer.authorise(data)) setDialogOpen(true);
  };
  if (query.isPending)
    return (
      <>
        <SlowRequestNotice />
        <FormSkeleton />
      </>
    );
  if (!query.wallet)
    return (
      <ApiFeedback error={query.error} onRetry={() => void query.refetch()} />
    );
  if (transfer.result)
    return (
      <TransferReceipt
        transfer={transfer.result}
        success
        onBack={transfer.dismissResult}
      />
    );
  return (
    <>
      <PageHeading
        title="Send money"
        description="Transfer between NGN wallets."
      />
      {transfer.unconfirmed && (
        <Alert className="mb-6">
          <AlertDescription>
            <p>
              An earlier transfer still needs confirmation. Check it before
              sending another.
            </p>
            <Button className="mt-3" onClick={() => setDialogOpen(true)}>
              Resume transfer
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!dialogOpen && (
        <div className="mb-5">
          <ApiFeedback error={transfer.error} />
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border bg-card p-6">
          <h2 className="mb-6 text-base font-semibold">Transfer details</h2>
          <TransferForm
            fromWalletId={query.wallet.id}
            balanceMinor={query.wallet.balanceMinor}
            disabled={transfer.unconfirmed}
            isSubmitting={transfer.isPending}
            onReview={onReview}
            onInputChange={transfer.clear}
          />
        </section>
        <aside className="rounded-xl border bg-muted/20 p-6 text-sm">
          <h2 className="font-medium">Check before you send</h2>
          <p className="mt-3 leading-6 text-muted-foreground">
            Ask the recipient for their wallet ID. The review shows the exact
            amount and destination before you confirm.
          </p>
          <p className="mt-3 leading-6 text-muted-foreground">
            If a connection is interrupted, check the existing transfer rather
            than starting it again.
          </p>
        </aside>
      </div>
      {transfer.attempt && (
        <TransferConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          sourceWalletId={transfer.attempt.sourceWalletId}
          destinationWalletId={transfer.attempt.destinationWalletId}
          amountMinor={transfer.attempt.amountMinor}
          error={transfer.error}
          unconfirmed={transfer.unconfirmed}
          rejected={transfer.attempt.phase === "rejected"}
          retryAfter={transfer.retryAfter}
          isPending={transfer.isPending}
          onConfirm={() => void transfer.confirm()}
          onStartOver={() => {
            transfer.clear();
            setDialogOpen(false);
          }}
        />
      )}
    </>
  );
};
export default TransferPage;
