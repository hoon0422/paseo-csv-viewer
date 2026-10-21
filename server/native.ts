import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type * as DuckDB from "@duckdb/node-api";

export function duckdb(): typeof DuckDB {
  // Paseo 0.12 bundles server JS but cannot bundle DuckDB's native .node file.
  const home = process.env.PASEO_HOME;
  const root = home
    ? JSON.parse(readFileSync(join(home, "config.json"), "utf8")).plugins?.["csv-viewer"]?.path
    : process.cwd();
  if (typeof root !== "string") throw new Error("CSV Viewer installation path is unavailable");
  return createRequire(join(root, "package.json"))("@duckdb/node-api") as typeof DuckDB;
}
