import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sessionSchema } from "@/api/contracts";
import type { Session } from "@/api/contracts";
import { SESSION_EXPIRED } from "@/api/client";

const SESSION_KEY = "wallet.session";
function restoreSession(): Session | null {
  try { return sessionSchema.parse(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null")); }
  catch { return null; }
}
type Auth = { session: Session | null; signIn: (session: Session) => void; signOut: () => void };
const AuthContext = createContext<Auth | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState(restoreSession);
  const queryClient = useQueryClient();
  const signOut = useCallback(() => {
    void queryClient.cancelQueries();
    queryClient.clear();
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* An in-memory session can still be signed out. */ }
    setSession(null);
  }, [queryClient]);
  const signIn = (next: Session) => {
    void queryClient.cancelQueries();
    queryClient.clear();
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* Keep this session in memory. */ }
    setSession(next);
  };
  useEffect(() => {
    const expire = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === session?.token) signOut();
    };
    window.addEventListener(SESSION_EXPIRED, expire);
    return () => window.removeEventListener(SESSION_EXPIRED, expire);
  }, [session?.token, signOut]);
  return <AuthContext.Provider value={{ session, signIn, signOut }}>{children}</AuthContext.Provider>;
};
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider");
  return context;
}
