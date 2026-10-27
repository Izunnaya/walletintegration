import { z } from "zod";

// Registration and login request shapes.
//
// The email rule is one rule, applied once, here: trim then lowercase. The same normalised
// value is used for uniqueness, for the blacklist check and for login, and the database
// enforces it again with users_email_normalised and blacklist_email_normalised. Two tables,
// one definition of what an email is, so they cannot disagree.

export const normalisedEmail = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "email is too short")
  .max(254, "email is too long")
  .pipe(z.string().email("email must be a valid address"));

// strictObject, not object. A registration body carrying role, isBlocked, balanceMinor or
// isSystem is refused rather than silently stripped, which is Q17 settled as reject. A
// client sending role: "admin" is either a bug or an escalation attempt, and both are worth
// telling the caller about. Dropping the field quietly would hide the bug and teach the
// attacker nothing either way.
export const registerRequestSchema = z.strictObject({
  email: normalisedEmail,
  name: z.string().trim().min(1, "name is required").max(120, "name is too long"),
  // Length only. A composition rule (one upper, one digit, one symbol) shrinks the search
  // space more than it raises the cost, and NIST stopped recommending them.
  password: z
    .string()
    .min(12, "password must be at least 12 characters")
    .max(200, "password must be at most 200 characters"),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// Login is not strict about length or shape beyond being present. The credentials are
// either right or they are not, and telling a caller their password was "too short to be
// ours" is a hint about what our passwords look like.
export const loginRequestSchema = z.strictObject({
  email: normalisedEmail,
  password: z.string().min(1, "password is required"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
