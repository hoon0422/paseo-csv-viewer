import { open, mkdir, rm, readdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createSessions } from "./server/session.ts";
const path = "/home/cua/ticket-5/fixtures/cancel.csv";
await mkdir("/home/cua/ticket-5/fixtures", { recursive: true });
const file = await open(path, "w");
const line = "x".repeat(99) + "\n";
const block = Buffer.from(line.repeat(10_000));
try {
  await file.writeFile("value\n");
  for (let i = 0; i < 500; i++) {
    let at = 0;
    while (at < block.length) {
      const { bytesWritten } = await file.write(block, at, block.length - at);
      at += bytesWritten;
    }
  }
} finally { await file.close(); }
const bytes = (await stat(path)).size;
const before = new Set((await readdir("/tmp")).filter(x => x.startsWith("csv-viewer-session-")));
const sessions = createSessions();
const t0 = performance.now();
const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path } });
const previewMs = performance.now() - t0;
let status = sessions.status(opened.sessionId);
for (let i = 0; i < 100 && status.phase !== "preparing" && status.phase !== "complete" && status.phase !== "error"; i++) {
  await new Promise(r => setTimeout(r, 10));
  status = sessions.status(opened.sessionId);
}
const atCancel = performance.now();
const phaseAtCancel = status.phase;
const closed = sessions.close(opened.sessionId);
const rpcMs = performance.now() - atCancel;
await sessions.dispose();
const stoppedMs = performance.now() - atCancel;
const after = (await readdir("/tmp")).filter(x => x.startsWith("csv-viewer-session-") && !before.has(x));
const evidence = { bytes, previewMs, phaseAtCancel, closed, rpcMs, stoppedMs, leakedSessionDirs: after, sourceBytesAfter: (await stat(path)).size };
process.stdout.write(JSON.stringify(evidence) + "\n");
if (phaseAtCancel !== "preparing" || !closed || after.length) process.exitCode = 1;
await rm(path);
