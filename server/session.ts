import { randomUUID } from "node:crypto";
import { open as openFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { openPreview } from "../shared/session";
import { duckdb } from "./native";

type OpenInput = z.output<typeof openPreview.input>;
type PaseoApi = PluginHandlerContext["paseo"];
type Session = { id: string; panelId: string; path: string };
const LIMIT = 50;

async function scanCsv(path: string, delimiter: number, current: () => boolean) {
  const file = await openFile(path, "r");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let width = 1;
  let firstWidth = 0;
  let seen = false;
  let recordHasBytes = false;
  let quoted = false;
  let quotePending = false;
  let skipLf = false;
  let line = 1;
  let offset = 0;
  try {
    for (;;) {
      if (!current()) throw new Error("Replaced by a newer file");
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return firstWidth || (seen ? width : 0);
      let index = offset === 0 && bytesRead >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf ? 3 : 0;
      for (; index < bytesRead; index++) {
        const byte = chunk[index];
        seen = true;
        if (skipLf) {
          skipLf = false;
          if (byte === 0x0a) continue;
        }
        if (quotePending) {
          quotePending = false;
          if (byte === 0x22) continue;
          quoted = false;
        }
        if (byte === 0x22) {
          if (quoted) quotePending = true;
          else { quoted = true; recordHasBytes = true; }
        } else if (byte === 0x0a || byte === 0x0d) {
          if (!quoted) {
            if (!firstWidth) {
              firstWidth = width;
              if (firstWidth === 1) return firstWidth;
            } else if (!recordHasBytes) {
              throw new Error(`CSV Error on Line: ${line} (byte ${offset + index}): empty record has 1 column; expected ${firstWidth}`);
            }
            width = 1;
            recordHasBytes = false;
          }
          line++;
          skipLf = byte === 0x0d;
        } else if (!quoted) {
          if (!firstWidth && byte === delimiter) width++;
          recordHasBytes = true;
        }
      }
      offset += bytesRead;
    }
  } finally {
    await file.close();
  }
}

export function createSessions() {
  const active = new Map<string, Session>();
  const generations = new Map<string, number>();

  async function open(input: OpenInput, paseo?: PaseoApi) {
    const generation = (generations.get(input.panelId) ?? 0) + 1;
    generations.set(input.panelId, generation);
    active.delete(input.panelId);

    let path: string;
    if (input.source.kind === "workspace") {
      if (!paseo) throw new Error("Workspace lookup is unavailable");
      if (isAbsolute(input.source.path)) throw new Error("Workspace file path must be relative");
      const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
      if (!workspace || workspace.id !== input.workspaceId || !workspace.workspaceDirectory) throw new Error("Workspace is unavailable");
      const root = await realpath(workspace.workspaceDirectory);
      path = await realpath(resolve(root, input.source.path));
      const within = relative(root, path);
      if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        throw new Error("File is outside this workspace");
      }
    } else {
      if (!isAbsolute(input.source.path)) throw new Error("Local file path must be absolute");
      path = await realpath(input.source.path);
    }
    if (!/\.(csv|tsv)$/i.test(extname(path))) throw new Error("Choose a CSV or TSV file");
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Choose a regular file");

    // DuckDB's sniffer can accept broken quotes; its strict reader also skips blank records in wider files.
    const width = await scanCsv(path, extname(path).toLowerCase() === ".tsv" ? 0x09 : 0x2c,
      () => generations.get(input.panelId) === generation);
    if (!width) {
      const sessionId = randomUUID();
      active.set(input.panelId, { id: sessionId, panelId: input.panelId, path });
      return { sessionId, fileName: basename(path), sourceBytes: info.size, columns: [], rows: [], status: "preview" as const, limit: LIMIT };
    }

    const { DuckDBInstance } = duckdb();
    const db = await DuckDBInstance.create(":memory:");
    const connection = await db.connect();
    let columns: string[];
    let rows: string[][];
    try {
      const columnsSql = Array.from({ length: width }, (_, index) => `'column${index}':'VARCHAR'`).join(",");
      const from = `read_csv(?, delim=?, quote='"', escape='"', header=false, auto_detect=false, columns={${columnsSql}}, strict_mode=true, ignore_errors=false, null_padding=false)`;
      const params = [path, extname(path).toLowerCase() === ".tsv" ? "\t" : ","];
      const reader = await connection.runAndReadAll(
        `SELECT * FROM ${from} LIMIT ${LIMIT + (input.hasHeader === false ? 0 : 1)}`,
        params,
      );
      const values = reader.getRows().map((row) => row.map((value) => value == null ? "" : String(value)));
      columns = input.hasHeader !== false ? values.shift() ?? [] : values[0]?.map((_, index) => `Column ${index + 1}`) ?? [];
      rows = values.slice(0, LIMIT);
      reader.closeSync();
      // shortcut: opening waits for a full strict scan; #5 moves this into preparation.
      const validation = await connection.runAndReadAll(`SELECT COUNT(*) FROM ${from}`, params);
      validation.closeSync();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(message.split(/Possible fixes?:|Possible Solution:/i)[0].trim());
    } finally {
      connection.closeSync();
      db.closeSync();
    }
    if (generations.get(input.panelId) !== generation) throw new Error("Replaced by a newer file");
    const sessionId = randomUUID();
    active.set(input.panelId, { id: sessionId, panelId: input.panelId, path });
    return { sessionId, fileName: basename(path), sourceBytes: info.size, columns, rows, status: "preview" as const, limit: LIMIT };
  }

  function close(sessionId: string) {
    for (const [panelId, session] of active) {
      if (session.id === sessionId) {
        active.delete(panelId);
        generations.set(panelId, (generations.get(panelId) ?? 0) + 1);
        return true;
      }
    }
    return false;
  }

  async function dispose() {
    active.clear();
    generations.clear();
  }

  return { open, close, dispose };
}
