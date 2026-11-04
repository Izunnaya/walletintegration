import { z } from "zod";

// Normalize email before uniqueness, blacklist and login checks.
export const normalisedEmail = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "email is too short")
  .max(254, "email is too long")
  .pipe(z.string().email("email must be a valid address"));

// bcrypt reads at most 72 UTF-8 bytes; reject longer passwords before hashing.
const passwordSchema = z
  .string()
  .refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "password must be at most 72 UTF-8 bytes",
  );

export const registerRequestSchema = z.strictObject({
  email: normalisedEmail,
  name: z.string().trim().min(1, "name is required").max(120, "name is too long"),

  // Keep passwords unchanged; require at least 12 characters after surrounding whitespace.
  password: passwordSchema
    .refine((password) => password.length >= 12, "password must be at least 12 characters")
    // Without this, twelve spaces is a valid password: it passes the length check while
    // containing nothing at all.
    .refine(
      (password) => password.trim().length >= 12,
      "password must contain at least 12 characters that are not surrounding whitespace",
    ),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email: normalisedEmail,
  password: passwordSchema.refine((password) => password.length > 0, "password is required"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
