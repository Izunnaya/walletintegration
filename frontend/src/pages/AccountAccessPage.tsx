import LoadingButton from "@/components/LoadingButton";
import { useRetryAfter } from "@/hooks/useRetryAfter";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSetRestriction } from "@/api/AdminApi";
import { useAuth } from "@/auth/AuthProvider";
import PageHeading from "@/components/PageHeading";
import ApiFeedback from "@/components/ApiFeedback";
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
import AccountAccessForm from "@/forms/account-access-form/AccountAccessForm";
import type { AccountAccessFormData } from "@/forms/account-access-form/AccountAccessForm";

const AccountAccessPage = () => {
  const { session } = useAuth();
  const { setRestriction, isPending, error, data, reset } = useSetRestriction();
  const retryAfter = useRetryAfter(error);
  const [review, setReview] = useState<AccountAccessFormData | null>(null);
  const confirm = async () => {
    if (!review || retryAfter > 0) return;
    try {
      await setRestriction(review);
      setReview(null);
    } catch {
      /* Show the mutation error without hiding the selected account. */
    }
  };
  return (
    <>
      <PageHeading
        title="Account access"
        description="Block or unblock transfers for a customer account."
      />
      <section className="max-w-xl space-y-6 rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Blocking prevents transfers in both directions. Unblocking does not
          remove a blacklist restriction. Every change records your reason in
          the{" "}
          <Link to="/admin/audit" className="underline">
            audit log
          </Link>
          .
        </p>
        {data && (
          <Alert>
            <AlertDescription>
              <p>
                {data.changed
                  ? "Account updated."
                  : "The account was already in this state."}{" "}
                {data.user.name} ({data.user.email}) is{" "}
                {data.user.isBlocked ? "blocked" : "unblocked"}.
              </p>
              {data.note && <p>{data.note}</p>}
            </AlertDescription>
          </Alert>
        )}
        <AccountAccessForm
          isLoading={isPending}
          onSave={async (values) => {
            reset();
            setReview(values);
          }}
        />
      </section>
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setReview(null);
        }}
      >
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>Confirm {review?.action}</DialogTitle>
            <DialogDescription>
              User ID {review?.userId}. Reason: {review?.reason}
            </DialogDescription>
          </DialogHeader>
          <ApiFeedback error={error} />
          {review?.userId === session?.user.id && (
            <p className="text-sm text-destructive">
              You cannot change your own access.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setReview(null)}
            >
              Cancel
            </Button>
            <LoadingButton
              loading={isPending}
              loadingLabel="Saving..."
              disabled={retryAfter > 0 || review?.userId === session?.user.id}
              onClick={confirm}
            >
              {retryAfter > 0 ? `Retry in ${retryAfter}s` : "Confirm change"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default AccountAccessPage;
