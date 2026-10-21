# Ticket #20 — resumed acceptance; resource/transport block

**INCOMPLETE / BLOCKED.** The authorized desktop restart recovered native input. Additional real-app checks passed and a filtered-count defect was fixed test-first in `ff199b6`. Current source passes typecheck and **93/93 tests** after the no-op integration merge. Performance targets failed where measured. Space command/transfer timeouts under the 5 GB workload prevented final installation, log export and the remaining app checks.

The [initial report](initial-report.md) preserves the earlier stop and original artifact. This report supersedes its current-status statements. No VM restart/recreation, host Paseo operation, daemon restart, credential copying, teleport, existing-evidence deletion, push or publication occurred.

## Acceptance summary

| Criterion | Verdict | Evidence / limit |
| --- | --- | --- |
| Current typecheck and full suite | PASS, source checkout | [Post-merge check](resume/check-local.log), [exit 0](resume/check-local.exit), [93/93 tests](resume/tests-local.json). Ran on macOS with PASEO_HOME removed, synthetic files, no host app/daemon access. Earlier isolated full suite also passed 93/93 before the new fix. No build script exists. |
| Standards/SPEC reviews resolved | DONE PREVIOUSLY | User-supplied completion at integration 284d9d9. The new one-line fix has focused and full-source checks; no new independent review. |
| New package installed in isolated Paseo 0.12.0 | PARTIAL | Original candidate eedc60d8… is the last confirmed install. Corrected candidate c8eba2bd… is built and verified, **not installed or runtime-accepted**. |
| About 300 MB first sorted screen ≤1 s | FAIL on this environment | Manual Numeric session first page **20.598 s**, already a lower bound for an app screen. Other mode figures could not be exported. |
| 5 GB first sorted screen ≤15 s | FAIL at confirmed checkpoint | Auto first page absent for **at least 88.309 s** after preparation completed. No completed 5 GB sort duration claimed. |
| Newly scrolled rows ≤0.2 s | FAIL for observed 300 MB session pages; 5 GB BLOCKED | Observed retained Numeric pages 2–5: **0.368, 0.342, 0.507, 0.368 s**. Five-GB page and end-to-end scroll timings unavailable. |
| Load time | RECORDED at session boundary | 300 MB all-ready **26.983 s**; 5 GB preview **1.827 s**, all-ready **309.979 s**, 49,999,999 data rows. Not picker-to-painted-screen timings. |
| Every UI behavior with screenshots | PARTIAL | Native matrix below. No claim of complete acceptance. |
| #10 update | DRAFT ONLY | `/tmp/csv-viewer-v2/notes/ticket-20-issue10-comment.md`. No issue edited; macOS remains pending. |

## Artifact, measurements and capacity

Retained Space **local:paseo-x64-ubuntu-ticket-2**: official **Paseo 0.12.0**, Ubuntu x86_64 under QEMU TCG, **2 logical CPUs**, **4,105,060,352 bytes RAM**, no swap. This differs materially from SPEC #11's 14-thread M-series reference. Targets were not relaxed; these figures do not establish general native-Mac performance.

Installed source `284d9d9f5a4875e2310a4ec3208d3b731b490695`, package SHA-256 **eedc60d8047ff041ff16b12fa9bd02e14f59b86e6917d04af6bdc843e715a80c**, directory `/home/cua/ui-v2-artifact/package`. Independent daemon `/home/cua/.paseo-x64-ticket-2`, port **6779**; desktop profile `/home/cua/.config/Paseo-x64-ticket-2`.

[measure.mts](resume/measure.mts) imported that exact extracted package's server/session and native runtime. Source checkout supplied tsx/SDK. It asserts row counts, numeric extrema, known 5 GB text extrema on completed sorts, cursor advancement and 200-row pages. **Only the 300 MB run completed**, with observed exit 0. These are session/engine measurements, not RPC/rendering benchmarks. Native UI activity and a focused regression also ran during these measurements; contention and diagnostic overhead limit interpretation.

The 300 MB fixture is the first 300,000,000 bytes of the retained fixed-width 5 GB source, with 2,999,999 data rows. The 5 GB source was reused in place. Before its run, the actual database/spill filesystem `/tmp` had **5,758,476,288 bytes free**, covering ~2 GB table + ~1.5 GB orders + ~1 GB spill allowance with a margin. Runner refused 5 GB starts below 5 GB free and included an owned-session stop below 750 MB free. No evidence was deleted to create room. Last confirmed free space was **4,801,884,160 bytes**; no disk-exhaustion stop was observed.

