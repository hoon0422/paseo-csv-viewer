# Standards review

HEAD: `a9efd0f5b0eda155c9ff26a443fe509025968e21`.
Diff: `git diff 168bb91cef429b159c3ff1b182b3e90b895bf904...HEAD`.

## Confirmed documented-standard breach

**P2 — Cell accessible names omit the data.** `client/table.tsx:91–95` explicitly labels each button `Copy cell row ${rowIndex + 1}, ${columns[index] ...}`, while the actual value appears only in its child Text. The explicit accessible name replaces the text-derived name: keyboard/screen-reader focus identifies the copy action and column but does not announce the value being inspected. This breaches active Ponytail-full’s “Never cut: … accessibility” rule (`/Users/Younghoon/.codex/plugins/cache/ponytail/ponytail/5.3.2/skills/ponytail/SKILL.md:44`). Include the raw cell value in the accessible name or an associated accessible description, distinguishing empty values. Focused regression for the implementer: render distinct and empty values, verify their accessible names/descriptions expose those values, and check focused cell announcements in the isolated desktop. Existing `tests/table.test.tsx:29–44` checks copy behavior through labels that omit values; it does not check this accessibility outcome. The label omission is source-confirmed; actual assistive-technology announcements were not exercised.

## Heuristic judgement call

**Possible Duplicated Code — sort transitions.** `client/panel.tsx:279–280` repeats `++queryRequest.current; setRows([]); setOffset(0); setTotalRows(null); setSortMode(undefined); setSort(next); void navigate(0, next);` in both column/direction and mode handlers. Future changes to query invalidation or pending state must reach both handlers or the controls can diverge. A single local function accepting the next sort would remove the repeated transition without introducing a new abstraction layer. This is a low-priority maintenance judgement, not a confirmed behavioral bug or hard standard violation.

## Scope and evidence

Reviewed repository guidance, implementation/configuration hunks, relevant tests, and acceptance provenance. No further documented-standard breaches identified. The committed tarball matches its documented SHA-256 and all packaged files match the checkout. Existing Linux evidence records 41 passing tests and actual 5 GB acceptance; no tests/package commands were run here.

Skipped spec completeness and runtime execution. Isolated macOS/Windows acceptance remains unverified; #10 and its parent remain open. No repository changes, app/daemon operations, tracker mutations, or additional agents.
