---
"@sealant/mend": patch
---

`mend server setup`, `start`, `restart` and `upgrade` now announce each slow phase before it starts:
resolving the release, downloading assets, pulling images, starting containers and waiting for
health. Image pulls show Docker's own progress on the terminal instead of running silently, so a
first setup no longer looks frozen for the minutes a pull takes.
