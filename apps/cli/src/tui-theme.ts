/**
 * The TUI's painted theme: a designed dark surface in the Evidence Review
 * family, tuned for terminal cells rather than transcribed from the web's
 * CSS. The canvas paints over whatever the terminal has, so the look is the
 * same everywhere — depth comes from a real canvas/panel split, selection is
 * a wash you can actually see, and the accents are bright enough to read as
 * intentional on the dark ground. Component code imports semantic names from
 * here; this file is the CLI's single color authority.
 */

/** The canvas behind everything — deep, so panels genuinely lift off it. */
export const BG = "#141419";
/** Raised panels; two steps above the canvas instead of the old near-tie. */
export const PANEL = "#1e1e26";
/** Primary text. */
export const INK = "#eeece8";
/** Secondary text. */
export const INK_2 = "#c9c7c2";
/** Tertiary text — labels, meta. */
export const MUTED = "#a3a09a";
/** The quietest legible step; anything darker reads as broken. */
export const FAINT = "#807d76";
/** Hairlines and panel borders — visible, not vanishing. */
export const RULE = "#37374a";
/**
 * Interaction and selection — the ONE accent, and the only place chrome is
 * allowed color: the focused pane border and the selection gutter bar.
 */
export const COBALT = "#6f96f5";
/** The selection wash: a neutral lifted row — visible, not colorful. */
export const WASH = "#2c2c35";
export const AMBER = "#e2ab42";
export const GREEN = "#69c189";
export const RED = "#e87f76";
/** Diff line washes — strong enough to scan, never louder than the ink. */
export const ADD_WASH = "#20362a";
export const DELETE_WASH = "#3c2b2e";

/** Syntax colors are centralized too; they are subordinate to semantic UI color. */
export const SYNTAX_KEYWORD = "#cda6f2";
export const SYNTAX_STRING = "#98cfa8";
export const SYNTAX_NUMBER = "#e6c37e";
export const SYNTAX_FUNCTION = "#94bdf7";
