import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace"), path: z.string().min(1) }),
  z.object({ kind: z.literal("local"), path: z.string().min(1) }),
]);

export const openPreview = defineRpc({
  name: "viewer.open",
  input: z.object({ panelId: z.string().uuid(), workspaceId: z.string().min(1), source, hasHeader: z.boolean().optional(), turn: z.number().int().nonnegative().optional() }),
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
  input: z.object({ sessionId: z.string().uuid().optional(), panelId: z.string().uuid().optional(), turn: z.number().int().nonnegative().optional() }),
  output: z.object({ closed: z.boolean() }),
});

export const sessionStatus = defineRpc({
  name: "viewer.status",
  input: z.object({ sessionId: z.string().uuid() }),
  output: z.object({
    phase: z.enum(["preview", "scanning", "preparing", "complete", "error", "cancelled"]),
    message: z.string(),
    bytesScanned: z.number().nonnegative(),
    sourceBytes: z.number().nonnegative(),
    percent: z.number().min(0).max(100).nullable(),
    rowCount: z.number().nonnegative().nullable(),
    sourceChanged: z.boolean(),
  }),
});

const pageInput = z.object({ sessionId: z.string().uuid(), offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(50),
    search: z.string().max(2048).optional(), requestId: z.number().int().nonnegative().optional(),
    sort: z.object({ column: z.number().int().nonnegative(), direction: z.enum(["asc", "desc"]), mode: z.enum(["auto", "numeric", "text"]) }).optional() });
const pageOutput = z.object({ offset: z.number(), rows: z.array(z.array(z.string())), totalRows: z.number().int().nonnegative(), sortMode: z.enum(["numeric", "text"]).optional() });

export const pageRows = defineRpc({ name: "viewer.page", input: pageInput, output: pageOutput });

export const pageQuery = defineRpc({
  name: "viewer.query",
  input: z.discriminatedUnion("action", [pageInput.extend({ action: z.literal("start"), requestId: z.number().int().nonnegative() }),
    z.object({ action: z.literal("poll"), sessionId: z.string().uuid(), requestId: z.number().int().nonnegative() })]),
  output: z.discriminatedUnion("state", [z.object({ state: z.literal("pending") }), z.object({ state: z.literal("ready"), page: pageOutput })]),
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
