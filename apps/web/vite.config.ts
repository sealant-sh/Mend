import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dev runs two processes: this vite server for the app, and the Effect server
// (src/entry/main.ts) for API + auth on 3105. The proxy keeps them one origin.
const config = defineConfig({
  server: {
    port: 3101,
    proxy: {
      // ws: the terminal rides a WebSocket (/api/tty); the shorthand form
      // proxies only HTTP and leaves the upgrade hanging forever in dev.
      "/api": { target: "http://localhost:3105", ws: true },
    },
  },
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
