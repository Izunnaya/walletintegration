import { z } from "zod";

// Registration and login use the same email normalization: trim, then lowercase. The same
// normalised value is used for uniqueness, the blacklist check and login, and the database
// enforces the rule again through users_email_normalised and blacklist_email_normalised.
// Two tables, one definition of what an email is, so they cannot disagree.
//
// Trimming handles spaces, tabs and newlines around the address. A space *inside* one is
// refused by the email check rather than silently removed, because "ad a@example.com" is
// not a typo we can safely guess at.
export const normalisedEmail = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "email is too short")
  .max(254, "email is too long")
  .pipe(z.string().email("email must be a valid address"));

// bcrypt ignores input beyond 72 UTF-8 bytes, so reject it before hashing or comparing.
//
// It truncates silently rather than complaining, which makes this a real hole and not just
// a tidiness rule: without the cap, someone could set a 200 character password believing it
// strong, while anyone knowing its first 72 bytes could sign in. Bytes rather than
// characters, because one emoji or accented letter can take up to four.
//
// Login applies the same cap. If it did not, a password longer than 72 bytes would appear
// to work through truncation, which is worse than refusing it.
const passwordSchema = z
  .string()
  .refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "password must be at most 72 UTF-8 bytes",
  );

export const registerRequestSchema = z.strictObject({
  email: normalisedEmail,
  name: z.string().trim().min(1, "name is required").max(120, "name is too long"),

  // Length only, and nothing about composition. A rule demanding one upper, one digit and
  // one symbol shrinks the search space more than it raises the cost, which is why NIST
  // stopped recommending them. Spaces are allowed and wanted: a passphrase beats a short
  // cryptic string.
  //
  // The password is never trimmed. It is a secret, and silently altering what someone typed
  // is worse than storing it as given. Login does not trim either, so the two always agree
  // about what the password is.
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

// Login imposes no length rule beyond being present. A "too short to be ours" rejection
// would be a hint about what our passwords look like, and the credentials are either right
// or they are not.
export const loginRequestSchema = z.strictObject({
  email: normalisedEmail,
  password: passwordSchema.refine((password) => password.length > 0, "password is required"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
