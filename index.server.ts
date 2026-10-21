import type { PluginServerContext } from "@getpaseo/plugin/server";
import { closePreview, openPreview } from "./shared/session";
import { createSessions } from "./server/session";

export default function contribute(server: PluginServerContext) {
  const sessions = createSessions();
  server.handle(openPreview, (input, { paseo }) => sessions.open(input, paseo));
  server.handle(closePreview, ({ sessionId }) => ({ closed: sessions.close(sessionId) }));
  return () => sessions.dispose();
}
