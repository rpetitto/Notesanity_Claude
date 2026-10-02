import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    base: process.env["VITE_BASE"] || "/",
    plugins: [tailwindcss(), react()],
    build: {
        outDir: "dist/client",
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            "/api": {
                // `npm run dev` (wrangler) serves the API with the real bindings.
                target: "http://localhost:8787",
                changeOrigin: true,
            },
        },
    },
});
