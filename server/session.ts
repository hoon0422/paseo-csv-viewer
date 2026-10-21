import { randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { mkdtemp, open as openFile, realpath, rm, stat } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { openPreview, PAGE_SIZE, type Filter, type Sort } from "../shared/session";
import { duckdb } from "./native";
import { buildSortOrder } from "./sort";
import { buildFilter } from "./filter";

type OpenInput = z.output<typeof openPreview.input>;
type PaseoApi = PluginHandlerContext["paseo"];
type Phase = "preview" | "preparing" | "complete" | "error" | "cancelled";
type PageOptions = { filter?: Filter; requestId?: number; sort?: Sort; afterPosition?: number };
type PageResult = { offset: number; nextPosition: number | null; rows: string[][]; totalRows: number | null; sortMode?: "numeric" | "text" };
type Session = {
  id: string; panelId: string; turn: number; cancelled: boolean; phase: Phase; message: string;
  sourceBytes: number; bytesScanned: number; percent: number | null; rowCount: number | null;
  sourcePath?: string; revision?: string; sourceChanged?: boolean;
  directory?: string; db?: DuckDBInstance; connection?: DuckDBConnection; width?: number; queryRequestId: number;
  csv?: { from: string; params: string[]; hasHeader: boolean }; csvConnection?: DuckDBConnection;
  pageOperation?: Promise<unknown>; pageConnection?: DuckDBConnection;
  opening?: Promise<unknown>; operation?: Promise<unknown>; cleanup?: Promise<void>; pageBusy?: boolean;
  query?: { requestId: number; result?: PageResult; error?: unknown };
  order?: { key: string; mode?: "numeric" | "text" };
  filterOrder?: { key: string; totalRows?: number };
  interruptTimer?: ReturnType<typeof setInterval>;
};
const LIMIT = 50;
const CHANGED = "Source file changed or is no longer accessible. Refresh to read the current file.";

function sourceRevision(path: string) {
  const resolved = realpathSync(path);
  accessSync(path, constants.R_OK);
  const info = statSync(path, { bigint: true });
  if (!info.isFile()) throw new Error("Source is not a regular file");
  return { resolved, size: Number(info.size), key: [resolved, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":") };
}

async function firstRecordWidth(path: string, delimiter: number, current: () => boolean) {
  const file = await openFile(path, "r");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let width = 1, recordHasBytes = false, quoted = false, quotePending = false, skipLf = false, offset = 0;
  try {
    for (;;) {
      if (!current()) throw new Error("Session cancelled");
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return recordHasBytes ? width : 0;
      let index = offset === 0 && bytesRead >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf ? 3 : 0;
      for (; index < bytesRead; index++) {
        const byte = chunk[index];
        if (skipLf) { skipLf = false; if (byte === 0x0a) continue; }
        if (quotePending) { quotePending = false; if (byte === 0x22) continue; quoted = false; }
        if (byte === 0x22) {
          if (quoted) quotePending = true;
          else { quoted = true; recordHasBytes = true; }
        } else if (byte === 0x0a || byte === 0x0d) {
          if (!quoted && recordHasBytes) return width;
          skipLf = byte === 0x0d;
        } else if (!quoted) {
          if (byte === delimiter) width++;
          recordHasBytes = true;
        }
      }
      offset += bytesRead;
    }
  } finally { await file.close(); }
}

function explain(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/no space left|ENOSPC|out of memory|failed to allocate/i.test(message)) return `Not enough temporary disk or memory to prepare this file. Free space and try again. ${message}`;
  if (/write|WAL|spill|database|temporary storage/i.test(message)) return `Temporary storage failed. Check free disk space and permissions, then try again. ${message}`;
  if (/ENOENT|EACCES|permission denied|IO Error|cannot open file/i.test(message)) return `Cannot read the source file. Check that it still exists and is accessible. ${message}`;
  return message.split(/Possible fixes?:|Possible Solution:/i)[0].trim();
}

