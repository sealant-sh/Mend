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
      "/api": "http://localhost:3105",
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
