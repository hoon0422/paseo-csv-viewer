# CSV Viewer

[![CI](https://github.com/hoon0422/csv-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/hoon0422/csv-viewer/actions/workflows/ci.yml)

A read-only CSV and TSV viewer for [Paseo](https://paseo.sh) that opens multi-gigabyte files without loading them into memory. Open it from the Command Center or the workspace header. Then enter a workspace-relative path, choose a local file, or drop a file from Paseo Files or your desktop file manager onto the panel.

![CSV Viewer panel](assets/screenshot.png)

## Built for large files

CSV Viewer is built for files that a text editor or spreadsheet cannot open. It reads the file where it is and never copies it into the app.

| Measured on a 5 GB CSV (49,999,999 rows) | Result |
| --- | --- |
| First rows on screen | 2.1 s |
| Whole file prepared for paging, search and sort | 11.6 min |
| Search across every row | 44 s |
| Sort all 49,999,999 rows | 118 s |
| Peak plugin memory | 1.3 GB |
| Temporary disk used | 0.95 GB |

These numbers come from a slow test machine: an emulated Ubuntu 24.04 VM with 2 vCPUs, 4 GB of RAM and no swap. A real desktop should be faster. The full record is in [`reports/ticket-10/`](reports/ticket-10/README.md).

How it stays fast and small:

- **Preview first.** The first 50 rows appear within seconds, while the rest of the file is checked and prepared in the background with a progress bar.
- **Streaming, not loading.** The daemon reads the source file in a stream and builds a disk-backed [DuckDB](https://duckdb.org) table in a private temporary directory. Only the visible page of 50 rows goes to the app.
- **Fixed memory budget.** DuckDB is limited to 1 GB of memory and 2 threads. A larger sort spills to temporary disk instead of using more RAM.
- **Whole-file queries.** Search covers every column of every row, including hidden columns and rows past the preview. Sorting orders the whole file, in text order or exact numeric order.
- **Cancellable.** A long search or sort can be cancelled, and the viewer returns to the rows you had.
- **No upload.** Dropping a file from the desktop passes its path, not its contents.

## Features

- UTF-8 CSV and TSV. The first record is the header by default; you can treat it as data instead.
- Page through all rows, search every column, and sort in text or exact numeric order.
- Hide and resize columns.
- Copy a cell, or copy the selected rows' visible columns in the current order.
- Strict parsing: a record with the wrong number of fields is reported with its line number.
- If the source file changes, the finished snapshot stays on screen with a notice until you press Refresh.
- Opening a new file replaces the previous one.

## Compatibility and data access

CSV Viewer requires Paseo **0.12.0** exactly, on both the app and the daemon. It was tested with the official 0.12.0 desktop app and daemon on:

- Ubuntu 24.04.5 x86_64, including the 5 GB file above.
- Windows Server 2022 x64, with small files ([`reports/platform-acceptance/`](reports/platform-acceptance/README.md)).

macOS is a supported target but has not been tested in an isolated environment yet.

External file drops and the local file picker work only when the panel's host is the desktop app's own daemon. Preparing the file and running queries create a temporary DuckDB database, its write-ahead log, and possibly sort spill files on the daemon's temporary disk. Make sure that disk has room for roughly the size of the source file. Closing or replacing the panel deletes this temporary storage. The plugin never writes to the original file. Like every Paseo plugin, it is trusted code and has the daemon user's file, process and network access.

Paseo 0.12.0 does not bundle DuckDB's native binary into its plugin server bundle. CSV Viewer finds the installed DuckDB package through the `csv-viewer` entry in `PASEO_HOME/config.json`, so keep the default plugin ID. Paseo Files drag data and desktop file paths also use internal Paseo 0.12.0 interfaces. Later Paseo releases need a separate compatibility check before the manifest range is widened.

## Install

Install from a local checkout on a Paseo daemon:

```bash
paseo plugin install /absolute/path/to/csv-viewer
```

The manifest runs `npm ci --omit=dev --ignore-scripts` from the committed lock to install DuckDB's native runtime. Node and npm must be on the daemon's `PATH`.

## Development

```bash
npm ci
npm run typecheck
npm test
```

CI runs the same checks on Ubuntu, macOS and Windows for every pull request and every push to `main`.
