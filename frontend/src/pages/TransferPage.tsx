import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import PageHeading from "@/components/PageHeading";
import PendingPanels from "@/components/PendingPanels";
import TransferConfirmDialog from "@/components/TransferConfirmDialog";
import TransferReceipt from "@/components/TransferReceipt";
import TransferForm from "@/forms/transfer-form/TransferForm";
import type { TransferFormData } from "@/forms/transfer-form/TransferForm";
import { useTransferAttempt } from "@/hooks/useTransferAttempt";
import { useMyWallet } from "@/api/WalletApi";
import { useUsers } from "@/api/AdminApi";
import { getDemoOutcome, setDemoOutcome } from "@/api/demoWorkspace";
import type { DemoOutcome } from "@/api/demoWorkspace";

const outcomes: { value: DemoOutcome; label: string }[] = [
  { value: "success", label: "Success / wallet validation" },
  { value: "unknown", label: "Unknown outcome, then successful retry" },
  { value: "conflict", label: "409 · Conflict" },
  { value: "rateLimited", label: "429 · Rate limited (10 seconds)" },
  { value: "sessionExpired", label: "401 · Session expired" },
];

const TransferPage = () => {
  const { wallet, isPending: walletPending } = useMyWallet();
  const { users } = useUsers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outcome, setOutcome] = useState<DemoOutcome>(getDemoOutcome);

  const {
    attempt,
    result,
    message,
    requestId,
    errorCode,
    unconfirmed,
    retryAfter,
    isPending,
    authorise,
    confirm,
    clear,
    dismissResult,
  } = useTransferAttempt();

  if (walletPending) return <PendingPanels label="Loading wallet" />;
  if (!wallet) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Your wallet could not be loaded.</AlertDescription>
      </Alert>
    );
  }

  if (result) {
    return <TransferReceipt transfer={result} success onBack={dismissResult} />;
  }

  const restricted = wallet.status !== "active";
  const recipientName = users.find((user) => user.id === attempt?.recipientWalletId)?.name;

  // A conflicted key can never succeed, so the dialog offers a new transfer rather than a
  // retry. Read from the code, never the message.
  const conflicted = errorCode === "IDEMPOTENCY_KEY_CONFLICT";

  const onReview = (data: TransferFormData) => {
    authorise(data);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeading
        title="Transfer"
        description="Move money simply. From your wallet to theirs."
      />

      {restricted && (
        <Alert className="mb-6">
          <AlertDescription>
            Your account is restricted. You can&apos;t send transfers.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-7 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border p-6">
          <h2 className="mb-1 text-base font-semibold">Send a transfer</h2>
          <p className="mb-7 text-xs text-muted-foreground">
            Transfers between wallets are instant and free.
          </p>

          <TransferForm
            fromWalletId={wallet.id}
            balanceMinor={wallet.balanceMinor}
            disabled={restricted}
            isSubmitting={isPending}
            onReview={onReview}
            // Any edit invalidates the authorised attempt, so the next review generates a
            // new Idempotency-Key rather than replaying the previous details.
            onInputChange={clear}
          />
        </section>

        <section className="rounded-xl border bg-muted/25 p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" />
            Send with confidence
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            Double-check the recipient&apos;s wallet ID. You&apos;ll review all the details
            before confirming your transfer.
          </p>

          {/* Scaffolding, and labelled as such. The real API decides its own outcome; until
              this is wired there is no other way to reach the error states. */}
          <label className="mt-5 flex flex-col gap-2 text-xs">
            Demo response
            <select
              aria-label="Demo response"
              className="rounded border bg-background p-2"
              value={outcome}
              onChange={(event) => {
                const next = event.target.value as DemoOutcome;
                setOutcome(next);
                setDemoOutcome(next);
                clear();
              }}
            >
              {outcomes.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <p className="mb-3 mt-6 text-[10px] font-medium tracking-wider text-muted-foreground">
            DEMO RECIPIENTS
          </p>
          {users
            .filter((user) => user.id !== wallet.id)
            .map((user) => (
              <div
                key={user.id}
                className="flex w-full items-center justify-between gap-2 border-t py-3 text-left"
              >
                <div>
                  <p className="text-xs font-medium">{user.name}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{user.id}</p>
                </div>
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </div>
            ))}
        </section>
      </div>

      {attempt && (
        <TransferConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          amountMinor={attempt.amountMinor}
          recipientWalletId={attempt.recipientWalletId}
          recipientName={recipientName}
          idempotencyKey={attempt.idempotencyKey}
          message={message}
          requestId={requestId}
          unconfirmed={unconfirmed}
          conflicted={conflicted}
          retryAfter={retryAfter}
          isPending={isPending}
          onConfirm={confirm}
          onStartOver={() => {
            clear();
            setDialogOpen(false);
          }}
        />
      )}
    </>
  );
};

export default TransferPage;
