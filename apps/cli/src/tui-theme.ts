/**
 * The TUI's theme: a drawn interface with NO painted background — the
 * terminal's own ground shows through everything, and the borders alone
 * draw the panes. The only fills left are the ones that state something:
 * the selection row and the diff add/delete washes. Chrome is near-mono;
 * color appears only where it is a fact. Component code imports semantic
 * names from here; this file is the CLI's single color authority.
 */

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
/**
 * The one exception to the no-painted-background rule: a floating modal
 * must occlude the content beneath it, so it owns its ground.
 */
export const SURFACE = "#17171d";
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
