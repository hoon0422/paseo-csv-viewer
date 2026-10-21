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
    await assert.rejects(sessions.open(input), /Line: 5002[\s\S]*Expected Number of Columns: 2 Found: 1/);
    await writeFile(file, Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0x31, 0x2c, 0xc3, 0x28, 0x0a]));
    await assert.rejects(sessions.open(input), /Line: 2[\s\S]*Invalid unicode/i);
    await sessions.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
