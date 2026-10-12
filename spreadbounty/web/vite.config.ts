import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// root is web/; the browser imports the same scoring core as the CLI and server from ../src/core
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } } // keep the browser's Origin/Host: the server's same-origin check rejects proxied POSTs otherwise, fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
