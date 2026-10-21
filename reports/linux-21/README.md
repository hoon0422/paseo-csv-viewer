# Issue #21 Linux recheck: FAIL

Tested source **9eece4b0d4a8bbdaa20ecf06cf4ef53aee9877a9**, also the current `integration/ui-v2` tip. No product code changed. Package SHA-256 **a4320cea81841531292e7519f1a25e2c77c25f9bac12faf5432412e62473fbdd**. All 21 packaged files match this Git revision and the installed files; see [package provenance](package-provenance.json) and [installed provenance](evidence/installed-provenance.json). npm 12 omitted shrinkwrap from its [pack inventory](pack.json), so the final tar uses that inventory plus committed `npm-shrinkwrap.json`, with every file read from Git and the tar contents asserted equal. Nothing was published.

## Environment and installation

Existing Space `local:paseo-x64-ubuntu-ticket-2`, Ubuntu x86_64, official Paseo **0.12.0**, 2 vCPU / 4 GB, emulated. The Space initially reported Paused; it was resumed in place and transport worked. No VM reboot/recreation, desktop restart, host Paseo changes, credentials, or teleport. Daemon PID **40131**, home `/home/cua/.paseo-x64-ticket-2`, loopback **6779**; desktop profile `/home/cua/.config/Paseo-x64-ticket-2`.

The global plugin switch was already enabled. Production [npm ci](evidence/npm-ci.log) passed. The initial install found the existing ID configured; normal remove/install replaced only the isolated `csv-viewer` registration, preserving the previous package directory. [Install](evidence/install.json) reports `running` at `/home/cua/linux-21/package`; [empty installed panel](evidence/03-installed.png). The daemon PATH includes `/usr/local/bin`, which resolves Node **v24.21.0**, linux/x64. [Process evidence](evidence/04-processes.json) records both the daemon and plugin subprocess PATH/home/executable.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Source checks | PASS | Typecheck, committed child bundle freshness, **112/112 tests**, build; [check](check.log), [exit 0](check.exit). Required integration merge was already up to date; [post-merge check](check-postmerge.log), [exit](check-postmerge.exit). PASEO_HOME unset; source checks only. |
| Build and isolated installation | PASS | Package/source hashes above; [production dependencies](evidence/npm-ci.log), [running install](evidence/install.json). |
| Node on daemon PATH | PASS | `/usr/local/bin/node`, v24.21.0, linux/x64; [PATH](evidence/04-processes.json), [Node runtime](evidence/path-node-runtime.json). |
| Small CSV open | FAIL | Native path entry `rows120.csv`, **120 data rows**. [Screenshot](evidence/04-small-failed.png), [state](evidence/04-small-failed.json). Child exits 1; no table opens. |
| ~30k-row CSV open/replacement | FAIL | Native path entry `ui-v2-30050.csv`, **30,050 data rows**. [Screenshot](evidence/05-30050-failed.png), [state](evidence/05-30050-failed.json), [fixture hashes](evidence/fixtures.json). Same error; no table opens. |
| Sort and filter | BLOCKED | No source reaches Preview/Ready, so these controls cannot be exercised. |
| Daemon/plugin do not map DuckDB | PASS for observed states | `/proc/40131/maps` and `/proc/41938/maps` contain no DuckDB mappings after either failure and after panel closure; [small](evidence/04-processes.json), [30k](evidence/05-processes.json), [closed](evidence/10-processes.json). |
| Child maps DuckDB while source open | BLOCKED | Child crashes before source opening; no successful child binding load demonstrated. |
| Crash cleanup | PASS for these observed failures | Child absent and no `/tmp/csv-viewer-child-*` roots after each failed open; process evidence above. |
| Close panels / last-close shutdown | PARTIAL | Native Close buttons removed both viewer tabs; [final screenshot](evidence/10-closed.png), [no viewer state](evidence/10-closed.json). No child or owned root remains. Normal last-close termination is unverified because the child had already crashed. Earlier captures 07–09 are intermediate close attempts, not final-close proof. |

## Blocker

[Plugin stderr](evidence/plugin-logs-final.json) reports twice:

```
Error: Unable to deserialize cloned data due to invalid or unsupported version.
    at parseChannelMessages (node:internal/child_process/serialization:72:13)
```

`server/proxy.ts:57` selects `serialization: "advanced"`. The official [Paseo binary runtime](evidence/paseo-runtime.json) uses Electron 44.2.0 / V8 **15.2.124.19-electron.0**, while the [PATH Node runtime](evidence/path-node-runtime.json) uses V8 **13.6.233.17-node.53**. Both architectures are linux/x64. The failure and differing V8 versions point to incompatible advanced IPC serialization, not missing Node or an architecture mismatch. Runtime versions were read by running a tiny script with the same official binary in Node mode, without starting another daemon.

The [panel error](evidence/05-30050-failed.png) is visible but directs users toward Node/DuckDB architecture checks; it does not expose the actual IPC error. Local tests use a compatible parent/child runtime and passed despite this real-app failure. No workaround or product fix was applied during this recheck.

## Final state and limits

The isolated desktop and daemon remain running; all viewer tabs are closed. The tested package remains installed for diagnosis. Previous package directories, fixtures, and evidence remain intact. [Final health](evidence/final-health.json). [Evidence assertions](verify-evidence.py) check provenance, both errors, runtime architecture, absence of mappings/child/temp roots, final closure, and the source check results. [Assertion results](verification.json).

No macOS, performance, successful sort/filter, successful child binding load, or normal last-close lifetime is claimed. Progress commands were attempted throughout, but the plugin is unavailable; [attempt log](progress.log). No host plugin was installed and no coordinator ticket was marked done. No issue comment or status change was made.
