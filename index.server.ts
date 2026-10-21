import type { PluginServerContext } from "@getpaseo/plugin/server";
import { closePreview, openPreview, pageRows, sessionStatus } from "./shared/session";
import { createSessions } from "./server/session";

export default function contribute(server: PluginServerContext) {
  const sessions = createSessions();
  server.handle(openPreview, (input, { paseo }) => sessions.open(input, paseo));
  server.handle(closePreview, ({ sessionId, panelId, turn }) => ({ closed: sessions.close(sessionId, panelId, turn) }));
  server.handle(sessionStatus, ({ sessionId }) => sessions.status(sessionId));
  server.handle(pageRows, ({ sessionId, offset, limit, search, requestId, sort }) => sessions.page(sessionId, offset, limit, { search, requestId, sort }));
  return () => sessions.dispose();
}
