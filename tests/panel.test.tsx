import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { PluginRpcProvider } from "../node_modules/@getpaseo/plugin/dist/client/rpc-context.js";
import { ViewerPanel } from "../client/panel";
import { createSessions } from "../server/session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class DropZone {
  private listeners = new Map<string, (event: unknown) => void>();
  addEventListener(name: string, listener: (event: unknown) => void) { this.listeners.set(name, listener); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  drop(path: string) {
    this.listeners.get("drop")?.({
      preventDefault() {}, stopPropagation() {},
      dataTransfer: { getData: () => "", files: [{ path }] },
    });
  }
}

async function panelTest(run: (app: {
  tree: ReactTestRenderer; zone: DropZone; file: (path: string, rows: number) => Promise<string>;
  bridgeStatus: (next: () => Promise<unknown>) => void;
  opens: () => number;
  holdPage: (next: Promise<void>) => void;
  press: (label: string) => Promise<void>; wait: (condition: () => boolean) => Promise<void>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-panel-"));
  const sessions = createSessions();
  const zone = new DropZone();
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: DropZone });
  let status: () => Promise<unknown> = async () => ({ status: "running", serverId: "test-host" });
  let pageGate = Promise.resolve();
  let opens = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    paseoDesktop: { webUtils: { getPathForFile: (file: { path: string }) => file.path }, invoke: () => status() },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
  const invoke = async (name: string, input: any): Promise<unknown> => {
    if (name === "viewer.open") { opens++; return sessions.open(input); }
    if (name === "viewer.close") return { closed: sessions.close(input.sessionId, input.panelId, input.turn) };
    if (name === "viewer.status") return sessions.status(input.sessionId);
    if (name === "viewer.page") { await pageGate; return sessions.page(input.sessionId, input.offset, input.limit); }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const props = { host: { id: "test-host" }, workspaceId: "workspace", layout: { compact: false }, theme: {
    colors: { foreground: "#fff", foregroundMuted: "#aaa", surface0: "#000", border: "#777" },
  } } as Parameters<typeof ViewerPanel>[0];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => {
      tree = create(<QueryClientProvider client={new QueryClient()}>
        <PluginRpcProvider invoke={invoke as Parameters<typeof PluginRpcProvider>[0]["invoke"]}>
          <ViewerPanel {...props} />
        </PluginRpcProvider>
      </QueryClientProvider>, { createNodeMock: () => zone });
    });
    const wait = async (condition: () => boolean) => {
      for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
      }
      assert.fail("Panel state did not settle");
    };
    await run({ tree, zone,
      file: async (path, rows) => {
        const full = join(directory, path);
        await writeFile(full, "id,value\n" + Array.from({ length: rows }, (_, i) => `${i},${path}-${i}\n`).join(""));
        return full;
      },
      bridgeStatus: (next) => { status = next; },
      opens: () => opens,
      holdPage: (next) => { pageGate = next; },
      press: async (label) => { await act(async () => { tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); }); },
      wait,
    });
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    await sessions.dispose();
    await rm(directory, { recursive: true, force: true });
    Reflect.deleteProperty(globalThis, "HTMLElement");
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  }
}

test("replacement clears an old page load and header switch applies to the next drop", async () => {
  await panelTest(async ({ tree, zone, file, holdPage, press, wait }) => {
    const first = await file("first.csv", 120);
    const second = await file("second.csv", 120);
    await act(async () => { zone.drop(first); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    let release!: () => void;
    holdPage(new Promise<void>((resolve) => { release = resolve; }));
    await press("Next rows");
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Next rows" }).props.disabled, true);
    await act(async () => { zone.drop(second); });
    await wait(() => JSON.stringify(tree.toJSON()).includes('"second.csv"," · "'));
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).length > 0);
    await act(async () => { release(); });
    await wait(() => !tree.root.findByProps({ accessibilityLabel: "Next rows" }).props.disabled);
    await press("First record is header");
    await wait(() => tree.root.findByProps({ accessibilityLabel: "First record is header" }).props.accessibilityState.checked === false);
    await act(async () => { zone.drop(first); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Copy cell row 1, Column 1" }).length > 0);
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Copy cell row 1, Column 1" }).findByType("div").children[0], "id");
  });
});

test("two pending OS drops keep action order when locality checks resolve out of order", async () => {
  await panelTest(async ({ tree, zone, file, bridgeStatus, opens, wait }) => {
    const first = await file("slow.csv", 2);
    const second = await file("new.csv", 2);
    let resolveFirst!: (value: unknown) => void;
    let calls = 0;
    bridgeStatus(() => ++calls === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) :
      Promise.resolve({ status: "running", serverId: "test-host" }));
    await act(async () => { zone.drop(first); zone.drop(second); });
    await wait(() => JSON.stringify(tree.toJSON()).includes('"new.csv"," · "'));
    await act(async () => { resolveFirst({ status: "running", serverId: "test-host" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    assert.equal(calls, 2);
    assert.equal(opens(), 1);
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Copy cell row 1, value" }).findByType("div").children[0], "new.csv-0");
  });
});
