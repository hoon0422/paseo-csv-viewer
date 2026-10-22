# CSV Viewer

CSV Viewer lets you inspect a UTF-8 CSV or TSV file in a read-only Paseo workspace panel, including files of several gigabytes. Open it from the Command Center or the workspace header, then enter a path, choose a local file, or drop one from Paseo Files or the desktop file manager onto the panel.

The first 50 rows appear right away while the whole file is prepared in the background. You can then scroll through every row, sort any column in Auto, Numeric or Text order, filter with rules (text, regular expression, numeric comparison and range, match all or any), hide and resize columns, and copy selected rows as TSV or a single cell. The first record is a header by default and can be treated as data instead. If the file changes, the current table stays visible with a notice until you press Refresh.

## Large files

The file is read in place and loaded into a temporary DuckDB database on the daemon's disk, and the app receives only the 200 rows it is showing. On an Apple M4 Pro, a 500 MB file with 8.8 million rows was ready to sort and filter in about 6 seconds, and a 5.4 GB file with 87 million rows in about a minute. Performance is guaranteed up to 500 MB: the first sorted screen within 2 seconds and each scrolled page within 0.2 seconds. Larger files open after you confirm a size warning, with no timing promised. Prepared data on temporary disk can take more than half the size of the source file.

## Requirements and data access

The app and daemon must both run Paseo 0.12.0. Node.js and npm must be on the daemon's PATH: npm sets up the locked DuckDB runtime, and DuckDB runs in a separate `node` process because the macOS Paseo app does not allow its native library inside the daemon. The default `csv-viewer` plugin ID is required. The current version was tested on Ubuntu 24.04 x86_64 and macOS 26 arm64. An earlier version was tested on Windows Server 2022, and the current one has not been retested there.

External drops and the local file picker require the desktop's own daemon to be the selected host. Drops pass the file path, not its contents, and CSV Viewer never modifies the original file. Temporary files are deleted when the panel closes or the source is replaced. As a trusted Paseo plugin, its server code has the daemon user's access to local files, processes, credentials, and network services. Paseo Files drag data, the desktop local-file bridge, and the native loader path depend on internal Paseo 0.12.0 behavior, so later releases are unverified.