At **17:33:40 UTC**, guest `MemAvailable` was **96,712 kB**; latest observed benchmark RSS was **2,992,631,808 bytes**. Memory pressure coincided with command/transfer timeouts; that is not proof of every timeout's cause. Subsequent test-only termination and direct log-export requests timed out. **Benchmark termination is unconfirmed; the owned 5 GB test may still be running.** Inspect it before any other heavy job.

[observations.json](resume/observations.json) is explicitly transcribed from already-returned tool readings. Original raw logs remain in `/home/cua/ui-v2-resume/{medium,large}.jsonl`, their stderr files, `ui-events.jsonl`, capacity/state JSON and focused red/green logs. Export failed; local observations are **not substituted raw logs**. Later resource-only samples do not identify the active sort or establish whether an earlier sort finished. The reported 88.309-second bound uses the last complete event-log inspection. The stronger 12-minute claim made in chat was corrected and is not used here.

## Native app checks

All screenshots below used the installed **eedc60d8…** candidate. Inputs were real Cua mouse/keyboard actions. [probe.mjs](resume/probe.mjs) was copied as a file, then read DOM/status/events through a loopback-only diagnostic endpoint; no long script was typed in DevTools. It did not change UI state or bypass React/RPC. Some captures include Cua's cursor overlay.

| Behavior | Verdict | Evidence |
| --- | --- | --- |
| Desktop restart and native Ctrl+F reaching/focusing panel filter | PASS | [Recovered](resume/31-recovered.png), [Ctrl+F](resume/32-native-ctrl-f.png). Daemon restart was unnecessary. |
| Case-insensitive text and Aa | PASS | ALPHA matched [6,025](resume/33-filter-casefold.png), then [zero with Aa](resume/34-filter-case-sensitive.png). |
| Rule checkbox immediately reapplies | PASS | [Disabled rule restores full source](resume/35-disabled-rule.png). |
| Operator list and numeric between | PASS for choices/range | [All choices](resume/36-filter-operators.png), [IDs 00002–00004](resume/38-between-result.png). Other operator semantics remain automated-only. |
| Add/remove and Match all/any | PASS | [Add](resume/39-added-rule.png), [AND gives 1](resume/40-match-all.png), [OR gives 6,027](resume/41-match-any.png), [remove draft](resume/42-removed-rule.png). Removal waits for Apply; checkbox is immediate. |
| Incomplete values ignored with red borders; Escape clears/closes | PASS | [Incomplete range](resume/43-incomplete-rule.png), [Escape](resume/44-escape-clears.png). |
| One-line ellipsis; multiple expansion and collapse | PASS | [First expanded](resume/45-expanded-first.png), [both expanded](resume/46-multiple-expanded.png), [first collapsed while second stays open](resume/51-collapse-first-edge.png). Captures 47–49 include missed tiny-edge actions and are not proof of their filenames' intended gestures. |
| Drag minimum 40 px; fit cap 600 px | PASS | [Native drag](resume/50-drag-minimum.png), [native fit](resume/52-fit-note.png). Fresh Space DOM readbacks confirmed 40 and 600; long loaded multiline cell used for fit. |
| Header menu/hide/count badge | PASS for exercised actions | [Menu](resume/53-text-menu.png), [hidden text, badge 1](resume/54-hidden-text.png). Initial evidence also covers descending sort. Reveal and clear-sort app coverage remain open. |
| Any column ignores hidden; named hidden rule applies | PASS | [Any gives 0](resume/55-any-skips-hidden.png), [hidden label](resume/56-hidden-column-option.png), [named rule gives 6,025](resume/57-named-hidden-rule.png). |
| Filtered descending sort and resets | PASS for observed transition | [Filtered sort](resume/58-filtered-sort.png), DOM first ID 12049. Filter changes had collapsed expansion. |
| Refresh retains sort/filter/hidden/widths and clears selection | PASS for exercised state | [Refresh](resume/59-refresh-retains.png), fresh DOM: 6,025 matches, descending ID 12049, widths 40/600, hidden text, zero selected. |
| Rejected path retains table; Escape/blur restore path | PARTIAL, source fix pending app recheck | [Error](resume/60-path-error-preserves.png), [Escape](resume/61-path-escape.png), [blur](resume/62-path-blur.png). Count defect found; fix below. [Reapply on old code](resume/63-reapply-after-path-error.png) restores count. |
| Row/Ctrl-click/Shift selection and exact Ctrl+C TSV | PASS, initial evidence | [Modifier](05-modifier-selection.png), [range](06-shift-range.png), [clipboard TSV](native-copy.tsv). |
| Double-click cell acknowledgement | PASS for acknowledgement only | [Copied cell toast](resume/49-first-collapsed.png), caused by a missed edge hitting the cell. This cell's exact clipboard value was not read back. |
| Tooltip hover, drop/overlay, local picker | UNTESTED/BLOCKED | No completed v2 native proof. |
| Infinite scroll/growing extent, smoothness after tens of thousands loaded | UNTESTED/BLOCKED | New 30,050-row fixture prepared, no large-loaded-row app run completed. |
| Viewport Ctrl+A and 10,000-row limit | UNTESTED/BLOCKED | Automated tests pass; no native viewport/limit proof. |
| Full shortcut scope, reveal all, header/source resets, preparation interactions | PARTIAL/BLOCKED | Input Ctrl+A editing worked; full checklist remains open. |
| Regex error/recovery in app | UNTESTED/BLOCKED | Operator list reached; subsequent sequence canceled during Cua stall. No regex outcome claimed. |

