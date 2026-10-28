import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/auth/AuthProvider";
import { apiRequest } from "./client";
import {
  historyTransferSchema,
  transferPageSchema,
  transferSchema,
} from "./contracts";
import type { SendTransferRequest, Transfer } from "./contracts";
import { walletKeys } from "./WalletApi";

export const transferKeys = { all: ["transfers"] as const };
export const useTransfers = () => {
  const { session } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [...transferKeys.all, session?.user.id, "list"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiRequest(
        `/transfers?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        transferPageSchema,
        { token: session?.token, signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(session),
  });
  return {
    ...query,
    transfers: query.data?.pages.flatMap((page) => page.transfers) ?? [],
  };
};
export const useTransfer = (id: string | undefined) => {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: [...transferKeys.all, session?.user.id, id],
    queryFn: ({ signal }) => {
      if (!id) throw new Error("A transfer ID is required");
      return apiRequest(
        `/transfers/${encodeURIComponent(id)}`,
        z.object({ transfer: historyTransferSchema }),
        { token: session?.token, signal },
      );
    },
    enabled: Boolean(session && id),
  });
  return { ...query, transfer: query.data?.transfer };
};
export const useSendTransfer = () => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({
      idempotencyKey,
      ...details
    }: SendTransferRequest): Promise<Transfer> => {
      const response = await apiRequest(
        "/transfers",
        z.object({ transfer: transferSchema }),
        {
          token: session?.token,
          body: { ...details, currency: "NGN" },
          idempotencyKey,
        },
      );
      return { ...response.transfer, direction: "sent" };
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletKeys.mine });
      void queryClient.invalidateQueries({ queryKey: transferKeys.all });
    },
  });
  return { ...mutation, send: mutation.mutateAsync };
};
