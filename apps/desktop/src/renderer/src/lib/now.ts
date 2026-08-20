import { useSyncExternalStore } from "react";

/** A clock that ticks every 30s — enough for "12m" to stay honest. */
let now = Date.now();
const listeners = new Set<() => void>();
let timer: number | null = null;

export const useNow = (): number =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (timer === null) {
        timer = window.setInterval(() => {
          now = Date.now();
          for (const l of listeners) l();
        }, 30_000);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      };
    },
    () => now,
  );
