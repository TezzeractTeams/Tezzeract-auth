import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * In production the server serves web/dist from the same origin, so the
 * frontend only ever makes same-origin requests. The dev proxy reproduces that
 * shape: /api, the OIDC endpoints and the session cookie all appear to come
 * from the Vite origin, so there is no code path that behaves differently in
 * development.
 */
const SERVER_ORIGIN = process.env["AUTH_SERVER_ORIGIN"] ?? "http://localhost:3000";

const PROXIED = [
  "/api",
  "/authorize",
  "/token",
  "/jwks",
  "/userinfo",
  "/session",
  "/end_session",
  "/.well-known",
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Suffix match so any ngrok-free.dev tunnel works (the subdomain changes
    // each time the tunnel restarts). localhost and IPs remain allowed by default.
    allowedHosts: [".ngrok-free.dev"],
    proxy: Object.fromEntries(
      PROXIED.map((path) => [path, { target: SERVER_ORIGIN, changeOrigin: false }]),
    ),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  build: {
    sourcemap: true,
    // Fail the build rather than shipping a chunk big enough to hide a
    // mistakenly bundled dependency.
    chunkSizeWarningLimit: 600,
  },
});
