import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { emailSchema, registrationPasswordSchema } from "@/lib/validation";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import LoadingButton from "@/components/LoadingButton";

const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: emailSchema,
  password: registrationPasswordSchema,
});
export type CreateAccountFormData = z.infer<typeof createAccountSchema>;
type Props = {
  isLoading: boolean;
  retryAfter: number;
  onSave: (data: CreateAccountFormData) => Promise<void>;
};
const CreateAccountForm = ({ isLoading, retryAfter, onSave }: Props) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateAccountFormData>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  return (
    <form onSubmit={handleSubmit(onSave)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="register-name">Name</FieldLabel>
          <Input
            id="register-name"
            autoComplete="name"
            {...register("name")}
            aria-invalid={!!errors.name}
          />
          {errors.name && (
            <FieldDescription className="text-destructive">
              {errors.name.message}
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="register-email">Email</FieldLabel>
          <Input
            id="register-email"
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
          <FieldLabel htmlFor="register-password">Password</FieldLabel>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            {...register("password")}
            aria-invalid={!!errors.password}
          />
          <FieldDescription
            className={errors.password ? "text-destructive" : ""}
          >
            {errors.password?.message ??
              "For a strong password, mix uppercase and lowercase letters, numbers and symbols."}
          </FieldDescription>
        </Field>
        <LoadingButton
          type="submit"
          loading={isLoading}
          disabled={retryAfter > 0}
          loadingLabel="Creating account..."
        >
          {retryAfter > 0 ? `Retry in ${retryAfter}s` : "Create account"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
};
export default CreateAccountForm;
