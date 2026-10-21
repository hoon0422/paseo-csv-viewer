# CSV Viewer

A read-only CSV/TSV preview plugin for Paseo 0.12.x desktop. Open its workspace
panel from the Command Center or workspace header. Enter a workspace-relative
path, choose a local file, or drop one from Paseo Files or a desktop file manager.
The panel shows at most 50 data rows and replaces the previous preview.

Install from this Git repository after its dependencies are prepared by the
manifest build command. The daemon reads the original file by path; file bytes
are not sent through the client to open it. External files require the desktop
app's own running daemon to have the same server ID as the selected panel host.

The Paseo Files drag MIME/payload, React Native Web drop listeners,
`paseoDesktop.webUtils.getPathForFile`, and
`paseoDesktop.invoke("desktop_daemon_status")` are internal Paseo 0.12.0
interfaces. The adapter checks their availability and refuses unsupported
sources. DuckDB is loaded from the plugin installation path in the independent
daemon's configuration because Paseo 0.12.0's server compiler cannot bundle
native `.node` binaries.

This ticket supplies a provisional preview. Full-file preparation, search,
sorting, cancellation, and 5 GB validation belong to later tickets. Linux
desktop 0.12.0 is the runtime tested here; macOS and Windows remain unverified.
