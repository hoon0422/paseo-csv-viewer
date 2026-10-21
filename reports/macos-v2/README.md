# macOS v2 acceptance after JSON IPC — functional checks pass

The requested macOS workflow and child-process checks passed on the exact package below, in the retained local Cua VM. The earlier advanced-IPC blocker is **superseded**. This is functional and structural evidence, not a native-performance verdict or a reproduction of macOS library-validation rejection with SIP enforced.

## Exact source, package and environment

- Product integration: `fa02073` (JSON IPC), merged into this evidence branch at `170add003b49484364501be3c4eaeb27025733e4`.
- Package: [`paseo-csv-viewer-0.1.0.tgz`](paseo-csv-viewer-0.1.0.tgz), SHA256 `64ea117c5568f0f8d5e89b0c7f6b3959786e200f2dcdeb76f22a555a5ac50a0b`.
- [`package-provenance.json`](package-provenance.json): all 22 packaged files match the source checkout, including committed shrinkwrap, `server/ipc.ts`, and rebuilt `server/child.cjs`. The npm-style tarball uses the prior npm pack selection plus the new server module, with shrinkwrap explicitly included. No product source changed during acceptance.
- `npm run build` and `npm run check` passed (typecheck and generated-child consistency). Logs: [`build.log`](build.log), [`check.log`](check.log). The automated test suite was not rerun for this evidence-only change.
- Cua upload verified the same package SHA256 in the guest. Locked production install (`npm ci --omit=dev --ignore-scripts --no-audit --no-fund`) passed. The old directory installation was removed from the plugin catalog, its source preserved, and the replacement installed at `/Users/lume/csv-macos-21/json-artifact/package`. [`plugin-list-final.json`](json-evidence/plugin-list-final.json) confirms enabled/running.
- Space `local:paseo-csv-macos-21`, **retained running**, local Lume, canonical cached image `ghcr.io/trycua/macos:26`, digest `sha256:d6d864fe6bba6ada8b2e5cd9d7f1ba4f64b1e5ca8a2ef7edc1d1530e356437df`. No VM creation/restart was needed for this rerun.
- Guest macOS 26.5.2 (25F84), arm64, 4 logical CPUs, 8 GiB RAM. Official Paseo app/daemon **0.12.0**, Electron **44.2.0**, bundled Node **24.20.0** / V8 **15.2**; official external Node LTS **24.22.1** / V8 **13.6**, npm **11.19.1**.
- Daemon home `/Users/lume/.paseo-csv-macos-21`, loopback `127.0.0.1:6781`, relay disabled, server ID `srv_BtH4HyyeBawj`. Desktop data `/Users/lume/csv-macos-21/desktop-data`; desktop PID 1331. Guest evidence `/Users/lume/csv-macos-21/json-evidence`; 111 files were exported with Cua transfer verification.

Official app provenance remains the T01/T04 verified installation: archive `https://github.com/getpaseo/paseo/releases/download/v0.12.0/Paseo-0.12.0-arm64.zip`, SHA256 `eab79b156c6eea5e5f4472533b66724a0a2974f672745c2025eb59a75f829d41`. Deep/strict signing verification passed, Team ID `99ZMJMKU9Y`, notarization stapled. Official nodejs.org archive hash and Node signature Team `HX7739G8FX` were verified. The unchanged signature, entitlement and archive-check records are retained in [`t04-evidence/`](t04-evidence/); runtime versions are in `t04-evidence/paseo-runtime.json` and `json-evidence/environment.log`.

**SIP is disabled in the cached VM image.** Paseo main/Helper entitlements omit `disable-library-validation`, while official Node includes it. The original unmodified plugin loaded successfully in this VM, so the reported different-Team-IDs rejection was not reproduced here. Security configuration was not changed. The child-only native mapping proof below remains valid independently of whether this VM enforces library validation.

## #21 structural proof

With `rows.csv` open and sorted by value ascending, [02-sorted.png](json-evidence/02-sorted.png) shows IDs 1200, 1199, 1198 with values 1, 2, 3. [`structural-open-sorted.log`](json-evidence/structural-open-sorted.log) records:

