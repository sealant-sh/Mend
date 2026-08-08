import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dev runs two processes: this vite server for the app, and the Effect server
// (src/entry/main.ts) for API + auth on 3105. The proxy keeps them one origin.

// Vite refuses Host headers it doesn't recognise (DNS-rebinding guard). Bare
// IPs pass on their own, so reaching dev by LAN or tailnet address needs
// nothing here; a MagicDNS or mDNS name does. MEND_DEV_HOSTS carries those,
// comma-separated, so no operator's private hostname lands in the repo.
const allowedHosts = process.env.MEND_DEV_HOSTS?.split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

const config = defineConfig({
  server: {
    // The workbench is steered from any device on the operator's network
    // (ARCHITECTURE.md §9), so dev binds every interface, not just loopback.
    host: true,
    port: 3101,
    ...(allowedHosts && allowedHosts.length > 0 ? { allowedHosts } : {}),
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
