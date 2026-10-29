import { z } from "zod";

export const restrictionRequestSchema = z.strictObject({
  reason: z.string().trim().min(3, "reason is required").max(500, "reason is too long"),
});

export type RestrictionRequest = z.infer<typeof restrictionRequestSchema>;
