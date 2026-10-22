import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the child bundle check detects source drift without silently rebuilding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "csv-child-build-"));
  const script = join(process.cwd(), "scripts/build-child.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: "utf8" });
  try {
    await mkdir(join(directory, "server"));
    const source = join(directory, "server/child.ts");
    const bundle = join(directory, "server/child.cjs");
    await writeFile(source, 'console.log("first");\n');
    const missing = run("--check");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /stale.*npm run build/s);
    assert.equal(run().status, 0);
    assert.equal(run("--check").status, 0);
    const original = await readFile(bundle, "utf8");
    await writeFile(source, 'console.log("second");\n');
    assert.equal(run("--check").status, 1);
    assert.equal(await readFile(bundle, "utf8"), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
