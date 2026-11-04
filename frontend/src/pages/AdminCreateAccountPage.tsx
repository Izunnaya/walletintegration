import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { useCreateAccount } from "@/api/AuthApi";
import { useRetryAfter } from "@/hooks/useRetryAfter";
import ApiFeedback from "@/components/ApiFeedback";
import PageHeading from "@/components/PageHeading";
import CreateAccountForm from "@/forms/create-account-form/CreateAccountForm";
import type { CreateAccountFormData } from "@/forms/create-account-form/CreateAccountForm";
import { SlowRequestNotice } from "@/components/LoadingStates";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { money } from "@/lib/money";
import { easeOut, panelVariants } from "@/lib/motion";
import type { Registration } from "@/api/contracts";

// Creating an account for someone else, from inside the workspace. It posts to the same
// public registration endpoint the sign-up page uses - the server creates the user and the
// wallet in one transaction either way - and then shows what was created, because an admin
// who has just made a wallet needs its id to hand over.
const AdminCreateAccountPage = () => {
  const { createAccount, isPending, error } = useCreateAccount();
  const retryAfter = useRetryAfter(error);
  const navigate = useNavigate();
  const [created, setCreated] = useState<Registration | null>(null);

  const onSave = async (data: CreateAccountFormData) => {
    if (retryAfter > 0) return;
    try {
      setCreated(await createAccount(data));
    } catch {
      /* The mutation error is rendered below. */
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.wallet.publicId ?? created.wallet.id);
      notify.success("Wallet ID copied");
    } catch {
      notify.error(null, "Select the wallet ID to copy it manually.");
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="Create account"
        description="A fresh start for someone's money."
      />
      <motion.section
        className="max-w-xl rounded-xl border p-6"
        variants={panelVariants}
        initial="initial"
        animate="animate"
        transition={easeOut}
      >
        {created ? (
          <div className="flex flex-col gap-5">
            <span className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
              <Check className="size-5" />
            </span>
            <h2 className="text-xl font-semibold">A new wallet, ready to go.</h2>
            <p className="text-sm text-muted-foreground">
              {created.user.name} · {created.user.email}
            </p>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <code className="break-all text-xs">
                {created.wallet.publicId ?? created.wallet.id}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy new wallet ID"
                onClick={copy}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-sm">
              Initial balance: {money(created.wallet.balanceMinor)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void navigate("/admin/users")}>
                View accounts
                <ArrowRight />
              </Button>
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
            <div className="mb-5">
              <ApiFeedback error={error} />
            </div>
            {isPending && <SlowRequestNotice />}
            <CreateAccountForm
              retryAfter={retryAfter}
              isLoading={isPending}
              onSave={onSave}
            />
          </>
        )}
      </motion.section>
    </>
  );
};
export default AdminCreateAccountPage;
