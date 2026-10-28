import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
} | null>(null);
function storedTheme(): Theme {
  try {
    return localStorage.getItem("folio.theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    try {
      localStorage.setItem("folio.theme", theme);
    } catch {
      /* The theme still works without storage. */
    }
  }, [theme]);
  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme: () =>
          setTheme((current) => (current === "dark" ? "light" : "dark")),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme requires ThemeProvider");
  return theme;
}
