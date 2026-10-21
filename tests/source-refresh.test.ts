import { test } from "node:test";
import { strict as assert } from "node:assert";
import { appendFile, chmod, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessions } from "../server/session";

async function settled(sessions: ReturnType<typeof createSessions>, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = sessions.status(id);
    if (status.phase === "complete" || status.phase === "error") return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Session did not settle");
}

test("external edits leave a completed snapshot stale until an explicit new session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-refresh-"));
  const sessions = createSessions();
  try {
    const file = join(directory, "source.csv");
    const original = "id,value\n1,old\n";
    await writeFile(file, original);
    const input = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: file } };
    const first = await sessions.open(input);
    assert.equal((await settled(sessions, first.sessionId)).phase, "complete");
    await writeFile(file, "id,value\n1,newer\n2,added\n");
    assert.equal(sessions.status(first.sessionId).sourceChanged, true);
    assert.deepEqual((await sessions.page(first.sessionId, 0, 50)).rows, [["1", "old"]]);
    const refreshed = await sessions.open({ ...input, turn: 1 });
    assert.notEqual(refreshed.sessionId, first.sessionId);
    assert.deepEqual(refreshed.rows, [["1", "newer"], ["2", "added"]]);
    assert.equal((await settled(sessions, refreshed.sessionId)).sourceChanged, false);
    assert.equal(await readFile(file, "utf8"), "id,value\n1,newer\n2,added\n");
  } finally {
    await sessions.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("append, truncation, atomic replacement, deletion, and loss of access mark only their own snapshot stale", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-revisions-"));
  const sessions = createSessions();
  try {
    const firstFile = join(directory, "first.csv");
    const otherFile = join(directory, "other.csv");
    await writeFile(firstFile, "id,value\n1,old\n");
    await writeFile(otherFile, "id,value\n2,other\n");
    const first = { panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local" as const, path: firstFile } };
    const other = await sessions.open({ ...first, panelId: crypto.randomUUID(), source: { kind: "local", path: otherFile } });
    await settled(sessions, other.sessionId);
    let turn = 0;
    for (const change of [
      async () => appendFile(firstFile, "2,added\n"),
      async () => writeFile(firstFile, "id,value\n"),
      async () => { const replacement = join(directory, "replacement.csv"); await writeFile(replacement, "id,value\n3,replaced\n"); await rename(replacement, firstFile); },
      async () => { await chmod(firstFile, 0o000); },
      async () => { await chmod(firstFile, 0o600); await rm(firstFile); },
    ]) {
      const opened = await sessions.open({ ...first, turn: ++turn });
      assert.equal((await settled(sessions, opened.sessionId)).phase, "complete");
      await change();
      assert.equal(sessions.status(opened.sessionId).sourceChanged, true);
      assert.equal(sessions.status(other.sessionId).sourceChanged, false);
      assert.deepEqual((await sessions.page(other.sessionId, 0, 50)).rows, [["2", "other"]]);
      if (turn === 4) await chmod(firstFile, 0o600);
    }
    await assert.rejects(sessions.open({ ...first, turn: ++turn }), /source file.*exists and is accessible/i);
  } finally {
    await sessions.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an edit during preparation invalidates the preview instead of completing mixed rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-prep-change-"));
  const sessions = createSessions();
  try {
    const file = join(directory, "preparing.csv");
    await writeFile(file, "id,value\n" + "1,before\n".repeat(80_000));
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path: file } });
    await writeFile(file, "id,value\n2,after\n");
    const status = await settled(sessions, opened.sessionId);
    assert.equal(status.phase, "error");
    assert.equal(status.sourceChanged, true);
    assert.match(status.message, /Refresh/);
    await assert.rejects(sessions.page(opened.sessionId, 0, 50), /not ready/);
  } finally {
    await sessions.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("superseded opens and closes release session storage without reviving an old view", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-replace-change-"));
  const storage = join(directory, "storage");
  const previousTmp = process.env.TMPDIR;
  const sessions = createSessions();
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(storage);
    process.env.TMPDIR = storage;
    const firstFile = join(directory, "first.csv");
    const secondFile = join(directory, "second.csv");
    await writeFile(firstFile, "id,value\n" + "1,first\n".repeat(40_000));
    await writeFile(secondFile, "id,value\n2,second\n");
    const panelId = crypto.randomUUID();
    const pending = sessions.open({ panelId, workspaceId: "workspace", source: { kind: "local", path: firstFile }, turn: 1 })
      .then(() => assert.fail("Superseded open completed"), (cause) => assert.match(String(cause), /cancelled|newer/i));
    const second = await sessions.open({ panelId, workspaceId: "workspace", source: { kind: "local", path: secondFile }, turn: 2 });
    await pending;
    assert.deepEqual(second.rows, [["2", "second"]]);
    assert.equal((await settled(sessions, second.sessionId)).phase, "complete");
    assert.equal((await readdir(storage)).length, 1);
    assert.equal(sessions.close(second.sessionId), true);
    await sessions.dispose();
    assert.deepEqual(await readdir(storage), []);
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    await sessions.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
