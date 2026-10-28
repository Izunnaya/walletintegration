import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTransfer, fetchTransfers, sendTransfer } from "./demoWorkspace";
import { walletKeys } from "./WalletApi";
import type { SendTransferRequest, Transfer } from "./types";

export const transferKeys = {
  all: ["transfers"] as const,
  one: (id: string) => ["transfers", id] as const,
};

export const useTransfers = () => {
  const { data: transfers, isPending, isError, error } = useQuery({
    queryKey: transferKeys.all,
    queryFn: fetchTransfers,
  });

  return { transfers: transfers ?? [], isPending, isError, error };
};

export const useTransfer = (id: string | undefined) => {
  const { data: transfer, isPending, isError, error } = useQuery({
    queryKey: transferKeys.one(id ?? ""),
    queryFn: () => fetchTransfer(id!),
    // Without this the query runs with an empty id the moment the route has no :id.
    enabled: Boolean(id),
  });

  return { transfer, isPending, isError, error };
};

export const useSendTransfer = () => {
  const queryClient = useQueryClient();

  const {
    mutateAsync: send,
    isPending,
    isError,
    error,
    reset,
  } = useMutation<Transfer, Error, SendTransferRequest>({
    mutationFn: sendTransfer,

    // retry stays off deliberately. A transfer is not safe to repeat on the library's
    // schedule: the Idempotency-Key is what makes a repeat safe, and the key belongs to the
    // attempt the user authorised. Retrying is the user pressing the button again with the
    // same key, which is why the form holds the key rather than generating one per call.
    retry: false,

    onSuccess: () => {
      // The balance and both transfer lists are now stale. One invalidation, and every screen
      // showing them refetches - this is the reason the data lives in the cache.
      void queryClient.invalidateQueries({ queryKey: walletKeys.mine });
      void queryClient.invalidateQueries({ queryKey: transferKeys.all });
    },
  });

  return { send, isPending, isError, error, reset };
};
