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

const cells = (tree: ReactTestRenderer, column: string) => tree.root.findAll((node) =>
  typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.startsWith(`Copy cell row 1, ${column}, `));
const cell = (tree: ReactTestRenderer, column: string) => {
  const found = cells(tree, column)[0];
  assert.ok(found, `Cell in ${column} is visible`);
  return found;
};

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
  internal(payload: string) {
    this.listeners.get("drop")?.({
      preventDefault() {}, stopPropagation() {},
      dataTransfer: { getData: () => payload, files: [] },
    });
  }
}

async function panelTest(run: (app: {
  tree: ReactTestRenderer; zone: DropZone; file: (path: string, rows: number) => Promise<string>;
  write: (path: string, content: string) => Promise<string>;
  bridgeStatus: (next: () => Promise<unknown>) => void;
  opens: () => number;
  holdPage: (next: Promise<void>) => void;
  holdSearch: (next: Promise<void>) => void;
  holdSort: (next: Promise<void>) => void;
  pageCalls: () => { filter?: unknown; sort?: unknown }[];
  clipboard: () => string;
  press: (label: string) => Promise<void>; wait: (condition: () => boolean) => Promise<void>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-panel-"));
  const sessions = createSessions();
  const zone = new DropZone();
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: DropZone });
  let status: () => Promise<unknown> = async () => ({ status: "running", serverId: "test-host" });
  let pageGate = Promise.resolve();
  let searchGate = Promise.resolve();
  let sortGate = Promise.resolve();
  const pageCalls: { filter?: unknown; sort?: unknown }[] = [];
  let clipboard = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { clipboard = text; } } } });
  let opens = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    paseoDesktop: { webUtils: { getPathForFile: (file: { path: string }) => file.path }, invoke: () => status() },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
  const invoke = async (name: string, input: any): Promise<unknown> => {
    if (name === "viewer.open") { opens++; return sessions.open(input); }
    if (name === "viewer.close") return { closed: sessions.close(input.sessionId, input.panelId, input.turn) };
    if (name === "viewer.status") return sessions.status(input.sessionId);
    if (name === "viewer.query" && input.action === "start") { pageCalls.push(input); await pageGate; if (input.filter) await searchGate; if (input.sort) await sortGate; return sessions.beginPage(input.sessionId, input.offset, input.limit, { filter: input.filter, requestId: input.requestId, sort: input.sort }); }
    if (name === "viewer.query" && input.action === "poll") return sessions.pollPage(input.sessionId, input.requestId);
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
      write: async (path, content) => { const full = join(directory, path); await writeFile(full, content); return full; },
      bridgeStatus: (next) => { status = next; },
      opens: () => opens,
      holdPage: (next) => { pageGate = next; },
      holdSearch: (next) => { searchGate = next; },
      holdSort: (next) => { sortGate = next; },
      pageCalls: () => pageCalls,
      clipboard: () => clipboard,
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
    Reflect.deleteProperty(globalThis, "navigator");
  }
}

test("cancelling an unfiltered sort restores source order and supersedes its page", async () => {
  await panelTest(async ({ tree, zone, file, holdSort, pageCalls, press, wait }) => {
    const source = await file("sort.csv", 120);
    await act(async () => { zone.drop(source); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    let release!: () => void;
    holdSort(new Promise<void>((resolve) => { release = resolve; }));
    await press("Sort column 1 id descending");
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Cancel sort" }).length > 0);
    await press("Cancel sort");
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");
    assert.equal(pageCalls().at(-1)?.sort, undefined);
    await act(async () => { release(); });
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");
  });
});

test("filtered sorting and visible-column copy use the displayed order; clear keeps sorting", async () => {
  await panelTest(async ({ tree, zone, write, clipboard, press, wait }) => {
    const lines = Array.from({ length: 120 }, (_, i) => `${i},plain,other`);
    lines[1] = "1,alpha,needle";
    lines[70] = "70,gamma,needle";
    lines[90] = "90,zeta,needle";
    const source = await write("combined.csv", `id,visible,secret\n${lines.join("\n")}\n`);
    await act(async () => { zone.drop(source); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    await press("Hide secret");
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("needle"); });
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "1"));
    await press("Sort column 2 visible descending");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "90"));
    await press("Select row 1");
    await press("Select row 2");
    await press("Copy selected rows");
    assert.equal(clipboard(), "90\tzeta\n70\tgamma");
    await press("Clear search");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "90"));
    assert.ok(tree.root.findAllByProps({ accessibilityLabel: "✓ Auto" }).length > 0);
  });
});

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
    await wait(() => cells(tree, "Column 1").length > 0);
    assert.equal(cell(tree, "Column 1").findByType("div").children[0], "id");
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
    assert.equal(cell(tree, "value").findByType("div").children[0], "new.csv-0");
  });
});

