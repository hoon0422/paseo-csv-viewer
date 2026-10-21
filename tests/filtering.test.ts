import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessions } from "../server/session";
import { pageRows } from "../shared/session";

async function fixture(body: string, check: (s: ReturnType<typeof createSessions>, id: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-filter-"));
  const sessions = createSessions();
  try {
    const path = join(directory, "values.csv");
    await writeFile(path, body);
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "workspace", source: { kind: "local", path } });
    for (let i = 0; i < 200 && sessions.status(opened.sessionId).phase !== "complete"; i++) {
      const status = sessions.status(opened.sessionId);
      assert.notEqual(status.phase, "error", status.message);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(sessions.status(opened.sessionId).phase, "complete");
    await check(sessions, opened.sessionId);
  } finally { await sessions.dispose(); await rm(directory, { recursive: true, force: true }); }
}

test("Any column filter covers visible columns while a rule can name a hidden column", async () => {
  await fixture("id,city,secret\n1,Toronto,no\n2,Ottawa,TORONTO\n3,toronto,yes\n", async (s, id) => {
    const filter = { rules: [{ enabled: true, column: "any" as const, operator: "contains" as const, value: "TORONTO" }], match: "all" as const, caseSensitive: false, visibleColumns: [1] };
    const input = pageRows.input.parse({ sessionId: id, offset: 0, limit: 200, filter });
    const first = await s.page(id, 0, 200, input);
    assert.deepEqual(first.rows.map((row) => row[0]), ["1", "3"]);
    assert.equal(first.totalRows, 2);
    const hidden = await s.page(id, 0, 200, { filter: { ...filter, rules: [{ ...filter.rules[0], column: 2 }] } });
    assert.deepEqual(hidden.rows.map((row) => row[0]), ["2"]);
  });
});

test("text filter operators combine rules, ignore incomplete rules and honor case sensitivity", async () => {
  await fixture('id,value\n1,Alpha\n2,alphabet\n3,BETA\n4,""\n5," "\n6,café\n', async (s, id) => {
    const base = { match: "all" as const, caseSensitive: false, visibleColumns: [1] };
    const cases = [
      ["contains", "ALP", ["1", "2"]], ["does not contain", "alp", ["3", "4", "5", "6"]],
      ["=", "alpha", ["1"]], ["≠", "alpha", ["2", "3", "4", "5", "6"]],
      ["begins with", "ALP", ["1", "2"]], ["ends with", "HA", ["1"]],
      ["is empty", undefined, ["4"]], ["is not empty", undefined, ["1", "2", "3", "5", "6"]],
      ["=", "CAFÉ", ["6"]],
    ] as const;
    for (const [operator, value, expected] of cases) {
      const filter = { ...base, rules: [{ enabled: true, column: 1, operator, value }] };
      assert.deepEqual((await s.page(id, 0, 200, { filter })).rows.map((row) => row[0]), expected, operator);
    }
    const rules = [{ enabled: true, column: 1, operator: "contains" as const, value: "alp" }, { enabled: true, column: 0, operator: "=" as const, value: "2" }];
    assert.deepEqual((await s.page(id, 0, 200, { filter: { ...base, rules } })).rows.map((row) => row[0]), ["2"]);
    assert.deepEqual((await s.page(id, 0, 200, { filter: { ...base, match: "any", rules: [...rules, { ...rules[1], value: "3" }] } })).rows.map((row) => row[0]), ["1", "2", "3"]);
    assert.deepEqual((await s.page(id, 0, 200, { filter: { ...base, caseSensitive: true, rules: [rules[0]] } })).rows.map((row) => row[0]), ["2"]);
    const ignored = [{ ...rules[0], enabled: false }, { ...rules[1], value: "" }, { ...rules[1], value: undefined }];
    for (const match of ["all", "any"] as const) {
      assert.equal((await s.page(id, 0, 200, { filter: { ...base, match, rules: ignored } })).totalRows, 6);
    }
    assert.equal((await s.page(id, 0, 200, { filter: { ...base, visibleColumns: [], rules: [{ ...rules[0], column: "any" }] } })).totalRows, 0);
  });
});

