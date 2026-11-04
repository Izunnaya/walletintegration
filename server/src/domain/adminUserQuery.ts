import { z } from "zod";

// Query parameters for GET /admin/users.
//
// The same keyset pagination the transfer history uses, for the same reason: a cursor is a
// user id and the next page is everything below it, so a page cannot shift or repeat a row
// because an account was created while an admin was reading. OFFSET would do exactly that.
//
// The search runs on the server rather than over the loaded page. An admin looking for one
// account among many would otherwise only find it after paging to it, which is not a search.

export const adminUserQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),

  cursor: z
    .string()
    .trim()
    .regex(/^\d+$/, "cursor must be a user id")
    .transform((value) => BigInt(value))
    .pipe(z.bigint().positive().max(9_223_372_036_854_775_807n))
    .optional(),

  // Matched against name, email and wallet id. Bounded because it reaches a LIKE, and an
  // unbounded pattern is an invitation to make the database do unbounded work.
  search: z.string().trim().max(120).optional(),

  // The same three states the list renders as badges. Blacklisted takes precedence over
  // blocked, so the filters partition the accounts rather than overlapping: an account that
  // is both is blacklisted, because that is the restriction an admin cannot lift here.
  status: z.enum(["all", "active", "blocked", "blacklisted"]).default("all"),
});

export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;
