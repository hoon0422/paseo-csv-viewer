import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { installationRoot } from "./native";
import { resolveSource, type createSessions } from "./session";

type Sessions = ReturnType<typeof createSessions>;
type PaseoApi = PluginHandlerContext["paseo"];
type Method = Exclude<keyof Sessions, "inspect">;
export type Request = { id: number; method: Method; args: any[] };
export type Response = { ready: true } | { workspace: number; workspaceId: string } | { id: number; value?: any; error?: string };
type Panel = { panelId: string; turn: number; sessionId?: string; sourceBytes: number; worker?: Worker; error?: Error };
type Worker = {
  child: ChildProcess; ready: Promise<void>; ended: Promise<void>; error?: Error;
  pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; paseo?: PaseoApi }>;
  panels: Set<Panel>;
};

function nodeOnPath() {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(directory, process.platform === "win32" ? "node.exe" : "node");
    try { accessSync(path, constants.X_OK); return path; } catch { /* Try the next PATH entry. */ }
  }
  throw new Error("CSV Viewer needs Node.js on the daemon's PATH. Install Node.js and try again.");
}

export function createSessionProxy(spawnChild: (file: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {
  let worker: Promise<Worker> | undefined;
  let stopping: Promise<void> | undefined;
  let disposed = false, sequence = 0;
  const panels = new Map<string, Panel>();
  const sessions = new Map<string, Panel>();
  const turns = new Map<string, number>();

  async function start(): Promise<Worker> {
    const node = nodeOnPath();
    const directory = await mkdtemp(join(tmpdir(), "csv-viewer-worker-")).catch((cause) => {
      throw new Error(`Temporary storage failed. Check free disk space and permissions, then try again. ${String(cause)}`);
    });
    let child: ChildProcess;
    try {
      child = spawnChild(node, [join(installationRoot(), "server", "worker.cjs"), directory], {
        // JSON IPC turns omitted close arguments into null and changes cancellation semantics.
        stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "advanced",
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      });
    } catch (cause) { await rm(directory, { recursive: true, force: true }); throw cause; }
    let ready!: () => void, failed!: (error: Error) => void;
    const state: Worker = { child, ready: new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; }),
      ended: Promise.resolve(), pending: new Map(), panels: new Set() };
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => { state.error = new Error(`CSV Viewer could not start its Node.js child. Check Node.js and its architecture. ${error.message}`); });
    state.ended = new Promise<void>((resolveEnded) => {
      child.once("close", async (code, signal) => {
        state.error ??= new Error(`CSV Viewer Node.js child exited (${signal ?? code}). Reopen the source to try again. Check Node.js and its architecture. ${stderr.trim()}`);
        try { await rm(directory, { recursive: true, force: true }); }
        catch (cause) { state.error = new Error(`${state.error.message} Temporary storage cleanup failed: ${String(cause)}`); }
        for (const panel of state.panels) {
          panel.error = state.error;
          if (panels.get(panel.panelId) === panel) panels.delete(panel.panelId);
        }
        failed(state.error);
        for (const pending of state.pending.values()) pending.reject(state.error);
        state.pending.clear();
        if (await worker?.catch(() => undefined) === state) worker = undefined;
        resolveEnded();
      });
    });
    child.on("message", (message: Response) => {
      if ("ready" in message) { ready(); return; }
      if ("workspace" in message) {
        const pending = state.pending.get(message.workspace);
        void (async () => {
          try {
            if (!pending?.paseo) throw new Error("Workspace lookup is unavailable");
            const workspace = await pending.paseo.workspaces.ref(message.workspaceId).refresh();
            if (child.connected) child.send({ workspace: message.workspace, value: workspace && { id: workspace.id, workspaceDirectory: workspace.workspaceDirectory } });
          } catch (cause) {
            if (child.connected) child.send({ workspace: message.workspace, error: String(cause) });
          }
        })();
        return;
      }
      const pending = state.pending.get(message.id);
      state.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value);
    });
    return state;
  }
  function getWorker(): Promise<Worker> {
    if (disposed) return Promise.reject(new Error("Viewer is closed"));
    if (stopping) return stopping.then(getWorker);
    return worker ??= start();
  }
  async function request<K extends Method>(state: Worker, method: K, args: Parameters<Sessions[K]>, paseo?: PaseoApi): Promise<Awaited<ReturnType<Sessions[K]>>> {
    await state.ready;
    if (state.error) { await state.ended; throw state.error; }
    return new Promise<Awaited<ReturnType<Sessions[K]>>>((resolve, reject) => {
      const id = ++sequence;
      state.pending.set(id, { resolve, reject, paseo });
      state.child.send({ id, method, args } satisfies Request, (error) => {
        if (error) { state.child.kill(); }
      });
    });
  }
  async function stopIfIdle() {
    if (panels.size || !worker) return;
    const current = worker;
    stopping ??= (async () => {
      const state = await current.catch(() => undefined);
      if (!state) { if (worker === current) worker = undefined; return; }
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
    if (previous) previous.worker?.panels.delete(previous);
    const panel: Panel = { panelId: input.panelId, turn, sourceBytes: 0 };
    panels.set(input.panelId, panel);
    try {
      const state = await getWorker();
      state.panels.add(panel);
      panel.worker = state;
      const result = await request(state, "open", [input], paseo);
      panel.sessionId = result.sessionId; panel.sourceBytes = result.sourceBytes;
      sessions.set(result.sessionId, panel);
      return result;
    } catch (cause) {
      if (panels.get(input.panelId) === panel) panels.delete(input.panelId);
      await stopIfIdle();
      throw cause;
    }
  }
  async function forSession<K extends "status" | "page" | "beginPage" | "pollPage">(method: K, args: Parameters<Sessions[K]>): Promise<Awaited<ReturnType<Sessions[K]>>> {
    const panel = sessions.get(args[0]);
    if (panel?.error) throw panel.error;
    if (!panel || !worker) throw new Error(method === "page" ? "Rows are not ready for this session" : "Viewer session is closed");
    const state = await worker;
    return request(state, method, args);
  }
  async function close(sessionId?: string, panelId?: string, turn?: number) {
    if (panelId && turn !== undefined) turns.set(panelId, Math.max(turn, turns.get(panelId) ?? 0));
    const panel = sessionId ? sessions.get(sessionId) : panelId ? panels.get(panelId) : undefined;
    if (!panel || (panelId && turn !== undefined && panel.turn >= turn)) return false;
    if (panels.get(panel.panelId) === panel) panels.delete(panel.panelId);
    if (panel.sessionId) sessions.delete(panel.sessionId);
    panel.worker?.panels.delete(panel);
    if (panel.error || !worker) return false;
    const state = await worker;
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
