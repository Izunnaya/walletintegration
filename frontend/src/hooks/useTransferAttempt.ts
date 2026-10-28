import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSendTransfer } from "@/api/TransferApi";
import { ApiError } from "@/api/types";
import type { Transfer, TransferErrorCode } from "@/api/types";
import { toMinor } from "@/lib/money";

// The Idempotency-Key's lifecycle, which is the only genuinely subtle thing in this UI.
//
// The rule: one key per set of details the user authorised. Pressing "Confirm" again after a
// failure must reuse it, because that is what makes the retry safe - the server recognises
// the key and returns the first outcome instead of moving money twice. Changing the amount or
// the recipient must discard it, because that is a different transfer and reusing the key
// would make the server replay the old one.
//
// Getting this backwards in either direction is a real bug: a fresh key on retry can send
// money twice, and a stale key after an edit sends the wrong amount. It lives in one named
// place for that reason.

type AuthorisedAttempt = {
  idempotencyKey: string;
  recipientWalletId: string;
  amountMinor: string;
  note?: string;
};

type Input = { recipientWalletId: string; amount: string; note?: string };

export const useTransferAttempt = () => {
  const [attempt, setAttempt] = useState<AuthorisedAttempt | null>(null);
  const [result, setResult] = useState<Transfer | null>(null);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState<string | undefined>(undefined);
  // The code, not the message. A screen deciding what to offer next by matching on message
  // text breaks the moment the wording changes, and the wording is the part that should be
  // free to change.
  const [errorCode, setErrorCode] = useState<TransferErrorCode | undefined>(undefined);
  // An unconfirmed outcome is not a failure. The next press asks about the same key rather
  // than starting again, so the button has to say "Check status" instead of "Confirm".
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  // Belt as well as braces alongside the disabled button: a double-press that arrives in the
  // same tick would otherwise send twice.
  const inFlight = useRef(false);

  const { send, isPending, reset } = useSendTransfer();
  const navigate = useNavigate();

  useEffect(() => {
    if (!retryAfter) return;
    const timer = setTimeout(() => setRetryAfter((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryAfter]);

  const clear = useCallback(() => {
    setAttempt(null);
    setUnconfirmed(false);
    setMessage("");
    setRequestId(undefined);
    setErrorCode(undefined);
    reset();
  }, [reset]);

  // Called with validated input. Reuses the key when the details are unchanged, which is
  // what makes reopening the dialog after a failure a retry rather than a new transfer.
  const authorise = useCallback((input: Input) => {
    const amountMinor = toMinor(input.amount);
    const recipientWalletId = input.recipientWalletId.trim();

    setAttempt((current) => {
      if (
        current &&
        current.recipientWalletId === recipientWalletId &&
        current.amountMinor === amountMinor
      ) {
        return current;
      }
      setUnconfirmed(false);
      setMessage("");
      return {
        idempotencyKey: crypto.randomUUID(),
        recipientWalletId,
        amountMinor,
        ...(input.note ? { note: input.note } : {}),
      };
    });
  }, []);

  const confirm = useCallback(async () => {
    if (inFlight.current || retryAfter > 0 || !attempt) return;

    inFlight.current = true;
    setMessage("");

    try {
      const transfer = await send(attempt);
      setResult(transfer);
      setAttempt(null);
      setUnconfirmed(false);
      setErrorCode(undefined);
      toast.success("Transfer completed");
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setMessage(apiError?.message ?? "Something went wrong. Try again.");
      setRequestId(apiError?.requestId);
      setErrorCode(apiError?.code);

      if (apiError?.code === "UNAUTHENTICATED") {
        // The token is gone, so there is nothing to retry with. Keep nothing and send them
        // to sign in; the attempt would be meaningless under a different session anyway.
        setAttempt(null);
        navigate("/login?expired=1");
        return;
      }
      if (apiError?.code === "RATE_LIMITED") {
        setRetryAfter(apiError.retryAfterSeconds ?? 10);
        return;
      }
      if (apiError?.code === "TRANSFER_UNAVAILABLE") {
        // The key is kept on purpose. This is the case the whole design exists for.
        setUnconfirmed(true);
        return;
      }
      if (apiError?.code === "IDEMPOTENCY_KEY_CONFLICT") {
        // The key was already used for different details, so it can never succeed. The only
        // way forward is a new one.
        setUnconfirmed(false);
        return;
      }
    } finally {
      inFlight.current = false;
    }
  }, [attempt, navigate, retryAfter, send]);

  return {
    attempt,
    result,
    message,
    requestId,
    errorCode,
    unconfirmed,
    retryAfter,
    isPending,
    authorise,
    confirm,
    clear,
    dismissResult: () => setResult(null),
  };
};