## Test-first count fix and corrected candidate

A rejected source path kept filtered rows but the preparation-complete effect reran when `busy` returned false and overwrote the matching count with the full source count. The existing panel/session regression now applies a one-of-three filter, opens a missing path, and checks that both the filtered row and `1 of 3 rows` survive the error and Refresh. It failed on that exact assertion in the Space and passed after the fix.

`client/panel.tsx` seeds the completed count only while no page count is known: `setTotalRows(current => current ?? status.rowCount)`. Existing source/filter/sort resets still clear it. Commit **ff199b665dc22a420f5d5964196a08841dc2e5e8** contains the one-line correction and regression. No server/native/filter/sort/SDK/RPC change. Focused Space logs remain there; [current full source check](resume/check-local.log) passed 93/93 on macOS after the no-op merge. The first sandbox attempt could not create tsx's local IPC socket; the authorized source-only rerun permitted that socket with PASEO_HOME still removed.

[Corrected candidate](resume/final-package/paseo-csv-viewer-0.1.0.tgz), SHA-256 **c8eba2bd6236714909d0d301ed79f10240fd79e31b73f864d36a8c929574918f**, source **ff199b6**. [Provenance](resume/final-package/provenance.json) and [builder](resume/build-candidate.py) assert all original 18 entries, including npm-shrinkwrap.json, against the commit. Only client/panel.tsx differs from the installed candidate; server/native/shared entries are identical. Measurements continue to identify the artifact actually run.

The Space npm pack attempt timed out before producing an artifact. Host npm 12's [attempted inventory](resume/final-package/npm12-pack.json) omitted shrinkwrap, so that output was replaced with an explicit checked gzip/tar build of the previously verified inventory. No install scripts or host app ran. **Corrected candidate has not had a production install or been installed in the Space**; its app recheck remains blocked.

## Retained state

First desktop restart recovered input. A later authorized SIGTERM to PID 38888 was accepted; that PID was absent at the last successful readback. Desktop was not relaunched under heavy load. Daemon and VM were never restarted. The benchmark runs outside the daemon; restarting the daemon would not establish benchmark termination.

Termination requests matched only `/home/cua/ui-v2-resume/measure.mts /home/cua/ticket-5/fixtures/large.csv`; their delivery/completion remains unknown. Inspect the Space/process first, then preserve original logs before retrying. No owned storage or prior evidence was deleted. Additional fixtures: `/home/cua/ui-v2-resume/{medium,outside}.csv` and `/home/cua/ticket-10/fixtures/ui-v2-30050.csv`.

[Progress commands](resume/progress.log) still reported the plugin unavailable; host unchanged, T10 not marked done. Notes: `/tmp/csv-viewer-v2/notes/ticket-20.md`. Proposed comment: `/tmp/csv-viewer-v2/notes/ticket-20-issue10-comment.md`. No issue edits.
