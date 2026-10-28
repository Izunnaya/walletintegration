import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Copy } from "lucide-react";
import { notify } from "@/lib/notify";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import PageHeading from "@/components/PageHeading";
import CreateAccountForm from "@/forms/create-account-form/CreateAccountForm";
import type { CreateAccountFormData } from "@/forms/create-account-form/CreateAccountForm";
import { useCreateAccount } from "@/api/AdminApi";
import { ApiError } from "@/api/types";
import type { WalletUser } from "@/api/types";
import { money } from "@/lib/money";

const CreateAccountPage = () => {
  const { create, isPending } = useCreateAccount();
  const [created, setCreated] = useState<WalletUser | null>(null);
  const [message, setMessage] = useState("");

  const onSubmit = async (data: CreateAccountFormData) => {
    setMessage("");
    try {
      const account = await create(data);
      setCreated(account);
      notify.success(`${account.name} now has a wallet`, account.id);
    } catch (caught) {
      // Kept on the page rather than only in a toast. A refusal here is usually the email
      // already being registered or blacklisted, which the admin has to act on, and a
      // notification that disappears after four seconds is the wrong place for it.
      setMessage(
        caught instanceof ApiError ? caught.message : "That account could not be created.",
      );
    }
  };

  const copyWalletId = async (walletId: string) => {
    try {
      await navigator.clipboard.writeText(walletId);
      notify.success("Wallet ID copied");
    } catch {
      notify.error(null, "Could not copy. Please select the wallet ID manually.");
    }
  };

  return (
    <>
      <PageHeading
        title="Create account"
        description="A fresh start for someone's money."
      />

      <section className="max-w-xl rounded-xl border p-6">
        {created ? (
          <div className="flex flex-col gap-5">
            <span className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
              <Check className="size-5" />
            </span>
            <h2 className="text-xl font-semibold">A new wallet, ready to go.</h2>
            <p className="text-sm text-muted-foreground">
              {created.name} · {created.email}
            </p>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <code className="text-xs">{created.id}</code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy new wallet ID"
                onClick={() => copyWalletId(created.id)}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-sm">Initial balance: {money(created.balanceMinor)}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/admin/users" className={buttonVariants()}>
                View accounts
                <ArrowRight />
              </Link>
              <Button variant="outline" onClick={() => setCreated(null)}>
                Create another
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-base font-semibold">Account details</h2>
            <p className="mb-7 mt-1 text-xs text-muted-foreground">
              Create an account and its wallet in one step.
            </p>

            {message && (
              <Alert variant="destructive" className="mb-6">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}

            <CreateAccountForm isSubmitting={isPending} onSubmit={onSubmit} />
          </>
        )}
      </section>
    </>
  );
};

export default CreateAccountPage;
