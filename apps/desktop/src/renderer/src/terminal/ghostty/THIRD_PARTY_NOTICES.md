# Third-party notices

## t3code terminal adapter

This directory is adapted from t3code's browser terminal (`apps/web/src/terminal/ghostty/` in
[pingdotgg/t3code](https://github.com/pingdotgg/t3code), MIT, © 2026 T3 Tools Inc.), taken at
nightly `v0.0.34-nightly.20260819.1133`.

Mend changes are marked with `// Mend:` comments; the substantive one widens
`GhosttyTerminalSurface.write` to accept `Uint8Array` (Mend's transport is binary WebSocket frames;
t3's delivered strings).

## Ghostty / libghostty-vt

`vendor/ghostty-vt.wasm` and `vendor/ghostty-write-pty.wasm` are built from the official
`libghostty-vt` C ABI ([ghostty-org/ghostty](https://github.com/ghostty-org/ghostty), MIT, ©
Mitchell Hashimoto & Ghostty contributors), pinned by t3code at revision
`9f62873bf195e4d8a762d768a1405a5f2f7b1697` and reproducible with t3code's
`apps/web/scripts/build-libghostty-wasm.sh`.

## Symbols Nerd Font

`fonts/SymbolsNerdFontMono-Regular.woff2` is the symbols-only Nerd Font (MIT, © 2014 Ryan L
McIntyre) — license in `fonts/LICENSE`.
