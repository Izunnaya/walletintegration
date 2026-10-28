import { useQuery } from "@tanstack/react-query";
import { fetchMyWallet } from "./demoWorkspace";

// One file per resource, each exporting hooks the screens call. A screen never fetches and
// never holds server data in useState: it asks a hook and renders whatever comes back.
//
// That is the reason for TanStack Query here rather than useEffect. The balance appears on
// the overview and again in the transfer form, the transfer list appears on two screens, and
// a completed transfer has to change all of them. With a query cache that is one
// invalidation. With useState it is prop drilling, or the same request firing twice and the
// two copies disagreeing - which is what the export did.
//
// Nothing here knows the data is currently coming from a stand-in. Swapping demoWorkspace
// for fetch changes this file and leaves every caller alone.

export const walletKeys = {
  mine: ["wallet", "me"] as const,
};

export const useMyWallet = () => {
  const { data: wallet, isPending, isError, error } = useQuery({
    queryKey: walletKeys.mine,
    queryFn: fetchMyWallet,
  });

  return { wallet, isPending, isError, error };
};
