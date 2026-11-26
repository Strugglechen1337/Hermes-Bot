import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const bffPort = Number(process.env.PORT || 9135);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5178,
    proxy: {
      "/api/ws": {
        target: `ws://127.0.0.1:${bffPort}`,
        ws: true,
        changeOrigin: false,
      },
      "/api": {
        target: `http://127.0.0.1:${bffPort}`,
        changeOrigin: false,
      },
      "/auth": {
        target: `http://127.0.0.1:${bffPort}`,
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
