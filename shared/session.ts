import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace"), path: z.string().min(1) }),
  z.object({ kind: z.literal("local"), path: z.string().min(1) }),
]);

export const openPreview = defineRpc({
  name: "viewer.open",
  input: z.object({ panelId: z.string().uuid(), workspaceId: z.string().min(1), source, hasHeader: z.boolean().optional() }),
  output: z.object({
    sessionId: z.string().uuid(),
    fileName: z.string(),
    sourceBytes: z.number().nonnegative(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    status: z.literal("preview"),
    limit: z.number(),
  }),
});

export const closePreview = defineRpc({
  name: "viewer.close",
  input: z.object({ sessionId: z.string().uuid() }),
  output: z.object({ closed: z.boolean() }),
});

export const workspaceFileDrag = z.object({
  version: z.literal(1),
  serverId: z.string().min(1),
  workspaceId: z.string().min(1),
  attachment: z.object({
    kind: z.literal("workspace_file"),
    path: z.string().min(1),
    selection: z.object({ kind: z.literal("whole_file") }),
  }),
});
