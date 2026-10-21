import { strict as assert } from "node:assert";
import { readdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createSessions } from "../../server/session";

const path = "/home/cua/ticket-5/fixtures/large.csv";
const sessions = createSessions();
const start = performance.now();
const record = (event: string, data: object = {}) => console.log(JSON.stringify({ event, ms: performance.now() - start, ...data }));
let id: string | undefined;
try {
  assert.equal((await stat(path)).size, 5_000_000_000);
  const preview = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "ticket-10", source: { kind: "local", path } });
  id = preview.sessionId;
  assert.equal(preview.rows.length, 50);
  assert.equal(preview.rows[0][0], "00000000");
  record("preview", { rows: preview.rows.length, phase: sessions.status(id).phase });
  let phase = "";
  for (;;) {
    const status = sessions.status(id);
    if (status.phase !== phase) { phase = status.phase; record("phase", { ...status }); }
    if (phase === "error") throw new Error(status.message);
    if (phase === "complete") { assert.equal(status.rowCount, 49_999_999); break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const query = async (name: string, search: string, requestId: number, sort?: { column: number; direction: "asc" | "desc"; mode: "text" }) => {
    const result = await sessions.page(id!, 0, 50, { search, requestId, sort });
    record(name, { totalRows: result.totalRows, sortMode: result.sortMode, rows: result.rows.slice(0, 5).map((row) => [row[0], row[1].slice(0, 20)]) });
    return result;
  };
  const found = await query("full-search", "query-tail-", 1);
  assert.equal(found.totalRows, 5);
  assert.deepEqual(found.rows.map((row) => row[1].split(".")[0]), ["query-tail-alpha", "query-tail-bravo", "query-tail-charlie", "query-tail-delta", "query-tail-echo"]);
  const combined = await query("search-sort", "query-tail-", 2, { column: 1, direction: "desc", mode: "text" });
  assert.deepEqual(combined.rows.map((row) => row[1].split(".")[0]), ["query-tail-echo", "query-tail-delta", "query-tail-charlie", "query-tail-bravo", "query-tail-alpha"]);
  const global = await query("unfiltered-global-sort", "", 3, { column: 1, direction: "desc", mode: "text" });
  assert.equal(global.totalRows, 49_999_999);
  assert.deepEqual(global.rows.slice(0, 5).map((row) => row[1].split(".")[0]), ["query-tail-echo", "query-tail-delta", "query-tail-charlie", "query-tail-bravo", "query-tail-alpha"]);
  record("done", { sourceBytesAfter: (await stat(path)).size });
} finally {
  await sessions.dispose();
  record("cleanup", { remainingDirs: (await readdir("/tmp")).filter((name) => name.startsWith("csv-viewer-session-")) });
}
