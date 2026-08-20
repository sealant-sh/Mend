import { useSyncExternalStore } from "react";

import type { ConnectionInfo } from "../../../shared/bridge";

/**
 * Where the desktop points and whether it is signed in — read once from
 * main, then kept current by `connection.onChange` (sign-in here, or
 * `mend login` / `mend logout` in a terminal: main watches the file).
 */

let info: ConnectionInfo | null = null;
let loading: Promise<null> | null = null;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

const emit = () => {
  for (const listener of listeners) listener();
};

const ensure = () => {
  if (unsubscribe === null) {
    unsubscribe = window.mend.connection.onChange((next) => {
      info = next;
      emit();
    });
  }
  if (info === null && loading === null) {
    loading = window.mend.connection.get().then((next) => {
      info = next;
      emit();
      return null;
    });
  }
};

/** Null until main has answered once — the root route waits on it. */
export const useConnection = (): ConnectionInfo | null =>
  useSyncExternalStore(
    (listener) => {
      ensure();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => info,
  );

export const loadConnection = (): Promise<ConnectionInfo> => {
  ensure();
  if (info !== null) return Promise.resolve(info);
  return (loading ?? Promise.resolve(null)).then(() => {
    if (info === null) throw new Error("connection: main did not answer");
    return info;
  });
};
