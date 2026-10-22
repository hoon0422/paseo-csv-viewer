SPEC #11 / ticket #20 Linux v2 acceptance is complete. The remaining macOS acceptance in #10 must run on this new package:

- Package: `reports/ui-v2/final/paseo-csv-viewer-0.1.0.tgz`
- SHA-256: `10ab7e52e582c4321da29406b2b49f9a505447823fdc4598207803d0984f1fda`
- Source: `b18637295bc1f490df261ded617c0b1988daae27`, including integration `10f25c1` and the test-first rejected-path matching-count fix.

All 18 packaged files match source and the installation in `local:paseo-x64-ubuntu-ticket-2`, official Paseo 0.12.0, isolated daemon home `/home/cua/.paseo-x64-ticket-2`, port 6779. Production install succeeded; plugin running. Current source passes typecheck and 101/101 tests.

Updated ADR 0003 performance is judged natively up to 500 MB. The supplied `/tmp/csv-viewer-v2/perf/report-500mb.md` records all 23 targets passing; a copy and raw events are committed under `reports/ui-v2/final/`. The package's engine files match that measured revision. Cua and 5 GB timings remain reference only; no new 5 GB Cua run. Warning OK and Cancel were exercised in the app on a 500,000,100-byte fixture.

`reports/ui-v2/README.md` records the final per-criterion verdicts, screenshot matrix, provenance and limitations. Remaining UI checks include native picker/drop/tooltips, viewport selection and limit toast, responsive wheel scrolling with 30,050 loaded rows, reset behavior, clear sort/reveal all, regex recovery and exact row/cell clipboard checks. Short copied DOM-scroll scripts prepared the large-loaded-row state through normal application paging; the verification gestures were native.

Keep #10 open until isolated macOS acceptance passes on this exact artifact (or a later explicitly identified replacement). No macOS run has occurred on this package. No host Paseo changes, VM restart/recreation, teleport, credential copying, evidence deletion, push or publication.

Proposed comment only; not posted, as requested.