test("numeric filter operators compare DOUBLE values using the sort numeric grammar", async () => {
  const values = ["-2", "2", "02.00e0", "10", "text", "", "NaN", "inf", "1,234", "$5", " 3 ", "1e9999", "-1e9999", "1e-9999", "9007199254740993"];
  await fixture("id,value\n" + values.map((value, index) => `${index},"${value}"\n`).join(""), async (s, id) => {
    const base = { match: "all" as const, caseSensitive: false, visibleColumns: [1] };
    const cases = [[">", "2", undefined, ["3", "10", "11", "14"]], ["<", "2", undefined, ["0", "12", "13"]],
      ["≥", "2", undefined, ["1", "2", "3", "10", "11", "14"]], ["≤", "2", undefined, ["0", "1", "2", "12", "13"]],
      ["between", "2", "3", ["1", "2", "10"]], [">", "9007199254740992", undefined, ["11"]],
      [">", "NaN", undefined, []], ["between", "3", "2", []]] as const;
    for (const [operator, value, value2, expected] of cases) {
      const filter = { ...base, rules: [{ enabled: true, column: 1, operator, value, value2 }] };
      assert.deepEqual((await s.page(id, 0, 200, { filter })).rows.map((row) => row[0]), expected, `${operator} ${value}`);
    }
    assert.equal((await s.page(id, 0, 200, { filter: { ...base, rules: [{ enabled: true, column: 1, operator: "between", value: "2" }] } })).totalRows, values.length);
  });
});

test("regex filters use case mode and report invalid patterns without failing the session", async () => {
  await fixture("id,value\n1,Alpha\n2,alphabet\n3,beta\n", async (s, id) => {
    const filter = { match: "all" as const, caseSensitive: false, visibleColumns: [1], rules: [{ enabled: true, column: 1, operator: "matches regex" as const, value: "^ALP.*a$" }] };
    assert.deepEqual((await s.page(id, 0, 200, { filter })).rows.map((row) => row[0]), ["1"]);
    assert.equal((await s.page(id, 0, 200, { filter: { ...filter, caseSensitive: true } })).totalRows, 0);
    await assert.rejects(s.page(id, 0, 200, { filter: { ...filter, rules: [{ ...filter.rules[0], value: "[" }] } }), /invalid.*regular expression|invalid.*regex/i);
    assert.equal(s.status(id).phase, "complete");
    assert.equal((await s.page(id, 0, 200)).totalRows, 3);
    assert.equal((await s.page(id, 0, 200, { filter })).totalRows, 1);
  });
});

test("filter values are literal parameters and malformed rule inputs are rejected at both RPCs", async () => {
  const value = "'); COPY (SELECT 'stolen') TO '/tmp/csv-filter-injection'; -- %_";
  await fixture(`id,value\n1,"${value}"\n2,other\n`, async (s, id) => {
    const filter = { match: "all" as const, caseSensitive: false, visibleColumns: [0, 1], rules: [{ enabled: true, column: "any" as const, operator: "contains" as const, value }] };
    const input = { sessionId: id, offset: 0, limit: 200, filter };
    assert.deepEqual((await s.page(id, 0, 200, pageRows.input.parse(input))).rows, [["1", value]]);
    const { pageQuery } = await import("../shared/session");
    const malformed = [
      { ...filter, match: "sql" }, { ...filter, caseSensitive: "false" }, { ...filter, visibleColumns: [-1] },
      { ...filter, rules: [{ ...filter.rules[0], enabled: "yes" }] },
      { ...filter, rules: [{ ...filter.rules[0], column: "column0); DROP TABLE rows; --" }] },
      { ...filter, rules: [{ ...filter.rules[0], column: 0.5 }] },
      { ...filter, rules: [{ ...filter.rules[0], operator: "IN" }] },
      { ...filter, rules: [{ ...filter.rules[0], value: 12 }] }, { ...filter, sql: "SELECT * FROM rows" },
    ];
    for (const invalid of malformed) {
      assert.equal(pageRows.input.safeParse({ ...input, filter: invalid }).success, false);
      assert.equal(pageQuery.input.safeParse({ ...input, action: "start", requestId: 1, filter: invalid }).success, false);
      await assert.rejects(s.page(id, 0, 200, { filter: invalid as typeof filter }));
    }
    for (const invalid of [{ ...filter, visibleColumns: [2] }, { ...filter, rules: [{ ...filter.rules[0], column: 2 }] }]) {
      assert.throws(() => s.beginPage(id, 0, 200, { filter: invalid, requestId: 1 }), /filter column/i);
    }
    assert.equal((await s.page(id, 0, 200)).totalRows, 2);
  });
});

