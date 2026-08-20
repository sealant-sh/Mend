import type { MendBridge } from "../../shared/bridge";

declare global {
  interface Window {
    /** The preload bridge — the renderer's only path to the Mend server. */
    readonly mend: MendBridge;
  }
}
