import { test } from "node:test";
import { strict as assert } from "node:assert";
import { jsonMessage } from "../server/ipc";

test("session IPC requests, responses, workspace replies and errors round-trip through JSON", () => {
  const messages = [
    { id: 1, method: "open", args: [{ panelId: "panel", workspaceId: "workspace", source: { kind: "workspace", path: "rows.csv" }, hasHeader: undefined }] },
    { id: 2, method: "status", args: ["session"] },
    { id: 3, method: "page", args: ["session", 0, 200, { sort: undefined }] },
    { id: 4, method: "beginPage", args: ["session", 0, 200, { requestId: 1 }] },
    { id: 5, method: "pollPage", args: ["session", 1] },
    { id: 6, method: "close", args: [undefined, "panel", undefined] },
    { id: 7, method: "dispose", args: [] },
    { ready: true }, { workspace: 1, requestId: 1, workspaceId: "workspace" },
    { workspace: 1, value: { id: "workspace", workspaceDirectory: "/workspace" } },
    { workspace: 2, value: null }, { workspace: 3, error: { message: "Workspace is unavailable" } },
    { id: 1, value: { sessionId: "session", columns: ["name"], rows: [["雪"]], sourceBytes: 12 } },
    { id: 2, value: { phase: "complete", percent: 100, rowCount: 1 } },
    { id: 3, value: { offset: 0, nextPosition: 0, rows: [["雪"]], totalRows: 1, sortMode: undefined } },
    { id: 4, value: { state: "pending" } }, { id: 5, value: { state: "ready", page: { rows: [] } } },
    { id: 6, value: true }, { id: 7, value: null }, { id: 8, error: { message: "Session cancelled" } },
  ];
  for (const message of messages) {
    const encoded = jsonMessage(message);
    assert.deepEqual(JSON.parse(JSON.stringify(encoded)), encoded);
  }
  assert.deepEqual(jsonMessage(messages[5]), { id: 6, method: "close", args: [null, "panel", null] });
  for (const value of [1n, new Map([["key", "value"]]), new Set([1]), new Error("Use {message}")]) {
    assert.throws(() => jsonMessage({ value }), /JSON/i);
  }
});
