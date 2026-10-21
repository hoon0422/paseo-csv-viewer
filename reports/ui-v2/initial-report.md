# Ticket #20 — partial Linux acceptance; desktop input blocked

**INCOMPLETE / BLOCKED.** New package built and installed; current typecheck and all 93 tests pass. The real desktop stopped reflecting Cua input before performance measurement and most UI acceptance. No performance target or complete UI acceptance is claimed. Following the user's explicit stop-on-blocker instruction, validation stopped without restarting Paseo or the Space.

## Criterion verdicts

| #20 criterion | Verdict | Evidence / remaining work |
| --- | --- | --- |
| Current source typecheck and full suite | PASS | [Full check](ui-v2-evidence/check-final.log), [exit 0](ui-v2-evidence/check-final.exit), [93 passing tests](tests.json). Bootstrap has no build script to run. |
| Standards and SPEC reviews resolved | DONE BEFORE THIS TICKET | User supplied review completion at integration `284d9d9`; reviews remain in `/tmp/csv-viewer-v2/review/`. No review rerun or new product-code change. |
| New package installed in isolated Paseo 0.12.0 with provenance | PASS | [Tarball](ui-v2-evidence/paseo-csv-viewer-0.1.0.tgz), [pack inventory](ui-v2-evidence/pack.json), [production install](ui-v2-evidence/production-ci.log), [install result](ui-v2-evidence/plugin-install.json), [running status](ui-v2-evidence/plugin-status.json), [empty v2 panel](ui-v2-evidence/01-installed.png). |
| 5 GB first sorted screen ≤15 s | BLOCKED / UNMEASURED | Existing 5,000,000,000-byte fixture confirmed present. No new 5 GB load or sort was started. |
| Newly scrolled rows ≤0.2 s after sort/filter | BLOCKED / UNMEASURED | Neither engine nor end-to-end timing was recorded for this package. |
| About 300 MB first sorted screen ≤1 s | BLOCKED / UNMEASURED | No 300 MB fixture or timing run was started. |
| Load time | BLOCKED / UNMEASURED | Small source loaded, but no precise latency was recorded. |
| Every #11 UI behavior in the real app with screenshots | PARTIAL / BLOCKED | Native observations below; passing renderer tests do not replace missing app evidence. |
| Proposed #10 package update | DRAFT ONLY | `/tmp/csv-viewer-v2/notes/ticket-20-issue10-comment.md`. No issue was edited. This package is a candidate, not a completed Linux acceptance gate. |

## Exact source and artifact

- Branch: `ticket/20-acceptance`, initially based on integration `284d9d9f5a4875e2310a4ec3208d3b731b490695`. The final integration merge reported `Already up to date`; no other branch changed. The passing full check ran before that no-op merge. No further suite was started after the stop decision.
- Product source and package source: **`284d9d9f5a4875e2310a4ec3208d3b731b490695`**. The only code change in this ticket is a test wait described below; it is excluded from the package.
- Package: `paseo-csv-viewer-0.1.0.tgz`, 180,471 bytes; SHA-256 **`eedc60d8047ff041ff16b12fa9bd02e14f59b86e6917d04af6bdc843e715a80c`**. Built with `npm pack --json` in the Space. Locked `npm ci --omit=dev --ignore-scripts` passed from the extracted package.
- [Provenance](ui-v2-evidence/provenance.json) records all 18 package-entry checksums, source archive hash, environment and installed path. [Independent artifact verification](artifact-verification.json) matched every tar entry against the extracted package and `git show` at the source commit. No new performance figures are inherited from older reports.
- Space: **`local:paseo-x64-ubuntu-ticket-2`**, retained Ubuntu 24.04.5 x86_64 environment, 2 logical CPUs, 4,105,060,352 bytes RAM, Node 24.21.0. Official Paseo 0.12.0; daemon home `/home/cua/.paseo-x64-ticket-2`, port `6779`; desktop user data `/home/cua/.config/Paseo-x64-ticket-2`.
- Installed default plugin ID `csv-viewer` at `/home/cua/ui-v2-artifact/package`. Existing registration was removed and replaced because install rejected a duplicate ID; old package files were preserved. Latest CLI status is `running` even though desktop input is blocked.
- Source-only archive and synthetic fixtures were transferred/created. No teleport, credential copying, host app/daemon operation, publication, paid environment or new VM occurred. The existing Space and 5 GB fixture remain intact.

## Native desktop observations

These used Cua's exact-window driver with explicit foreground delivery in the isolated Space. The first background attempt was refused; foreground delivery was already authorized for this Space. The Linux accessibility snapshot exposed only the frame, so actions used fresh screenshots.

