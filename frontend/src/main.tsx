import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./App.css";
import AppRoutes from "./AppRoutes";
import { WorkspaceProvider } from "./components/WorkspaceProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A wallet balance refetching because the window regained focus is noise, not news.
      refetchOnWindowFocus: false,
      // A read that fails is worth one more attempt; the API answers 503 for a transient
      // failure precisely so a client knows retrying is reasonable. Writes set retry: false
      // themselves, because a transfer is not safe to repeat on a schedule.
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider>
          <AppRoutes />
        </WorkspaceProvider>
      </QueryClientProvider>
    </Router>
  </StrictMode>,
);
