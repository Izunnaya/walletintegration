import { ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money } from "@/lib/money";
import { quick } from "@/lib/motion";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amountMinor: string;
  recipientWalletId: string;
  recipientName?: string;
  idempotencyKey: string;
  message: string;
  requestId?: string;
  unconfirmed: boolean;
  conflicted: boolean;
  retryAfter: number;
  isPending: boolean;
  onConfirm: () => void;
  onStartOver: () => void;
};

// The last step before money moves, so it states the details rather than summarising them:
// the amount, the recipient's wallet ID in full, and the key this attempt will carry.
//
// The button's label is the interesting part. It says "Confirm transfer" normally, "Check
// status" when the outcome was never confirmed - because pressing it asks about the same key
// rather than sending again - and counts down while rate limited.
const TransferConfirmDialog = ({
  open,
  onOpenChange,
  amountMinor,
  recipientWalletId,
  recipientName,
  idempotencyKey,
  message,
  requestId,
  unconfirmed,
  conflicted,
  retryAfter,
  isPending,
  onConfirm,
  onStartOver,
}: Props) => {
  const label = () => {
    if (isPending) return "Checking…";
    if (retryAfter > 0) return `Retry in ${retryAfter}s`;
    if (unconfirmed) return "Check status";
    return "Confirm transfer";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-request would hide the outcome of something already sent.
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>
            {unconfirmed ? "Awaiting confirmation" : "Review your transfer"}
          </DialogTitle>
          <DialogDescription>Check these details before sending.</DialogDescription>
        </DialogHeader>

        <div className="my-4 flex flex-col gap-4">
          <p className="text-3xl font-semibold tracking-tight">{money(amountMinor)}</p>

          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">To</span>
            <span>{recipientName ?? "Unknown recipient"}</span>
          </div>

          <code className="break-all rounded-md bg-muted p-3 text-xs">{recipientWalletId}</code>

          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Transfer fee</span>
            <span>₦0.00</span>
          </div>

          {/* Shown because it is the thing that makes a retry safe, and a reviewer should be
              able to see it staying the same across one. */}
          <p className="break-all text-[10px] text-muted-foreground">
            Idempotency-Key: {idempotencyKey}
          </p>

          <AnimatePresence>
            {message && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={quick}
                className="overflow-hidden"
              >
                <Alert variant={unconfirmed ? "default" : "destructive"}>
                  <AlertDescription>
                    <p>{message}</p>
                    {requestId && (
                      <p className="mt-2 break-all text-[10px]">Request ID: {requestId}</p>
                    )}
                  </AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          {conflicted ? (
            <Button onClick={onStartOver}>Start a new transfer</Button>
          ) : (
            <Button disabled={isPending || retryAfter > 0} onClick={onConfirm}>
              {label()}
              <ArrowUpRight />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferConfirmDialog;
