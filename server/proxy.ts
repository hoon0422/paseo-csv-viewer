import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { installationRoot } from "./native";
import { resolveSource, type createSessions } from "./session";

type Sessions = ReturnType<typeof createSessions>;
type PaseoApi = PluginHandlerContext["paseo"];
type Method = Exclude<keyof Sessions, "inspect">;
export type Request = { id: number; method: Method; args: any[] };
export type Response = { ready: true } | { workspace: number; requestId: number; workspaceId: string } | { id: number; value?: any; error?: string };
type Panel = { panelId: string; turn: number; sessionId?: string; sourceBytes: number; child?: Child; error?: Error };
type Child = {
  child: ChildProcess; fail: (cause: unknown) => void; ready: Promise<void>; ended: Promise<void>; error?: Error;
  pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; paseo?: PaseoApi }>;
  panels: Set<Panel>;
};

function nodeOnPath() {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const path = join(directory, process.platform === "win32" ? "node.exe" : "node");
    try { if (!statSync(path).isFile()) continue; accessSync(path, constants.X_OK); return path; } catch { /* Try the next PATH entry. */ }
  }
  throw new Error("CSV Viewer needs Node.js on the daemon's PATH. Install Node.js and add its directory to the daemon's PATH, then try again.");
}

function nodeFailure(node: string) {
  return new Error(`CSV Viewer cannot run Node.js at "${node}" (expected ${process.platform}/${process.arch}). Check that Node.js is executable and matches the installed DuckDB architecture, then reopen the source.`);
}

function panelMessage(cause: unknown) {
  const message = (cause instanceof Error ? cause.message : String(cause)).trim().replace(/^Error:\s*/, "");
  return message.length > 500 ? `${message.slice(0, 497).trimEnd()}...` : message;
}

