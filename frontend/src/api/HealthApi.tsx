import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "./client";

export const useServiceHealth = () => useQuery({
  queryKey: ["health"],
  queryFn: async ({ signal }) => {
    await Promise.all([
      apiRequest("/health/live", z.object({ status: z.literal("ok") }), { signal }),
      apiRequest("/health/ready", z.object({ status: z.literal("ready") }), { signal }),
    ]);
    return true;
  },
  staleTime: 60_000,
});
