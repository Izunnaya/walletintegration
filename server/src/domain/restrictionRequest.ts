import { z } from "zod";

// The body of a block or unblock. A reason is required, not optional: the audit trail exists
// to answer "who changed this, when, and why", and an entry with no why answers two thirds
// of the question.
export const restrictionRequestSchema = z.strictObject({
  reason: z.string().trim().min(3, "reason is required").max(500, "reason is too long"),
});

export type RestrictionRequest = z.infer<typeof restrictionRequestSchema>;
