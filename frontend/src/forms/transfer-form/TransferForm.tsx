import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import LoadingButton from "@/components/LoadingButton";
import { money, toMinor } from "@/lib/money";

// The rules are the server's rules, written once here.
//
// The point of validating in the browser is not security - the server validates again and
// its answer is the one that counts. It is that a user should not wait for a round trip to
// be told an amount has three decimal places. Where the two could drift, the message says
// what the server would say.
const transferSchema = z.object({
  recipientWalletId: z
    .string()
    .trim()
    .min(1, "Enter the recipient's wallet ID.")
    .max(64, "That is longer than any wallet ID."),

  // Kept as the typed string and converted with the same helper the display uses, so
  // "1,000.50" and "1000.5" are both accepted and both mean the same thing.
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount.")
    .refine((value) => {
      try {
        toMinor(value);
        return true;
      } catch {
        return false;
      }
    }, "Enter a positive naira amount with at most 2 decimal places."),

  note: z.string().max(140, "A note can be at most 140 characters.").optional(),
});

export type TransferFormData = z.infer<typeof transferSchema>;

type Props = {
  fromWalletId: string;
  balanceMinor: string;
  disabled?: boolean;
  isSubmitting: boolean;
  /** Called with valid input. The page decides what to do next, which is to ask for confirmation. */
  onReview: (data: TransferFormData) => void;
  /** Cleared by the page whenever the inputs change, because a new amount is a new transfer. */
  onInputChange: () => void;
};

const TransferForm = ({
  fromWalletId,
  balanceMinor,
  disabled = false,
  isSubmitting,
  onReview,
  onInputChange,
}: Props) => {
  const form = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: { recipientWalletId: "", amount: "", note: "" },
    // Validate as the user leaves each field rather than only on submit, so the first thing
    // they see is not four errors at once.
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  return (
    <form
      onSubmit={handleSubmit(onReview)}
      onChange={onInputChange}
      noValidate
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="from">From wallet</FieldLabel>
          <Input id="from" readOnly value={fromWalletId} />
          <FieldDescription>Available: {money(balanceMinor)}</FieldDescription>
        </Field>

        <Field data-invalid={Boolean(errors.recipientWalletId)}>
          <FieldLabel htmlFor="to">To wallet ID</FieldLabel>
          <Input
            id="to"
            placeholder="wlt_…"
            aria-invalid={Boolean(errors.recipientWalletId)}
            {...register("recipientWalletId")}
          />
          {errors.recipientWalletId && (
            <FieldDescription className="text-destructive">
              {errors.recipientWalletId.message}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.amount)}>
          <FieldLabel htmlFor="amount">Amount (NGN)</FieldLabel>
          <Input
            id="amount"
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={Boolean(errors.amount)}
            {...register("amount")}
          />
          {errors.amount && (
            <FieldDescription className="text-destructive">
              {errors.amount.message}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor="note">
            Note <span className="text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="note" placeholder="What's it for?" maxLength={140} {...register("note")} />
          {errors.note && (
            <FieldDescription className="text-destructive">{errors.note.message}</FieldDescription>
          )}
        </Field>

        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingLabel="Checking…"
          disabled={disabled}
        >
          Review transfer
          <ArrowRight data-icon="inline-end" />
        </LoadingButton>
      </FieldGroup>
    </form>
  );
};

export default TransferForm;
