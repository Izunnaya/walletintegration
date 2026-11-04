import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import { registrationSchema, sessionSchema } from "./contracts";

export const useLogin = () => {
  const {
    mutateAsync: login,
    isPending,
    error,
    reset,
  } = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiRequest("/auth/login", sessionSchema, { body }),
    retry: false,
  });
  return { login, isPending, error, reset };
};
export const useCreateAccount = () => {
  const queryClient = useQueryClient();
  const {
    mutateAsync: createAccount,
    isPending,
    error,
  } = useMutation({
    mutationFn: (body: { name: string; email: string; password: string }) =>
      apiRequest("/auth/register", registrationSchema, { body }),
    retry: false,
    // A new account belongs in the admin list straight away. The public sign-up page has no
    // such list cached, where this is a no-op.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
  return { createAccount, isPending, error };
};
