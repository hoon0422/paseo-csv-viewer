import type { DuckDBConnection } from "@duckdb/node-api";

export type Sort = { column: number; direction: "asc" | "desc"; mode: "auto" | "numeric" | "text" };

// Whitespace is ASCII space, tab, CR or LF. Exponents use DuckDB BIGNUM; overflow fails the query visibly.
const whitespace = "' \t\r\n'";
const number = "'[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?'";

export async function sortPage(connection: DuckDBConnection, width: number, sort: Sort, offset: number, limit: number, where = "", searchParams: string[] = []) {
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
  let sql: string;
  if (mode === "text") {
    sql = `SELECT * FROM rows${where} ORDER BY trim(${cell}, ${whitespace}) = '', ${cell} ${direction}, rowid LIMIT ? OFFSET ?`;
  } else {
    const opposite = direction === "ASC" ? "DESC" : "ASC";
    sql = `WITH source AS (
      SELECT *, rowid AS source_rowid, trim(${cell}, ${whitespace}) AS value,
        regexp_full_match(trim(${cell}, ${whitespace}), ${number}) AS valid FROM rows${where}
    ), parts AS (
      SELECT *, regexp_replace(regexp_replace(value, '^[+-]', ''), '[eE].*$', '') AS mantissa,
        CASE WHEN valid THEN COALESCE(CAST(NULLIF(regexp_extract(value, '[eE]([+-]?[0-9]+)$', 1), '') AS BIGNUM), 0::BIGNUM) END AS exponent
      FROM source
    ), digits AS (
      SELECT *, replace(mantissa, '.', '') AS raw_digits FROM parts
    ), keys AS (
      SELECT *, rtrim(ltrim(raw_digits, '0'), '0') AS significant,
        exponent + length(split_part(mantissa, '.', 1)) - (length(raw_digits) - length(ltrim(raw_digits, '0'))) AS position
      FROM digits
    ), ordered AS (
      SELECT *, CASE WHEN trim(${cell}, ${whitespace}) = '' THEN 2 WHEN NOT valid THEN 1 ELSE 0 END AS bucket,
        CASE WHEN significant = '' THEN 1 WHEN starts_with(value, '-') THEN 0 ELSE 2 END AS sign FROM keys
    )
    SELECT * EXCLUDE (source_rowid, value, valid, mantissa, exponent, raw_digits, significant, position, bucket, sign) FROM ordered
    ORDER BY bucket, CASE WHEN bucket = 0 THEN sign END ${direction},
      CASE WHEN bucket = 0 AND sign = 0 THEN position END ${opposite}, CASE WHEN bucket = 0 AND sign = 0 THEN significant END ${opposite},
      CASE WHEN bucket = 0 AND sign = 2 THEN position END ${direction}, CASE WHEN bucket = 0 AND sign = 2 THEN significant END ${direction},
      CASE WHEN bucket = 1 THEN ${cell} END ${direction}, source_rowid LIMIT ? OFFSET ?`;
  }
  const result = await connection.runAndReadAll(sql, [...searchParams, limit, offset]);
  try { return { rows: result.getRows().map((row) => row.map((value) => value == null ? "" : String(value))), sortMode: mode }; }
  finally { result.closeSync(); }
}