- Supervisor 1285, daemon 1287, plugin Helper 2271 and all other inspected Paseo desktop/Helper processes: **no `duckdb.node` or `libduckdb` mapping**.
- External Node **2349**, parent **2271**: maps the installed package's `duckdb.node`, `libduckdb.dylib`, and owned database/WAL under `csv-viewer-child-SzZnPy`.
- Independent `vmmap` captures corroborate this: [`node-vmmap.log`](json-evidence/node-vmmap.log), [`plugin-vmmap.log`](json-evidence/plugin-vmmap.log), [`daemon-vmmap.log`](json-evidence/daemon-vmmap.log).

Later QA reopening used Node 3309. Before normal close, [`before-close.log`](json-evidence/before-close.log) records the live child and its owned directory `csv-viewer-child-Ol63yN`. Clicking the last CSV Viewer tab's Close button stopped that child and removed the entire owned directory, including its session storage: [`close-cleanup.json`](json-evidence/close-cleanup.json), [60-last-panel-closed.png](json-evidence/60-last-panel-closed.png). The Command Center and outside-workspace-path checks then reopened and normally closed the viewer again. [`final-cleanup.json`](json-evidence/final-cleanup.json) asserts no remaining Node process or owned child directory. The app and daemon remain healthy/running: `health-final.json`, `daemon-status-final.json`.

## macOS workflow verdicts

All screenshot links in this table refer to the **current** JSON-IPC package.

