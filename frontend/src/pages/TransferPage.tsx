import { useState } from "react";
import { ShieldCheck } from "lucide-react";
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
  const walletId = query.wallet?.publicId ?? query.wallet?.id;
  const transfer = useTransferAttempt(walletId);
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
        title="Transfer"
        description="Move money simply. From your wallet to theirs."
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
      <div className="grid items-start gap-7 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border p-6">
          <h2 className="mb-1 text-base font-semibold">Send a transfer</h2>
          <p className="mb-7 text-xs text-muted-foreground">
            Transfers between wallets are instant and free.
          </p>
          <TransferForm
            fromWalletId={walletId!}
            balanceMinor={query.wallet.balanceMinor}
            disabled={transfer.unconfirmed}
            isSubmitting={transfer.isPending}
            onReview={onReview}
            onInputChange={transfer.clear}
          />
        </section>
        <aside className="rounded-xl border bg-muted/25 p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" />
            Send with confidence
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            Double-check the recipient's wallet ID. You'll review every detail
            before confirming your transfer.
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            If a connection is interrupted, check the existing transfer rather
            than starting it again.
          </p>
        </aside>
      </div>
      {transfer.attempt && (
        <TransferConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          destinationWalletId={transfer.attempt.destinationWalletId}
          amountMinor={transfer.attempt.amountMinor}
          idempotencyKey={transfer.attempt.idempotencyKey}
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
