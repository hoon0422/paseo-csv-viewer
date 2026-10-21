import { randomUUID } from "node:crypto";
import { mkdtemp, open as openFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { openPreview } from "../shared/session";
import { duckdb } from "./native";
import { sortPage, type Sort } from "./sort";

type OpenInput = z.output<typeof openPreview.input>;
type PaseoApi = PluginHandlerContext["paseo"];
type Phase = "preview" | "scanning" | "preparing" | "complete" | "error" | "cancelled";
type Session = {
  id: string; panelId: string; turn: number; cancelled: boolean; phase: Phase; message: string;
  sourceBytes: number; bytesScanned: number; percent: number | null; rowCount: number | null; width: number;
  directory?: string; db?: DuckDBInstance; connection?: DuckDBConnection;
  opening?: Promise<unknown>; operation?: Promise<unknown>; cleanup?: Promise<void>; pageBusy?: boolean;
  interruptTimer?: ReturnType<typeof setInterval>;
};
const LIMIT = 50;

// DuckDB's strict reader skips blank records in multi-column files; this checks only that defect.
async function scanCsv(path: string, delimiter: number, current: () => boolean, firstOnly: boolean, progress?: (bytes: number) => void) {
  const file = await openFile(path, "r");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let width = 1, firstWidth = 0, seen = false, recordHasBytes = false, quoted = false, quotePending = false, skipLf = false;
  let line = 1, offset = 0;
  try {
    for (;;) {
      if (!current()) throw new Error("Session cancelled");
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return firstWidth || (seen ? width : 0);
      let index = offset === 0 && bytesRead >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf ? 3 : 0;
      for (; index < bytesRead; index++) {
        const byte = chunk[index];
        seen = true;
        if (skipLf) { skipLf = false; if (byte === 0x0a) continue; }
        if (quotePending) { quotePending = false; if (byte === 0x22) continue; quoted = false; }
        if (byte === 0x22) {
          if (quoted) quotePending = true;
          else { quoted = true; recordHasBytes = true; }
        } else if (byte === 0x0a || byte === 0x0d) {
          if (!quoted) {
            if (!firstWidth) {
              firstWidth = width;
              if (firstOnly || firstWidth === 1) return firstWidth;
            } else if (!recordHasBytes) {
              throw new Error(`CSV Error on Line: ${line} (byte ${offset + index}): empty record has 1 column; expected ${firstWidth}`);
            }
            width = 1; recordHasBytes = false;
          }
          line++; skipLf = byte === 0x0d;
        } else if (!quoted) {
          if (!firstWidth && byte === delimiter) width++;
          recordHasBytes = true;
        }
      }
      offset += bytesRead;
      progress?.(offset);
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

export function createSessions() {
  const active = new Map<string, Session>();
  const owned = new Set<Session>();
  const latestTurn = new Map<string, number>();
  let disposed = false;
  const current = (session: Session) => !disposed && !session.cancelled && active.get(session.panelId) === session;
  function cleanup(session: Session) {
    return session.cleanup ??= (async () => {
      try { session.connection?.closeSync(); } finally {
        try { session.db?.closeSync(); } finally {
          try { if (session.directory) await rm(session.directory, { recursive: true, force: true }); }
          finally { owned.delete(session); }
        }
      }
    })();
  }
  async function drain(session: Session) {
    await session.opening?.catch(() => {});
    await session.operation?.catch(() => {});
    if (session.interruptTimer) clearInterval(session.interruptTimer);
    await cleanup(session);
  }
  function cancel(session: Session) {
    if (session.cancelled) return;
    const running = session.phase === "preview" || session.phase === "scanning" || session.phase === "preparing" || session.pageBusy;
    session.cancelled = true;
    session.phase = "cancelled";
    session.message = "Session cancelled";
    if (active.get(session.panelId) === session) active.delete(session.panelId);
    if (running) {
      const interrupt = () => {
        try { session.connection?.interrupt(); }
        catch (cause) { console.error("CSV Viewer interrupt failed:", cause); }
      };
      interrupt();
      // run() prepares asynchronously; repeat until it settles so an early interrupt cannot miss the query.
      session.interruptTimer = setInterval(interrupt, 25);
    }
    void drain(session).catch((cause) => console.error("CSV Viewer cleanup failed:", cause));
  }

  async function open(input: OpenInput, paseo?: PaseoApi) {
    if (disposed) throw new Error("Viewer is closed");
    const turn = input.turn ?? 0;
    if (turn < (latestTurn.get(input.panelId) ?? 0)) throw new Error("Replaced by a newer file or closed panel");
    latestTurn.set(input.panelId, turn);
    const previous = active.get(input.panelId);
    if (previous) cancel(previous);
    const session: Session = { id: randomUUID(), panelId: input.panelId, turn, cancelled: false, phase: "preview", message: "Opening preview", sourceBytes: 0, bytesScanned: 0, percent: null, rowCount: null, width: 0 };
    active.set(input.panelId, session);
    owned.add(session);
    const initialize = async () => {
      let path: string;
      if (input.source.kind === "workspace") {
        if (!paseo) throw new Error("Workspace lookup is unavailable");
        if (isAbsolute(input.source.path)) throw new Error("Workspace file path must be relative");
        const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
        if (!workspace || workspace.id !== input.workspaceId || !workspace.workspaceDirectory) throw new Error("Workspace is unavailable");
        const root = await realpath(workspace.workspaceDirectory);
        path = await realpath(resolve(root, input.source.path));
        const within = relative(root, path);
        if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error("File is outside this workspace");
      } else {
        if (!isAbsolute(input.source.path)) throw new Error("Local file path must be absolute");
        path = await realpath(input.source.path);
      }
      if (!current(session)) throw new Error("Session cancelled");
      if (!/\.(csv|tsv)$/i.test(extname(path))) throw new Error("Choose a CSV or TSV file");
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Choose a regular file");
      session.sourceBytes = info.size;
      const delimiter = extname(path).toLowerCase() === ".tsv" ? 0x09 : 0x2c;
      const width = await scanCsv(path, delimiter, () => current(session), true);
      session.width = width;
      if (!current(session)) throw new Error("Session cancelled");
      const base = { sessionId: session.id, fileName: basename(path), sourceBytes: info.size, status: "preview" as const, limit: LIMIT };
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
          temp_directory: join(session.directory, "spill"), memory_limit: "1GB", threads: "2", preserve_insertion_order: "true",
        });
      } catch (cause) { throw new Error(`Temporary storage failed. Check free disk space and permissions, then try again. ${String(cause)}`); }
      if (!current(session)) throw new Error("Session cancelled");
      session.connection = await session.db.connect();
      if (!current(session)) throw new Error("Session cancelled");
      const columnsSql = Array.from({ length: width }, (_, index) => `'column${index}':'VARCHAR'`).join(",");
      const from = `read_csv(?, delim=?, quote='"', escape='"', header=false, auto_detect=false, columns={${columnsSql}}, strict_mode=true, ignore_errors=false, null_padding=false)`;
      const params = [path, delimiter === 0x09 ? "\t" : ","];
      const reader = await session.connection.runAndReadAll(`SELECT * FROM ${from} LIMIT ${LIMIT + (input.hasHeader === false ? 0 : 1)}`, params);
      let values: string[][];
      try { values = reader.getRows().map((row) => row.map((value) => value == null ? "" : String(value))); }
      finally { reader.closeSync(); }
      if (!current(session)) throw new Error("Session cancelled");
      const columns = input.hasHeader !== false ? values.shift() ?? [] : values[0]?.map((_, index) => `Column ${index + 1}`) ?? [];
      const rows = values.slice(0, LIMIT);
      session.phase = "scanning";
      session.message = "Checking records for skipped blanks";
      session.operation = prepare(session, path, delimiter, width, from, params, input.hasHeader !== false);
      return { ...base, columns, rows };
    };
    const pending = initialize();
    session.opening = pending;
    try { return await pending; }
    catch (cause) {
      cancel(session);
      await cleanup(session);
      throw new Error(explain(cause));
    }
  }

  async function prepare(session: Session, path: string, delimiter: number, width: number, from: string, params: string[], hasHeader: boolean) {
    try {
      if (width > 1) {
        await scanCsv(path, delimiter, () => current(session), false, (bytes) => { session.bytesScanned = bytes; });
        session.bytesScanned = session.sourceBytes;
      }
      if (!current(session)) return;
      session.phase = "preparing";
      session.message = "Preparing disk-backed rows";
      const result = await session.connection!.run(`CREATE TABLE rows AS SELECT * FROM ${from}${hasHeader ? " OFFSET 1" : ""}`, params);
      result.closeSync();
      if (!current(session)) return;
      const count = await session.connection!.runAndReadAll("SELECT COUNT(*) FROM rows");
      try { session.rowCount = Number(count.getRows()[0][0]); } finally { count.closeSync(); }
      if (!current(session)) return;
      session.phase = "complete";
      session.message = "All rows ready";
      session.percent = 100;
    } catch (cause) {
      if (current(session)) { session.phase = "error"; session.message = explain(cause); await cleanup(session); }
    }
  }

  function find(id: string) { return [...active.values()].find((session) => session.id === id); }
  function status(id: string) {
    const session = find(id);
    if (!session) throw new Error("Viewer session is closed");
    let percent = session.percent;
    if (session.phase === "scanning" && session.sourceBytes) percent = Math.min(100, Math.floor(session.bytesScanned / session.sourceBytes * 100));
    if (session.phase === "preparing" && session.connection) {
      const native = session.connection.progress.percentage;
      percent = native >= 0 && native <= 100 ? native : null;
    }
    return { phase: session.phase, message: session.message, bytesScanned: session.bytesScanned, sourceBytes: session.sourceBytes, percent, rowCount: session.rowCount };
  }
  async function page(id: string, offset: number, limit: number, options?: { sort?: Sort }) {
    const session = find(id);
    if (!session || session.phase !== "complete" || !session.connection) throw new Error("Rows are not ready for this session");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > LIMIT) throw new Error("Invalid page range");
    if (session.operation && session.pageBusy) throw new Error("A page is already loading");
    session.pageBusy = true;
    const pending = (async () => {
      if (options?.sort) {
        const sorted = await sortPage(session.connection!, session.width, options.sort, offset, limit);
        if (!current(session)) throw new Error("Session cancelled");
        return { offset, ...sorted };
      }
      const reader = await session.connection!.runAndReadAll("SELECT * FROM rows WHERE rowid >= ? ORDER BY rowid LIMIT ?", [offset, limit]);
      try {
        if (!current(session)) throw new Error("Session cancelled");
        return { offset, rows: reader.getRows().map((row) => row.map((value) => value == null ? "" : String(value))), sortMode: undefined };
      } finally { reader.closeSync(); }
    })();
    session.operation = pending;
    try {
      return await pending;
    } catch (cause) { throw new Error(explain(cause)); }
    finally { session.pageBusy = false; }
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
  return { open, status, page, close, dispose };
}
