import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAccount, fetchUsers, setRestriction } from "./demoWorkspace";
import { walletKeys } from "./WalletApi";
import type { WalletUser } from "./types";

export const adminKeys = {
  users: ["admin", "users"] as const,
};

export const useUsers = () => {
  const { data: users, isPending, isError, error } = useQuery({
    queryKey: adminKeys.users,
    queryFn: fetchUsers,
  });

  return { users: users ?? [], isPending, isError, error };
};

type RestrictionRequest = { walletId: string; blocked: boolean; reason: string };

export const useSetRestriction = () => {
  const queryClient = useQueryClient();

  const { mutateAsync: setUserRestriction, isPending, isError, error, reset } = useMutation<
    WalletUser,
    Error,
    RestrictionRequest
  >({
    mutationFn: ({ walletId, blocked, reason }) => setRestriction(walletId, blocked, reason),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users });
      // Blocking the signed-in wallet changes what the overview is allowed to offer.
      void queryClient.invalidateQueries({ queryKey: walletKeys.mine });
    },
  });

  return { setUserRestriction, isPending, isError, error, reset };
};

type CreateAccountRequest = { name: string; email: string; password: string };

export const useCreateAccount = () => {
  const queryClient = useQueryClient();

  const { mutateAsync: create, isPending, isError, error, reset } = useMutation<
    WalletUser,
    Error,
    CreateAccountRequest
  >({
    // The password is accepted and not forwarded, because the stand-in has nothing to hash
    // it with and storing it in the browser would be worse than dropping it. When this talks
    // to /auth/register it goes in the body and never anywhere else.
    mutationFn: ({ name, email }) => createAccount({ name, email }),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users });
    },
  });

  return { create, isPending, isError, error, reset };
};
