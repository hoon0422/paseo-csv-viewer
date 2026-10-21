# Ticket 10 platform acceptance

The final reviewed package was tested in the independent, official Paseo 0.12.0 desktop on a **free local Windows Server 2022 Standard Evaluation x64** Cua QEMU VM. This is Windows Server build 20348, not Windows 11. The package is `reports/final-review/paseo-csv-viewer-0.1.0.tgz`, SHA256 `8db56bbc46c2cc6c7b42b6ff009554bcd7515653645ceb757a05dfe0e3d4d0bc`, built from source commit `13390f27`. The guest independently verified the same package hash in `runtime-before-close.json`. No source changes were made for this platform run. The prior 5 GB figures in `reports/ticket-10/` are Linux measurements of this same final package; this Windows run used small fixtures and makes no Windows 5 GB performance claim.

## Placement and installation

`windows-preflight.json` records image digest, 6,138,205,223-byte download, 6,203,375,616-byte unpacked image, 64 GiB sparse virtual disk, 24 GiB host RAM, initial disk headroom, the initial 120-second readiness timeout, and the successful diagnostic retry using the **same one named local VM**. Cua's own disk guard was kept. Host free disk before deletion was 15,120,000 KiB; the VM directory used about 4.1 GiB. No paid provider, custom runtime, Paseo source build, host Paseo settings, profile or credential transfer was involved. Guest details are in `environment.json`; guest C: had 54,520,041,472 bytes free initially and 52,818,567,168 bytes during the run.

`installer.json` records the official `Paseo-Setup-0.12.0-x64.exe` URL, 144,428,988 bytes, and SHA256 `acb5f9958723e4d3d295984f067fb2c2144e4f73338487c2d8fa47330b2520c1`, verified after a guest download. The silent installer command exceeded the remote command's 300-second wait, so its clean exit code was **not observed**. Its installed desktop and `paseo.cmd` were subsequently launched; `paseo-version.log` reports 0.12.0. In the isolated guest, plugin activation was enabled and the exact extracted package installed with the official CLI. `plugin-list.json` shows `csv-viewer` enabled/running from `C:\Users\Docker\ticket-10\artifact\package`; `plugin-logs.json` shows ready. `npm-ci.log` shows the package lock installed with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` (4 packages). The locked Windows DuckDB binding loaded and returned `SELECT 1 = 1`: `native-check.cjs` and `native-check.log`. This demonstrates native DLL loading under the exact installed package, alongside real desktop queries.

## Windows desktop results

| Check | Result | Evidence |
| --- | --- | --- |
| Workspace header registration, preview and paging | Pass: 120 source data records; rows 51–100 on next page | `windows-workspace-panel.png`, `windows-preview-later.png`, `windows-page-two.png` |
| Search hidden column beyond preview | Pass: hidden `note` column still matched only ID 090 | `windows-hidden-search.png` |
| Combined search and sort | Pass: `value-0` matched 100; descending numeric ID began 099 | `windows-combined-search-ready.png`, `windows-combined-sort-ready.png` |
| Visible-column/current-order copy | Pass: selected sorted row copied exactly `099\tvalue-099` with `note` hidden | `clipboard-check.json`, `windows-copy-selected.png` |
| Clear search and unfiltered sort | Pass: full 120-row set sorted descending. Cancel was clicked after clearing, but the small sort completed too quickly to establish a Windows cancellation outcome. | `windows-clear-search-pending.png`, `windows-cancel-sort.png` |
| Strict malformed record | Pass: line 3 column-count error | `windows-malformed.png` |
| Header toggle | Pass: generated columns and 121 rows when off; original header and 120 when on | `windows-header-off-ready.png`, `windows-reopened.png` |
| Source change and refresh | Pass: completed snapshot warning after test-owned append, Refresh showed 121 rows and found the appended row | `source-change.json`, `windows-source-change.png`, `windows-source-new-row.png` |
| Native local chooser | Pass: Windows Open dialog selected `demo.tsv`; 2 TSV rows loaded | `windows-native-picker-dialog.png`, `windows-native-tsv.png` |
| Source removal | Pass: snapshot warning, then missing-file error on Refresh | `source-removal.json`, `windows-source-removed.png`, `windows-source-removed-refresh.png` |
| File Explorer drop | Pass: test-owned `drop.csv` opened with `from-explorer` and `drop-route` rows after Paseo was launched through Explorer at normal desktop integrity | `windows-os-drop-normal-result.png` |
| Paseo Files internal drag | Pass: dragged `rows120.csv` from the right Files pane; viewer switched to 121 rows | `windows-internal-drop.png` |
| Normal tab close | Pass: active `C:\Users\Docker\AppData\Local\Temp\1\csv-viewer-session-ik0LVB` existed while open and disappeared after Ctrl+W. | `sessions-before-close.json`, `sessions-after-close.json`, `windows-panel-closed.png` |

The first Explorer drop attempt showed Windows' prohibited cursor. That instance of Paseo had been launched from the guest's Administrator command shell. After stopping that test process and starting Paseo through Explorer, the same desktop drop route passed. Forced stopping left an earlier 14,983-byte `csv-viewer-session-HejzkK` directory dated 10:13:55 UTC in `C:\Users\Docker\AppData\Local\Temp`; it was separate from the normal session in `Temp\1` and is included in both session manifests. The disposable VM removal deletes that residue. No product defect was inferred from the elevated-process drag refusal or forced-stop residue.

Windows Server 2022 was tested; Windows 11 was not available and is untested. Cross-host/malformed internal-drop rejection, source-query races, and 5 GB search/global-sort behavior were not repeated on Windows; the public seam and final Linux desktop results are in `reports/ticket-10/`. No disk-full stress was applied to the host or entire guest.

## macOS and closeout

`macos-preflight.json` is a **verbatim** copy of `/tmp/csv-viewer-implementation/macos-preflight.json` (`cmp` exit 0). The cached canonical macOS 26 base was present, but Cua CLI exited 7 before clone/VM creation because it required about 30.0 GiB plus a 5.0 GiB reserve and only 25.4 GiB was available on `/Users/Younghoon/.lume`. macOS runtime acceptance was **not run**. No guard override, Mac base change, new Mac VM, paid environment, or host app reuse occurred.

After evidence export, `cua sb rm local:paseo-csv-windows-acceptance --force` returned `deleted` and the VM directory was absent. `cleanup.json` records that result, 19,440,000 KiB host free disk afterward, the running Ubuntu ticket-2 Space, removal of only the Windows direct registration, and release of the platform allocation lock. The shared Windows image cache and retained Ubuntu Space and 5 GB fixture remain untouched. Ticket 10 remains open because macOS runtime acceptance is blocked and Windows 11 was not exercised.

The ticket branch was fast-forwarded to integration `b159fd140a32fdf885950995b6a984e1425c3b26`, which changed only final-review documents. The package hash stayed unchanged. `platform-typecheck.log` records a passing Ubuntu typecheck, and `platform-tests.log` records 41 passing tests, no failures or skips, after that merge.
