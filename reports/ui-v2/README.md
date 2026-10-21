# Ticket #20 — v2 Linux acceptance

**Linux acceptance complete. macOS acceptance remains pending.** Final acceptance follows the updated [#20](https://github.com/hoon0422/csv-viewer/issues/20), [SPEC #11](https://github.com/hoon0422/csv-viewer/issues/11) and [ADR 0003](../../docs/adr/0003-performance-guaranteed-up-to-500-mb.md). Native hardware judges performance up to 500,000,000 bytes. Earlier Cua timings and 5 GB measurements are reference only; the old performance FAIL verdicts in the preserved [resume report](resume-report.md) no longer define acceptance. No new 5 GB Cua run was made.

## Acceptance criteria

| #20 criterion | Final verdict | Evidence and scope |
| --- | --- | --- |
| Typecheck and full suite on current source | PASS | [Merged-source check](final/check.log), [exit 0](final/check.exit), [101/101 tests](final/tests.json). Source-only macOS check with PASEO_HOME removed; no host app/daemon access. No build script is defined. |
| Standards and SPEC reviews; findings resolved | PASS, previously completed | User confirmed resolution at integration 284d9d9. Original [Standards](final/review-standards.md) and [SPEC](final/review-spec.md) reports are retained, not represented as fresh reviews. The later rejected-path count defect was fixed test-first in ff199b6; red/green evidence remains under resume/. |
| New package built and installed in isolated Paseo 0.12.0 | PASS | [Package](final/paseo-csv-viewer-0.1.0.tgz), [source provenance](final/package-provenance.json), [installed provenance](final/installed-provenance.json), [install](final/install.json), [running status](final/plugins-after.json). All 18 packaged files match the merged revision and Space installation byte-for-byte. |
| Native performance under ADR 0003; size confirmation in app | PASS | Native timing gate PASS: [supplied report](final/native-report-500mb.md), originally `/tmp/csv-viewer-v2/perf/report-500mb.md`; [raw events](final/native-500mb.json). Warning Cancel and OK both passed on the final installation: [Cancel](final/69-cancel-retains-rich-state.png), [OK/Preparation](final/71-warning-ok-opening.png), [Ready](final/73-preparation-scroll.png). |
| #11 UI behaviors exercised in the real app with screenshots | PASS for the requested UI acceptance | Historical native checks and provenance are preserved in [resume report](resume-report.md); all previously unverified requested behaviors were exercised on the final package below. |
| #10 says macOS acceptance uses this package | PASS for requested draft; posting delegated | User explicitly requested no issue edit. Proposed comment: `/tmp/csv-viewer-v2/notes/ticket-20-issue10-comment.md`. No comment posted; macOS acceptance remains pending. |

## Provenance and recovery

Source **b18637295bc1f490df261ded617c0b1988daae27** includes integration **10f25c1f95531480921a5c12761cda0aa3636ad3**. Artifact SHA-256 **10ab7e52e582c4321da29406b2b49f9a505447823fdc4598207803d0984f1fda**. The [builder](final/build-package.py) takes the previously verified 18-file release inventory from this exact Git revision, including npm-shrinkwrap.json, and checks the gzip/tar contents. Production `npm ci --omit=dev` [passed](final/npm-ci.log) in the Space. This supersedes both the original installed eedc60d8… candidate and the uninstalled c8eba2bd… candidate.

Space **local:paseo-x64-ubuntu-ticket-2**, official **Paseo 0.12.0**, Ubuntu x86_64, QEMU TCG, 2 logical CPUs, 4,105,060,352 bytes RAM, no swap. Installation: `/home/cua/ui-v2-final/package`; isolated daemon home `/home/cua/.paseo-x64-ticket-2`, loopback port **6779**; desktop profile `/home/cua/.config/Paseo-x64-ticket-2`. Desktop PID 39987, window 18874372. The existing VM and all earlier evidence were preserved.

Transport recovered on the first fresh command. At 19:33:54 UTC, [readback](final/recovery-initial.json) showed 3,468,517,376 available memory bytes and 4,801,781,760 free disk bytes. An exact argv/owner check found **no surviving** `/home/cua/ui-v2-resume/measure.mts /home/cua/ticket-5/fixtures/large.csv` process; no benchmark process was killed or restarted. The isolated desktop was started; its daemon became available at 6779. An explicit isolated `daemon start --home …` returned “Already running”; no VM or host Paseo restart occurred. Only synthetic sources and this package were transferred. No teleport, credentials, evidence deletion, push or publication.

## Performance basis

The supplied native run used Apple M4 Pro / arm64, 14 logical cores, DuckDB 1.5.6, configured 4 GB memory. Fixture: **499,206,474 bytes, 8,800,000 rows**. All **23 timing checks passed**. First screens are measured after Preparation; each appended page has 200 rows. This is session/engine timing, not a packaged-UI or physical-paint measurement.

| Native measurement | Observed | Target | Result |
| --- | --- | --- | --- |
| Auto first sorted screen | 1.645 s | ≤2 s | PASS |
| Numeric first sorted screen | 0.714 s | ≤2 s | PASS |
| Text first sorted screen | 0.598 s | ≤2 s | PASS |
| Auto / Numeric / Text slowest of five appended pages | 0.035 / 0.038 / 0.010 s | each ≤0.2 s | PASS |
| Filter slowest of five appended pages | 0.041 s | ≤0.2 s | PASS |
| Load: preview / Preparation from open | 0.016 / 5.657 s | recorded, no load-time threshold | RECORDED |

Native measured revision b1b7b7d… and the installed package have identical session, sort, filter and native-runtime source files: [hash comparison](final/native-source-comparison.json), [empty engine diff](final/native-engine-diff.txt). Native 5.37 GB reference figures remain in the supplied report. Historical Cua 300 MB and partial 5 GB logs remain in resume/ with their original artifact attribution; no completed 5 GB sort latency is inferred.

For the warning test, a separate fixed-width **500,000,100-byte** prefix of the retained synthetic fixture was created after checking capacity. Decimal one-place formatting displays this as “500.0 MB”; it is strictly over the cutoff. [Warning](final/36-over-500mb-warning.png), [Cancel preserves source/path/selection](final/37-over-500mb-cancel-preserves.png), [state readback](final/37-cancel-state.json).

## Real desktop behavior evidence

All `final/` screenshots use the installed **10ab7e52…** package. Real Cua keyboard/mouse actions exercised the controls. The copied [DOM reader](final/read-dom.mjs) and [probe](final/probe.mjs) read state over the desktop's loopback diagnostic port; no long scripts were typed into DevTools. For the tens-of-thousands setup only, short [scroll scripts](final/load-rows.js) / [faster continuation](final/load-rows-fast.js) set the real scroll container to its loaded extent. The application's normal onScroll/onEndReached and RPC path appended pages; no React state or session results were injected. Native input is used for the subsequent selection-limit and responsiveness checks.

| Behavior | Result | Evidence |
| --- | --- | --- |
| Native local picker opens a source | PASS | [Dialog/file selection](final/12-picker-selected.png), [opened table](final/14-picker-open-pass.png), [readback](final/13-state.json). Earlier rushed path-entry attempts closed without opening; the demonstrated directory/file selection succeeded. |
| Icon hover tooltips; full multiline cell hover | PASS for captured controls | [Picker](final/07-picker-tooltip.png), [header](final/15-header-tooltip.png), [Refresh](final/16-refresh-tooltip.png), [Filter shortcut](final/17-filter-tooltip.png), [copy shortcut](final/20-copy-tooltip.png), [reveal](final/34-reveal-tooltip-disabled.png), [sort](final/35-sort-tooltip-disabled.png), [full cell](final/18-cell-tooltip.png). Detected Auto mode checked with a live sort below. |
| Whole-panel drop, overlay, replacement without prompt below cutoff | PASS | Dragged Paseo Files ui-v2-30050.csv onto the **path bar**, outside the table. [Whole-panel overlay](final/21-whole-panel-drop-overlay.png), [replacement](final/22-drop-opened.png); old 17-row selection cleared. |
| Ctrl+A selects partly visible viewport rows | PASS | [17 selected](final/19-viewport-selection.png), [DOM](final/19-state.json). Rows 1–17 selected, including the partially visible last row; not all 50 loaded rows or 12,050 source rows. |
| Infinite scrolling, growing loaded extent | PASS | [50 loaded](final/22-drop-opened.png), [250](final/24-loaded-end.png), [1,250](final/31-driver-pages.png), later large-loaded evidence below. |

The earlier app matrix is retained in [resume report](resume-report.md): path Enter/error/Escape/blur; native Ctrl+F; row/Ctrl-click/Shift selection and exact raw TSV copy; multiple expansion/collapse; 40 px drag minimum and 600 px fit cap; hide/count badge; filtered descending sort; Refresh retention/selection reset; case sensitivity, rule enable/add/remove, Match all/any, numeric between, incomplete values, hidden-column rules and Escape clear. Its screenshots identify the original eedc60d8… install. Table, columns, filter and drop modules are unchanged between that install and the final package ([empty diff](final/unchanged-ui-modules.diff)); the final-source suite covers their contracts. The panel's rejected-path filtered-count fix is rechecked on the final installation below.

The 25 ms diagnostic monitor was disabled during long scrolling. Its earlier event log and the small setup scripts are reference instrumentation, not a claim that every setup scroll was native input. Captures 38–39 were made while setup was moving the viewport and do **not** establish a successful cap gesture. Captures 43–44 also missed the short-lived toast; the native window capture 1027319-toast.png and its event log are the actual cap proof.

| Remaining behavior on final package | Verdict | Evidence |
| --- | --- | --- |
| 10,000-row cap leaves selection unchanged and shows toast | PASS | With row 1 selected, native Shift-click on row 29,837 attempted an oversized range. [Actual native-window toast capture](final/1027319-toast.png); [events](final/ui-events.jsonl) at 19:51:26 UTC show “Can't select more than 10,000 rows”, still 1 selected, and removal about 2.08 s later. Initial edge clicks hit expansion controls, so they are not counted. |
| Smoothness after tens of thousands loaded; short timing probe | PASS, qualitative; timings reference | All **30,050** rows were loaded ([setup completion](final/load-rows-fast-result.json)); native wheel [up](final/45-native-wheel-up.png) / [down](final/46-native-wheel-down.png) stayed responsive without a freeze or loss of position. [12-second probe](final/wheel-result.json) recorded 104 mounted rows, four trusted wheel events, p50 frame interval 16.7 ms, p95 16.8 ms, max 116.7 ms. Wheel-to-scroll proxies were 25.2–123.1 ms; wheel-to-double-rAF proxies 68.4–209.6 ms. These are a small emulated-desktop observation, not native timing acceptance or a physical-paint measurement. |
| Auto tooltip includes detected mode; current sort has check/arrow | PASS | [Numeric detected](final/48-auto-detected-numeric-tooltip.png), [descending checkmark](final/49-sort-checkmark.png). Sort returned to the top and cleared selection. |
| Clear sort | PASS | [Clear sort](final/50-clear-sort.png): source order restored (00000 first), arrow removed, mode disabled. |
| Reveal all | PASS | [Hidden note, enabled reveal with badge 1](final/52-hidden-reveal-enabled.png); [reveal](final/53-reveal-all.png) restores note and disables reveal. |
| Ctrl+F reaches panel and focuses value | PASS, rechecked | [Native shortcut](final/54-native-ctrl-f-final.png). |
| Regex invalid/error and corrected recovery | PASS | [Invalid `[`](final/56-regex-error.png), [corrected `^0000[2-4]$`](final/57-regex-recovered.png), [three-row readback](final/57-regex-state.json). |
| Header toggle resets everything | PASS | [Before](final/62-width-reset-setup.png), [state](final/62-state.json): regex, descending id, hidden note, width 150, one selected, row 1 expanded. [Toggle](final/63-header-toggle-resets.png), [readback](final/63-header-reset-state.json): 30,051 rows, header becomes data, all columns visible at 160, no sort/filter/selection/expansion, top of table. |
| Rejected path preserves matching count on installed fix | PASS | [Missing path](final/67-rejected-path-keeps-matching-count.png), [readback](final/67-path-state.json): one matching row and “1 of 30,050 rows” retained, alongside sort/hidden/width/selection/expansion. |
| Over-500 MB Cancel preserves state | PASS | [Warning with changed state](final/68-warning-retains-rich-state.png), [Cancel](final/69-cancel-retains-rich-state.png), [readback](final/69-cancel-state.json): source/path, 1-of-30,050 filter, descending sort, hidden note, width 150, selection and expansion preserved. |
| Over-500 MB OK opens and new source resets everything | PASS | [Warning](final/70-warning-before-ok.png), [OK](final/71-warning-ok-opening.png), [readback](final/71-ok-state.json): new absolute path/name, two fresh columns at 160, sort/filter/hidden state cleared, zero selected, no expansion, top of table. [Ready](final/73-preparation-scroll.png): 5,000,000 rows. |
| Preparation status and viewport selection | PASS for native observations | [Preparing 6%](final/71-warning-ok-opening.png) shows disabled sort/filter; [17 selected at Preparing 95%](final/72-preparation-selection.png). The later End/append capture occurred after Ready, so it is not claimed as preparation-scroll proof. Other preparation control contracts remain covered by the full suite and prior evidence. |
| Raw Ctrl+C and double-click cell copy on final package | PASS | [Copied 17 rows](final/74-final-package-copy.png), [clipboard TSV](final/native-copy-17.tsv) exactly equals [17 parsed source rows](final/expected-copy-17.tsv), visible columns only, no header. [Double-click toast](final/75-double-click-copy-cell.png) and [clipboard value 00000034](final/native-cell-copy.json). |

Final-package Cua **load time reference**: [native-OK-to-status probe](final/warning-load-result.json) observes preview/Preparation at **0.819 s** and Ready at **28.690 s** for 500,000,100 bytes / 5,000,000 data rows, using 200 ms status polling. Native input/selection ran during preparation. No sort or 5 GB benchmark was launched for this test. The native report above is the acceptance performance basis.

## Final state and limits

The app was returned to [the small ui-v2.csv source](final/76-final-small-source.png), disposing the owned large-source session through the normal source switch. Both owned DOM-loading probes completed; both owned long-lived diagnostic monitor processes were stopped. [Final health](final/final-health.json): no owned 5 GB benchmark, 2,624,636 kB available memory, 4,225,859,584 free disk bytes. The 500 MB fixture, existing 5 GB fixture, earlier artifacts and reports remain intact. The isolated desktop/daemon remain running for inspection; no new VM was created.

[Evidence assertions](final/verify-evidence.py) and their [results](final/verification.json) check package/source identity, native timing verdicts, viewport selection, the cap event, reset/preservation states, regex results and clipboard equality. T10 progress commands were attempted at each stage but the progress plugin remains unavailable ([log](final/progress.log)); no host plugin was installed and T10 was not marked done.

The original independent review was not repeated, as instructed. Cua measurements do not replace native hardware performance, macOS was not tested, and #10 was not edited. The proposed #10 comment names this exact package for the future isolated macOS acceptance.
