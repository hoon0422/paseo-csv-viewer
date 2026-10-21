# Ticket #20 / T10 — final Linux acceptance

Branch: ticket/20-acceptance. Merged integration/ui-v2 10f25c1 in b18637295bc1f490df261ded617c0b1988daae27. Full check: typecheck + 101/101 tests PASS. No product changes in the final resume; earlier test-first matching-count fix ff199b6 remains included (red/green logs retained).

Final package: reports/ui-v2/final/paseo-csv-viewer-0.1.0.tgz
SHA-256: 10ab7e52e582c4321da29406b2b49f9a505447823fdc4598207803d0984f1fda
All 18 entries match the merged revision and installed Space files. Production npm ci passed; plugin running in /home/cua/ui-v2-final/package.

Space local:paseo-x64-ubuntu-ticket-2, official Paseo 0.12.0, isolated home /home/cua/.paseo-x64-ticket-2 port 6779. Recovered transport; exact process check found the earlier 5 GB benchmark absent. Started only the isolated desktop; daemon became available, explicit isolated start reported already running. No VM restart/recreation, host app/daemon change, teleport, credentials or evidence deletion. No new VM.

ADR 0003 performance PASS via /tmp/csv-viewer-v2/perf/report-500mb.md, copied with raw native events into reports/ui-v2/final/. All 23 native targets pass; engine files equal the measured revision b1b7b7d. Cua/5 GB figures remain reference only. No new 5 GB Cua run.

Remaining native UI checks completed: tooltips/full-cell hover, local picker, whole-panel drop onto path bar, viewport Ctrl+A, cap toast/unchanged selection, clear sort, reveal all, Ctrl+F, regex error/recovery, header and new-source resets, rejected-path matching count, >500 MB warning Cancel/OK, row/cell clipboard. With 30,050 loaded rows, native wheel responsive; 104 mounted, p95 frame interval 16.8 ms in a 12 s reference probe. Setup used short copied DOM-scroll files through normal app paging; actual gestures remained native. The 500,000,100-byte warning fixture reached preview at 0.819 s / Ready at 28.690 s, Cua reference only.

Evidence: reports/ui-v2/README.md final criterion table and provenance; final/ contains package, logs, screenshots, raw probes, native report and verification assertions. Earlier artifacts and reports preserved; original reviews not repeated per instruction. Proposed #10 comment: /tmp/csv-viewer-v2/notes/ticket-20-issue10-comment.md (not posted). macOS acceptance must use the final package above; no macOS run.

App returned to small ui-v2.csv, large session disposed normally, owned monitors stopped. Final health: no owned 5 GB benchmark, MemAvailable 2,624,636 kB, disk available 4,225,859,584 bytes. Desktop/daemon and fixtures retained. Progress CLI unavailable; stage attempts logged, T10 not marked done (coordinator owns).

After evidence commit 35b28aa, merging integration/ui-v2 again was already up to date at 10f25c1. The required check passed again: typecheck + 101/101 tests, no failures/skips. Product and test files are unchanged from packaged source b186372. Post-merge logs and merge-check.json are committed under reports/ui-v2/final/.
