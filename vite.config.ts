import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    sourcemap: false,

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("remark-math") ||
            id.includes("rehype-katex")
          ) {
            return "markdown";
          }

          if (id.includes("react") || id.includes("react-dom")) {
            return "react";
          }

          if (id.includes("zustand") || id.includes("zod") || id.includes("lucide-react")) {
            return "vendor";
          }
        },
      },
    },
  },
}));
