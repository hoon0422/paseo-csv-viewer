# Spec-axis final review

Reviewed HEAD `a9efd0f5b0eda155c9ff26a443fe509025968e21` against `168bb91cef429b159c3ff1b182b3e90b895bf904` using the requested three-dot diff and freshly fetched #1 specification.

**Confirmed defect — P1: rejected query starts destroy the current polling owner.** Spec (`review-spec.md:60`): “I want canceled or replaced work to stop affecting the panel”. In `server/session.ts:327–337`, `beginPage` assigns `session.query` before `page` rejects an older request ID at line 283. Public-seam sequence: open a real CSV, await complete, start `viewer.query` request 2, then deliver a delayed start for request 1, then poll request 2. The second start replaces the polling record with request 1 even though its work is rejected; polling request 2 now throws “Query superseded”, including after its valid result completes. No native-query timing assumption is needed. The current panel catches that error and stops loading without displaying its requested results (`client/panel.tsx:128–144`). Duplicate starts with the same ID while busy likewise replace the record with an “already loading” error (server line 286).

Fix by validating/admitting query ownership before publishing the polling record. Focused implementer regression: exercise the sequence through start/poll with a real prepared fixture; assert the stale start cannot prevent request 2 from yielding its expected rows. Also cover a duplicate active start. Existing `tests/session.test.ts:129–153` checks obsolete polling after a newer start, but not a stale start arriving afterward. This is confirmed by source control flow, not a newly executed runtime test.

**Known incomplete acceptance, separate from the defect.** Spec: “The first release targets macOS, Windows, and Linux desktop clients.” `reports/ticket-10/README.md:36` explicitly leaves isolated macOS/Windows runtime checks blocked. #10 and the parent must remain open. Linux evidence records 41 passing tests and full 5GB acceptance; the actual tarball exists and its SHA-256 matches the documented artifact.

No additional confirmed spec defects or unrequested scope creep emerged from inspection of parsing, cleanup, source revisions, drop validation, clipboard serialization, and exact numeric ordering.

No repository changes, test/package execution, app/Space operations, or additional agents. Runtime reproduction and blocked platform checks remain unperformed; the query regression needs isolated verification after repair.
