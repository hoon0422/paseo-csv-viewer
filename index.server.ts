import type { PluginServerContext } from "@getpaseo/plugin/server";
import { closePreview, inspectSource, openPreview, pageQuery, pageRows, sessionStatus } from "./shared/session";
import { createSessions } from "./server/session";

export default function contribute(server: PluginServerContext) {
  const sessions = createSessions();
  server.handle(inspectSource, (input, { paseo }) => sessions.inspect(input, paseo));
  server.handle(openPreview, (input, { paseo }) => sessions.open(input, paseo));
  server.handle(closePreview, ({ sessionId, panelId, turn }) => ({ closed: sessions.close(sessionId, panelId, turn) }));
  server.handle(sessionStatus, ({ sessionId }) => sessions.status(sessionId));
  server.handle(pageRows, ({ sessionId, offset, limit, ...options }) => sessions.page(sessionId, offset, limit, options));
  server.handle(pageQuery, (input) => input.action === "start"
    ? sessions.beginPage(input.sessionId, input.offset, input.limit, input)
    : sessions.pollPage(input.sessionId, input.requestId));
  return () => sessions.dispose();
}
