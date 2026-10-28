import { z } from "zod";

export const databaseIdSchema = z.string().trim().regex(/^\d+$/, "Enter a numeric ID.")
  .pipe(z.coerce.bigint().positive().max(9_223_372_036_854_775_807n)).transform(String);
export const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email("Enter a valid email address.");
export const passwordSchema = z.string().min(1, "Enter your password.")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "Use at most 72 UTF-8 bytes.");
export const registrationPasswordSchema = passwordSchema.refine(
  (value) => value.trim().length >= 12, "Use at least 12 characters excluding surrounding spaces.",
);
