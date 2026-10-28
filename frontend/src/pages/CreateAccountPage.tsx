import { useRetryAfter } from "@/hooks/useRetryAfter";
import { Link, useNavigate } from "react-router-dom";
import { useCreateAccount } from "@/api/AuthApi";
import ApiFeedback from "@/components/ApiFeedback";
import CreateAccountForm from "@/forms/create-account-form/CreateAccountForm";
import type { CreateAccountFormData } from "@/forms/create-account-form/CreateAccountForm";
import { SlowRequestNotice } from "@/components/LoadingStates";

const CreateAccountPage = () => {
  const { createAccount, isPending, error } = useCreateAccount();
  const navigate = useNavigate();
  const retryAfter = useRetryAfter(error);
  const onSave = async (data: CreateAccountFormData) => {
    if (retryAfter > 0) return;
    try {
      await createAccount(data);
      navigate(`/login?registered=1&email=${encodeURIComponent(data.email)}`, {
        replace: true,
      });
    } catch {
      /* The mutation error is rendered below. */
    }
  };
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Create your account.
      </h1>
      <p className="mb-7 mt-2 text-sm text-muted-foreground">
        Your NGN wallet starts at zero.
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
      <p className="mt-6 text-sm text-muted-foreground">
        Already registered?{" "}
        <Link className="underline text-foreground" to="/login">
          Sign in
        </Link>
      </p>
    </>
  );
};
export default CreateAccountPage;