async function resolveSource(input: Pick<OpenInput, "workspaceId" | "source">, paseo?: PaseoApi) {
  let path: string;
  let sourcePath: string;
  if (input.source.kind === "workspace") {
    if (!paseo) throw new Error("Workspace lookup is unavailable");
    if (isAbsolute(input.source.path)) throw new Error("Workspace file path must be relative");
    const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
    if (!workspace || workspace.id !== input.workspaceId || !workspace.workspaceDirectory) throw new Error("Workspace is unavailable");
    const root = await realpath(workspace.workspaceDirectory);
    sourcePath = resolve(root, input.source.path);
    path = await realpath(sourcePath);
    const within = relative(root, path);
    if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error("File is outside this workspace");
  } else {
    if (!isAbsolute(input.source.path)) throw new Error("Local file path must be absolute");
    sourcePath = input.source.path;
    path = await realpath(sourcePath);
  }
  if (!/\.(csv|tsv)$/i.test(extname(path))) throw new Error("Choose a CSV or TSV file");
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Choose a regular file");
  const revision = sourceRevision(sourcePath);
  if (revision.resolved !== path) throw new Error(CHANGED);
  return { path, sourcePath, revision };
}

export function createSessions() {
  const active = new Map<string, Session>();
  const owned = new Set<Session>();
  const latestTurn = new Map<string, number>();
  let disposed = false;
  const current = (session: Session) => !disposed && !session.cancelled && (!session.sourceChanged || session.phase === "complete") && active.get(session.panelId) === session;
  function interrupt(session: Session) {
    const send = () => {
      try { session.connection?.interrupt(); session.csvConnection?.interrupt(); }
      catch (cause) { console.error("CSV Viewer interrupt failed:", cause); }
    };
    send();
    session.interruptTimer ??= setInterval(send, 25);
  }
  function checkSource(session: Session) {
    if (!session.sourcePath || !session.revision || session.sourceChanged) return;
    try {
      if (sourceRevision(session.sourcePath).key === session.revision) return;
    } catch { /* A missing or inaccessible source is a changed source. */ }
    session.sourceChanged = true;
    if (session.phase !== "complete") {
      session.phase = "error";
      session.message = CHANGED;
      interrupt(session);
      void drain(session).catch((cause) => console.error("CSV Viewer cleanup failed:", cause));
    }
  }
  function requireSource(session: Session) {
    checkSource(session);
    if (session.sourceChanged) throw new Error(CHANGED);
  }
  function cleanup(session: Session) {
    return session.cleanup ??= (async () => {
      try { session.csvConnection?.closeSync(); } finally {
        try { session.connection?.closeSync(); } finally {
          try { session.db?.closeSync(); } finally {
            try { if (session.directory) await rm(session.directory, { recursive: true, force: true }); }
            finally { owned.delete(session); }
          }
        }
      }
    })();
  }
  async function drain(session: Session) {
    await session.opening?.catch(() => {});
    await session.operation?.catch(() => {});
    await session.pageOperation?.catch(() => {});
    if (session.interruptTimer) clearInterval(session.interruptTimer);
    await cleanup(session);
  }
  function cancel(session: Session) {
    if (session.cancelled) return;
    const running = session.phase === "preview" || session.phase === "preparing" || session.pageBusy;
    session.cancelled = true;
    session.phase = "cancelled";
    session.message = "Session cancelled";
    if (active.get(session.panelId) === session) active.delete(session.panelId);
    if (running) interrupt(session);
    void drain(session).catch((cause) => console.error("CSV Viewer cleanup failed:", cause));
  }

  async function inspect(input: Pick<OpenInput, "workspaceId" | "source">, paseo?: PaseoApi) {
    if (disposed) throw new Error("Viewer is closed");
    const { revision } = await resolveSource(input, paseo);
    return { sourceBytes: revision.size };
  }

  async function open(input: OpenInput, paseo?: PaseoApi) {
    if (disposed) throw new Error("Viewer is closed");
    const turn = input.turn ?? 0;
    if (turn < (latestTurn.get(input.panelId) ?? 0)) throw new Error("Replaced by a newer file or closed panel");
    latestTurn.set(input.panelId, turn);
    const previous = active.get(input.panelId);
    if (previous) cancel(previous);
    const session: Session = { id: randomUUID(), panelId: input.panelId, turn, cancelled: false, phase: "preview", message: "Opening preview", sourceBytes: 0, bytesScanned: 0, percent: null, rowCount: null, queryRequestId: 0 };
    active.set(input.panelId, session);
    owned.add(session);
    const initialize = async () => {
      const { path, sourcePath, revision } = await resolveSource(input, paseo);
      if (!current(session)) throw new Error("Session cancelled");
      session.sourcePath = sourcePath;
      session.revision = revision.key;
      session.sourceBytes = revision.size;
      const delimiter = extname(path).toLowerCase() === ".tsv" ? 0x09 : 0x2c;
      const width = await firstRecordWidth(path, delimiter, () => current(session));
      requireSource(session);
      session.width = width;
      if (!current(session)) throw new Error("Session cancelled");
      const base = { sessionId: session.id, fileName: basename(path), sourceBytes: revision.size, status: "preview" as const, limit: LIMIT };
      if (!width) {
        session.phase = "complete"; session.message = "Empty file"; session.rowCount = 0;
        return { ...base, columns: [], rows: [] as string[][] };
      }
      try { session.directory = await mkdtemp(join(tmpdir(), "csv-viewer-session-")); }
      catch (cause) { throw new Error(`Temporary storage failed. Check free disk space and permissions, then try again. ${String(cause)}`); }
      if (!current(session)) throw new Error("Session cancelled");
      const { DuckDBInstance } = duckdb();
      try {
        session.db = await DuckDBInstance.create(join(session.directory, "rows.duckdb"), {
          temp_directory: join(session.directory, "spill"), memory_limit: "4GB", threads: String(availableParallelism()), preserve_insertion_order: "true",
        });
      } catch (cause) { throw new Error(`Temporary storage failed. Check free disk space and permissions, then try again. ${String(cause)}`); }
      if (!current(session)) throw new Error("Session cancelled");
      session.connection = await session.db.connect();
      const progress = await session.connection.run("SET enable_progress_bar=true; SET enable_progress_bar_print=false; SET progress_bar_time=0");
      progress.closeSync();
      session.csvConnection = await session.db.connect();
      if (!current(session)) throw new Error("Session cancelled");
      const columnsSql = Array.from({ length: width }, (_, index) => `'column${index}':'VARCHAR'`).join(",");
      // DuckDB returns single-column blank lines as NULL; quoted empty values must remain rows.
      const from = `(SELECT * FROM read_csv(?, delim=?, quote='"', escape='"', header=false, auto_detect=false, columns={${columnsSql}}, strict_mode=true, ignore_errors=false, null_padding=false, allow_quoted_nulls=false)${width === 1 ? " WHERE column0 IS NOT NULL" : ""})`;
      const params = [path, delimiter === 0x09 ? "\t" : ","];
      const reader = await session.connection.runAndReadAll(`SELECT * FROM ${from} LIMIT ${LIMIT + (input.hasHeader === false ? 0 : 1)}`, params);
      let values: string[][];
      try { values = reader.getRows().map((row) => row.map((value) => value == null ? "" : String(value))); }
      finally { reader.closeSync(); }
      requireSource(session);
      if (!current(session)) throw new Error("Session cancelled");
      const columns = input.hasHeader !== false ? values.shift() ?? [] : values[0]?.map((_, index) => `Column ${index + 1}`) ?? [];
      const rows = values.slice(0, LIMIT);
      session.csv = { from, params, hasHeader: input.hasHeader !== false };
      session.operation = prepare(session, from, params, input.hasHeader !== false);
      return { ...base, columns, rows };
    };
    const pending = initialize();
    session.opening = pending;
    try { return await pending; }
    catch (cause) {
      checkSource(session);
      cancel(session);
      await cleanup(session);
      throw new Error(session.sourceChanged ? CHANGED : explain(cause));
    }
  }

  async function prepare(session: Session, from: string, params: string[], hasHeader: boolean) {
    try {
      if (!current(session)) return;
      requireSource(session);
      session.phase = "preparing";
      session.message = "Preparing disk-backed rows";
      const result = await session.connection!.run(`CREATE TABLE rows AS SELECT * FROM ${from}${hasHeader ? " OFFSET 1" : ""}`, params);
      result.closeSync();
      requireSource(session);
      if (!current(session)) return;
      const count = await session.connection!.runAndReadAll("SELECT COUNT(*) FROM rows");
      try { session.rowCount = Number(count.getRows()[0][0]); } finally { count.closeSync(); }
      requireSource(session);
      if (!current(session)) return;
      session.phase = "complete";
      session.message = "All rows ready";
      session.percent = 100;
    } catch (cause) {
      checkSource(session);
      if (current(session)) {
        session.phase = "error"; session.message = explain(cause);
        interrupt(session);
        await session.pageOperation?.catch(() => {});
        if (session.interruptTimer) clearInterval(session.interruptTimer);
        await cleanup(session);
      }
    } finally {
      if (session.sourceChanged) {
        await session.pageOperation?.catch(() => {});
        await cleanup(session);
      }
    }
  }

  function find(id: string) { return [...active.values()].find((session) => session.id === id); }
  function status(id: string) {
    const session = find(id);
    if (!session) throw new Error("Viewer session is closed");
    checkSource(session);
    let percent = session.percent;
    if (session.phase === "preparing" && session.connection) {
      const native = session.connection.progress.percentage;
      percent = native >= 0 && native <= 100 ? native : null;
    }
    return { phase: session.phase, message: session.message, bytesScanned: session.bytesScanned, sourceBytes: session.sourceBytes, percent, rowCount: session.rowCount, sourceChanged: !!session.sourceChanged };
  }
  function admitPage(id: string, offset: number, limit: number, options?: PageOptions) {
    const session = find(id);
    if (session) checkSource(session);
    if (!session || (session.phase !== "complete" && session.phase !== "preparing") || !session.connection) throw new Error("Rows are not ready for this session");
    if (session.phase === "preparing" && (options?.sort || options?.filter)) throw new Error("Sort and filter are unavailable until preparation completes");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE) throw new Error("Invalid page range");
    if (options?.afterPosition !== undefined && (!Number.isSafeInteger(options.afterPosition) || options.afterPosition < 0 || options.afterPosition >= Number.MAX_SAFE_INTEGER)) throw new Error("Invalid page position");
    const requestId = options?.requestId ?? 0;
    if (!Number.isSafeInteger(requestId) || requestId < 0) throw new Error("Invalid page query");
    if (requestId < session.queryRequestId) throw new Error("Query superseded");
    if (session.pageBusy && requestId === session.queryRequestId) throw new Error("A page is already loading");
    const compiled = buildFilter(options?.filter, session.width ?? 0);
    return { session, requestId, compiled };
  }
  async function page(id: string, offset: number, limit: number, options?: PageOptions): Promise<PageResult> {
    const { session, requestId, compiled } = admitPage(id, offset, limit, options);
    const previous = session.pageBusy ? session.pageOperation : undefined;
    if (previous) {
      session.queryRequestId = requestId;
      const interrupt = () => { try { session.pageConnection?.interrupt(); } catch (cause) { console.error("CSV Viewer interrupt failed:", cause); } };
      interrupt();
      const timer = setInterval(interrupt, 25);
      try { await previous.catch(() => {}); } finally { clearInterval(timer); }
    } else session.queryRequestId = requestId;
    if (!current(session) || requestId !== session.queryRequestId) throw new Error("Query superseded");
    checkSource(session);
    session.pageBusy = true;
    const preparing = session.phase === "preparing";
    const connection = preparing ? session.csvConnection! : session.connection!;
    session.pageConnection = connection;
    const pending = (async () => {
      if (preparing) {
        requireSource(session);
        const csv = session.csv!;
        const start = options?.afterPosition !== undefined ? options.afterPosition + 1 : offset;
        const reader = await connection.runAndReadAll(`SELECT * FROM ${csv.from} LIMIT ? OFFSET ?`, [...csv.params, limit, start + (csv.hasHeader ? 1 : 0)]);
        try {
          if (!current(session) || requestId !== session.queryRequestId) throw new Error("Query superseded");
          requireSource(session);
          const rows = reader.getRows().map((row) => row.map((value) => value == null ? "" : String(value)));
          return { offset, nextPosition: rows.length ? start + rows.length - 1 : null, rows, totalRows: null };
        } finally { reader.closeSync(); }
      }
      const { where, params: filterParams } = compiled;
      const filtered = !!where;
      const checkCurrent = () => {
        if (!current(session) || requestId !== session.queryRequestId) throw new Error("Query superseded");
      };
      for (const pattern of compiled.regexes) {
        try {
          const checked = await connection.runAndReadAll("SELECT regexp_matches('', ?)", [pattern]);
          checked.closeSync();
        } catch (cause) {
          checkCurrent();
          throw new Error(`Invalid regular expression: ${explain(cause)}`);
        }
        checkCurrent();
      }
      const key = options?.sort ? JSON.stringify([options.sort.column, options.sort.direction, options.sort.mode]) : undefined;
      if (session.order?.key !== key || (options?.sort && !session.order?.mode)) {
        const dropped = await session.connection!.run("DROP TABLE IF EXISTS sort_order");
        dropped.closeSync();
        session.order = undefined;
        checkCurrent();
        if (options?.sort) {
          // Remember an unfinished build so the next page request drops it after cancellation.
          session.order = { key: key! };
          const mode = await buildSortOrder(session.connection!, session.width ?? 0, options.sort, checkCurrent);
          checkCurrent();
          session.order = { key: key!, mode };
        }
      }
      const sortPosition = session.order ? "ord.pos" : "rows.rowid";
      const sortFrom = session.order ? "sort_order ord JOIN rows ON rows.rowid = ord.src" : "rows";
      const filterKey = filtered ? JSON.stringify([key, where, filterParams]) : undefined;
      if (session.filterOrder?.key !== filterKey || (filtered && session.filterOrder?.totalRows === undefined)) {
        const dropped = await connection.run("DROP TABLE IF EXISTS filter_order");
        dropped.closeSync();
        session.filterOrder = undefined;
        checkCurrent();
        if (filtered) {
          session.filterOrder = { key: filterKey! };
          const built = await connection.run(`CREATE TABLE filter_order AS
            SELECT ${sortPosition} AS pos, rows.rowid AS src FROM ${sortFrom} WHERE ${where} ORDER BY ${sortPosition}`, filterParams);
          built.closeSync();
          checkCurrent();
          const count = await connection.runAndReadAll("SELECT COUNT(*) FROM filter_order");
          try {
            checkCurrent();
            session.filterOrder.totalRows = Number(count.getRows()[0][0]);
          } finally { count.closeSync(); }
        }
      }
      checkCurrent();
      const totalRows = session.filterOrder?.totalRows ?? session.rowCount ?? 0;
      const position = filtered ? "filtered.pos" : sortPosition;
      const from = filtered ? "filter_order filtered JOIN rows ON rows.rowid = filtered.src" : sortFrom;
      const start = options?.afterPosition !== undefined ? options.afterPosition + 1 : filtered ? 0 : offset;
      const range = filtered ? `${position} >= ?` : `${position} >= ? AND ${position} < ?`;
      const params = filtered ? [start, limit, options?.afterPosition !== undefined ? 0 : offset] : [start, start + limit, limit];
      const reader = await session.connection!.runAndReadAll(
        `SELECT rows.*, ${position} FROM ${from} WHERE ${range}
          ORDER BY ${position} LIMIT ?${filtered ? " OFFSET ?" : ""}`, params);
      try {
        checkCurrent();
        checkSource(session);
        const values = reader.getRows();
        return { offset, nextPosition: values.length ? Number(values[values.length - 1][session.width!]) : null,
          rows: values.map((row) => row.slice(0, session.width).map((value) => value == null ? "" : String(value))),
          totalRows, ...(session.order ? { sortMode: session.order.mode } : {}) };
      } finally { reader.closeSync(); }
    })();
    session.pageOperation = pending;
    try {
      return await pending;
    } catch (cause) { throw new Error(explain(cause)); }
    finally { if (session.pageOperation === pending) session.pageBusy = false; }
  }
  function beginPage(id: string, offset: number, limit: number, options: PageOptions & { requestId: number }) {
    const { session } = admitPage(id, offset, limit, options);
    const query = { requestId: options.requestId } as NonNullable<Session["query"]>;
    session.query = query;
    void page(id, offset, limit, options).then((result) => { query.result = result; }, (error) => { query.error = error; });
    return { state: "pending" as const };
  }
  function pollPage(id: string, requestId: number) {
    const query = find(id)?.query;
    if (!query || query.requestId !== requestId) throw new Error("Query superseded");
    if (query.error) throw query.error;
    return query.result ? { state: "ready" as const, page: query.result } : { state: "pending" as const };
  }
  function close(sessionId?: string, panelId?: string, turn?: number) {
    if (panelId && turn !== undefined) latestTurn.set(panelId, Math.max(turn, latestTurn.get(panelId) ?? 0));
    const session = sessionId ? find(sessionId) : panelId ? active.get(panelId) : undefined;
    if (!session) return false;
    if (panelId && turn !== undefined && session.turn >= turn) return false;
    cancel(session);
    return true;
  }
  async function dispose() {
    disposed = true;
    latestTurn.clear();
    const sessions = [...owned];
    sessions.forEach(cancel);
    await Promise.allSettled(sessions.map(drain));
  }
  return { inspect, open, status, page, beginPage, pollPage, close, dispose };
}
