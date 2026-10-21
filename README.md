# CSV Viewer

CSV Viewer opens UTF-8 CSV and TSV files in a read-only Paseo workspace panel. Open it from the Command Center or workspace header. Enter a workspace-relative path, choose a local file, or drop a file from Paseo Files or the desktop file manager onto the open panel.

The first record is a header by default. The panel previews up to 50 rows while it validates and prepares the whole file. You can page through the prepared rows, search every column, sort in text or exact numeric order, hide or resize columns, and copy cells or selected visible rows. A new file replaces the previous one. If the source changes, the completed snapshot stays visible with a notice until you press Refresh.

## Compatibility and data access

The tested app and daemon are the official Paseo 0.12.0 amd64 release on Ubuntu 24.04.5. The manifest accepts exactly 0.12.0. macOS and Windows are intended desktop targets but have no isolated runtime verification yet. The app and daemon must both meet the version requirement.

The daemon reads the original file directly. External file drops and the local picker work only when the selected panel host is the desktop app's own running daemon. No full-file upload is made for an external drop. Preparation and queries create an owned temporary DuckDB database, WAL, and possible sort spill on the daemon's temporary disk. Closing or replacing the panel removes owned storage. The original file is never written by the plugin. Plugin code has the daemon user's file, process, and network access, as Paseo plugins are trusted code.

Paseo 0.12.0 does not bundle DuckDB's native binary into its plugin server bundle. CSV Viewer resolves the installed DuckDB package through the `csv-viewer` entry in `PASEO_HOME/config.json`; use the default plugin ID. Paseo Files drag data and desktop file paths also use internal Paseo 0.12.0 interfaces. Later Paseo releases need a separate compatibility check before widening the manifest range.

## Install and development

Install the project directory on an independent Paseo daemon with `paseo plugin install /absolute/path/to/csv-viewer`. The manifest runs `npm ci --omit=dev --ignore-scripts` from the committed lock to install DuckDB's native runtime package. Node and npm must be available on the daemon's PATH. Run `npm ci`, `npm run typecheck`, and `npm test` to check a development checkout. A packed artifact can be extracted to a directory and installed from that directory using the default ID.

The verified limits and resource measurements for this build are recorded in `reports/ticket-10/`. The 5 GB synthetic fixture is retained only in the assigned Ubuntu test Space and is not part of the package.
