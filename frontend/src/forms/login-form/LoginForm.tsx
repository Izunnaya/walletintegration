import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { emailSchema, passwordSchema } from "@/lib/validation";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import LoadingButton from "@/components/LoadingButton";

const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export type LoginFormData = z.infer<typeof loginSchema>;
type Props = {
  email?: string;
  isLoading: boolean;
  retryAfter: number;
  onSave: (data: LoginFormData) => Promise<void>;
};
const LoginForm = ({ email = "", isLoading, retryAfter, onSave }: Props) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email, password: "" },
  });
  return (
    <form onSubmit={handleSubmit(onSave)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            {...register("email")}
            aria-invalid={!!errors.email}
          />
          {errors.email && (
            <FieldDescription className="text-destructive">
              {errors.email.message}
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            aria-invalid={!!errors.password}
          />
          {errors.password && (
            <FieldDescription className="text-destructive">
              {errors.password.message}
            </FieldDescription>
          )}
        </Field>
        <LoadingButton
          type="submit"
          loading={isLoading}
          disabled={retryAfter > 0}
          loadingLabel="Signing in..."
        >
          {retryAfter > 0 ? `Retry in ${retryAfter}s` : "Sign in"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
};
export default LoginForm;
