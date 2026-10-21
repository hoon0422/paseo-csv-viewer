---
status: accepted
---

# Load DuckDB in a shared Node.js child

The official macOS Paseo 0.12.0 daemon has Hardened Runtime library validation and cannot load DuckDB's ad-hoc-signed native binary. Run the existing viewer sessions in one long-lived child using the explicitly resolved `node` on the daemon's PATH, on every OS. The child uses the existing installed-package resolution in `PASEO_HOME/config.json`; the daemon proxies session operations over IPC and retains workspace lookup and source inspection.

The last panel close stops the child. If it crashes, affected sessions fail, the daemon removes the child's owned temporary directory, and the next open starts a new child. Sessions are not restored after a crash. The client RPC contract stays unchanged. This avoids changing Paseo or re-signing DuckDB, at the cost of requiring a compatible Node.js runtime on PATH and shipping a bundled child entry with the plugin.

If the daemon and child are killed together, cleanup cannot run and owned temporary directories can remain.
