import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// root is web/; the browser imports the same scoring core as the CLI and server from ../src/core
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" }, fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
