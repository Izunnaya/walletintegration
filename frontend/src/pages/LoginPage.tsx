import { Link, useSearchParams } from "react-router-dom";
import { Wallet } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Deliberately not wired, and the button says so rather than pretending.
//
// Signing in needs the token to be stored and attached to every request, and a token in the
// wrong place is the kind of mistake that is hard to walk back. It belongs with the API
// wiring, in the phase that adds it, not as a form that looks real and does nothing.
//
// ?expired=1 is how useTransferAttempt sends someone here after a 401, so the reason they
// were interrupted is on screen instead of them arriving at a blank login.
const LoginPage = () => {
  const [params] = useSearchParams();
  const expired = params.get("expired") === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-sm">
        <Wallet className="mb-8 size-9" />
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back.</h1>
        <p className="mb-8 mt-2 text-sm text-muted-foreground">
          A clearer view of your money.
        </p>

        {expired && (
          <Alert className="mb-5">
            <AlertDescription>
              Your session expired, so the transfer was not sent. Sign in and try again.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={(event) => event.preventDefault()}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="login-email">Email</FieldLabel>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="login-password">Password</FieldLabel>
              <Input id="login-password" type="password" autoComplete="current-password" />
            </Field>

            <Button disabled type="submit">
              Sign in — not connected yet
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              No credentials are sent or stored. Authentication arrives with the API wiring.
            </p>

            <Link to="/" className={buttonVariants({ variant: "outline" })}>
              Return to the demo workspace
            </Link>
          </FieldGroup>
        </form>
      </section>
    </main>
  );
};

export default LoginPage;
