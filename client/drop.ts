import { workspaceFileDrag, type source } from "../shared/session";
import type { z } from "zod";

const MIME = "application/x-paseo-workspace-file+json";
type Source = z.output<typeof source>;
type Desktop = {
  webUtils?: { getPathForFile?: (file: File) => string };
  invoke?: (command: string) => Promise<unknown>;
};

function desktop(): Desktop | undefined {
  return (window as Window & { paseoDesktop?: Desktop }).paseoDesktop;
}

export async function localSource(file: File, hostId: string): Promise<Source> {
  const bridge = desktop();
  if (!bridge?.webUtils?.getPathForFile || !bridge.invoke) throw new Error("Local file drops require the Paseo desktop app");
  const path = bridge.webUtils.getPathForFile(file);
  if (!path) throw new Error("This drop has no local file path");
  let status: unknown;
  try {
    status = await bridge.invoke("desktop_daemon_status");
  } catch {
    throw new Error("Cannot confirm that this desktop and host share a computer");
  }
  if (!status || typeof status !== "object" ||
      !("status" in status) || status.status !== "running" ||
      !("serverId" in status) || typeof status.serverId !== "string" ||
      !status.serverId || status.serverId !== hostId) {
    throw new Error("Local files can open only on this desktop's running Paseo host");
  }
  return { kind: "local", path };
}

export function listenForDrops(
  node: unknown, hostId: string, workspaceId: string,
  open: (source: Source | Promise<Source>) => void, error: (message: string) => void, hover?: (active: boolean) => void,
) {
  if (typeof HTMLElement === "undefined" || !(node instanceof HTMLElement)) return () => {};
  let depth = 0;
  const accepts = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).some((type) => type === MIME || type === "Files");
  const reset = () => { depth = 0; hover?.(false); };
  const enter = (event: DragEvent) => {
    if (!accepts(event)) return;
    depth++;
    over(event);
  };
  const leave = () => { if (--depth <= 0) reset(); };
  const over = (event: DragEvent) => {
    if (!accepts(event)) return;
    hover?.(true);
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent) => {
    reset();
    event.preventDefault();
    event.stopPropagation();
    const data = event.dataTransfer;
    if (!data) return error("No file was supplied");
    const internal = data.getData(MIME);
    if (internal) {
      try {
        const payload = workspaceFileDrag.parse(JSON.parse(internal));
        if (payload.serverId !== hostId || payload.workspaceId !== workspaceId) {
          throw new Error("The file belongs to another host or workspace");
        }
        open({ kind: "workspace", path: payload.attachment.path });
      } catch (cause) {
        error(cause instanceof Error ? cause.message : "Invalid Paseo Files drop");
      }
      return;
    }
    const file = data.files?.[0];
    if (!file) return error("Drop a CSV or TSV file from Paseo Files or your file manager");
    open(localSource(file, hostId));
  };
  node.addEventListener("dragenter", enter);
  node.addEventListener("dragleave", leave);
  node.addEventListener("dragend", reset);
  node.addEventListener("dragover", over);
  node.addEventListener("drop", drop);
  return () => {
    reset();
    node.removeEventListener("dragenter", enter);
    node.removeEventListener("dragleave", leave);
    node.removeEventListener("dragend", reset);
    node.removeEventListener("dragover", over);
    node.removeEventListener("drop", drop);
  };
}

export function chooseLocalFile(hostId: string): Promise<Source | null> {
  if (typeof document === "undefined") throw new Error("Local file selection requires the Paseo desktop app");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,text/csv,text/tab-separated-values";
    input.style.display = "none";
    document.body.appendChild(input);
    const finish = (file: File | undefined) => {
      input.remove();
      if (!file) return resolve(null);
      void localSource(file, hostId).then(resolve, reject);
    };
    input.addEventListener("change", () => finish(input.files?.[0]), { once: true });
    input.addEventListener("cancel", () => finish(undefined), { once: true });
    input.click();
  });
}
