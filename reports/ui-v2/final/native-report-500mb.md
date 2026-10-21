# Native performance — ADR 0003 / 500 MB scope

2026-10-21 · `ticket/12-sort-perf` · `b1b7b7d6aa72b783f66dd4285b64727c136e6284` (Refs #11). Integration base: `72ca040f349579f305624316519b3096c069cc76`.

## 500 MB result

PASS: all 23 measured timing targets. Fixture: **499,206,474 bytes (499.2 MB), 8,800,000 rows**, seeded five-column generator style. First screens are timed after Preparation completes, as in the supplied harness; all pages contain 200 rows. Appends below show the slowest of five separate calls, not an average.

| Measurement | 499.2 MB | Target | Result |
|---|---|---|---|
| Auto first screen | 1.645 s | ≤2 s | PASS |
| Numeric first screen | 0.714 s | ≤2 s | PASS |
| Text first screen | 0.598 s | ≤2 s | PASS |
| Auto slowest append | 0.035 s | ≤0.2 s | PASS |
| Numeric slowest append | 0.038 s | ≤0.2 s | PASS |
| Text slowest append | 0.010 s | ≤0.2 s | PASS |
| Filter slowest append | 0.041 s | ≤0.2 s | PASS |

| Mode | Appends 1–5 (seconds) |
|---|---|
| Auto | 0.035 / 0.034 / 0.035 / 0.034 / 0.034 |
| Numeric | 0.036 / 0.037 / 0.038 / 0.036 / 0.035 |
| Text | 0.010 / 0.008 / 0.009 / 0.008 / 0.009 |
| Filter | 0.039 / 0.041 / 0.040 / 0.039 / 0.040 |

## 5.37 GB reference only

Existing `/tmp/csvbench/data/big.csv`: **5,369,129,071 bytes, 87,000,000 rows**. ADR 0003 promises no timing for this size. The raw events use `targetMs: null` and `pass: null`; these numbers are not acceptance failures.

| Mode | First 200 rows (s) | Appends 1–5 (s) |
|---|---|---|
| Auto | 7.728 | 0.410 / 0.417 / 0.416 / 0.414 / 0.442 |
| Numeric | 6.535 | 0.443 / 0.415 / 0.419 / 0.416 / 0.424 |
| Text | 6.310 | 0.106 / 0.111 / 0.130 / 0.111 / 0.111 |
| Filter | 1.399 | 0.449 / 0.450 / 0.450 / 0.475 / 0.460 |

## Preparation and resources

| Measurement | 499.2 MB | 5.37 GB reference |
|---|---|---|
| Preview (s) | 0.016 | 0.017 |
| Preparation from open (s) | 5.657 | 62.206 |
| Auto order build only (s) | 0.540 | 5.046 |
| Numeric order build only (s) | 0.412 | 4.133 |
| OS process peak RSS (GiB) | 1.47 | 6.02 |
| Largest owned-storage snapshot (GiB) | 0.30 | 3.19 |
| Minimum free disk (GiB) | 24.64 | 17.89 |

## Implementation and checks

- Removed `source_row`, its unique index, the packed `source_cells` copy and their page-fetch path. Restored the original sort/filter-order join against `rows`; numeric/Auto order-build improvements are retained unchanged. No memory/thread changes: actual sessions report 14 threads, 3.7 GiB (configured 4GB), insertion-order preservation true.
- Added `viewer.inspect({workspaceId, source}) → {sourceBytes}`. It reuses the same path/readability/type validation as open and creates no session or DuckDB storage. The panel calls it before path Enter, picker, drop and Refresh. Strictly greater than 500,000,000 bytes shows the requested size warning and OK/Cancel. OK proceeds; Cancel/Escape preserves the current table/path; newer selections invalidate stale confirmations. The existing decimal size format is shared with the status bar.
- Test-first evidence: `500mb/confirmation-red.log` records the old immediate-open behavior failing; `confirmation-green.log` and `confirmation-paths.log` record the working confirmation. Real sparse-file inspection verifies fresh sizes and no Preparation/session replacement. Panel tests cover the exact cutoff, path, picker, drop, stale OK and Refresh after growth; the final suite also checks Escape cancellation.
- Final bootstrap check: **PASS**, typecheck + **101/101 tests**, 0 failures. No build script exists; optional build is a no-op. Log: `500mb/check-final.log`.

## Method, reproduction and cleanup

Native Apple M4 Pro / arm64; version, settings, SQL timings, RSS and free disk are recorded in the raw events. Each fixture has one sequential run with no competing check process. Mode order is Auto, Text, Numeric, then Any-column contains `toronto1` with sort cleared. Auto/Numeric sort amount ascending; Text sorts city ascending. No cache flush, percentile, UI rendering or packaged Cua acceptance measurement. The large native benchmark calls the noninteractive session API directly; panel confirmation is tested separately.

`measure.mts` is the supplied harness, with acceptance thresholds revised to ≤2s first screen / ≤0.2s append only for sources ≤500,000,000 bytes, and null targets above that size. Existing read-only storage snapshots remain; obsolete index-specific diagnostic controls were removed and were not run. The prior harness is preserved as `500mb/measure-before-scope.mts`. The generated fixture uses the original seeded generator with only the path, row count and size assertion changed.

```sh
node /tmp/csv-viewer-v2/perf/500mb/generate-500mb.mjs
env -u PASEO_HOME node --import ./node_modules/tsx/dist/loader.mjs /tmp/csv-viewer-v2/perf/measure.mts /tmp/csvbench/data/native-session-8_8m.csv adr3-500mb 8800000
env -u PASEO_HOME node --import ./node_modules/tsx/dist/loader.mjs /tmp/csv-viewer-v2/perf/measure.mts /tmp/csvbench/data/big.csv adr3-5gb-reference 87000000
```

Raw results: `adr3-500mb.json`, `adr3-5gb-reference.json`, `500mb/{500mb,5gb-reference}.{jsonl,stderr}`. SQL captures confirm no source index or packed copy. Source/check/cleanup manifests and the UI table are in `500mb/`. The 499.2 MB fixture was generated after a free-disk check (26GiB) and deleted after measuring; owned session databases/spill were disposed. The existing big CSV and previous reports are preserved. No host Paseo changes, push, issue mutation, dependency changes or memory/thread changes.

Notes: `/tmp/csv-viewer-v2/notes/ticket-12.md`. T10 progress CLI remains unavailable; local log `500mb/T10.md`. The coordinator owns marking T10 done.
