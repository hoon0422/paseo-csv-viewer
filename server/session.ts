import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { openPreview } from "../shared/session";
import { duckdb } from "./native";

type OpenInput = z.output<typeof openPreview.input>;
type PaseoApi = PluginHandlerContext["paseo"];
type Session = { id: string; panelId: string; path: string };
const LIMIT = 50;

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

    const { DuckDBInstance } = duckdb();
    const db = await DuckDBInstance.create(":memory:");
    const connection = await db.connect();
    let columns: string[];
    let rows: string[][];
    try {
      // shortcut: only the first 50 rows are read, full-file preparation belongs to #4/#5.
      const reader = await connection.runAndReadAll(
        "SELECT * FROM read_csv(?, delim=?, header=false, all_varchar=true, strict_mode=true, ignore_errors=false, null_padding=false) LIMIT 51",
        [path, extname(path).toLowerCase() === ".tsv" ? "\t" : ","],
      );
      const values = reader.getRows().map((row) => row.map((value) => value == null ? "" : String(value)));
      columns = values.shift() ?? [];
      rows = values.slice(0, LIMIT);
      reader.closeSync();
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
