import type { DuckDBConnection } from "@duckdb/node-api";
import type { Sort } from "../shared/session";

// Whitespace is ASCII space, tab, CR or LF; keep the numeric grammar stricter than DuckDB casts.
const whitespace = "' \t\r\n'";
const number = "'[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?'";

export function numericValue(cell: string) {
  const value = `trim(${cell}, ${whitespace})`;
  return `CASE WHEN regexp_full_match(${value}, ${number}) THEN TRY_CAST(${value} AS DOUBLE) END`;
}

export async function buildSortOrder(connection: DuckDBConnection, width: number, sort: Sort, checkCurrent: () => void) {
  if (!Number.isSafeInteger(sort.column) || sort.column < 0 || sort.column >= width) throw new Error("Invalid sort column");
  if (sort.direction !== "asc" && sort.direction !== "desc") throw new Error("Invalid sort direction");
  if (sort.mode !== "auto" && sort.mode !== "numeric" && sort.mode !== "text") throw new Error("Invalid sort mode");
  const column = `column${sort.column}`;
  const cell = `COALESCE(${column}, '')`;
  const direction = sort.direction.toUpperCase();
  let mode = sort.mode;
  let allNumeric = false;
  if (mode !== "text") {
    // Validate once outside the window so numeric columns only sort a DOUBLE and rowid.
    const result = await connection.runAndReadAll(`SELECT COALESCE(BOOL_AND(trim(${cell}, ${whitespace}) = '' OR
      regexp_full_match(trim(${cell}, ${whitespace}), ${number})), true) FROM rows`);
    try { allNumeric = !!result.getRows()[0][0]; }
    finally { result.closeSync(); }
    if (mode === "auto") mode = allNumeric ? "numeric" : "text";
  }
  checkCurrent();
  let order: string;
  let from = "rows";
  if (mode === "text") {
    order = `CASE WHEN trim(${cell}, ${whitespace}) <> '' THEN ${cell} END ${direction} NULLS LAST, rowid`;
  } else if (allNumeric) {
    order = `TRY_CAST(${cell} AS DOUBLE) ${direction} NULLS LAST, rowid`;
  } else {
    from = `(SELECT rowid, ${numericValue(cell)} AS num,
      CASE WHEN trim(${cell}, ${whitespace}) <> '' THEN ${cell} END AS text FROM rows)`;
    order = `num ${direction} NULLS LAST, CASE WHEN num IS NULL THEN text END ${direction} NULLS LAST, rowid`;
  }
  const result = await connection.run(`CREATE TABLE sort_order AS
    SELECT row_number() OVER (ORDER BY ${order}) - 1 AS pos, rowid AS src FROM ${from}`);
  result.closeSync();
  return mode;
}
