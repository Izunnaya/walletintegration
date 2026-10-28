import { useEffect, useState } from "react";
import { ApiError } from "@/api/contracts";

export function useRetryAfter(error: unknown): number {
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (error instanceof ApiError && error.retryAfterSeconds) {
      setDeadline(Date.now() + error.retryAfterSeconds * 1000);
    }
  }, [error]);
  useEffect(() => {
    const remaining = () =>
      Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setSeconds(remaining());
    if (deadline <= Date.now()) return;
    const timer = setInterval(() => {
      const value = remaining();
      setSeconds(value);
      if (value === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return seconds;
}