| Check | Verdict | Evidence and observed result |
| --- | --- | --- |
| Workspace header and Command Center entries | Pass | [01](json-evidence/01-path-open.png), [61](json-evidence/61-command-center.png), [63](json-evidence/63-command-center-source.png): both open the viewer; Command Center source shows three correct records |
| Path Enter, relative/absolute display | Pass | [01](json-evidence/01-path-open.png), [66](json-evidence/66-absolute-path.png): workspace-relative `rows.csv`; absolute outside-workspace path |
| Path Escape, blur and text shortcuts | Pass | [51](json-evidence/51-path-escape.png), [64](json-evidence/64-input-shortcuts.png), [67](json-evidence/67-path-blur-restored.png); Command+C in path input copied `draft.csv`, not TSV |
| Rejected path keeps existing table | Pass | [52](json-evidence/52-path-error-preserves-table.png): missing-path error with existing 12,050-row table retained |
| Native local CSV/TSV picker | Pass | [18](json-evidence/18-native-picker.png), [19](json-evidence/19-picker-chosen.png), [20](json-evidence/20-picker-tsv.png): actual macOS Open dialog selects `files.tsv`, row `8 / PaseoFiles / 43` |
| Paseo Files drop and source reset | Pass | [21](json-evidence/21-paseo-files-drop.png): native drag opens `rows.csv`, 1,201 records, original order/default presentation |
| Finder drop | Pass | [22](json-evidence/22-finder-drop.png), [23](json-evidence/23-finder-drop-result.png): actual OS drag opens distinct row `7 / FinderDrop / 42` |
| Auto/Numeric/Text sorting and clear | Pass | [02](json-evidence/02-sorted.png), [47](json-evidence/47-auto-descending.png), [48](json-evidence/48-numeric-mode.png), [49](json-evidence/49-text-mode.png), [50](json-evidence/50-clear-sort.png): numeric descending starts 12050; Text ascending starts `1,10`; clear restores file order |
| Header text does not sort | Pass | [68](json-evidence/68-header-text-no-sort.png): clicking header text leaves the unsorted three-row source unchanged |
| Combined filter and sort | Pass | [04](json-evidence/04-filter-sorted.png): Toronto filter returns 600/1200, ascending value starts IDs 1199,1197,1195 / values 2,4,6 |
| Hidden-column rule / Any column | Pass | [08](json-evidence/08-hidden-column-filter.png), [09](json-evidence/09-any-column-excludes-hidden.png): named hidden note matches one; Any column excludes it and matches zero |
| Case-insensitive/default and Aa | Pass | [04](json-evidence/04-filter-sorted.png), [11](json-evidence/11-case-sensitive.png): lowercase `toronto` matches normally and zero with Aa applied |
| Regex error and recovery | Pass | [37](json-evidence/37-regex-filter.png), [38](json-evidence/38-invalid-regex.png), [39](json-evidence/39-regex-recovered.png): valid regex matches IDs 1,2; invalid `[` reports error; correcting it restores results |
| Numeric rule, all/any, disabling and empty rules | Pass | [40](json-evidence/40-numeric-filter.png)–[45](json-evidence/45-between-inclusive.png): `id > 12048` → 2, Match all → 1, disabled second rule → 2, Match any → 3162, blank rule ignored → 2, inclusive between → 3 |
| Native click / Shift / Command selection | Pass | [05](json-evidence/05-native-range-selection.png), [06](json-evidence/06-command-toggle.png): Shift selects three; Command toggles middle row off |
| Exact visible-column/current-order TSV | Pass | `filtered-selected.tsv`, `toggled-selected.tsv`, [`clipboard-and-preservation-checks.json`](json-evidence/clipboard-and-preservation-checks.json); hidden note omitted, no header, exact expected sorted/filtered values |
| Double-click cell copy | Pass | [07](json-evidence/07-copy-cell.png), `copied-cell.txt`: clipboard exactly `Toronto` |
| Viewport-only Command+A | Pass | [29](json-evidence/29-viewport-select-all.png), `viewport-selected.tsv`: exactly 16 partly visible records copied |
| 10,000-row limit and toast | Pass | [34](json-evidence/34-full-load.png)–[36](json-evidence/36-selection-limit-toast.png): native Shift-click toward row 12010 displays limit toast and retains original one-row selection; exact clipboard assertion |
| Infinite scroll / growing loaded range | Pass | [28](json-evidence/28-large-scroll.png), [32](json-evidence/32-loaded-rows.png), [34](json-evidence/34-full-load.png): native wheel appends 50→250; normal application paging subsequently loads all 12050 selection-fixture rows |
| Column hide/reveal/drag/fit | Pass | [05](json-evidence/05-native-range-selection.png), [12](json-evidence/12-filter-escape-cleared.png)–[16](json-evidence/16-column-autofit.png): hide/reveal; splitter moves 70 px; double-click fits to loaded values |
| Row expansion/collapse and full-value hover | Pass | [14](json-evidence/14-expanded-row.png), [15](json-evidence/15-row-collapsed.png): native bottom-edge double-click expands long note, then collapses; full-value tooltip visible |
| Refresh keeps controls; changed source | Pass | [10](json-evidence/10-refresh-keeps-controls.png), [17](json-evidence/17-refresh-after-append.png): sort/filter/hidden state preserved; fitted width retained; test append adds new minimum ID 1201 / value 0 and count 1201 |
| Header/source reset | Pass | [53](json-evidence/53-header-off.png), [54](json-evidence/54-header-on.png): off generates Column 1/2 and includes header as data; on restores original header/12050 rows; new source/drop resets presentation |
| Over-500 MB Cancel | Pass | [24](json-evidence/24-large-warning.png), [25](json-evidence/25-large-cancel.png): 501.0 MB warning; Cancel retains FinderDrop and does not prepare new source |
| Over-500 MB OK | Pass | [26](json-evidence/26-large-warning-again.png), [27](json-evidence/27-large-open.png): explicit OK opens 1002000 records, Ready, 501.0 MB |
| Malformed records / skipped blank lines | Pass | [55](json-evidence/55-malformed.png), [56](json-evidence/56-blank-lines-skipped.png): exact line-3 column-count error; blank lines yield two records |
| Removed source / refresh failure | Pass | [57](json-evidence/57-removal-source-open.png)–[59](json-evidence/59-source-removed-refresh.png): test-owned source is removed; Refresh reports ENOENT with existing snapshot retained |
| Last-panel child exit and owned-storage cleanup | Pass | `close-cleanup.json`, `final-cleanup.json`, [60](json-evidence/60-last-panel-closed.png), [69](json-evidence/69-final-close.png) |

