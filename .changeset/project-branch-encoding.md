---
"@sealant/mend": patch
---

The branches and refresh endpoints answer instead of 400ing. Their handlers returned plain
objects where the contract's `ProjectBranch` is a class schema — the work succeeded (the fetch
ran) and then response encoding refused the body, starving the composer's branch picker and
`mend refresh` alike. Handlers now construct instances, and a contract test pins the invariant:
class schemas encode instances only, shape-alikes compile and then fail at runtime.
