import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tailwind 4 runs as a Vite plugin rather than through postcss, so there is no
// postcss.config and no tailwind.config: the theme lives in src/App.css.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The same "@/" alias the components already use, so moving them needed no edits.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    // The API defaults to 3000, so the UI takes 3001. CORS_ORIGINS on the server lists both.
    port: 3001,
  },

  build: {
    rollupOptions: {
      output: {
        // The screens are already split a chunk each by React.lazy in AppRoutes. This splits
        // the libraries out of the entry as well, which is about caching rather than size:
        // app code changes on every deploy, React and framer-motion change a few times a
        // year, and in one chunk together a one-line fix invalidates all of it in every
        // returning visitor browser.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          motion: ["framer-motion"],
          query: ["@tanstack/react-query"],
          forms: ["react-hook-form", "@hookform/resolvers", "zod"],
        },
      },
    },
  },
});
