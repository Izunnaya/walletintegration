import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import "./App.css";
import AppRoutes from "./AppRoutes";
import SkeletonProvider from "./components/SkeletonProvider";
import { ThemeProvider } from "./components/ThemeProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { Toaster } from "./components/ui/sonner";
import { ApiError } from "./api/contracts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        count < 1 && error instanceof ApiError && error.status >= 500,
      staleTime: 15_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <MotionConfig reducedMotion="user">
              <SkeletonProvider>
                <Toaster position="bottom-right" />
                <AppRoutes />
              </SkeletonProvider>
            </MotionConfig>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </Router>
  </StrictMode>,
);
