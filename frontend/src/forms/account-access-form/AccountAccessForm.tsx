import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { databaseIdSchema } from "@/lib/validation";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import LoadingButton from "@/components/LoadingButton";

const schema = z.object({
  userId: databaseIdSchema,
  action: z.enum(["block", "unblock"]),
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason of at least 3 characters.")
    .max(500),
});
export type AccountAccessFormData = z.infer<typeof schema>;
type Props = {
  isLoading: boolean;
  onSave: (data: AccountAccessFormData) => Promise<void>;
};
const AccountAccessForm = ({ isLoading, onSave }: Props) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountAccessFormData>({
    resolver: zodResolver(schema),
    defaultValues: { userId: "", action: "block", reason: "" },
  });
  return (
    <form onSubmit={handleSubmit(onSave)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="access-user">User ID</FieldLabel>
          <Input
            id="access-user"
            inputMode="numeric"
            {...register("userId")}
            aria-invalid={!!errors.userId}
          />
          <FieldDescription className={errors.userId ? "text-destructive" : ""}>
            {errors.userId?.message ??
              "Use the account's user ID, which differs from its wallet ID."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="access-action">Action</FieldLabel>
          <select
            id="access-action"
            {...register("action")}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="block">Block transfers</option>
            <option value="unblock">Unblock transfers</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="access-reason">Reason</FieldLabel>
          <Input
            id="access-reason"
            maxLength={500}
            {...register("reason")}
            aria-invalid={!!errors.reason}
          />
          {errors.reason && (
            <FieldDescription className="text-destructive">
              {errors.reason.message}
            </FieldDescription>
          )}
        </Field>
        <LoadingButton
          type="submit"
          loading={isLoading}
          loadingLabel="Saving..."
        >
          Apply account restriction
        </LoadingButton>
      </FieldGroup>
    </form>
  );
};
export default AccountAccessForm;
