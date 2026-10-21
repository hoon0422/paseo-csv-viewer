import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessions } from "../server/session";

async function fixture(body: string, check: (session: ReturnType<typeof createSessions>, id: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-sort-"));
  const session = createSessions();
  try {
    const path = join(dir, "values.csv");
    await writeFile(path, body);
    const opened = await session.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path } });
    for (let i = 0; i < 200 && session.status(opened.sessionId).phase !== "complete"; i++) {
      const status = session.status(opened.sessionId);
      assert.notEqual(status.phase, "error", status.message);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(session.status(opened.sessionId).phase, "complete");
    await check(session, opened.sessionId);
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

test("numeric grammar and exact comparison preserve wide and high-precision original text", async () => {
  const values = ["9007199254740993", "9007199254740992", "-1.0000000000000000000000000000000000000002", "-1.0000000000000000000000000000000000000001", "1.0000000000000000000000000000000000000001", "1.0000000000000000000000000000000000000002", "+01.0", "1e0", ".5", "  -0.5  ", "1.", "", "N/A"];
  await fixture("value\n" + values.map((value) => value === "" ? '""' : value).join("\n") + "\n", async (s, id) => {
    const sorted = (await s.page(id, 0, 50, { sort: { column: 0, direction: "asc", mode: "numeric" } })).rows.map((row) => row[0]);
    assert.deepEqual(sorted, [values[2], values[3], values[9], values[8], values[6], values[7], values[10], values[4], values[5], values[1], values[0], "N/A", ""]);
    const text = (await s.page(id, 0, 50, { sort: { column: 0, direction: "asc", mode: "text" } })).rows.map((row) => row[0]);
    assert.equal(text.indexOf("9007199254740992") < text.indexOf("9007199254740993"), true);
    assert.deepEqual(sorted.slice(5, 7), ["1e0", "1."]);
  });
});

test("search and sort share a filtered page count while auto inference still sees late text", async () => {
  const lines = Array.from({ length: 55 }, (_, i) => `${i},${i === 54 ? "N/A" : "0"},miss`);
  lines[1] = "1,10,hit";
  lines[2] = "2,2,hit";
  lines[51] = "51,2,hit";
  lines[52] = "52,100,hit";
  await fixture("id,value,tag\n" + lines.join("\n") + "\n", async (s, id) => {
    const sort = { column: 1, direction: "asc" as const, mode: "auto" as const };
    const first = await s.page(id, 0, 2, { search: "hit", requestId: 1, sort });
    const second = await s.page(id, 2, 2, { search: "hit", requestId: 1, sort });
    assert.equal(first.totalRows, 4);
    assert.equal(first.sortMode, "text");
    assert.deepEqual(first.rows.map((row) => row[0]), ["1", "52"]);
    assert.deepEqual(second.rows.map((row) => row[0]), ["2", "51"]);
    const numeric = await s.page(id, 0, 4, { search: "hit", requestId: 2, sort: { ...sort, mode: "numeric" } });
    assert.deepEqual(numeric.rows.map((row) => row[0]), ["2", "51", "1", "52"]);
    assert.equal(numeric.totalRows, 4);
  });
});
