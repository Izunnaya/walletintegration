import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/money";
import LoadingButton from "@/components/LoadingButton";
import ApiFeedback from "@/components/ApiFeedback";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinationWalletId: string;
  amountMinor: string;
  idempotencyKey: string;
  error: unknown;
  unconfirmed: boolean;
  rejected: boolean;
  retryAfter: number;
  isPending: boolean;
  onConfirm: () => void;
  onStartOver: () => void;
};

// The source wallet is not repeated here. It is the signed-in wallet, already shown on the
// form as a read-only field, and the design gives the dialog to the one detail worth
// re-reading before money moves: where it is going.
const TransferConfirmDialog = ({
  open,
  onOpenChange,
  destinationWalletId,
  amountMinor,
  idempotencyKey,
  error,
  unconfirmed,
  rejected,
  retryAfter,
  isPending,
  onConfirm,
  onStartOver,
}: Props) => (
  <Dialog
    open={open}
    onOpenChange={(next) => {
      if (!isPending) onOpenChange(next);
    }}
  >
    <DialogContent showCloseButton={!isPending}>
      <DialogHeader>
        <DialogTitle>
          {unconfirmed
            ? "Check your transfer"
            : rejected
              ? "Transfer rejected"
              : "Review your transfer"}
        </DialogTitle>
        <DialogDescription>
          {unconfirmed
            ? "The outcome is not confirmed. Check this transfer before starting another."
            : "Check these details before sending."}
        </DialogDescription>
      </DialogHeader>
      <div className="my-4 flex flex-col gap-4">
        <p className="text-3xl font-semibold tracking-tight">
          {money(amountMinor)}
        </p>
        <p className="text-xs text-muted-foreground">To wallet</p>
        <code className="break-all rounded-md bg-muted p-3 text-xs">
          {destinationWalletId}
        </code>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Transfer fee</span>
          <span>{money("0")}</span>
        </div>
        <p className="break-all text-[10px] text-muted-foreground">
          Idempotency-Key: {idempotencyKey}
        </p>
        <ApiFeedback error={error} />
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() => onOpenChange(false)}
        >
          Go back
        </Button>
        {rejected ? (
          <Button onClick={onStartOver}>Start a new transfer</Button>
        ) : (
          <LoadingButton
            loading={isPending}
            loadingLabel="Checking..."
            disabled={retryAfter > 0}
            onClick={onConfirm}
          >
            {retryAfter > 0
              ? `Retry in ${retryAfter}s`
              : unconfirmed
                ? "Check transfer status"
                : "Confirm transfer"}
          </LoadingButton>
        )}
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
export default TransferConfirmDialog;
