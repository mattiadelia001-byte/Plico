import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Il motore PDF (MuPDF) è WebAssembly: va escluso dalla pre-compilazione di Vite.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["mupdf"] },
  build: { target: "esnext" },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
