import { defineConfig } from "vite";

// Vite config tuned for Tauri 2.0.
// Ref: https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  // Prevent Vite from clearing the terminal (Tauri prints its own logs).
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't watch the Rust backend directory.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
