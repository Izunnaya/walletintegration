import { z } from "zod";
import { ApiError } from "./contracts";

export const SESSION_EXPIRED = "wallet:session-expired";
const baseUrl = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const failureSchema = z.object({ error: z.object({
  code: z.string(), message: z.string(), requestId: z.string().optional(),
  details: z.array(z.object({ field: z.string().nullable(), message: z.string() })).optional(),
}) });

type Options = { token?: string; body?: unknown; signal?: AbortSignal; idempotencyKey?: string };

export function retryDelay(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined;
}

export async function apiRequest<T>(path: string, schema: z.ZodType<T>, options: Options = {}): Promise<T> {
  const { token, body, signal, idempotencyKey } = options;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("NETWORK_ERROR", 0, "The server could not be reached. Check your connection and try again.");
  }
  const payload: unknown = await response.json().catch(() => null);
  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  if (!response.ok) {
    const parsed = failureSchema.safeParse(payload);
    if (response.status === 401 && token) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED, { detail: token }));
    throw new ApiError(
      parsed.success ? parsed.data.error.code : "HTTP_ERROR", response.status,
      parsed.success ? parsed.data.error.message : `The server returned HTTP ${response.status}. Please try again.`,
      parsed.success ? parsed.data.error.requestId ?? requestId : requestId,
      retryDelay(response.headers.get("Retry-After")), parsed.success ? parsed.data.error.details ?? [] : [],
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError("INVALID_RESPONSE", response.status, "The server returned an unexpected response.", requestId);
  return parsed.data;
}
