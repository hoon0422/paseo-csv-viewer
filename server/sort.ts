import type { DuckDBConnection } from "@duckdb/node-api";

export type Sort = { column: number; direction: "asc" | "desc"; mode: "auto" | "numeric" | "text" };

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
  if (mode === "auto") {
    const result = await connection.runAndReadAll(`SELECT COALESCE(BOOL_AND(trim(${cell}, ${whitespace}) = '' OR regexp_full_match(trim(${cell}, ${whitespace}), ${number})), true) FROM rows`);
    try { mode = result.getRows()[0][0] ? "numeric" : "text"; }
    finally { result.closeSync(); }
  }
  checkCurrent();
  let order: string;
  if (mode === "text") {
    order = `trim(${cell}, ${whitespace}) = '', CASE WHEN trim(${cell}, ${whitespace}) <> '' THEN ${cell} END ${direction}, rowid`;
  } else {
    const value = `trim(${cell}, ${whitespace})`;
    const valid = `regexp_full_match(${value}, ${number})`;
    order = `CASE WHEN ${value} = '' THEN 2 WHEN ${valid} THEN 0 ELSE 1 END,
        ${numericValue(cell)} ${direction},
        CASE WHEN NOT ${valid} AND ${value} <> '' THEN ${cell} END ${direction}, rowid`;
  }
  const result = await connection.run(`CREATE TABLE sort_order AS
    SELECT row_number() OVER (ORDER BY ${order}) - 1 AS pos, rowid AS src FROM rows`);
  result.closeSync();
  return mode;
}
