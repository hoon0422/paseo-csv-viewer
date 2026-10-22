# SPEC recheck

Reviewed `a9efd0f...9fde2e44077e108f2ddde81730d4acb4944b085f`, including product commit `13390f27`.

**Prior P1 resolved.** The specification requires “canceled or replaced work to stop affecting the panel.” `server/session.ts:283–284` now rejects stale IDs and duplicate active starts synchronously; `beginPage` calls that admission check at line 332 before replacing the polling owner at line 334. The intervening code contains no asynchronous yield. Thus start(2), stale start(1), duplicate active start(2), poll(2) preserves request 2 and its result. Completed-query paging with the same ID remains permitted.

`tests/session.test.ts:154–184` exercises precisely that sequence with a real CSV, asserts the expected matching row, and verifies subsequent same-ID paging. Retained red evidence fails before repair; the isolated post-merge suite records 42 passes and typecheck passes. I did not rerun them.

**No concrete new SPEC defect or scope creep found in this delta.** `client/panel.tsx:126–134` preserves the existing sort transition; `client/table.tsx:91–100` adds cell values to accessible labels while copying the unchanged raw value. Standards-axis disposition remains separate.

The rebuilt tarball's checked SHA-256 matches `8db56bbc46c2cc6c7b42b6ff009554bcd7515653645ceb757a05dfe0e3d4d0bc`. Recorded desktop proof covers this artifact; earlier 5GB measurements remain attributable only to the previous artifact.

No runtime/app/Space operations or repository edits performed. OS-level cell accessibility/spoken output and isolated macOS/Windows acceptance remain unverified; #10/#1 remain open, and this is not full-spec completion.
