import { useRetryAfter } from "@/hooks/useRetryAfter";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useLogin } from "@/api/AuthApi";
import ApiFeedback from "@/components/ApiFeedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import LoginForm from "@/forms/login-form/LoginForm";
import type { LoginFormData } from "@/forms/login-form/LoginForm";
import { SlowRequestNotice } from "@/components/LoadingStates";

const LoginPage = () => {
  const { login, isPending, error } = useLogin();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const retryAfter = useRetryAfter(error);
  const location = useLocation();
  const [params] = useSearchParams();
  const onSave = async (data: LoginFormData) => {
    if (retryAfter > 0) return;
    try {
      signIn(await login(data));
      const requested: unknown = location.state?.from;
      const destination =
        typeof requested === "string" &&
        requested.startsWith("/") &&
        !requested.startsWith("//")
          ? requested
          : "/";
      navigate(destination, { replace: true });
    } catch {
      /* The mutation error is rendered below. */
    }
  };
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Welcome back.</h1>
      <p className="mb-7 mt-2 text-sm text-muted-foreground">
        Sign in to your wallet.
      </p>
      {params.get("expired") === "1" && (
        <Alert className="mb-5">
          <AlertDescription>
            Your session expired. Sign in again to continue. Any unresolved
            transfer can be checked with its original request.
          </AlertDescription>
        </Alert>
      )}
      {params.get("registered") === "1" && (
        <Alert className="mb-5">
          <AlertDescription>
            Your account and wallet are ready. Sign in to continue.
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-5">
        <ApiFeedback error={error} />
      </div>
      {isPending && <SlowRequestNotice />}
      <LoginForm
        email={params.get("email") ?? ""}
        isLoading={isPending}
        retryAfter={retryAfter}
        onSave={onSave}
      />
      <p className="mt-6 text-sm text-muted-foreground">
        New here?{" "}
        <Link className="underline text-foreground" to="/register">
          Create an account
        </Link>
      </p>
    </>
  );
};
export default LoginPage;