| Behavior | App verdict | Evidence |
| --- | --- | --- |
| Empty panel, path placeholder, compact icon row | PASS for visible layout | [Installed panel](ui-v2-evidence/01-installed.png). Icons visible; hover tooltips were not verified. |
| Enter workspace-relative path; read-only file name and relative path display | PASS | Typed `rows120.csv`, pressed Enter; [loaded panel](02-path-ready.png), 120 total rows, first 50 loaded, decimal size `2.4 kB`, `Ready`. Escape/blur restoration, outside absolute paths and error preservation remain untested in the app. |
| ⋮ menu and descending sort | PASS for exercised actions | [Menu](03-column-menu.png) shows ascending, descending, checked Clear sort, divider and Hide column. [Descending](04-sorted.png) starts at ID `119` and shows ↓. Header inertness, sorted-menu check, clear and hide/reveal remain untested in the app. |
| Click, Ctrl-click and Shift range selection | PASS | Clicked row 1, Ctrl-clicked row 3: [2 selected](05-modifier-selection.png). Shift-clicked row 6 from row 3: [rows 3–6 selected](06-shift-range.png). |
| Ctrl+C copies displayed rows as TSV, without header | PASS | Space clipboard returned [exact TSV](native-copy.tsv), IDs `117`, `116`, `115`, `114` in displayed order. [After copy](07-copy-after-toast.png). The capture missed the approximately two-second toast; its visible appearance is unverified. Hidden-column copy and double-click cell copy remain untested in the app. |
| Drop anywhere and overlay; local picker | BLOCKED / UNTESTED | No v2 native drop/picker run completed. Older reports concern different packages. |
| Infinite scroll, growing extent, rendering with many loaded rows | BLOCKED / UNTESTED | No v2 scroll gesture or timing completed. |
| One-line ellipsis, value hover, multiple row expansion/collapse and resets | BLOCKED / UNTESTED | No app proof completed. |
| Header drag minimum 40 px, double-click fit maximum 600 px | BLOCKED / UNTESTED | No app gesture completed. |
| Viewport Ctrl+A, 10,000-row limit and toast | BLOCKED / UNTESTED | Full automated tests pass; no app proof completed. |
| Focus-scoped shortcuts and normal input behavior | PARTIAL | Ctrl+C worked in the focused table. Ctrl+F/A and normal path/filter editing scope remain untested in the app. |
| Filter rules, operators, all/any, Aa, hidden columns, validation and cancellation | BLOCKED / UNTESTED | No real-app filter run completed. Automated suite results are separate. |
| Preparation interactions/progress; refresh and header/source resets | BLOCKED / UNTESTED | No v2 app proof completed. |

## Test-first harness correction

The initial [full check](ui-v2-evidence/check.log) passed 92/93 tests and failed `scrolls beyond the preview during preparation without interrupting the load` with `Session did not settle`. Its shared helper allowed about five seconds to import five million rows. The production session was not shown to be incorrect.

`tests/session.test.ts` now gives only that preparation test a 120-second bounded wait, expressed as a deadline. Other callers keep a five-second default. Assertions on preparation scrolling, row content/count, both header modes and cleanup are unchanged. The existing failing test is the red evidence; the [focused green run](ui-v2-evidence/preparation-green.log) passed in 48.657 seconds, and the subsequent full bootstrap check passed 93/93. Performance targets were not relaxed. Product/package files are unchanged.

## Exact blocker and retained state

At approximately 17:02–17:05 UTC on 2026-10-21, the desktop/DevTools stopped reflecting input after an attempt to enter the 9,226-character [UI exercise script](exercise.js) through native `type_text`. Earlier short console expressions had worked. The capture remained on a partially visible first-line comment; **the script was not confirmed to execute and establishes no UI verdicts**. A clipboard-based retry was also not confirmed. Its content remains diagnostic input, not successful test output.

Fresh window and desktop captures stayed unchanged after exact-window foreground click/hotkey calls and Space desktop click/type/key calls, including Escape and F12. Releasing modifier keys did not restore observable response. The tools reported dispatch success/unverifiable delivery, which is not treated as application success. The cause was not diagnosed; this is not a claim of a plugin defect or that the whole Space is down.

[Blocked desktop](ui-v2-evidence/blocked-desktop.png), [OS/process/disk readback](ui-v2-evidence/blocker.txt), and [checkpoint capture log](ui-v2-evidence/capture.jsonl) preserve the state. Only `T20-probe` was captured; none of the intended exercise checkpoints ran observably. The title-watching screenshot process was stopped using its owned sentinel. The app/daemon/VM were not restarted or replaced. No performance workload remains running. The already-started check finished and its results were exported.

The Space was reachable with about 6.0 GB free; this was not an observed disk-exhaustion stop. The retained 5 GB source was checked by size only; its full hash was not recomputed. The extra synthetic `/home/cua/ticket-10/fixtures/ui-v2.csv` and source checkout `/home/cua/ui-v2-source` remain in the Space. `/tmp/csv-viewer-v2/notes/ticket-20.md` contains the continuation note.

## Dashboard

T10 progress commands for Build/Verify, ticker and blocker note all reported the progress plugin unavailable or Paseo unreachable ([log](progress.log)). No host plugin/daemon change was attempted. T10 was not marked done. Ticket #20 and #10 must remain incomplete; isolated macOS acceptance is also still pending.
