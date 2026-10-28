import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { walletIdentifierSchema } from "@/lib/validation";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import LoadingButton from "@/components/LoadingButton";
import { money, toMinor } from "@/lib/money";

const transferFormSchema = z.object({
  recipientWalletId: walletIdentifierSchema,
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount.")
    .refine((value) => {
      try {
        return BigInt(toMinor(value)) <= 1_000_000_000n;
      } catch {
        return false;
      }
    }, "Enter a positive amount up to NGN 10,000,000 with at most two decimal places."),
});
export type TransferFormData = z.infer<typeof transferFormSchema>;
type Props = {
  fromWalletId: string;
  balanceMinor: string;
  disabled: boolean;
  isSubmitting: boolean;
  onReview: (data: TransferFormData) => void;
  onInputChange: () => void;
};
const TransferForm = ({
  fromWalletId,
  balanceMinor,
  disabled,
  isSubmitting,
  onReview,
  onInputChange,
}: Props) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TransferFormData>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: { recipientWalletId: "", amount: "" },
    mode: "onBlur",
  });
  return (
    <form onSubmit={handleSubmit(onReview)} onChange={onInputChange} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="from">From wallet</FieldLabel>
          <Input id="from" readOnly value={fromWalletId} />
          <FieldDescription>
            Current balance: {money(balanceMinor)}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="recipient">Recipient wallet ID</FieldLabel>
          <Input
            id="recipient"

            placeholder="wlt_..."
            disabled={disabled || isSubmitting}
            {...register("recipientWalletId")}
            aria-invalid={!!errors.recipientWalletId}
          />
          {errors.recipientWalletId && (
            <FieldDescription className="text-destructive">
              {errors.recipientWalletId.message}
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="amount">Amount (NGN)</FieldLabel>
          <Input
            id="amount"
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled || isSubmitting}
            {...register("amount")}
            aria-invalid={!!errors.amount}
          />
          {errors.amount && (
            <FieldDescription className="text-destructive">
              {errors.amount.message}
            </FieldDescription>
          )}
        </Field>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingLabel="Sending..."
          disabled={disabled}
        >
          Review transfer
        </LoadingButton>
      </FieldGroup>
    </form>
  );
};
export default TransferForm;
