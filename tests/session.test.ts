import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { createSessions } from "../server/session";

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
