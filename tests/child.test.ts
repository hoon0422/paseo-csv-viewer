import { test } from "node:test";
import { once } from "node:events";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { createSessionProxy } from "../server/proxy";

test("panels share a Node child; a crash fails sessions, removes storage and restarts on demand", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-child-test-"));
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

test("Node lookup ignores relative PATH entries, directories and non-executable files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-node-lookup-"));
  const previousPath = process.env.PATH;
  let calls = 0;
  const sessions = createSessionProxy(() => { calls++; throw new Error("Unsafe Node candidate was selected"); });
  try {
    const { relative, delimiter } = await import("node:path");
    const { chmod } = await import("node:fs/promises");
    const node = join(directory, process.platform === "win32" ? "node.exe" : "node");
    await writeFile(node, "unused", { mode: 0o755 });
    const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: join(directory, "source.csv") } };
    process.env.PATH = ["", ".", relative(process.cwd(), directory)].join(delimiter);
    await assert.rejects(sessions.open(input), /Node.js.*PATH/);
    await rm(node);
    await mkdir(node);
    process.env.PATH = directory;
    await assert.rejects(sessions.open(input), /Node.js.*PATH/);
    await rm(node, { recursive: true });
    if (process.platform !== "win32") {
      await writeFile(node, "unused");
      await chmod(node, 0o644);
      await assert.rejects(sessions.open(input), /Node.js.*PATH/);
    }
    assert.equal(calls, 0);
  } finally {
    await sessions.dispose();
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a spawn error without close rejects waiting and pending requests and cleans storage", async () => {
  const { ChildProcess } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "csv-spawn-error-"));
  const previousTmp = process.env.TMPDIR;
  const children: ChildProcess[] = [];
  let node = "";
  const sessions = createSessionProxy((file) => {
    node = file;
    const child = new ChildProcess();
    child.kill = () => false;
    children.push(child);
    const fail = () => child.emit("error", Object.assign(new Error("spawn ENOEXEC"), { code: "ENOEXEC" }));
    if (children.length === 1) setTimeout(fail, 5);
    else {
      setTimeout(() => child.emit("message", { ready: true }), 0);
      child.send = (() => { setTimeout(fail, 5); return true; }) as ChildProcess["send"];
    }
    return child;
  });
  try {
    process.env.TMPDIR = directory;
    const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: "/unused.csv" } };
    for (let i = 0; i < 2; i++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const rejected = assert.rejects(sessions.open(input), (cause: Error) => {
        assert.ok(cause.message.includes(node), cause.message);
        assert.ok(cause.message.includes(process.arch), cause.message);
        assert.match(cause.message, /executable|architecture/i);
        return true;
      });
      try {
        await Promise.race([rejected, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Spawn error left open pending")), 200); })]);
      } finally {
        clearTimeout(timer);
        children[i].emit("close", -1, null);
        await rejected.catch(() => {});
      }
      assert.deepEqual(await readdir(directory), []);
    }
  } finally {
    await sessions.dispose();
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    await rm(directory, { recursive: true, force: true });
  }
});

