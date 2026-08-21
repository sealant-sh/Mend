/**
 * The rail's width contract, t3code's threadSidebarWidth.ts as pure
 * functions: a minimum, a default, and a maximum derived from the viewport
 * so the main pane never drops under its own floor. Persisted as a plain
 * number; double-clicking the rail forgets it.
 */

export const SIDEBAR_WIDTH_KEY = "mend-sidebar-width";
export const SIDEBAR_DEFAULT_WIDTH = 272;
export const SIDEBAR_MIN_WIDTH = 208;
/** The terminal + tab strip need at least this much; the rail may grow until they would not. */
export const MAIN_MIN_WIDTH = 640;

export const sidebarMaxWidth = (viewportWidth: number): number =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.floor(viewportWidth) - MAIN_MIN_WIDTH);

export const clampSidebarWidth = (width: number, viewportWidth: number): number =>
  Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), sidebarMaxWidth(viewportWidth));

/** stored ?? default, clamped up to the minimum and down to the derived maximum. */
export const initialSidebarWidth = (stored: number | null, viewportWidth: number): number =>
  clampSidebarWidth(
    stored !== null && Number.isFinite(stored) ? stored : SIDEBAR_DEFAULT_WIDTH,
    viewportWidth,
  );

export const readStoredSidebarWidth = (): number | null => {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

export const storeSidebarWidth = (width: number | null): void => {
  try {
    if (width === null) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    else localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable — the width still holds this window.
  }
};
