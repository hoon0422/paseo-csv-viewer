# macOS v2 acceptance — blocked on child IPC

Tested source **9eece4b0d4a8bbdaa20ecf06cf4ef53aee9877a9** (integration/ui-v2, includes #21), official Paseo desktop/daemon **0.12.0**, macOS **26.5.2 (25F84) arm64**, official Node LTS **24.22.1**, npm **11.19.1**. Test date 2026-10-21 UTC. The first source open fails because the Node child cannot deserialize IPC sent by the official Paseo runtime. Acceptance stopped at this blocker as instructed; no product code was changed.

## Exact package and installation

Artifact [`paseo-csv-viewer-0.1.0.tgz`](paseo-csv-viewer-0.1.0.tgz), SHA256 **f700a75c59dd62047dd63005c023f58a70b113a92c7b8e6c3e5cc2df85263ed1**. [`package-provenance.json`](package-provenance.json) records the source and all 21 file hashes. `npm run build` completed before packaging; generated child bundle produced no source diff. Host npm 12.1.0's pack selection was repacked with the committed shrinkwrap explicitly included. Every packaged file was checked byte-for-byte against the source checkout. This is a new package, distinct from all prior Linux/Windows/macOS artifacts.

Cua upload independently verified the same SHA256 in guest. Package was extracted into `/Users/lume/csv-macos-21/t04-artifact/package`; `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` installed four packages, exit 0. The already configured directory installation had to be removed with the official plugin CLI before installing the new path: another `plugin install` with the same ID is rejected. The old source directory remains preserved. [`t04-evidence/plugin-list.json`](t04-evidence/plugin-list.json) confirms `csv-viewer` enabled/running from the new package path.

## Environment and provenance

Retained **running** Space `local:paseo-csv-macos-21`, local Lume, canonical cached macOS image `ghcr.io/trycua/macos:26`, digest `sha256:d6d864fe6bba6ada8b2e5cd9d7f1ba4f64b1e5ca8a2ef7edc1d1530e356437df`. No new VM was created for T04. Daemon home `/Users/lume/.paseo-csv-macos-21`, loopback `127.0.0.1:6781`, relay disabled, server ID `srv_BtH4HyyeBawj`. Desktop data `/Users/lume/csv-macos-21/desktop-data`; guest evidence `/Users/lume/csv-macos-21/t04-evidence`.

Official Paseo archive: `https://github.com/getpaseo/paseo/releases/download/v0.12.0/Paseo-0.12.0-arm64.zip`, SHA256 `eab79b156c6eea5e5f4472533b66724a0a2974f672745c2025eb59a75f829d41`. Deep/strict signature verification passed, Developer ID Team `99ZMJMKU9Y`, notarization stapled. Original setup signature/entitlement/hash records are copied into `t04-evidence/`; installed app was not changed. Node was downloaded from nodejs.org and checked against its official SHASUMS256; signature Team `HX7739G8FX`. Exact runtime versions are in [`environment.log`](t04-evidence/environment.log) and [`paseo-runtime.json`](t04-evidence/paseo-runtime.json).

Paseo main and Helper entitlements omit `disable-library-validation`; official Node includes it. **SIP is disabled in this cached image.** The earlier unmodified package opened successfully here and mapped DuckDB in Paseo Helper, so the original different-Team-IDs rejection was not reproduced. This run does not prove behavior under enforced library validation. No security settings were changed.

## Failure and likely cause

Click `macOS CSV reproduction` → header `CSV Viewer` → type `rows.csv` in the path field → Return. Fixture is 1,200 synthetic records with `id,city,value,note`; IDs ascend, values descend, cities alternate, notes are long. Its full bytes and hash are recorded in `t04-evidence/rows.csv` and `fixture-sha256.log`.

The panel reports `CSV Viewer Node.js child exited (1)` and incorrectly suggests checking architectures, despite both runtimes being arm64. The actual captured child stderr is:

> Error: Unable to deserialize cloned data due to invalid or unsupported version.

The stack starts in Node's `internal/child_process/serialization:72`, with Node 24.22.1. [`child-stderr.txt`](t04-evidence/child-stderr.txt), [`plugin-logs-failure.json`](t04-evidence/plugin-logs-failure.json), and [`path-open-failed.png`](t04-evidence/path-open-failed.png) are the raw evidence. `server/proxy.ts:57` requests `serialization: "advanced"`. An incompatibility between Electron and external Node's V8 serialization is the likely cause, inferred from that setting and the child deserialization stack; no source change or standalone reproducer was attempted in this acceptance run.

## Verdicts

| Requested check | Verdict | Evidence / limit |
| --- | --- | --- |
| Exact artifact, locked production install, plugin running | Pass | package-provenance.json; package-sha256.log; npm-ci.log; plugin-list.json |
| Official app/daemon and Node provenance, entitlements | Pass | signature/hash/entitlement records; daemon-status.json; environment.log |
| Path Enter opens a CSV | **Fail** | path-open-failed.png; child-stderr.txt; plugin-logs-failure.json |
| Clear actionable child-failure message | Partial | Exit and Node path shown; architecture suggestion does not identify IPC incompatibility |
| DuckDB mapped only by Node while CSV is open and sorted | **Blocked** | Source cannot open; no live child exists after failure |
| Last-panel close stops child and removes owned storage | **Blocked** | No successful child session was established; no normal-close claim |
| Native picker and Finder/Paseo Files drops | **Untested** | Stopped on first-open blocker |
| Sorting, filters and combined results | **Untested** | Stopped on first-open blocker |
| Selection / visible-column TSV copy / cell copy | **Untested** | Stopped on first-open blocker |
| Column menu, hide/reveal/resize, row expansion | **Untested** | Stopped on first-open blocker |
| Scrolling, reset/header behavior, refresh/source changes | **Untested** | Stopped on first-open blocker |
| Over-500 MB confirmation OK and Cancel | **Untested** | No 501 MB fixture generated after blocker |
| Resource cleanup, malformed input, source removal | **Untested** | Stopped on first-open blocker |
| Original Hardened Runtime Team IDs rejection | **Not reproduced** | SIP disabled; earlier baseline loaded successfully |
| Native ADR 0003 performance targets | **Untested here** | No VM performance pass/fail claim; native measurement is required |

[`native-mappings-after-failure.log`](t04-evidence/native-mappings-after-failure.log) records no DuckDB mapping in the inspected live Paseo processes and no remaining `node` process **after the failure only**. [`processes-after-failure.log`](t04-evidence/processes-after-failure.log) records supervisor 1285, daemon 1287 and plugin Helper 1957. This does not satisfy the requested live-open/sorted structural proof. No VM timings were measured because opening never succeeded. No automated source tests were rerun for this evidence-only change; prior suite results are not relabeled as macOS acceptance.

#10 and #21 are not accepted by this run. The VM and daemon remain running for the coordinator; the failure panel is left visible. Host Paseo app/daemon, profiles, credentials, existing Ubuntu Spaces and security configuration were untouched. No issue comment was posted. Proposed comment is `/tmp/csv-viewer-v2/notes/macos-issue10-comment.md`.