test("closing an in-flight open rejects its delayed preview and closes the stray child session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-close-open-"));
  let release!: () => void, waiting!: () => void, stray = "";
  const held = new Promise<void>((resolve) => { waiting = resolve; });
  const panelId = crypto.randomUUID();
  const closedIds: string[] = [];
  const sessions = createSessionProxy((file, args, options) => {
    const child = spawn(file, args, options);
    const send = child.send.bind(child);
    child.send = ((message: any, ...rest: any[]) => {
      if (message.method === "open" && message.args[0].panelId === panelId) {
        release = () => { release = () => {}; send(message, ...rest); };
        waiting();
        return true;
      }
      if (message.method === "close" && message.args[0]) closedIds.push(message.args[0]);
      return send(message, ...rest);
    }) as ChildProcess["send"];
    child.on("message", (message: any) => { if (message.value?.fileName === "stray.csv") stray = message.value.sessionId; });
    return child;
  });
  try {
    const keep = join(directory, "keep.csv");
    const path = join(directory, "stray.csv");
    await writeFile(keep, "value\nkeep\n");
    await writeFile(path, "value\nstray\n");
    const input = { workspaceId: "workspace", source: { kind: "local" as const, path: keep } };
    const current = await sessions.open({ ...input, panelId: crypto.randomUUID() });
    const pending = sessions.open({ ...input, source: { kind: "local", path }, panelId });
    const rejected = assert.rejects(pending, /cancelled|closed/i);
    await held;
    assert.equal(await sessions.close(undefined, panelId), false);
    release();
    await rejected;
    assert.ok(stray);
    assert.ok(closedIds.includes(stray), "The stray session must be closed in the child");
    await assert.rejects(sessions.status(stray), /closed/);
    assert.equal((await sessions.status(current.sessionId)).phase, "complete");
  } finally {
    release?.();
    await sessions.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the child rejects methods outside the session IPC allowlist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-child-methods-"));
  const child = spawn(process.execPath, [join(process.cwd(), "server/child.cjs"), directory], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const ended = once(child, "close");
  try {
    await once(child, "message");
    for (const method of ["inspect", "constructor", "__proto__", "toString"]) {
      const response = once(child, "message");
      child.send({ id: 1, method, args: [] });
      const [reply] = await response;
      assert.match(reply.error, /unknown.*method/i);
    }
  } finally {
    child.kill();
    await ended;
    await rm(directory, { recursive: true, force: true });
  }
});

test("synchronous spawn failure and a missing native binding show concise architecture guidance", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (...values: unknown[]) => logs.push(values.map(String).join(" ")));
  const directory = await mkdtemp(join(tmpdir(), "csv-node-architecture-"));
  const previousTmp = process.env.TMPDIR;
  const detail = "NATIVE_DIAGNOSTIC".repeat(1000);
  let node = "";
  const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: "/unused.csv" } };
  const sessions = [
    createSessionProxy((file) => { node = file; throw Object.assign(new Error(detail), { code: "EBADARCH" }); }),
    createSessionProxy((file, _args, options) => {
      node = file;
      return spawn(file, ["-e", `process.stderr.write(${JSON.stringify(detail)}); process.send({ready:true}); process.on('message', m => { if(m.method === 'dispose') { process.send({id:m.id}); process.disconnect(); } else process.send({id:m.id,error:${JSON.stringify("  Error: Cannot find module '@duckdb/node-bindings-darwin-x64'\n" + detail)}}); });`], options);
    }),
  ];
  try {
    process.env.TMPDIR = directory;
    for (const session of sessions) {
      await assert.rejects(session.open(input), (cause: Error) => {
        assert.ok(cause.message.includes(node), cause.message);
        assert.ok(cause.message.includes(process.arch), cause.message);
        assert.match(cause.message, /architecture/i);
        assert.ok(cause.message.length <= 500);
        assert.equal(cause.message, cause.message.trim());
        assert.equal(cause.message.includes("NATIVE_DIAGNOSTIC"), false);
        assert.equal(cause.message.startsWith("Error:"), false);
        return true;
      });
      assert.deepEqual(await readdir(directory), []);
    }
    assert.ok(logs.some((message) => message.includes(detail)), "Full native details belong in plugin logs");
  } finally {
    await Promise.all(sessions.map((session) => session.dispose()));
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    await rm(directory, { recursive: true, force: true });
  }
});

test("workspace lookup ids cannot collide with reused request ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-child-lookups-"));
  const child = spawn(process.execPath, [join(process.cwd(), "server/child.cjs"), directory], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const ended = once(child, "close");
  try {
    await once(child, "message");
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      const response = once(child, "message");
      child.send({ id: 1, method: "open", args: [{ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "workspace", path: "unused.csv" } }] });
      const [lookup] = await response;
      assert.equal(lookup.requestId, 1);
      ids.push(lookup.workspace);
    }
    assert.notEqual(ids[0], ids[1]);
  } finally {
    child.kill();
    await ended;
    await rm(directory, { recursive: true, force: true });
  }
});

test("the child logs IPC send failures", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const directory = await mkdtemp(join(tmpdir(), "csv-child-send-"));
  try {
    const { stderr } = await promisify(execFile)(process.execPath, [join(process.cwd(), "server/child.cjs"), directory]);
    assert.match(stderr, /IPC send failed.*channel is closed/s);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
