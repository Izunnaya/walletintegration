import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { apiRequest } from "./client";
import { adminUserPageSchema, auditSchema, restrictionSchema } from "./contracts";

const auditKey = ["admin", "audit"] as const;
const usersKey = ["admin", "users"] as const;

export type UserStatusFilter = "all" | "active" | "blocked" | "blacklisted";

// The accounts an admin can act on. The search goes to the server rather than filtering the
// page in the browser, so looking for one account among many finds it without paging to it.
export const useUsers = (search: string, status: UserStatusFilter = "all") => {
  const { session } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [...usersKey, session?.user.id, search, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiRequest(
        `/admin/users?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}${status === "all" ? "" : `&status=${status}`}`,
        adminUserPageSchema,
        { token: session?.token, signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: session?.user.role === "admin",
    // Keep the rows on screen while a new search runs, rather than blanking the table.
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    users: query.data?.pages.flatMap((page) => page.users) ?? [],
    pages: query.data?.pages.map((page) => page.users) ?? [],
  };
};
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
      // Both lists change: the audit gains a row and the user's status moves with it.
      void queryClient.invalidateQueries({ queryKey: auditKey });
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
  return { ...mutation, setRestriction: mutation.mutateAsync };
};
