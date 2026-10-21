import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { createSessionProxy } from "../server/proxy";

test("panels share a Node child; a crash fails sessions, removes storage and restarts on demand", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-worker-test-"));
  const previous = process.env.TMPDIR;
  const children: ChildProcess[] = [];
  const sessions = createSessionProxy(((file, args, options) => {
    assert.equal(isAbsolute(file), true);
    const child = spawn(file, args, options);
    children.push(child);
    return child;
  }));
  try {
    const storage = join(directory, "storage");
    await mkdir(storage);
    process.env.TMPDIR = storage;
    const path = join(directory, "source.csv");
    await writeFile(path, "id,value\n1,keep\n");
    const input = { workspaceId: "workspace", source: { kind: "local" as const, path } };
    const first = await sessions.open({ ...input, panelId: crypto.randomUUID() });
    const second = await sessions.open({ ...input, panelId: crypto.randomUUID() });
    assert.equal(children.length, 1);
    assert.notEqual(children[0].pid, process.pid);
    assert.equal(await sessions.close(first.sessionId), true);
    assert.equal(children[0].exitCode, null);
    const pending = assert.rejects(sessions.page(second.sessionId, 0, 50), /child.*exited/i);
    children[0].kill("SIGKILL");
    const status = await sessions.status(second.sessionId);
    await pending;
    assert.equal(status.phase, "error");
    assert.match(status.message, /child.*exited/i);
    assert.deepEqual(await readdir(storage), []);
    await assert.rejects(sessions.page(second.sessionId, 0, 50), /child.*exited/i);
    const reopened = await sessions.open({ ...input, panelId: crypto.randomUUID() });
    assert.deepEqual(reopened.rows, [["1", "keep"]]);
    assert.equal(children.length, 2);
    await sessions.close(reopened.sessionId);
    assert.notEqual(children[1].exitCode, null);
    assert.deepEqual(await readdir(storage), []);
  } finally {
    await sessions.dispose();
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing or incompatible Node reports a clear error, cleans storage and allows retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-start-test-"));
  const previousPath = process.env.PATH;
  const previousTmp = process.env.TMPDIR;
  let incompatible = true;
  const sessions = createSessionProxy((file, args, options) => incompatible
    ? spawn(file, ["-e", "process.stderr.write('incompatible architecture'); process.exit(71)"], options)
    : spawn(file, args, options));
  try {
    process.env.TMPDIR = directory;
    const path = join(directory, "source.csv");
    await writeFile(path, "value\nkeep\n");
    const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path } };
    process.env.PATH = join(directory, "missing");
    await assert.rejects(sessions.open(input), /Node.js.*PATH/);
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    await assert.rejects(sessions.open(input), /child exited.*71.*architecture/s);
    assert.deepEqual(await readdir(directory), ["source.csv"]);
    incompatible = false;
    const opened = await sessions.open(input);
    assert.deepEqual(opened.rows, [["keep"]]);
    const { createRequire } = await import("node:module");
    assert.equal(Object.keys(createRequire(import.meta.url).cache).some((path) => /duckdb.*\.node$/.test(path)), false);
  } finally {
    await sessions.dispose();
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    await rm(directory, { recursive: true, force: true });
  }
});
