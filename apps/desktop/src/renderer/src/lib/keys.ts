import { useEffect, useRef } from "react";

/**
 * The keybindings (BRIEF.md §keyboard). One capture-phase listener on the
 * window so the combos work even while the terminal owns focus; everything
 * uses Ctrl+Shift (or Ctrl+digit / Ctrl+Tab) so readline and TUI apps never
 * see a key they care about. t3code's jump model: Ctrl+1..9 jumps the inbox.
 */
export interface KeyActions {
  readonly nextSession: () => void;
  readonly prevSession: () => void;
  readonly nextProject: () => void;
  readonly prevProject: () => void;
  readonly newShellTab: () => void;
  readonly closeTab: () => void;
  readonly nextTab: () => void;
  readonly prevTab: () => void;
  readonly jumpInbox: (index: number) => void;
  readonly togglePalette: () => void;
  readonly toggleServices: () => void;
  readonly fontBigger: () => void;
  readonly fontSmaller: () => void;
  readonly fontReset: () => void;
  readonly openSettings: () => void;
}

export const useKeybindings = (actions: KeyActions): void => {
  const ref = useRef(actions);
  ref.current = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const bound = ref.current;

      // Ctrl+Tab / Ctrl+Shift+Tab — tab cycling within the project.
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) bound.prevTab();
        else bound.nextTab();
        return;
      }

      // Ctrl+, — settings (the platform convention).
      if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.code === "Comma"
      ) {
        event.preventDefault();
        event.stopPropagation();
        bound.openSettings();
        return;
      }

      // Ctrl+1..9 — inbox jump (t3's mod+N).
      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        const digit = Number(event.key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
          event.preventDefault();
          event.stopPropagation();
          bound.jumpInbox(digit - 1);
          return;
        }
      }

      // Ctrl+Shift+<letter or zoom key>.
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      // Zoom by physical key (Equal/Minus/Digit0), layout-independent.
      const zoom =
        event.code === "Equal"
          ? bound.fontBigger
          : event.code === "Minus"
            ? bound.fontSmaller
            : event.code === "Digit0"
              ? bound.fontReset
              : null;
      if (zoom !== null) {
        event.preventDefault();
        event.stopPropagation();
        zoom();
        return;
      }
      const key = event.key.toLowerCase();
      const handler =
        key === "j"
          ? bound.nextSession
          : key === "k"
            ? bound.prevSession
            : key === "l"
              ? bound.nextProject
              : key === "h"
                ? bound.prevProject
                : key === "t"
                  ? bound.newShellTab
                  : key === "w"
                    ? bound.closeTab
                    : key === "p"
                      ? bound.togglePalette
                      : key === "s"
                        ? bound.toggleServices
                        : null;
      if (handler === null) return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
};
