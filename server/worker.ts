import { rm } from "node:fs/promises";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createSessions } from "./session";
import type { Request, Response } from "./proxy";

const sessions = createSessions();
const lookups = new Map<number, { resolve: (workspace: any) => void; reject: (error: Error) => void }>();
function send(message: Response) { if (process.connected) process.send?.(message, () => {}); }
process.on("message", async (message: Request | { workspace: number; value?: unknown; error?: string }) => {
  if ("workspace" in message) {
    const pending = lookups.get(message.workspace);
    lookups.delete(message.workspace);
    if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value);
    return;
  }
  const { id, method, args } = message;
  try {
    const paseo = { workspaces: { ref: (workspaceId: string) => ({ refresh: () => new Promise((resolve, reject) => {
      lookups.set(id, { resolve, reject });
      send({ workspace: id, workspaceId });
    }) }) } } as PluginHandlerContext["paseo"];
    const value = method === "open" ? await sessions.open(args[0], paseo)

      : await (sessions[method] as (...args: any[]) => unknown)(...args);
    send({ id, value });
    if (method === "dispose") process.disconnect();
  } catch (cause) { send({ id, error: cause instanceof Error ? cause.message : String(cause) }); }
});
process.on("disconnect", () => {
  for (const pending of lookups.values()) pending.reject(new Error("Viewer is closed"));
  void sessions.dispose().then(() => rm(process.argv[2], { recursive: true, force: true })).finally(() => process.exit());
});
send({ ready: true });
