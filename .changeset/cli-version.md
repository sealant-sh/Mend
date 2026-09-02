---
"@sealant/mend": minor
---

The CLI explains itself. `mend help` is an index again: one line per command, grouped into start,
sessions, services, project setup, and this machine, aligned in two columns at your terminal's
width. Every command now has its own page, `mend help <command>` or `mend <command> --help`, with
usage, a description, options, examples, and see-also; `mend help service` lists a family. Usage
errors quote the same synopsis. The same pages ship as man pages: `man mend` and
`man mend-<command>` after a global install, or `mend man <command>` from anywhere. Every
description was rewritten to say what the command does in plain words.

`mend version` (also `--version`, `-v`) prints this CLI's version, then the server's when it answers
within two seconds, and states a mismatch as a fact.