test("an OS drop resolving after panel unload cannot open a session", async () => {
  await panelTest(async ({ tree, zone, file, bridgeStatus, opens }) => {
    const source = await file("late.csv", 2);
    let resolveStatus!: (value: unknown) => void;
    bridgeStatus(() => new Promise((resolve) => { resolveStatus = resolve; }));
    await act(async () => { zone.drop(source); });
    await act(async () => { tree.unmount(); });
    await act(async () => { resolveStatus({ status: "running", serverId: "test-host" }); });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(opens(), 0);
  });
});

test("cross-host and malformed Paseo Files drops explain rejection without opening a source", async () => {
  await panelTest(async ({ tree, zone, opens, wait }) => {
    const payload = { version: 1, serverId: "other-host", workspaceId: "workspace",
      attachment: { kind: "workspace_file", path: "data.csv", selection: { kind: "whole_file" } } };
    await act(async () => { zone.internal(JSON.stringify(payload)); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("another host or workspace"));
    assert.equal(opens(), 0);
    await act(async () => { zone.internal("{bad json"); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("Expected property name"));
    assert.equal(opens(), 0);
  });
});

test("panel shows a source change notice and Refresh loads the selected file", async () => {
  await panelTest(async ({ tree, zone, file, press, wait }) => {
    const source = await file("updated.csv", 2);
    await act(async () => { zone.drop(source); });
    await wait(() => cells(tree, "value").length > 0);
    await wait(() => JSON.stringify(tree.toJSON()).includes("All rows ready"));
    await writeFile(source, "id,value\n0,new\n1,latest\n");
    await wait(() => JSON.stringify(tree.toJSON()).includes("Source file changed"));
    assert.equal(cell(tree, "value").findByType("div").children[0], "updated.csv-0");
    await press("Refresh source");
    await wait(() => cells(tree, "value")
      .some((cell) => cell.findByType("div").children[0] === "new"));
    assert.equal(JSON.stringify(tree.toJSON()).includes("Source file changed"), false);
  });
});

test("a newer selection wins over a pending Refresh", async () => {
  await panelTest(async ({ tree, zone, file, wait }) => {
    const first = await file("first.csv", 2);
    const second = await file("second.csv", 2);
    await act(async () => { zone.drop(first); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("All rows ready"));
    await writeFile(first, "id,value\n" + "0,changed\n".repeat(30_000));
    await wait(() => JSON.stringify(tree.toJSON()).includes("Source file changed"));
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: "Refresh source" }).props.onPress();
      zone.drop(second);
    });
    await wait(() => cells(tree, "value")
      .some((cell) => cell.findByType("div").children[0] === "second.csv-0"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    assert.equal(cell(tree, "value").findByType("div").children[0], "second.csv-0");
  });
});

test("search shows pending, hidden-column matches and no results; stale search cannot replace cleared rows", async () => {
  await panelTest(async ({ tree, zone, file: makeFile, write, holdSearch, press, wait }) => {
    const file = await write("search.csv", "id,visible,secret\n" + Array.from({ length: 120 }, (_, i) =>
      `${i},plain,${i === 90 ? "café [X]%_" : "ordinary"}\n`).join(""));
    await act(async () => { zone.drop(file); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    await press("Hide secret");
    let release!: () => void;
    holdSearch(new Promise<void>((resolve) => { release = resolve; }));
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("CAFÉ [x]%_"); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("Searching the whole file"));
    await press("Clear search");
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    await act(async () => { release(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("CAFÉ [x]%_"); });
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "90"));
    assert.equal(cells(tree, "secret").length, 0);
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("no such value"); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("No matching rows."));
    await press("Clear search");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "0"));

    let releaseCancel!: () => void;
    holdSearch(new Promise<void>((resolve) => { releaseCancel = resolve; }));
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("café"); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Cancel search" }).length > 0);
    await press("Cancel search");
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Next rows" }).some((node) => !node.props.disabled));
    await act(async () => { releaseCancel(); });
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");

    let releaseReplace!: () => void;
    holdSearch(new Promise<void>((resolve) => { releaseReplace = resolve; }));
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("café"); });
    await wait(() => tree.root.findAllByProps({ accessibilityLabel: "Cancel search" }).length > 0);
    const replacement = await makeFile("replacement.csv", 2);
    await act(async () => { zone.drop(replacement); });
    await wait(() => JSON.stringify(tree.toJSON()).includes('"replacement.csv"," · "'));
    await act(async () => { releaseReplace(); });
    assert.equal(cell(tree, "value").findByType("div").children[0], "replacement.csv-0");
  });
});
