import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { apiRequest } from "./client";
import { walletSchema } from "./contracts";

export const walletKeys = { mine: ["wallet"] as const };
export const useMyWallet = () => {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: [...walletKeys.mine, session?.user.id],
    queryFn: ({ signal }) =>
      apiRequest("/wallets/me", walletSchema, {
        token: session?.token,
        signal,
      }),
    enabled: Boolean(session),
  });
  return { ...query, wallet: query.data };
};
