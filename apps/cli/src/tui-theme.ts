import { TextAttributes, type ThemeMode } from "@opentui/core";

/**
 * Terminal-native theming: the user's terminal supplies the background and
 * the body ink — nothing paints a canvas, so the TUI sits inside whatever
 * scheme the terminal already has. Hierarchy is the terminal's own DIM and
 * BOLD; color appears only where it carries one meaning (DESIGN.md's accent
 * discipline), in mid-tones picked to stay legible on light and dark
 * schemes alike. The renderer reports which side the terminal is
 * (`renderer.themeMode`); only the values that truly need a side — diff
 * washes and the concrete ink a few renderables demand — consult it.
 */

/** Interaction and selection — the one brand accent. */
export const COBALT = "#4f7ce8";
/** Attention: unresolved judgment, drafts, waiting. */
export const AMBER = "#c08f27";
/** Observed success and diff additions. */
export const GREEN = "#3f9e63";
/** Observed failure and diff deletions. */
export const RED = "#d05f56";
/** A neutral for renderable options that need a color where DIM cannot reach. */
export const GRAY = "#7f7f7f";

/** The terminal's own de-emphasis — the whole "muted ink" ramp in one bit. */
export const DIM = TextAttributes.DIM;
export const BOLD = TextAttributes.BOLD;

/**
 * Concrete body ink for the renderables whose defaults are white-on-anything
 * (textarea, input, the diff view). Everything else omits `fg` and inherits.
 */
export const editorInk = (mode: ThemeMode | null): string =>
  mode === "light" ? "#1b1b1d" : "#eceae6";

/** Faint add/delete line washes per terminal side; an undetected side gets none. */
export const diffWashes = (
  mode: ThemeMode | null,
): { readonly add: string; readonly del: string } =>
  mode === "light"
    ? { add: "#e8f2eb", del: "#f7ebe9" }
    : mode === "dark"
      ? { add: "#233028", del: "#332a2b" }
      : { add: "transparent", del: "transparent" };

/** Mid-tone syntax colors, subordinate to the semantic accents above. */
export const SYNTAX_KEYWORD = "#9d6fd0";
export const SYNTAX_STRING = "#42855e";
export const SYNTAX_NUMBER = "#b07d2a";
export const SYNTAX_FUNCTION = "#4a7fd4";
