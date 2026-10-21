# Issue #21 Linux recheck: PASS after IPC fix

The recheck with **fa020737da8036601a19fa0b91cabbda553c663d** passes all requested Linux checks. Earlier failure evidence is preserved below as history; it does not describe the current installed package.

## Successful retry

Merged `origin/integration/ui-v2` at fa02073 into this branch. Tested merged source **90b519b60cfeb0155c59c1825188b08df5df19d1**. Package SHA-256 **f6a8dd842efe01c74c7dafc0f21f284bbe3d5aac0de4b9c8b2a4eae67e1ff9cc**. All **22** package files match the Git revision and installation, including the bundled child and JSON IPC helper: [package provenance](retry/package-provenance.json), [installed provenance](retry/evidence/installed-provenance.json). The same explicit npm inventory plus committed shrinkwrap packaging method is used.

Same existing Space **local:paseo-x64-ubuntu-ticket-2**, official Paseo **0.12.0**, daemon PID **40131**, isolated home `/home/cua/.paseo-x64-ticket-2`, port **6779**. The Space was already reachable. No VM or desktop restart, host Paseo changes, credential copying, or teleport. Global plugins were already enabled. [Production npm ci](retry/evidence/npm-ci.log) passed; normal isolated remove/install switched `csv-viewer` to `/home/cua/linux-21-retry/package`, [running](retry/evidence/install.json), [exit 0](retry/evidence/install.exit). Previous package directories and evidence remain intact.

All UI actions below used native xdotool mouse/keyboard input. The copied [DOM probe](retry/evidence/probe.mjs) reads the real official desktop over its existing loopback diagnostic endpoint; it does not inject state or call plugin RPCs. Screenshots show the real app window. Intermediate captures 01–02 preceded settled rendering and are not success proof.

| Requested check | Verdict | Evidence |
| --- | --- | --- |
| Merged-source typecheck, child bundle freshness, tests, build | PASS | [Check log](retry/check.log), [exit 0](retry/check.exit): **113/113 tests**, no failures/skips. PASEO_HOME unset; no host app access. |
| Node on daemon PATH | PASS | Daemon/plugin PATH `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`; `/usr/local/bin/node` resolves `/usr/local/lib/nodejs/bin/node` (v24.21.0): [process evidence](retry/evidence/03-processes.json), [installed runtime](retry/evidence/installed-provenance.json). |
| Small source open | PASS | Native path `rows120.csv`, **120 data rows**, Ready, starts at id 000: [screenshot](retry/evidence/03-small.png), [state](retry/evidence/03-small.json). |
| Small source sort | PASS | id descending, first id **119**: [screenshot](retry/evidence/05-small-sorted.png), [state](retry/evidence/05-small-sorted.json). |
| Small source filter | PASS | Any column contains `value-01`; **10 of 120 rows**, descending id **019** first: [screenshot](retry/evidence/07-small-filtered.png), [state](retry/evidence/07-small-filtered.json). |
| ~30k-row source open/replacement | PASS | Native path `ui-v2-30050.csv`, **30,050 data rows**, Ready, starts id 00000; prior filter/sort cleared: [screenshot](retry/evidence/08-30050.png), [state](retry/evidence/08-30050.json). [Fixture hashes](retry/evidence/fixtures.json). |
| ~30k-row source sort | PASS | id descending, first id **30049**: [screenshot](retry/evidence/09-30050-sorted.png), [state](retry/evidence/09-30050-sorted.json). |
| ~30k-row source filter | PASS | Any column contains `alpha`; **15,025 of 30,050 rows**, descending id **30048** first: [screenshot](retry/evidence/10-30050-filtered.png), [state](retry/evidence/10-30050-filtered.json). |
| Daemon/plugin never map DuckDB during observed operations | PASS | Daemon **40131** and plugin **42352** have no DuckDB mappings in all four captures: [small open](retry/evidence/03-processes.json), [small filtered](retry/evidence/07-processes.json), [replacement](retry/evidence/08-processes.json), [large filtered](retry/evidence/10-processes.json). |
| Node child maps DuckDB | PASS | Child **42392**, parent **42352**, executable `/usr/local/lib/nodejs/bin/node`; `/proc/42392/maps` contains installed **duckdb.node** and **libduckdb.so** in those same captures. The child remains shared across source replacement. |
| Last panel close stops child and removes owned temporary storage | PASS | After native Close on the sole viewer tab: [New tab screenshot](retry/evidence/11-last-panel-closed.png), [no viewer](retry/evidence/11-last-panel-closed.json), [processes](retry/evidence/11-processes.json). [Direct lifetime check](retry/evidence/lifetime.json): PID **42392** and `/tmp/csv-viewer-child-GCgR9y` absent, daemon/plugin still alive. |

The [plugin log](retry/evidence/plugin-logs.json) has no stderr entries. The [assertion script](retry/verify-evidence.py) checks package/source/install identity, exact first rows and counts, sorted state, process ancestry/mappings, continued child identity through replacement, and successful last-close cleanup; [results](retry/verification.json) PASS.

Final state: viewer tab closed; isolated daemon and desktop remain running, fixed package installed for inspection, no child or owned temporary root left. [Health](retry/evidence/final-health.json). Progress remains unavailable; [attempt log](retry/progress.log), no host plugin installed and no coordinator ticket marked done. No issue comment/status change, public release, or npm publish.

This is Linux behavior verification only. No performance benchmark, macOS acceptance, or new crash-injection run was performed during the retry.

## History: first recheck failed before the IPC fix

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
