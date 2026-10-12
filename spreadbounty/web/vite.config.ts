import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// root is web/; the browser imports the same scoring core as the CLI and server from ../src/core
// changeOrigin stays false so the browser's Origin/Host reach the server: its same-origin check rejects proxied POSTs otherwise
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } }, fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
