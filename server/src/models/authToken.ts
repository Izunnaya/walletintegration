import jwt from "jsonwebtoken";
import { z } from "zod";
import { databaseIdSchema } from "../domain/transferRequest.ts";

// Issuing and reading the JWT.
//
// The token says who the caller is. It is never the source of what they may do to a
// specific wallet: ownership is re-read from the database under a row lock, because a token
// minted an hour ago cannot know who owns a wallet now.

// Read through a function so the checked value is typed string rather than string |
// undefined: TypeScript does not carry the narrowing into the closures below.
function readSigningSecret(): string {
  const configured = process.env.JWT_SECRET;

  if (!configured || configured.length < 32) {
    throw new Error(
      "JWT_SECRET must be set and at least 32 characters. A short secret can be brute forced offline.",
    );
  }

  return configured;
}

const secret = readSigningSecret();

// Short-lived, as the spec asks. It limits how long a stolen token is useful; it does not
// stop someone holding a valid one from using it, which is why the transfer re-checks
// ownership and restrictions rather than trusting the claims.
const TOKEN_LIFETIME = "1h";

export type AuthenticatedCaller = {
  userId: bigint;
  role: "customer" | "admin";
};

// The payload is parsed on the way in, not trusted. A token we signed should always match,
// but "should" is not a guarantee once a secret is rotated or a payload shape changes.
const claimsSchema = z.object({
  sub: databaseIdSchema,
  role: z.enum(["customer", "admin"]),
});

export function issueToken(caller: AuthenticatedCaller): string {
  return jwt.sign({ sub: caller.userId.toString(), role: caller.role }, secret, {
    expiresIn: TOKEN_LIFETIME,
    algorithm: "HS256",
  });
}

export type TokenResult =
  | { ok: true; caller: AuthenticatedCaller }
  | { ok: false; reason: "EXPIRED" | "INVALID" };

export function readToken(token: string): TokenResult {
  let payload: unknown;

  try {
    // The algorithm is pinned. Without this, a token could arrive claiming alg: "none" and
    // some verifiers would accept it unsigned.
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    return { ok: false, reason: expired ? "EXPIRED" : "INVALID" };
  }

  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) {
    return { ok: false, reason: "INVALID" };
  }

  return {
    ok: true,
    caller: { userId: claims.data.sub, role: claims.data.role },
  };
}
