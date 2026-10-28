import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useSendTransfer } from "@/api/TransferApi";
import { ApiError } from "@/api/contracts";
import type { Transfer } from "@/api/contracts";
import { toMinor } from "@/lib/money";
import { notify } from "@/lib/notify";
import {
  readAttempt,
  saveAttempt,
  sameTransfer,
  transferDetails,
} from "./attempt";
import type { TransferAttempt } from "./attempt";
import type { TransferFormData } from "./TransferForm";

export const useTransferAttempt = (sourceWalletId: string | undefined) => {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [attempt, setAttempt] = useState(() => readAttempt(userId));
  const [result, setResult] = useState<Transfer | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const { send, isPending, reset } = useSendTransfer();

  useEffect(() => {
    setNow(Date.now());
    if (!attempt || attempt.retryAt <= Date.now()) return;
    const retryAt = attempt.retryAt;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [attempt?.retryAt]);

  const remember = (next: TransferAttempt): boolean => {
    if (!userId) return false;
    try {
      saveAttempt(userId, next);
      setAttempt(next);
      return true;
    } catch {
      setError(
        new Error(
          "Tab storage is unavailable. Enable it before sending so an interrupted transfer can be safely checked.",
        ),
      );
      return false;
    }
  };
  const clear = () => {
    if (inFlight.current || attempt?.phase === "unconfirmed") return;
    if (userId) {
      try {
        saveAttempt(userId, null);
      } catch {
        /* No request was sent, or its rejection is known. */
      }
    }
    setAttempt(null);
    setError(null);
    reset();
  };
  const authorise = (input: TransferFormData): boolean => {
    if (!sourceWalletId || !userId || inFlight.current) return false;
    if (attempt?.phase === "unconfirmed") return true;
    const amountMinor = toMinor(input.amount);
    if (
      attempt &&
      attempt.phase === "review" &&
      sameTransfer(
        attempt,
        sourceWalletId,
        input.recipientWalletId,
        amountMinor,
      )
    )
      return true;
    setError(null);
    return remember({
      sourceWalletId,
      destinationWalletId: input.recipientWalletId,
      amountMinor,
      idempotencyKey: crypto.randomUUID(),
      phase: "review",
      retryAt: 0,
    });
  };
  const confirm = async () => {
    if (
      !attempt ||
      !userId ||
      inFlight.current ||
      attempt.phase === "rejected" ||
      attempt.retryAt > Date.now()
    )
      return;
    const sent = { ...attempt, phase: "unconfirmed" as const };
    // Save before fetch. Reloading, navigating away or re-authenticating must reuse this key.
    if (!remember(sent)) return;
    inFlight.current = true;
    setError(null);
    try {
      const completed = await send(transferDetails(sent));
      try {
        saveAttempt(userId, null);
      } catch {
        /* Replaying this saved success remains safe. */
      }
      setResult(completed);
      setAttempt(null);
      notify.success("Transfer completed", `Reference ${completed.reference}`);
    } catch (caught) {
      const failure =
        caught instanceof Error
          ? caught
          : new Error("The transfer could not be confirmed.");
      setError(failure);
      const apiError = failure instanceof ApiError ? failure : null;
      const uncertain =
        !apiError ||
        apiError.status === 0 ||
        apiError.status >= 500 ||
        apiError.status === 401 ||
        apiError.code === "INVALID_RESPONSE";
      let phase: TransferAttempt["phase"] = "rejected";
      if (uncertain) phase = "unconfirmed";
      else if (apiError?.status === 429) phase = attempt.phase;
      remember({
        ...sent,
        phase,
        retryAt: Date.now() + (apiError?.retryAfterSeconds ?? 0) * 1000,
      });
    } finally {
      inFlight.current = false;
    }
  };
  return {
    attempt,
    result,
    error,
    isPending,
    authorise,
    confirm,
    clear,
    unconfirmed: attempt?.phase === "unconfirmed",
    retryAfter: Math.max(0, Math.ceil(((attempt?.retryAt ?? 0) - now) / 1000)),
    dismissResult: () => setResult(null),
  };
};
