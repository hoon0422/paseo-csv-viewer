import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ViewerPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({ id: "viewer", title: "CSV Viewer", icon: "Table", context: "workspace", Component: ViewerPanel });
  client.addCommandCenterItem({
    id: "open-viewer", title: "Open CSV Viewer", icon: "Table", context: "workspace",
    onSelect({ openPanel }) { openPanel("viewer"); },
  });

  const buttons = new Map<string, { remove(): void }>();
  let stopped = false;
  let release: (() => Promise<void>) | undefined;
  const sync = (workspaces: readonly { id: string }[]) => {
    if (stopped) return;
    const ids = new Set(workspaces.map((workspace) => workspace.id));
    for (const [id, button] of buttons) if (!ids.has(id)) { button.remove(); buttons.delete(id); }
    for (const { id } of workspaces) if (!buttons.has(id)) {
      buttons.set(id, client.addHeaderButton({
        id: "open-viewer", workspaceId: id,
        button: { title: "Open CSV Viewer", icon: "Table", label: "CSV Viewer",
          behavior: { kind: "action", onPress() { client.openPanel("viewer", { workspaceId: id }); } } },
      }));
    }
  };
  void client.paseo.workspaces.list({ subscribe: {} }).then((result) => {
    release = () => result.subscription.release();
    if (stopped) return void release().catch((cause) => console.error("CSV Viewer workspace release failed:", cause));
    sync(result.entries);
    result.subscription.subscribe({
      snapshot: (snapshot: { entries: readonly { id: string }[] }) => sync(snapshot.entries),
      update: () => { void client.paseo.workspaces.list().then((latest) => sync(latest.entries)).catch((cause) => console.error("CSV Viewer workspace update failed:", cause)); },
    });
  }).catch((cause) => console.error("CSV Viewer workspace subscription failed:", cause));
  return () => {
    stopped = true;
    for (const button of buttons.values()) button.remove();
    void release?.().catch((cause) => console.error("CSV Viewer workspace release failed:", cause));
  };
}
