import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Two things that are genuinely app-wide: the colour scheme, and which role the workspace is
// being previewed as. Everything else the export kept at the top of one component is either
// server data, which now lives in the query cache, or screen-local state, which now lives in
// the screen that uses it.
//
// The role selector exists only because there is no sign-in yet. When /auth/login issues a
// token, the role comes out of that token and this goes away - which is why it is a provider
// with a tiny surface rather than threaded through props.

type Role = "admin" | "user";

type Workspace = {
  role: Role;
  setRole: (role: Role) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);

const THEME_STORAGE_KEY = "folio.theme";

// localStorage throws in a private window and returns nothing when site data is cleared, so
// every read is guarded and the app renders correctly without it.
function storedTheme(): "light" | "dark" {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  const [role, setRole] = useState<Role>("admin");
  const [theme, setTheme] = useState<"light" | "dark">(storedTheme);

  // Tailwind's dark variant is driven by the class on <html>, so the class is the source of
  // truth for styling and this effect is what keeps it in step with the state.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // A preference that cannot be saved is not worth failing a render over.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(() => ({ role, setRole, theme, toggleTheme }), [role, theme, toggleTheme]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
};
