import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessions } from "../server/session";
import { anyColumnFilter } from "./filter-input";
import { pageRows } from "../shared/session";

async function fixture(body: string, check: (session: ReturnType<typeof createSessions>, id: string, path: string, panelId: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-sort-"));
  const session = createSessions();
  try {
    const path = join(dir, "values.csv");
    await writeFile(path, body);
    const panelId = crypto.randomUUID();
    const opened = await session.open({ panelId, workspaceId: "workspace", source: { kind: "local", path } });
    for (let i = 0; i < 200 && session.status(opened.sessionId).phase !== "complete"; i++) {
      const status = session.status(opened.sessionId);
      assert.notEqual(status.phase, "error", status.message);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(session.status(opened.sessionId).phase, "complete");
    await check(session, opened.sessionId, path, panelId);
  } finally { await session.dispose(); await rm(dir, { recursive: true, force: true }); }
}

test("automatic numeric sort covers the whole file and keeps equal values in source order", async () => {
  const values = Array.from({ length: 60 }, (_, i) => `${i},2`);
  values.push("60,-10", "61,100", "62,+02.0e0", "63,1e2");
  await fixture("id,id\n" + values.join("\n") + "\n", async (s, id) => {
    const sort = { column: 1, direction: "asc" as const, mode: "auto" as const };
    const first = await s.page(id, 0, 50, { sort });
    const second = await s.page(id, 50, 50, { sort });
    assert.equal(first.rows[0][0], "60");
    assert.deepEqual(first.rows.filter((row) => row[1] === "2").map((row) => row[0]), Array.from({ length: 49 }, (_, i) => String(i)));
    assert.deepEqual(second.rows.slice(0, 3).map((row) => row[0]), ["49", "50", "51"]);
    const descending = await s.page(id, 0, 4, { sort: { ...sort, direction: "desc" } });
    assert.deepEqual(descending.rows.map((row) => row[0]), ["61", "63", "0", "1"]);
  });
});

test("consecutive 200-row pages append after a known sort position with stable ties", async () => {
  await fixture("id,value\n" + Array.from({ length: 451 }, (_, i) => `${i},${i % 3}\n`).join(""), async (s, id) => {
    const sort = { column: 1, direction: "asc" as const, mode: "auto" as const };
    pageRows.input.parse({ sessionId: id, offset: 0, limit: 200, sort });
    const first = await s.page(id, 0, 200, { sort });
    pageRows.output.parse(first);
    assert.equal(first.nextPosition, 199);
    const second = await s.page(id, 200, 200, { sort, afterPosition: first.nextPosition! });
    const third = await s.page(id, 400, 200, { sort, afterPosition: second.nextPosition! });
    const expected = [0, 1, 2].flatMap((value) => Array.from({ length: 451 }, (_, i) => i).filter((i) => i % 3 === value).map(String));
    assert.deepEqual([...first.rows, ...second.rows, ...third.rows].map((row) => row[0]), expected);
    assert.equal(first.sortMode, "numeric");
    assert.equal(second.sortMode, "numeric");
    assert.equal(third.nextPosition, 450);
    const end = await s.page(id, 451, 200, { sort, afterPosition: third.nextPosition! });
    assert.deepEqual(end.rows, []);
    assert.equal(end.nextPosition, null);
    assert.deepEqual((await s.page(id, 200, 200, { sort })).rows, second.rows);
    for (const afterPosition of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(s.page(id, 0, 200, { sort, afterPosition }), /position/);
    }
    assert.equal(pageRows.input.safeParse({ sessionId: id, offset: 0, limit: 201 }).success, false);
  });
});

test("sorted pages preserve quoted, multiline, Unicode and empty cells", async () => {
  await fixture('id,value,payload\n0,2,"a""b"\n1,1,"line\nbreak"\n2,1,"한글\t\\tail"\n3,1,\n', async (s, id) => {
    const sort = { column: 1, direction: "asc" as const, mode: "numeric" as const };
    const first = await s.page(id, 0, 2, { sort });
    const next = await s.page(id, 2, 2, { sort, afterPosition: first.nextPosition! });
    assert.deepEqual([...first.rows, ...next.rows], [
      ["1", "1", "line\nbreak"], ["2", "1", "한글\t\\tail"], ["3", "1", ""], ["0", "2", 'a"b'],
    ]);
    assert.deepEqual((await s.page(id, 0, 1)).rows, [["0", "2", 'a"b']]);
  });
});

test("closing a sorted session removes its temporary storage and leaves the source untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-sort-close-"));
  const storage = join(directory, "storage");
  const previous = process.env.TMPDIR;
  const s = createSessions();
  try {
    await mkdir(storage);
    const path = join(directory, "source.csv");
    const body = "value\n2\n1\n";
    await writeFile(path, body);
    process.env.TMPDIR = storage;
    const opened = await s.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path } });
    for (let i = 0; i < 200 && s.status(opened.sessionId).phase !== "complete"; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual((await s.page(opened.sessionId, 0, 200, { sort: { column: 0, direction: "asc", mode: "auto" } })).rows, [["1"], ["2"]]);
    assert.equal((await readdir(storage)).length, 1);
    assert.equal(s.close(opened.sessionId), true);
    for (let i = 0; i < 200 && (await readdir(storage)).length; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(await readdir(storage), []);
    assert.equal(await readFile(path, "utf8"), body);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await s.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("numeric grammar accepts signs, decimals, exponents and surrounding ASCII whitespace but leaves other text intact", async () => {
  const values = ["1e+2", "-0", "0e3", "1e-2", "  +.5\t", "2.", "1e", "NaN", "0x10", "1_0", "  "];
  await fixture("value\n" + values.map((value) => `"${value}"`).join("\n") + "\n", async (s, id) => {
    const result = await s.page(id, 0, 50, { sort: { column: 0, direction: "asc", mode: "numeric" } });
    assert.deepEqual(result.rows.map((row) => row[0]), ["-0", "0e3", "1e-2", "  +.5\t", "2.", "1e+2", "0x10", "1_0", "1e", "NaN", "  "]);
    assert.equal(result.sortMode, "numeric");
    const automatic = await s.page(id, 0, 1, { sort: { column: 0, direction: "asc", mode: "auto" } });
    assert.equal(automatic.sortMode, "text");
  });
});

test("cast-only spellings and whitespace inside numbers stay text in Numeric and Auto", async () => {
  const text = ["\v1", "+Infinity", "0x10", "1\f", "1 0", "1_0", "1\u00a0", "NaN", "inf", "\u00a01"];
  for (const value of text) {
    await fixture(`value\n"${value}"\n2\n10\n"  "\n""\n`, async (s, id) => {
      const sort = { column: 0, direction: "asc" as const, mode: "numeric" as const };
      assert.deepEqual((await s.page(id, 0, 200, { sort })).rows, [["2"], ["10"], [value], ["  "], [""]]);
      assert.equal((await s.page(id, 0, 200, { sort: { ...sort, mode: "auto" } })).sortMode, "text");
    });
  }
  await fixture("value\n" + ["10", "2", ...text, "  ", ""].map((v) => `"${v}"`).join("\n") + "\n", async (s, id) => {
    const sort = { column: 0, direction: "desc" as const, mode: "numeric" as const };
    assert.deepEqual((await s.page(id, 0, 200, { sort })).rows.map((r) => r[0]), ["10", "2", ...text.toReversed(), "  ", ""]);
  });
});

test("all-numeric sorts keep overflow, rounded ties and ASCII blanks stable across pages", async () => {
  const values = ["\t", "1e309", "-1e309", " -0\r\n", "1e-400", "  +.5\t", "1e+2", "", "  ", "9007199254740993", "9007199254740992"];
  await fixture("value\n" + values.map((v) => `"${v}"`).join("\n") + "\n", async (s, id) => {
    for (const mode of ["auto", "numeric"] as const) {
      const sort = { column: 0, direction: "asc" as const, mode };
      const first = await s.page(id, 0, 6, { sort });
      const next = await s.page(id, 6, 6, { sort, afterPosition: first.nextPosition! });
      assert.equal(first.sortMode, "numeric");
      assert.deepEqual([...first.rows, ...next.rows].map((r) => r[0]),
        ["-1e309", " -0\r\n", "1e-400", "  +.5\t", "1e+2", "9007199254740993", "9007199254740992", "1e309", "\t", "", "  "]);
      assert.deepEqual((await s.page(id, 0, 200, { sort: { ...sort, direction: "desc" } })).rows.map((r) => r[0]),
        ["1e309", "9007199254740993", "9007199254740992", "1e+2", "  +.5\t", " -0\r\n", "1e-400", "-1e309", "\t", "", "  "]);
    }
  });
});

test("late nonnumeric text forces auto text order; manual numeric keeps all rows", async () => {
  await fixture("id,value\n" + Array.from({ length: 55 }, (_, i) => `${i},${i % 2 ? "10" : "2"}\n`).join("") + "55,N/A\n56,\n57,  \n", async (s, id) => {
    const auto = await s.page(id, 0, 6, { sort: { column: 1, direction: "asc", mode: "auto" } });
    assert.deepEqual(auto.rows.map((row) => row[0]), ["1", "3", "5", "7", "9", "11"]);
    const numeric = await s.page(id, 0, 50, { sort: { column: 1, direction: "asc", mode: "numeric" } });
    assert.equal(numeric.rows[0][0], "0");
    const tail = await s.page(id, 55, 50, { sort: { column: 1, direction: "asc", mode: "numeric" } });
    assert.deepEqual(tail.rows.map((row) => row[0]), ["55", "56", "57"]);
    const reverse = await s.page(id, 0, 4, { sort: { column: 1, direction: "desc", mode: "numeric" } });
    assert.deepEqual(reverse.rows.map((row) => row[0]), ["1", "3", "5", "7"]);
    await assert.rejects(s.page(id, 0, 5, { sort: { column: 99, direction: "asc", mode: "text" } }), /column/i);
  });
});

test("numeric DOUBLE comparison keeps rounded ties in file order and preserves original text", async () => {
  const values = ["9007199254740993", "9007199254740992", "-1.0000000000000000000000000000000000000002", "-1.0000000000000000000000000000000000000001", "1.0000000000000000000000000000000000000001", "1.0000000000000000000000000000000000000002", "+01.0", "1e0", ".5", "  -0.5  ", "1.", "", "N/A"];
  await fixture("value\n" + values.map((value) => value === "" ? '""' : value).join("\n") + "\n", async (s, id) => {
    const sorted = (await s.page(id, 0, 50, { sort: { column: 0, direction: "asc", mode: "numeric" } })).rows.map((row) => row[0]);
    assert.deepEqual(sorted, [values[2], values[3], values[9], values[8], values[4], values[5], values[6], values[7], values[10], values[0], values[1], "N/A", ""]);
    const text = (await s.page(id, 0, 50, { sort: { column: 0, direction: "asc", mode: "text" } })).rows.map((row) => row[0]);
    assert.equal(text.indexOf("9007199254740992") < text.indexOf("9007199254740993"), true);
    assert.deepEqual(sorted.slice(6, 9), ["+01.0", "1e0", "1."]);
  });
});

test("DOUBLE overflow and underflow stay numeric, special spellings stay text, and blanks keep file order", async () => {
  const values = ["1e309", "-1e309", "1e-400", "-0", "inf", "NaN", "1,234", "$5", "  ", "", "\t"];
  await fixture("value\n" + values.map((value) => `"${value}"`).join("\n") + "\n", async (s, id) => {
    const numeric = await s.page(id, 0, 200, { sort: { column: 0, direction: "desc", mode: "numeric" } });
    assert.deepEqual(numeric.rows.map((row) => row[0]), ["1e309", "1e-400", "-0", "-1e309", "inf", "NaN", "1,234", "$5", "  ", "", "\t"]);
    const text = await s.page(id, 0, 200, { sort: { column: 0, direction: "desc", mode: "text" } });
    assert.deepEqual(text.rows.slice(-3).map((row) => row[0]), ["  ", "", "\t"]);
    assert.equal((await s.page(id, 0, 200, { sort: { column: 0, direction: "asc", mode: "auto" } })).sortMode, "text");
  });
});

test("filter and sort share a filtered page count while auto inference still sees late text", async () => {
  const lines = Array.from({ length: 55 }, (_, i) => `${i},${i === 54 ? "N/A" : "0"},miss`);
  lines[1] = "1,10,hit";
  lines[2] = "2,2,hit";
  lines[51] = "51,2,hit";
  lines[52] = "52,100,hit";
  await fixture("id,value,tag\n" + lines.join("\n") + "\n", async (s, id) => {
    const sort = { column: 1, direction: "asc" as const, mode: "auto" as const };
    const first = await s.page(id, 0, 2, { filter: anyColumnFilter("hit", [0, 1, 2]), requestId: 1, sort });
    const second = await s.page(id, 2, 2, { filter: anyColumnFilter("hit", [0, 1, 2]), requestId: 1, sort, afterPosition: first.nextPosition! });
    assert.equal(first.totalRows, 4);
    assert.equal(first.sortMode, "text");
    assert.deepEqual(first.rows.map((row) => row[0]), ["1", "52"]);
    assert.deepEqual(second.rows.map((row) => row[0]), ["2", "51"]);
    assert.ok(first.nextPosition! > first.rows.length);
    const numeric = await s.page(id, 0, 4, { filter: anyColumnFilter("hit", [0, 1, 2]), requestId: 2, sort: { ...sort, mode: "numeric" } });
    assert.deepEqual(numeric.rows.map((row) => row[0]), ["2", "51", "1", "52"]);
    assert.equal(numeric.totalRows, 4);
  });
});

test("new sort requests cancel a build, and clearing sort restores file order", async () => {
  await fixture("id,value\n" + Array.from({ length: 500_000 }, (_, i) => `${i},${(i * 7919) % 500_000}\n`).join(""), async (s, id) => {
    const stale = s.page(id, 0, 200, { requestId: 1, sort: { column: 1, direction: "asc", mode: "auto" } });
    const rejected = assert.rejects(stale, /superseded|interrupt/i);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newest = await s.page(id, 0, 200, { requestId: 2, sort: { column: 0, direction: "desc", mode: "numeric" } });
    await rejected;
    assert.deepEqual(newest.rows.slice(0, 3).map((row) => row[0]), ["499999", "499998", "499997"]);
    const continued = await s.page(id, 200, 200, { requestId: 2, sort: { column: 0, direction: "desc", mode: "numeric" }, afterPosition: newest.nextPosition! });
    assert.equal(continued.rows[0][0], "499799");
    const cleared = await s.page(id, 0, 2, { requestId: 3 });
    assert.deepEqual(cleared.rows.map((row) => row[0]), ["0", "1"]);
    assert.equal(cleared.sortMode, undefined);
    const restarted = await s.page(id, 0, 2, { requestId: 4, sort: { column: 1, direction: "asc", mode: "auto" } });
    assert.deepEqual(restarted.rows, [["0", "0"], ["17679", "1"]]);
  });
});

test("sorted filter keeps the completed snapshot stale until Refresh creates a new session", async () => {
  await fixture("id,value,tag\n1,10,hit\n2,2,hit\n3,N/A,miss\n", async (s, id, path, panelId) => {
    const sort = { column: 1, direction: "asc" as const, mode: "auto" as const };
    const old = await s.page(id, 0, 50, { filter: anyColumnFilter("hit", [0, 1, 2]), requestId: 1, sort });
    assert.deepEqual(old.rows.map((row) => row[0]), ["1", "2"]);
    assert.equal(old.sortMode, "text");
    await writeFile(path, "id,value,tag\n1,10,hit\n2,2,hit\n3,1,miss\n4,100,hit\n");
    assert.equal(s.status(id).sourceChanged, true);
    const stale = await s.page(id, 0, 50, { filter: anyColumnFilter("hit", [0, 1, 2]), requestId: 2, sort });
    assert.deepEqual(stale.rows, old.rows);
    assert.equal(stale.totalRows, 2);
    const refreshed = await s.open({ panelId, workspaceId: "workspace", source: { kind: "local", path }, turn: 1 });
    for (let i = 0; i < 200 && s.status(refreshed.sessionId).phase !== "complete"; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(s.status(refreshed.sessionId).sourceChanged, false);
    const current = await s.page(refreshed.sessionId, 0, 50, { filter: anyColumnFilter("hit", [0, 1, 2]), requestId: 1, sort });
    assert.deepEqual(current.rows.map((row) => row[0]), ["2", "1", "4"]);
    assert.equal(current.totalRows, 3);
    assert.equal(current.sortMode, "numeric");
  });
});
