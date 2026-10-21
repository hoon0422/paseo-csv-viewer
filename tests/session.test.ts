import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm, stat, readFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { createSessions } from "../server/session";

async function settled(sessions: ReturnType<typeof createSessions>, sessionId: string) {
  for (let i = 0; i < 200; i++) {
    const status = sessions.status(sessionId);
    if (status.phase === "complete" || status.phase === "error") return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Session did not settle");
}

test("opens a real CSV as a bounded read-only viewer session and replaces it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-"));
  const panelId = "b10416ae-b0d3-4aab-a49c-b77ccdcfd998";
  try {
    const first = join(dir, "first.csv");
    const second = join(dir, "second.tsv");
    await writeFile(first, 'id,note\n001,"hello, world"\n002,"two\nlines"\n');
    await writeFile(second, "code\tvalue\nA\tthree\n");
    const sessions = createSessions();
    const opened = await sessions.open({ panelId, workspaceId: "workspace", source: { kind: "local", path: first } });
    assert.deepEqual(opened.columns, ["id", "note"]);
    assert.deepEqual(opened.rows, [["001", "hello, world"], ["002", "two\nlines"]]);
    assert.equal(opened.status, "preview");
    assert.equal(opened.sourceBytes, (await stat(first)).size);
    assert.equal(await readFile(first, "utf8"), 'id,note\n001,"hello, world"\n002,"two\nlines"\n');
    const replaced = await sessions.open({ panelId, workspaceId: "workspace", source: { kind: "local", path: second } });
    assert.deepEqual(replaced.rows, [["A", "three"]]);
    assert.notEqual(replaced.sessionId, opened.sessionId);
    assert.equal(sessions.close(opened.sessionId), false);
    assert.equal(sessions.close(replaced.sessionId), true);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty CSV has an honest empty preview", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-empty-"));
  try {
    const file = join(dir, "empty.csv");
    await writeFile(file, "");
    const sessions = createSessions();
    const result = await sessions.open({
      panelId: "179b3a3c-9009-4872-aea1-045c05e5ec96",
      workspaceId: "workspace",
      source: { kind: "local", path: file },
    });
    assert.deepEqual(result.columns, []);
    assert.deepEqual(result.rows, []);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace selection stays inside its workspace and rejects other file kinds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-paths-"));
  try {
    const root = join(dir, "workspace");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(root);
    await writeFile(join(root, "valid.csv"), "name\nAda\n");
    await writeFile(join(dir, "outside.csv"), "name\nOther\n");
    await writeFile(join(root, "notes.txt"), "not CSV");
    await mkdir(join(root, "folder.csv"));
    const paseo = {
      workspaces: { ref: () => ({ refresh: async () => ({ id: "workspace", workspaceDirectory: root }) }) },
    } as unknown as PaseoApi;
    const sessions = createSessions();
    const base = { panelId: "d47b93c3-ae2a-428d-b31b-e866ece17a14", workspaceId: "workspace" };
    assert.deepEqual((await sessions.open({ ...base, source: { kind: "workspace", path: "valid.csv" } }, paseo)).rows, [["Ada"]]);
    await assert.rejects(sessions.open({ ...base, source: { kind: "workspace", path: "../outside.csv" } }, paseo), /outside this workspace/);
    await assert.rejects(sessions.open({ ...base, source: { kind: "workspace", path: "notes.txt" } }, paseo), /CSV or TSV/);
    await assert.rejects(sessions.open({ ...base, source: { kind: "workspace", path: "folder.csv" } }, paseo), /regular file/);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preview response stays at 50 data rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-bounded-"));
  try {
    const file = join(dir, "many.csv");
    await writeFile(file, "value\n" + Array.from({ length: 75 }, (_, i) => String(i)).join("\n") + "\n");
    const sessions = createSessions();
    const result = await sessions.open({
      panelId: "3e592d6d-2049-4e11-9141-617f34267c3c",
      workspaceId: "workspace",
      source: { kind: "local", path: file },
    });
    assert.equal(result.rows.length, 50);
    assert.deepEqual(result.rows.at(-1), ["49"]);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prepares a file-backed session and pages beyond the preview in source order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-pages-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "pages.csv");
    await writeFile(file, "id,id,\n" + Array.from({ length: 123 }, (_, i) => `${String(i).padStart(3, "0")},${i},tail-${i}\n`).join(""));
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.deepEqual(opened.columns, ["id", "id", ""]);
    assert.deepEqual(opened.rows[0], ["000", "0", "tail-0"]);
    assert.equal(opened.rows.length, 50);
    const status = await settled(sessions, opened.sessionId);
    assert.equal(status.phase, "complete", status.message);
    assert.equal(status.rowCount, 123);
    assert.deepEqual((await sessions.page(opened.sessionId, 49, 50)).rows[0], ["049", "49", "tail-49"]);
    assert.deepEqual((await sessions.page(opened.sessionId, 100, 50)).rows.at(-1), ["122", "122", "tail-122"]);
    assert.equal((await sessions.page(opened.sessionId, 123, 50)).rows.length, 0);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scrolls beyond the preview during preparation without interrupting the load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-preparing-pages-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "large.csv");
    await writeFile(file, "id,payload\n" + Array.from({ length: 100 }, (_, i) => `${i},keep\n`).join("") + "001,keep\n".repeat(4_999_900));
    for (const hasHeader of [true, false]) {
      const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file }, hasHeader });
      assert.equal(sessions.status(opened.sessionId).phase, "preparing");
      await assert.rejects(sessions.page(opened.sessionId, 0, 50, { sort: { column: 0, direction: "asc", mode: "text" } }), /sort.*preparation/i);
      assert.throws(() => sessions.beginPage(opened.sessionId, 0, 50, { search: "keep", requestId: 1 }), /filter.*preparation/i);
      assert.deepEqual(sessions.beginPage(opened.sessionId, 50, 50, { requestId: 1 }), { state: "pending" });
      let result: ReturnType<typeof sessions.pollPage> = { state: "pending" };
      for (let i = 0; i < 200; i++) {
        result = sessions.pollPage(opened.sessionId, 1);
        if (result.state === "ready") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(result.state, "ready");
      if (result.state === "ready") {
        assert.deepEqual(result.page.rows, Array.from({ length: 50 }, (_, i) => [String(i + (hasHeader ? 50 : 49)), "keep"]));
        assert.equal(result.page.totalRows, null);
        assert.equal(result.page.nextPosition, 99);
        const continued = await sessions.page(opened.sessionId, 0, 200, { requestId: 1, afterPosition: result.page.nextPosition! });
        assert.equal(continued.nextPosition, 299);
        assert.equal(continued.rows.length, 200);
        assert.deepEqual(continued.rows[0], [hasHeader ? "001" : "99", "keep"]);
      }
      const progress = sessions.status(opened.sessionId);
      assert.equal(progress.phase, "preparing");
      assert.equal(typeof progress.percent, "number");
      assert.equal(progress.percent! >= 0 && progress.percent! <= 100, true);
      const status = await settled(sessions, opened.sessionId);
      assert.equal(status.phase, "complete", status.message);
      assert.equal(status.rowCount, 5_000_000 + (hasHeader ? 0 : 1));
      assert.deepEqual((await sessions.page(opened.sessionId, 0, 1, { requestId: 1 })).rows, [hasHeader ? ["0", "keep"] : ["id", "payload"]]);
    }
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("superseding direct CSV pages leaves preparation running and cancellation removes storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-preparing-cancel-"));
  const sessions = createSessions();
  const previousTmp = process.env.TMPDIR;
  try {
    const storage = join(dir, "storage");
    await mkdir(storage);
    process.env.TMPDIR = storage;
    const file = join(dir, "large.csv");
    await writeFile(file, "id,payload\n" + "001,keep\n".repeat(5_000_000));
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    const stale = sessions.page(opened.sessionId, 1_000_000, 50, { requestId: 1 });
    const rejected = assert.rejects(stale, /superseded|interrupt/i);
    const next = sessions.page(opened.sessionId, 100, 50, { requestId: 2 });
    await rejected;
    assert.deepEqual((await next).rows, Array(50).fill(["001", "keep"]));
    assert.equal(sessions.status(opened.sessionId).phase, "preparing");
    const cancelled = sessions.page(opened.sessionId, 2_000_000, 50, { requestId: 3 });
    const cancelledRejected = assert.rejects(cancelled, /superseded|interrupt|cancelled|closed/i);
    assert.equal(sessions.close(opened.sessionId), true);
    await cancelledRejected;
    await sessions.dispose();
    assert.deepEqual(await readdir(storage), []);
    assert.equal((await stat(file)).size, opened.sourceBytes);
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a page query starts promptly and can be polled through completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-query-poll-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "query.csv");
    await writeFile(file, "id,value\n" + Array.from({ length: 10_000 }, (_, i) => `${i},${i === 9_999 ? "needle" : "other"}\n`).join(""));
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    await settled(sessions, opened.sessionId);
    assert.deepEqual(sessions.beginPage(opened.sessionId, 0, 50, { search: "needle", requestId: 1 }), { state: "pending" });
    let result: ReturnType<typeof sessions.pollPage> = { state: "pending" };
    for (let i = 0; i < 100; i++) {
      result = sessions.pollPage(opened.sessionId, 1);
      if (result.state === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(result.state, "ready");
    if (result.state === "ready") assert.deepEqual(result.page?.rows, [["9999", "needle"]]);
    assert.deepEqual(sessions.beginPage(opened.sessionId, 0, 50, { requestId: 2 }), { state: "pending" });
    assert.throws(() => sessions.pollPage(opened.sessionId, 1), /superseded/i);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejected stale and duplicate starts leave the active query pollable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-query-owner-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "query.csv");
    await writeFile(file, "id,value\n" + Array.from({ length: 10_000 }, (_, i) => `${i},${i === 9_999 ? "needle" : "other"}\n`).join(""));
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    await settled(sessions, opened.sessionId);
    assert.deepEqual(sessions.beginPage(opened.sessionId, 0, 50, { search: "needle", requestId: 2 }), { state: "pending" });
    assert.throws(() => sessions.beginPage(opened.sessionId, 0, 50, { requestId: 1 }), /superseded/i);
    assert.throws(() => sessions.beginPage(opened.sessionId, 0, 50, { requestId: 2 }), /already loading/i);
    let result: ReturnType<typeof sessions.pollPage> = { state: "pending" };
    for (let i = 0; i < 100; i++) {
      result = sessions.pollPage(opened.sessionId, 2);
      if (result.state === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(result.state, "ready");
    if (result.state === "ready") assert.deepEqual(result.page.rows, [["9999", "needle"]]);
    assert.deepEqual(sessions.beginPage(opened.sessionId, 1, 50, { search: "needle", requestId: 2 }), { state: "pending" });
    for (let i = 0; i < 100; i++) {
      result = sessions.pollPage(opened.sessionId, 2);
      if (result.state === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(result.state, "ready");
    if (result.state === "ready") assert.deepEqual(result.page.rows, []);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("searches all prepared columns beyond preview as literal Unicode text and clears to source order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-search-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "search.csv");
    const source = "id,visible,secret\n" + Array.from({ length: 125 }, (_, i) =>
      `${i},plain,${i === 90 ? "café [X]%_" : i === 120 ? "CAFÉ [x]%_" : i === 110 ? "O'Reilly; -- %_" : "ordinary"}\n`).join("");
    await writeFile(file, source);
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.equal(opened.rows.length, 50);
    assert.equal((await settled(sessions, opened.sessionId)).rowCount, 125);
    const found = await sessions.page(opened.sessionId, 0, 1, { search: "CAFÉ [x]%_", requestId: 1 });
    assert.deepEqual(found, { offset: 0, nextPosition: 90, rows: [["90", "plain", "café [X]%_"]], totalRows: 2 });
    assert.deepEqual((await sessions.page(opened.sessionId, 1, 50, { search: "CAFÉ [x]%_", requestId: 1 })).rows,
      [["120", "plain", "CAFÉ [x]%_"]]);
    assert.deepEqual((await sessions.page(opened.sessionId, 0, 50, { search: "O'Reilly; -- %_", requestId: 2 })).rows,
      [["110", "plain", "O'Reilly; -- %_"]]);
    assert.deepEqual(await sessions.page(opened.sessionId, 0, 50, { search: "^café.*$", requestId: 3 }),
      { offset: 0, nextPosition: null, rows: [], totalRows: 0 });
    const cleared = await sessions.page(opened.sessionId, 0, 50, { search: "", requestId: 4 });
    assert.equal(cleared.totalRows, 125);
    assert.deepEqual(cleared.rows[0], ["0", "plain", "ordinary"]);
    assert.deepEqual(await readFile(file, "utf8"), source);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("new query, file replacement and cancellation supersede in-flight search", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-search-order-"));
  const sessions = createSessions();
  const panelId = crypto.randomUUID();
  try {
    const first = join(dir, "first.csv");
    const second = join(dir, "second.csv");
    await writeFile(first, "id,secret\n" + Array.from({ length: 5_000 }, (_, i) => `${i},ordinary\n`).join(""));
    await writeFile(second, "id,secret\nnew,needle\n");
    const input = (path: string) => ({ panelId, workspaceId: "workspace", source: { kind: "local" as const, path } });
    const opened = await sessions.open(input(first));
    await settled(sessions, opened.sessionId);
    const stale = sessions.page(opened.sessionId, 0, 50, { search: "missing", requestId: 1 });
    const staleRejected = assert.rejects(stale, /superseded|interrupt/i);
    const cleared = sessions.page(opened.sessionId, 0, 50, { search: "", requestId: 2 });
    await staleRejected;
    assert.equal((await cleared).totalRows, 5_000);
    await assert.rejects(sessions.page(opened.sessionId, 0, 50, { search: "missing", requestId: 1 }), /superseded/);
    const replacedSearch = sessions.page(opened.sessionId, 0, 50, { search: "ordinary", requestId: 3 });
    const replacedRejected = assert.rejects(replacedSearch, /superseded|interrupt|cancelled|closed/i);
    const replaced = await sessions.open(input(second));
    await replacedRejected;
    await settled(sessions, replaced.sessionId);
    assert.deepEqual((await sessions.page(replaced.sessionId, 0, 50, { search: "NEEDLE", requestId: 1 })).rows, [["new", "needle"]]);
    const cancelledSearch = sessions.page(replaced.sessionId, 0, 50, { search: "needle", requestId: 2 });
    const cancelledRejected = assert.rejects(cancelledSearch, /superseded|interrupt|cancelled|closed/i);
    assert.equal(sessions.close(replaced.sessionId), true);
    await cancelledRejected;
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("closing a pending open and cancelling preparation cannot revive that panel", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-cancel-"));
  const sessions = createSessions();
  const panelId = crypto.randomUUID();
  try {
    const file = join(dir, "large.csv");
    await writeFile(file, "id,payload\n" + "001,keep\n".repeat(100_000));
    const pending = sessions.open({ panelId, workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.equal(sessions.close(undefined, panelId), true);
    await assert.rejects(pending, /cancelled/i);
    const opened = await sessions.open({ panelId, workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.equal(opened.rows.length, 50);
    assert.equal(sessions.close(opened.sessionId), true);
    assert.throws(() => sessions.status(opened.sessionId), /closed/);
    await assert.rejects(sessions.page(opened.sessionId, 50, 50), /not ready/);
    assert.equal((await readFile(file, "utf8")).startsWith("id,payload\n001,keep\n"), true);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a delayed open or close cannot supersede a newer panel request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-order-"));
  const sessions = createSessions();
  const panelId = crypto.randomUUID();
  try {
    const file = join(dir, "ordered.csv");
    await writeFile(file, "id\n001\n");
    const base = { panelId, workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    assert.equal(sessions.close(undefined, panelId, 2), false);
    await assert.rejects(sessions.open({ ...base, turn: 1 }), /newer file or closed panel/);
    const opened = await sessions.open({ ...base, turn: 3 });
    assert.equal(sessions.close(undefined, panelId, 2), false);
    assert.deepEqual(opened.rows, [["001"]]);
    assert.equal((await settled(sessions, opened.sessionId)).phase, "complete");
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a source removed after preview ends in an actionable error, never complete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-lost-source-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "lost.csv");
    await writeFile(file, "id,payload\n" + "001,keep\n".repeat(2_000_000));
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    await rm(file);
    const status = await settled(sessions, opened.sessionId);
    assert.equal(status.phase, "error");
    assert.match(status.message, /source file|read|accessible/i);
    await assert.rejects(sessions.page(opened.sessionId, 50, 50), /not ready/);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unavailable temporary storage reports how to recover", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-no-temp-"));
  const sessions = createSessions();
  const previous = process.env.TMPDIR;
  try {
    const file = join(dir, "data.csv");
    await writeFile(file, "id,value\n001,keep\n");
    process.env.TMPDIR = join(dir, "missing-temp-directory");
    await assert.rejects(sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } }), /Temporary storage failed.*free disk space and permissions/i);
    assert.equal(await readFile(file, "utf8"), "id,value\n001,keep\n");
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("preserves BOM, CRLF, Unicode, precise text, and quoted CSV fields in both header modes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-fidelity-"));
  try {
    const file = join(dir, "fidelity.csv");
    const bytes = '\uFEFFid,note,amount\r\n001,"café, \""ok\""\r\nline",00000000000000000001.234567890123456789\r\n';
    await writeFile(file, bytes);
    const sessions = createSessions();
    const input = { panelId: "47013f28-43c4-4b6e-8afe-7d03dc00e999", workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    const headed = await sessions.open(input);
    assert.deepEqual(headed.columns, ["id", "note", "amount"]);
    assert.deepEqual(headed.rows, [["001", 'café, "ok"\r\nline', "00000000000000000001.234567890123456789"]]);
    const headerless = await sessions.open({ ...input, hasHeader: false });
    assert.deepEqual(headerless.columns, ["Column 1", "Column 2", "Column 3"]);
    assert.deepEqual(headerless.rows, [["id", "note", "amount"], ...headed.rows]);
    assert.equal(await readFile(file, "utf8"), bytes);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps duplicate and blank headers by position and handles header-only TSV", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-headers-"));
  try {
    const file = join(dir, "headers.tsv");
    const sessions = createSessions();
    const input = { panelId: "407950ee-56e8-495c-b39b-a2c40204be38", workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    await writeFile(file, "id\tid\t\n001\t002\t\n");
    const headed = await sessions.open(input);
    assert.deepEqual(headed.columns, ["id", "id", ""]);
    assert.deepEqual(headed.rows, [["001", "002", ""]]);
    await writeFile(file, "id\tid\t\n");
    assert.deepEqual((await sessions.open(input)).rows, []);
    assert.deepEqual((await sessions.open({ ...input, hasHeader: false })).rows, [["id", "id", ""]]);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opens UTF-8 TSV with BOM, quoted tabs, escaped quotes and multiline CRLF", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-tsv-"));
  try {
    const file = join(dir, "quoted.tsv");
    await writeFile(file, '\uFEFFkey\tnote\r\n000\t"猫\t\""quoted\""\r\nnext"\r\n');
    const sessions = createSessions();
    const result = await sessions.open({ panelId: "db8b167a-4697-40d6-90e7-33f39460fe4d", workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.deepEqual(result.columns, ["key", "note"]);
    assert.deepEqual(result.rows, [["000", '猫\t"quoted"\r\nnext']]);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a quoted multiline first record still defines column positions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-multiline-header-"));
  try {
    const file = join(dir, "header.csv");
    await writeFile(file, '"first,\nname",second\n001,ok\n');
    const sessions = createSessions();
    const result = await sessions.open({ panelId: "cf643751-2113-4101-ac72-d1859d3ad95f", workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.deepEqual(result.columns, ["first,\nname", "second"]);
    assert.deepEqual(result.rows, [["001", "ok"]]);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips leading and single-column blank lines but keeps quoted empty values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-blank-first-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "blank.csv");
    const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    for (const [body, columns, rows] of [
      ["\n\nlabel\n\nvalue\n", ["label"], [["value"]]],
      ['""\n\nvalue\n', [""], [["value"]]],
      ['label\n\n""\nvalue\n', ["label"], [[""], ["value"]]],
      ["\n\na,b\n\n1,ok\n", ["a", "b"], [["1", "ok"]]],
    ] as const) {
      await writeFile(file, body);
      for (const hasHeader of [true, false]) {
        const opened = await sessions.open({ ...input, hasHeader });
        const expected = hasHeader ? rows : [columns, ...rows];
        assert.deepEqual(opened.columns, hasHeader ? columns : columns.map((_, i) => `Column ${i + 1}`));
        assert.deepEqual(opened.rows, expected);
        const status = await settled(sessions, opened.sessionId);
        assert.equal(status.phase, "complete", status.message);
        assert.equal(status.rowCount, expected.length);
        assert.deepEqual((await sessions.page(opened.sessionId, 0, 50)).rows, expected);
      }
    }
    await writeFile(file, "\r\n\r\n");
    const empty = await sessions.open(input);
    assert.deepEqual(empty.columns, []);
    assert.deepEqual(empty.rows, []);
    assert.equal(sessions.status(empty.sessionId).rowCount, 0);
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips blank lines before and after the preview while preserving quoted newlines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-blank-width-"));
  const sessions = createSessions();
  try {
    const file = join(dir, "blank-width.csv");
    const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    for (const newline of ["\n", "\r\n"]) {
      await writeFile(file, ["a,b", "1,ok", "", ...Array(60).fill("2,ok"), "", '3,"before' + newline + newline + 'after"', ""].join(newline));
      const opened = await sessions.open(input);
      assert.deepEqual(opened.columns, ["a", "b"]);
      assert.deepEqual(opened.rows[1], ["2", "ok"]);
      const status = await settled(sessions, opened.sessionId);
      assert.equal(status.phase, "complete", status.message);
      assert.equal(status.rowCount, 62);
      assert.deepEqual((await sessions.page(opened.sessionId, 61, 50)).rows, [["3", `before${newline}${newline}after`]]);
    }
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects malformed quoting, width and UTF-8 with locations, including after 50 rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-invalid-"));
  try {
    const file = join(dir, "invalid.csv");
    const sessions = createSessions();
    const input = { panelId: "8654fe2e-9c72-4886-b27d-319802a13709", workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    await writeFile(file, 'a,b\n1,"unterminated\n');
    await assert.rejects(sessions.open(input), /Line: 2[\s\S]*unterminated quote/i);
    await writeFile(file, "a,b\n1,ok\n2\n");
    await assert.rejects(sessions.open(input), /Line: 3[\s\S]*Expected Number of Columns: 2 Found: 1/);
    await writeFile(file, "a,b\n" + Array.from({ length: 5000 }, (_, i) => `${i},ok\n`).join("") + "bad\n");
    const late = await sessions.open(input);
    const status = await settled(sessions, late.sessionId);
    assert.equal(status.phase, "error");
    assert.match(status.message, /Line: 5002[\s\S]*Expected Number of Columns: 2 Found: 1/);
    await writeFile(file, Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0x31, 0x2c, 0xc3, 0x28, 0x0a]));
    await assert.rejects(sessions.open(input), /Line: 2[\s\S]*Invalid unicode/i);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
