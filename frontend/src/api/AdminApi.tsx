import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { apiRequest } from "./client";
import { auditSchema, restrictionSchema } from "./contracts";

const auditKey = ["admin", "audit"] as const;
export const useAuditEntries = () => {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: [...auditKey, session?.user.id],
    queryFn: ({ signal }) =>
      apiRequest("/admin/audit", auditSchema, {
        token: session?.token,
        signal,
      }),
    enabled: session?.user.role === "admin",
  });
  return { ...query, entries: query.data?.entries ?? [] };
};
export const useSetRestriction = () => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      userId,
      action,
      reason,
    }: {
      userId: string;
      action: "block" | "unblock";
      reason: string;
    }) =>
      apiRequest(
        `/admin/users/${encodeURIComponent(userId)}/${action}`,
        restrictionSchema,
        { token: session?.token, body: { reason } },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: auditKey });
    },
  });
  return { ...mutation, setRestriction: mutation.mutateAsync };
};
