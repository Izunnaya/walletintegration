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
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: string;
  error: unknown;
  unconfirmed: boolean;
  rejected: boolean;
  retryAfter: number;
  isPending: boolean;
  onConfirm: () => void;
  onStartOver: () => void;
};
const TransferConfirmDialog = ({
  open,
  onOpenChange,
  sourceWalletId,
  destinationWalletId,
  amountMinor,
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
            : "Check the wallet IDs and amount before confirming."}
        </DialogDescription>
      </DialogHeader>
      <p className="my-3 text-3xl font-semibold">{money(amountMinor)}</p>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt>From wallet</dt>
          <dd className="break-all font-mono">{sourceWalletId}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>To wallet</dt>
          <dd className="break-all font-mono">{destinationWalletId}</dd>
        </div>
      </dl>
      <ApiFeedback error={error} />
      <DialogFooter>
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() => onOpenChange(false)}
        >
          Close
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
