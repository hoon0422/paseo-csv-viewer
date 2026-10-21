import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outfile = "server/child.cjs";
const { outputFiles } = await build({
  entryPoints: ["server/child.ts"], outfile, bundle: true, platform: "node",
  format: "cjs", target: "node20", minify: true, write: false,
});
const contents = outputFiles[0].contents;
if (process.argv.includes("--check")) {
  const committed = await readFile(outfile).catch((cause) => {
    if (cause.code === "ENOENT") return Buffer.alloc(0);
    throw cause;
  });
  if (!Buffer.from(contents).equals(committed)) {
    console.error(`${outfile} is stale. Run npm run build and commit the updated bundle.`);
    process.exitCode = 1;
  }
} else await writeFile(outfile, contents);