test("filtered cursor pages follow the full sort, keep counts and rebuild for changed rules or sort", async () => {
  await fixture("id,value,tag\n" + Array.from({ length: 653 }, (_, i) => `${i},${i % 3},${i % 2 ? "hit" : "miss"}\n`).join(""), async (s, id) => {
    const filter = { match: "all" as const, caseSensitive: false, visibleColumns: [0, 1], rules: [{ enabled: true, column: 2, operator: "=" as const, value: "hit" }] };
    const sort = { column: 1, direction: "asc" as const, mode: "numeric" as const };
    const first = await s.page(id, 0, 200, { filter, sort });
    const second = await s.page(id, 200, 200, { filter, sort, afterPosition: first.nextPosition! });
    assert.equal(first.totalRows, 326);
    assert.equal(second.totalRows, 326);
    assert.equal(first.rows.length, 200);
    const expected = [0, 1, 2].flatMap((value) => Array.from({ length: 653 }, (_, i) => i).filter((i) => i % 3 === value && i % 2).map(String));
    assert.deepEqual([...first.rows, ...second.rows].map((row) => row[0]), expected);
    assert.deepEqual((await s.page(id, 200, 200, { filter, sort })).rows, second.rows);
    assert.deepEqual((await s.page(id, 326, 200, { filter, sort, afterPosition: second.nextPosition! })).rows, []);
    const desc = await s.page(id, 0, 200, { filter, sort: { ...sort, direction: "desc" } });
    assert.deepEqual(desc.rows.slice(0, 3).map((row) => row[0]), ["5", "11", "17"]);
    const changed = await s.page(id, 0, 200, { filter: { ...filter, rules: [{ ...filter.rules[0], value: "miss" }] } });
    assert.equal(changed.totalRows, 327);
    assert.deepEqual(changed.rows.slice(0, 3).map((row) => row[0]), ["0", "2", "4"]);
    assert.equal((await s.page(id, 0, 200)).totalRows, 653);
  });
});

test("a new filter cancels a running build and the cancelled filter can be retried", async () => {
  await fixture("id,value\n" + Array.from({ length: 500_000 }, (_, i) => `${i},ordinary-${i}\n`).join(""), async (s, id) => {
    const filter = { match: "all" as const, caseSensitive: false, visibleColumns: [0, 1], rules: [{ enabled: true, column: "any" as const, operator: "contains" as const, value: "ordinary" }] };
    const stale = s.page(id, 0, 200, { filter, requestId: 1 });
    const rejected = assert.rejects(stale, /superseded|interrupt/i);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const latest = { ...filter, rules: [{ enabled: true, column: 0, operator: "=" as const, value: "499999" }] };
    assert.deepEqual(s.beginPage(id, 0, 200, { filter: latest, requestId: 2 }), { state: "pending" });
    await rejected;
    for (let i = 0; i < 200; i++) {
      const result = s.pollPage(id, 2);
      if (result.state === "ready") {
        assert.deepEqual(result.page.rows, [["499999", "ordinary-499999"]]);
        assert.equal(result.page.totalRows, 1);
        break;
      }
      assert.ok(i < 199, "Filter did not settle");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.throws(() => s.pollPage(id, 1), /superseded/i);
    const retried = await s.page(id, 0, 200, { filter, requestId: 3 });
    assert.equal(retried.totalRows, 500_000);
    assert.deepEqual(retried.rows[0], ["0", "ordinary-0"]);
    const continued = await s.page(id, 200, 200, { filter, requestId: 3, afterPosition: retried.nextPosition! });
    assert.deepEqual(continued.rows[0], ["200", "ordinary-200"]);
  });
});
