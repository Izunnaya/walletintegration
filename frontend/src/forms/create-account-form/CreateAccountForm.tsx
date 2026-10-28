import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import LoadingButton from "@/components/LoadingButton";

// The password rules are the server's, and the two unobvious ones are deliberate.
//
// The minimum counts characters after trimming, because twelve spaces is not a password -
// the API rejects it for the same reason. The maximum is in BYTES, not characters, because
// bcrypt reads only the first 72 and silently ignores the rest: a longer value would appear
// to be accepted while most of it was never part of the hash. The value itself is never
// trimmed; only its length is measured that way.
const createAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(100, "A name can be at most 100 characters."),

  email: z.string().trim().min(1, "Enter an email address.").email("Enter a valid email address."),

  password: z
    .string()
    .refine((value) => value.trim().length >= 12, "Use at least 12 characters that are not spaces.")
    .refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "That is longer than 72 bytes, which is all bcrypt reads.",
    ),
});

export type CreateAccountFormData = z.infer<typeof createAccountSchema>;

type Props = {
  isSubmitting: boolean;
  onSubmit: (data: CreateAccountFormData) => void;
};

const CreateAccountForm = ({ isSubmitting, onSubmit }: Props) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateAccountFormData>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: { name: "", email: "", password: "" },
    mode: "onBlur",
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="name">Full name</FieldLabel>
          <Input
            id="name"
            placeholder="e.g. Jamie Taylor"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          {errors.name && (
            <FieldDescription className="text-destructive">{errors.name.message}</FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="email">Email address</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="jamie@example.com"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email && (
            <FieldDescription className="text-destructive">{errors.email.message}</FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          {errors.password ? (
            <FieldDescription className="text-destructive">
              {errors.password.message}
            </FieldDescription>
          ) : (
            <FieldDescription>New wallets start at ₦0.00.</FieldDescription>
          )}
        </Field>

        <LoadingButton type="submit" loading={isSubmitting} loadingLabel="Creating account…">
          Create account
          <Plus />
        </LoadingButton>
      </FieldGroup>
    </form>
  );
};

export default CreateAccountForm;
