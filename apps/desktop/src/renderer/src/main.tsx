import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { startTheme } from "#/lib/theme";

import { router } from "./router";

startTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("renderer: #root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
