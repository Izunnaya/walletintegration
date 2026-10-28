import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import "./App.css";
import AppRoutes from "./AppRoutes";
import SkeletonProvider from "./components/SkeletonProvider";
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
          {/*
            reducedMotion="user" is the whole accessibility story for animation, set once.
            framer-motion then drops transforms and scale for anyone whose system asks for
            reduced motion, keeping opacity only, so no component has to check for itself
            and none of them can forget. Vestibular disorders make movement genuinely
            unpleasant, and this is the setting people use to say so.
          */}
          <MotionConfig reducedMotion="user">
            <SkeletonProvider>
              <AppRoutes />
            </SkeletonProvider>
          </MotionConfig>
        </WorkspaceProvider>
      </QueryClientProvider>
    </Router>
  </StrictMode>,
);