export function createSessionProxy(spawnChild: (file: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {
  let child: Promise<Child> | undefined;
  let stopping: Promise<void> | undefined;
  let disposed = false, sequence = 0;
  const panels = new Map<string, Panel>();
  const sessions = new Map<string, Panel>();
  const turns = new Map<string, number>();

  async function start(): Promise<Child> {
    const node = nodeOnPath();
    const directory = await mkdtemp(join(tmpdir(), "csv-viewer-child-")).catch((cause) => {
      throw new Error(`Temporary storage failed. Check free disk space and permissions, then try again. ${String(cause)}`);
    });
    let childProcess: ChildProcess;
    try {
      childProcess = spawnChild(node, [join(installationRoot(), "server", "child.cjs"), directory], {
        // JSON IPC turns omitted close arguments into null and changes cancellation semantics.
        stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "advanced",
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      });
    } catch (cause) {
      console.error("CSV Viewer Node.js spawn failed:", node, cause);
      await rm(directory, { recursive: true, force: true });
      throw nodeFailure(node);
    }
    let ready!: () => void, failed!: (error: Error) => void, ended!: () => void;
    const state: Child = { child: childProcess, fail,
      ready: new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; }),
      ended: new Promise<void>((resolve) => { ended = resolve; }), pending: new Map(), panels: new Set() };
    let cleanup: Promise<void> | undefined;
    function reject(error: Error) {
      state.error = error;
      for (const panel of state.panels) {
        panel.error = error;
        if (panels.get(panel.panelId) === panel) panels.delete(panel.panelId);
      }
      failed(error);
      for (const pending of state.pending.values()) pending.reject(error);
      state.pending.clear();
    }
    function finish(error: Error) {
      return cleanup ??= (async () => {
        try { await rm(directory, { recursive: true, force: true }); }
        catch (cause) { console.error("CSV Viewer temporary storage cleanup failed:", cause); error = new Error(`${error.message} Temporary storage could not be removed; check disk permissions.`); }
        reject(error);
        if (await child?.catch(() => undefined) === state) child = undefined;
        ended();
      })();
    }
    function fail(cause: unknown) {
      console.error("CSV Viewer Node.js child failed:", node, cause);
      const error = nodeFailure(node);
      reject(error);
      childProcess.kill();
      void finish(error);
    }
    childProcess.stderr?.on("data", (chunk) => console.error("CSV Viewer Node.js child stderr:", String(chunk).trim()));
    childProcess.on("error", fail);
    childProcess.once("close", (code, signal) => {
      void finish(state.error ?? new Error(`CSV Viewer Node.js child exited (${signal ?? code}). Node.js: "${node}"; expected ${process.platform}/${process.arch}. Check Node.js and DuckDB architectures, then reopen the source.`));
    });
    childProcess.on("message", (message: Response) => {
      if (!message || typeof message !== "object") { state.fail(new Error("Invalid child IPC message")); return; }
      if ("ready" in message) {
        if (message.ready === true) ready(); else state.fail(new Error("Invalid child readiness message"));
        return;
      }
      if ("workspace" in message) {
        const pending = state.pending.get(message.requestId);
        void (async () => {
          try {
            if (!pending?.paseo) throw new Error("Workspace lookup is unavailable");
            const workspace = await pending.paseo.workspaces.ref(message.workspaceId).refresh();
            if (childProcess.connected) childProcess.send({ workspace: message.workspace, value: workspace && { id: workspace.id, workspaceDirectory: workspace.workspaceDirectory } }, (error) => { if (error) state.fail(error); });
          } catch (cause) {
            console.error("CSV Viewer workspace lookup failed:", cause);
            if (childProcess.connected) childProcess.send({ workspace: message.workspace, error: panelMessage(cause) }, (error) => { if (error) state.fail(error); });
          }
        })();
        return;
      }
      const pending = state.pending.get(message.id);
      state.pending.delete(message.id);
      if (message.error) {
        console.error("CSV Viewer child request failed:", message.error);
        pending?.reject(/@duckdb\/node-bindings|incompatible architecture|wrong architecture|ERR_DLOPEN_FAILED/i.test(message.error)
          ? nodeFailure(node) : new Error(panelMessage(message.error)));
      } else pending?.resolve(message.value);
    });
    return state;
  }
  function getChild(): Promise<Child> {
    if (disposed) return Promise.reject(new Error("Viewer is closed"));
    if (stopping) return stopping.then(getChild);
    return child ??= start();
  }
  async function request<K extends Method>(state: Child, method: K, args: Parameters<Sessions[K]>, paseo?: PaseoApi): Promise<Awaited<ReturnType<Sessions[K]>>> {
    if (state.error) throw state.error;
    await state.ready;
    if (state.error) throw state.error;
    return new Promise<Awaited<ReturnType<Sessions[K]>>>((resolve, reject) => {
      const id = ++sequence;
      state.pending.set(id, { resolve, reject, paseo });
      try { state.child.send({ id, method, args } satisfies Request, (error) => { if (error) state.fail(error); }); }
      catch (cause) { state.fail(cause); }
    });
  }
  async function stopIfIdle() {
    if (panels.size || !child) return;
    const current = child;
    stopping ??= (async () => {
      const state = await current.catch(() => undefined);
      if (!state) { if (child === current) child = undefined; return; }
      try { await state.ready; await request(state, "dispose", []); }
      catch { state.child.kill(); }
      await state.ended;
    })().finally(() => { stopping = undefined; });
    await stopping;
  }
  async function open(...[input, paseo]: Parameters<Sessions["open"]>) {
    if (disposed) throw new Error("Viewer is closed");
    const turn = input.turn ?? 0;
    if (turn < (turns.get(input.panelId) ?? 0)) throw new Error("Replaced by a newer file or closed panel");
    turns.set(input.panelId, turn);
    const previous = panels.get(input.panelId);
    if (previous?.sessionId) sessions.delete(previous.sessionId);
    if (previous) previous.child?.panels.delete(previous);
    const panel: Panel = { panelId: input.panelId, turn, sourceBytes: 0 };
    panels.set(input.panelId, panel);
    try {
      const state = await getChild();
      state.panels.add(panel);
      panel.child = state;
      const result = await request(state, "open", [input], paseo);
      if (panels.get(input.panelId) !== panel) {
        await request(state, "close", [result.sessionId]);
        throw new Error("Session cancelled");
      }
      panel.sessionId = result.sessionId; panel.sourceBytes = result.sourceBytes;
      sessions.set(result.sessionId, panel);
      return result;
    } catch (cause) {
      if (panels.get(input.panelId) === panel) panels.delete(input.panelId);
      panel.child?.panels.delete(panel);
      await stopIfIdle();
      throw cause;
    }
  }
  async function forSession<K extends "status" | "page" | "beginPage" | "pollPage">(method: K, args: Parameters<Sessions[K]>): Promise<Awaited<ReturnType<Sessions[K]>>> {
    const panel = sessions.get(args[0]);
    if (panel?.error) throw panel.error;
    if (!panel || !child) throw new Error(method === "page" ? "Rows are not ready for this session" : "Viewer session is closed");
    const state = await child;
    return request(state, method, args);
  }
  async function close(sessionId?: string, panelId?: string, turn?: number) {
    if (panelId && turn !== undefined) turns.set(panelId, Math.max(turn, turns.get(panelId) ?? 0));
    const panel = sessionId ? sessions.get(sessionId) : panelId ? panels.get(panelId) : undefined;
    if (!panel || (panelId && turn !== undefined && panel.turn >= turn)) return false;
    if (panels.get(panel.panelId) === panel) panels.delete(panel.panelId);
    if (panel.sessionId) sessions.delete(panel.sessionId);
    panel.child?.panels.delete(panel);
    if (panel.error || !child) return false;
    const state = await child;
    const result = await request(state, "close", [sessionId, panelId, turn]);
    await stopIfIdle();
    return result;
  }
  return {
    inspect: async (...[input, paseo]: Parameters<Sessions["inspect"]>) => {
      if (disposed) throw new Error("Viewer is closed");
      const { revision } = await resolveSource(input, paseo);
      return { sourceBytes: revision.size };
    },
    open, close,
    status: async (id: string): Promise<ReturnType<Sessions["status"]>> => {
      try { return await forSession("status", [id]); }
      catch (cause) {
        const panel = sessions.get(id);
        if (!panel?.error) throw cause;
        return { phase: "error", message: panel.error.message, bytesScanned: 0, sourceBytes: panel.sourceBytes, percent: null, rowCount: null, sourceChanged: false };
      }
    },
    page: (...args: Parameters<Sessions["page"]>) => forSession("page", args),
    beginPage: (...args: Parameters<Sessions["beginPage"]>) => forSession("beginPage", args),
    pollPage: (...args: Parameters<Sessions["pollPage"]>) => forSession("pollPage", args),
    dispose: async () => { disposed = true; panels.clear(); await stopIfIdle(); sessions.clear(); turns.clear(); },
  };
}