[`independent-expectations.json`](json-evidence/independent-expectations.json) derives filter counts and sort extrema directly from the fixture, separately from the viewer. Clipboard assertions compare exact bytes; source-preservation check confirms the large source's original SHA256 after opening/scrolling/copying. `rows.csv` was intentionally appended once, and `remove.csv` was a test-owned copy intentionally removed.

## Fixtures, timing and scope

`rows.csv` originally has 1200 records with IDs 1–1200, alternating Toronto/Montreal, reverse numeric value, and a long quoted note; the one appended record is ID 1201 / Toronto / 0. `selection.csv` has 12050 unique ID/value pairs. Small CSV/TSV, malformed and blank-line fixtures are exported. The large source is **501000014 bytes**, **1002000 data records**, header `id,value,note`; each 500-byte record is `1,7,` + 495 ASCII x bytes + newline. [`over500-fixture.json`](json-evidence/over500-fixture.json) records hash/shape and `clipboard-and-preservation-checks.json` verifies its unchanged SHA256 `7e19fb2b3ca3380c90cbb62642aedf410ad84c569906f73cff243a8e5ad75217`.

The observed interval from before the native OK action to a Ready screenshot was **7.663 s**, including automation/screenshot overhead. It is a reference upper bound, not a preparation benchmark. `large-process-sample.log` and `large-owned-files.log` are single samples after Ready, **not peaks**. [`reference-observations.json`](reference-observations.json) records these meanings. **No native ADR 0003 latency verdict or current-package 5 GB benchmark is claimed.** Prior performance/other-platform evidence retains its original package attribution.

Native UI gestures exercised the acceptance actions. For the selection-limit setup only, the disclosed [`prepare-loaded-rows.js`](json-evidence/prepare-loaded-rows.js) scrolled the real DOM viewport through ordinary application paging; it did not inject rows, selection or application state. The actual selection, limit, copy and toast checks were native. Earlier window-scoped modifier-injection attempts did not preserve the intended range; `attempt-03-window-selection.png` and `early-selection-injection-attempt.tsv` are setup attempts, not passing selection evidence. The later native desktop gestures and exact assertions are the verdict evidence.

Opening docked DevTools narrowed the host layout and remounted the panel with no source. QA then used undocked DevTools and reopened its fixture. Persistence across host compact-layout remounts is **not established** by this run. Native performance, SIP-enforced rejection, exhaustive filter-operator combinations, cross-host/malformed internal-drop rejection, disk-full stress, and in-flight cancel/replace/source-revision races were not repeated here; they are not silently marked passed. Small/501 MB operations completed before a pending-query cancellation outcome could be established. This report establishes the listed macOS workflows and structural checks, not every historical #10 stress criterion on this new package.

## Superseded advanced-IPC blocker

Source `9eece4b0d4a8bbdaa20ecf06cf4ef53aee9877a9`, artifact SHA256 `f700a75c59dd62047dd63005c023f58a70b113a92c7b8e6c3e5cc2df85263ed1`, failed its first desktop source open with Node stderr `Unable to deserialize cloned data due to invalid or unsupported version`. Electron V8 15.2 and external Node V8 13.6 could not use advanced IPC serialization. Original failure evidence remains in [`t04-evidence/`](t04-evidence/); original README, package, provenance and build log are archived in [`superseded/`](superseded/). JSON IPC in `fa02073` resolves that blocker with the same app and external Node installed. [`findings.json`](findings.json) marks the historical finding fixed.

The VM, desktop and isolated daemon remain running; viewer panels are closed and no child/storage remains. Host Paseo app/daemon, profiles, credentials, existing Ubuntu Spaces and security configuration were untouched. Only authorized dashboard status/ticker commands contacted the host progress service. No issue comment was posted; the updated draft is `/tmp/csv-viewer-v2/notes/macos-issue10-comment.md`. Overall #10 closure and remaining platform/stress attribution belong to the coordinator.
