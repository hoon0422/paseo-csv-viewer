import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { PluginRpcProvider } from "../node_modules/@getpaseo/plugin/dist/client/rpc-context.js";
import { PluginClientStateProvider } from "../node_modules/@getpaseo/plugin/dist/client/client-state.js";
import { ViewerPanel } from "../client/panel";
import { createSessions } from "../server/session";
import { TableView } from "../client/table";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const cells = (tree: ReactTestRenderer, column: string) => tree.root.findAll((node) =>
  typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.startsWith(`Copy cell row 1, ${column}, `));
const cell = (tree: ReactTestRenderer, column: string) => {
  const found = cells(tree, column)[0];
  assert.ok(found, `Cell in ${column} is visible`);
  return found;
};

class DropZone {
  parent: DropZone | null = null;
  editable = false;
  isContentEditable = false;
  private listeners = new Map<string, (event: unknown) => void>();
  contains(target: unknown): boolean { return target === this || target instanceof DropZone && this.contains(target.parent); }
  closest() { return this.editable ? this : null; }
  focus() { Object.assign(document, { activeElement: this }); }
  addEventListener(name: string, listener: (event: unknown) => void) { this.listeners.set(name, listener); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  drag(name: string, types = ["Files"]) {
    this.listeners.get(name)?.({ preventDefault() {}, dataTransfer: { types } });
  }
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

function shortcut(tree: ReactTestRenderer, target: DropZone, key: string, modifiers = {}) {
  let prevented = false;
  let stopped = false;
  tree.root.findByProps({ "aria-label": "CSV viewer" }).props.onKeyDownCapture({
    key, target, ctrlKey: true, nativeEvent: {}, ...modifiers,
    preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
  });
  return { prevented, stopped };
}

async function panelTest(run: (app: {
  tree: ReactTestRenderer; zone: DropZone; file: (path: string, rows: number) => Promise<string>;
  write: (path: string, content: string) => Promise<string>;
  bridgeStatus: (next: () => Promise<unknown>) => void;
  opens: () => number;
  holdPage: (next: Promise<void>) => void;
  holdSearch: (next: Promise<void>) => void;
  holdSort: (next: Promise<void>) => void;
  holdStatus: (next: Promise<void>) => void;
  pageCalls: () => { filter?: unknown; sort?: unknown }[];
  clipboard: () => string;
  press: (label: string, modifiers?: { ctrlKey?: boolean }) => Promise<void>; wait: (condition: () => boolean) => Promise<void>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "csv-viewer-panel-"));
  const sessions = createSessions();
  const zone = new DropZone();
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: DropZone });
  let status: () => Promise<unknown> = async () => ({ status: "running", serverId: "test-host" });
  let pageGate = Promise.resolve();
  let searchGate = Promise.resolve();
  let sortGate = Promise.resolve();
  let statusGate = Promise.resolve();
  const pageCalls: { filter?: unknown; sort?: unknown }[] = [];
  let clipboard = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { clipboard = text; } } } });
  let opens = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    paseoDesktop: { webUtils: { getPathForFile: (file: { path: string }) => file.path }, invoke: () => status() },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
  const invoke = async (name: string, input: any): Promise<unknown> => {
    if (name === "viewer.open") { opens++; return sessions.open(input, { workspaces: { ref: () => ({ refresh: async () => ({ id: "workspace", workspaceDirectory: directory }) }) } } as any); }
    if (name === "viewer.close") return { closed: sessions.close(input.sessionId, input.panelId, input.turn) };
    if (name === "viewer.status") { await statusGate; return sessions.status(input.sessionId); }
    if (name === "viewer.query" && input.action === "start") { pageCalls.push(input); await pageGate; if (input.filter) await searchGate; if (input.sort) await sortGate; return sessions.beginPage(input.sessionId, input.offset, input.limit, input); }
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
          <PluginClientStateProvider source={{ subscribe: () => () => {}, getAgent: () => null, getWorkspace: () => ({ id: "workspace", directory }) as any }}>
            <ViewerPanel {...props} />
          </PluginClientStateProvider>
        </PluginRpcProvider>
      </QueryClientProvider>, { createNodeMock: (element) => (element.props as { "aria-label"?: string })["aria-label"] === "CSV viewer"
        ? zone : { addEventListener() {}, removeEventListener() {} } });
    });
    const wait = async (condition: () => boolean) => {
      for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
      }
      assert.fail("Panel state did not settle: " + JSON.stringify(tree.toJSON()));
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
      holdStatus: (next) => { statusGate = next; },
      pageCalls: () => pageCalls,
      clipboard: () => clipboard,
      press: async (label, modifiers = {}) => { await act(async () => { const node = tree.root.findAll((node) => node.props["aria-label"] === label || node.props.accessibilityLabel === label)[0]; (node.props.onClick ?? node.props.onPress)(modifiers); }); },
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

test("row clicks replace, toggle and extend Selection in displayed order without checkboxes", async () => {
  await panelTest(async ({ tree, zone, file, wait }) => {
    await act(async () => { zone.drop(await file("selection.csv", 20)); });
    await wait(() => tree.root.findAllByType(TableView).some((table) => table.props.rows.length === 20));
    const selected = () => tree.root.findByType(TableView).props.presentation.selected;
    const click = async (row: number, modifiers = {}) => {
      await act(async () => { tree.root.findByProps({ "aria-label": `Select row ${row}` }).props.onClick(modifiers); });
    };
    assert.equal(tree.root.findAllByProps({ accessibilityRole: "checkbox" }).length, 0);
    await click(4);
    assert.deepEqual(selected(), [3]);
    await click(2);
    assert.deepEqual(selected(), [1]);
    await click(5, { ctrlKey: true });
    assert.deepEqual(selected(), [1, 4]);
    await click(2, { ctrlKey: true });
    assert.deepEqual(selected(), [4]);
    await click(6, { shiftKey: true });
    assert.deepEqual(selected(), [1, 2, 3, 4, 5]);
    await click(4, { shiftKey: true });
    assert.deepEqual(selected(), [3, 4, 5]);
    assert.equal(tree.root.findByProps({ "aria-label": "Select row 4" }).props["aria-selected"], true);
    assert.equal(tree.root.findByProps({ "aria-label": "Select row 4" }).props.style.backgroundColor, "rgba(128, 128, 128, 0.25)");
    assert.ok(tree.root.findByProps({ "aria-label": "Source status" }).findAllByType("span").some((span) => span.children.join("") === "3 selected"));
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    await click(1, { metaKey: true });
    assert.deepEqual(selected(), [3, 4, 5, 0]);
    await click(1, { ctrlKey: true });
    assert.deepEqual(selected(), [0]);
  });
});

test("panel shortcuts select partly visible rows and copy only while focused outside inputs during Preparation", async () => {
  await panelTest(async ({ tree, zone, file, wait, holdStatus, clipboard, press }) => {
    holdStatus(new Promise<void>(() => {}));
    await act(async () => { zone.drop(await file("shortcuts.csv", 20)); });
    await wait(() => tree.root.findAllByType(TableView).length > 0);
    const table = () => tree.root.findByType(TableView);
    await act(async () => { table().props.onVisibleRowsChange([1, 2]); });
    const root = tree.root.findByProps({ "aria-label": "CSV viewer" });
    await act(async () => { root.props.onPointerDownCapture({ target: zone }); });
    assert.equal(document.activeElement, zone);
    await act(async () => { assert.deepEqual(shortcut(tree, zone, "a"), { prevented: true, stopped: true }); });
    assert.deepEqual(table().props.presentation.selected, [1, 2]);
    await act(async () => { shortcut(tree, zone, "c"); });
    assert.equal(clipboard(), "1\tshortcuts.csv-1\n2\tshortcuts.csv-2");
    assert.equal(tree.root.findByProps({ "aria-label": "Toast" }).children[0], "Copied 2 rows");
    await press("Copy selected rows");
    assert.equal(clipboard(), "1\tshortcuts.csv-1\n2\tshortcuts.csv-2");
    const input = new DropZone(); input.parent = zone; input.editable = true;
    input.focus();
    for (const key of ["a", "c", "f"]) assert.deepEqual(shortcut(tree, input, key), { prevented: false, stopped: false });
    await act(async () => { root.props.onPointerDownCapture({ target: input }); });
    assert.equal(document.activeElement, input);
    input.editable = false; input.isContentEditable = true;
    assert.equal(shortcut(tree, input, "a").prevented, false);
    new DropZone().focus();
    assert.equal(shortcut(tree, zone, "a").prevented, false);
    zone.focus();
    assert.equal(shortcut(tree, new DropZone(), "a").prevented, false);
    for (const modifiers of [{ ctrlKey: false }, { shiftKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true }, { nativeEvent: { isComposing: true } }]) {
      assert.equal(shortcut(tree, zone, "a", modifiers).prevented, false);
    }
    assert.equal(shortcut(tree, zone, "f").prevented, false);
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    await press("Copy selected rows");
    assert.equal(shortcut(tree, zone, "a").prevented, false);
    await act(async () => { shortcut(tree, zone, "A", { metaKey: true, ctrlKey: false }); });
    assert.deepEqual(table().props.presentation.selected, [1, 2]);
    await act(async () => { shortcut(tree, zone, "C", { metaKey: true, ctrlKey: false }); });
    assert.equal(clipboard(), "1\tshortcuts.csv-1\n2\tshortcuts.csv-2");
  });
});

test("Selection accepts 10,000 rows and rejects an over-limit range, toggle or select-all unchanged", async () => {
  await panelTest(async ({ tree, zone, file, wait }) => {
    await act(async () => { zone.drop(await file("limit.csv", 10_001)); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("Ready"));
    const table = () => tree.root.findByType(TableView);
    while (table().props.rows.length < 10_001) {
      const loaded = table().props.rows.length;
      await act(async () => { table().props.onEndReached(); });
      await wait(() => table().props.rows.length > loaded);
    }
    const click = async (index: number, modifiers = {}) => {
      await act(async () => { table().props.onSelectRow(index, modifiers); });
    };
    await click(0);
    await click(10_000, { shiftKey: true });
    assert.deepEqual(table().props.presentation.selected, [0]);
    assert.equal(tree.root.findByProps({ "aria-label": "Toast" }).children[0], "Can't select more than 10,000 rows");
    await click(9_999, { shiftKey: true });
    const selection = table().props.presentation.selected;
    assert.equal(selection.length, 10_000);
    assert.equal(selection[0], 0);
    assert.equal(selection.at(-1), 9_999);
    await click(10_000, { ctrlKey: true });
    assert.equal(table().props.presentation.selected, selection);
    zone.focus();
    await act(async () => {
      table().props.onVisibleRowsChange(Array.from({ length: 10_001 }, (_, index) => index));
      shortcut(tree, zone, "a");
    });
    assert.equal(table().props.presentation.selected, selection);
    await click(9_998, { shiftKey: true });
    assert.deepEqual(table().props.presentation.selected, [9_998, 9_999]);
  });
});

test("source changes clear the Selection anchor and the previous viewport", async () => {
  await panelTest(async ({ tree, zone, file, wait }) => {
    await act(async () => { zone.drop(await file("anchor.csv", 20)); });
    await wait(() => tree.root.findAllByType(TableView).length > 0);
    let table = tree.root.findByType(TableView);
    await act(async () => { table.props.onSelectRow(9, {}); table.props.onVisibleRowsChange([9, 10]); });
    await act(async () => { zone.drop(await file("replacement.csv", 20)); });
    await wait(() => tree.root.findByProps({ "aria-label": "Workspace file path" }).props.value === "replacement.csv");
    table = tree.root.findByType(TableView);
    assert.deepEqual(table.props.presentation.selected, []);
    await act(async () => { table.props.onSelectRow(1, { shiftKey: true }); });
    assert.deepEqual(tree.root.findByType(TableView).props.presentation.selected, [1]);
    zone.focus();
    await act(async () => { shortcut(tree, zone, "a"); });
    assert.deepEqual(tree.root.findByType(TableView).props.presentation.selected, []);
  });
});

test("cancelling Preparation clears Selection and cannot select rows from the removed source", async () => {
  await panelTest(async ({ tree, zone, file, wait, holdStatus, press }) => {
    holdStatus(new Promise<void>(() => {}));
    await act(async () => { zone.drop(await file("cancel-selection.csv", 20)); });
    await wait(() => tree.root.findAllByType(TableView).length > 0);
    await act(async () => { tree.root.findByType(TableView).props.onVisibleRowsChange([1, 2]); });
    await press("Select row 1");
    await press("Cancel preparation");
    assert.equal(tree.root.findByProps({ "aria-label": "Copy selected rows" }).props.disabled, true);
    zone.focus();
    await act(async () => { shortcut(tree, zone, "a"); });
    assert.equal(tree.root.findByProps({ "aria-label": "Copy selected rows" }).props.disabled, true);
  });
});

test("scrolling appends 200 rows once, preserves selection and stops at the end", async () => {
  await panelTest(async ({ tree, zone, file, press, wait, pageCalls }) => {
    await act(async () => { zone.drop(await file("scroll.csv", 455)); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("Ready"));
    const table = () => tree.root.findByType(TableView);
    assert.equal(tree.root.findAllByProps({ "aria-label": "Next rows" }).length, 0);
    assert.equal(tree.root.findAllByProps({ "aria-label": "Previous rows" }).length, 0);
    await press("Select row 1");
    await act(async () => { table().props.onEndReached(); table().props.onEndReached(); });
    await wait(() => table().props.rows.length === 250);
    assert.deepEqual(table().props.rows.slice(49, 52).map((row: string[]) => row[0]), ["49", "50", "51"]);
    assert.deepEqual(table().props.presentation.selected, [0]);
    assert.equal(pageCalls().length, 1);
    await act(async () => { table().props.onEndReached(); });
    await wait(() => table().props.rows.length === 450);
    await act(async () => { table().props.onEndReached(); });
    await wait(() => table().props.rows.length === 455);
    await act(async () => { table().props.onEndReached(); });
    assert.equal(pageCalls().length, 3);
    assert.equal(table().props.rows.at(-1)[0], "454");
  });
});

test("cancelling an unfiltered sort restores source order and supersedes its page", async () => {
  await panelTest(async ({ tree, zone, file, holdSort, pageCalls, press, wait }) => {
    const source = await file("sort.csv", 120);
    await act(async () => { zone.drop(source); });
    await wait(() => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false);
    let release!: () => void;
    holdSort(new Promise<void>((resolve) => { release = resolve; }));
    await press("Sort column 1 id descending");
    await wait(() => tree.root.findAllByProps({ "aria-label": "Cancel sort" }).length > 0);
    await press("Cancel sort");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "0"));
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");
    assert.equal(pageCalls().at(-1)?.sort, undefined);
    await act(async () => { release(); });
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");
  });
});

test("filtered cursor pages append across gaps and query changes collapse expanded rows", async () => {
  await panelTest(async ({ tree, zone, write, press, wait }) => {
    await act(async () => { zone.drop(await write("gaps.csv", "id,value\n" + Array.from({ length: 640 }, (_, i) =>
      `${i},${i % 2 === 0 ? "keep" : "skip"}\n`).join(""))); });
    await wait(() => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false);
    const table = () => tree.root.findByType(TableView);
    const edge = () => tree.root.findByProps({ "aria-label": "Toggle row 1 expansion" });
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); });
    await press("Select row 1");
    await press("Filter");
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("keep"); });
    await wait(() => table().props.rows.length === 200);
    assert.equal(edge().props["aria-expanded"], false);
    assert.deepEqual(table().props.presentation.selected, []);
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); table().props.onEndReached(); });
    await wait(() => table().props.rows.length === 320);
    assert.equal(table().props.rows[200][0], "400");
    assert.equal(table().props.rows.at(-1)[0], "638");
    assert.equal(new Set(table().props.rows.map((row: string[]) => row[0])).size, 320);
    assert.equal(edge().props["aria-expanded"], true);
    await press("Sort column 1 id descending");
    await wait(() => table().props.rows[0]?.[0] === "638");
    assert.equal(edge().props["aria-expanded"], false);
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); });
    const beforeRefresh = table();
    await press("Refresh source");
    await wait(() => table() !== beforeRefresh && table().props.rows[0]?.[0] === "638");
    assert.equal(edge().props["aria-expanded"], false);
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); zone.drop(await write("replacement.csv", "id,value\nnew,source\n")); });
    await wait(() => table().props.rows[0]?.[0] === "new");
    assert.equal(edge().props["aria-expanded"], false);
  });
});

test("a pending append cannot mix into a new sort or filter", async () => {
  await panelTest(async ({ tree, zone, file, press, wait, holdPage }) => {
    await act(async () => { zone.drop(await file("stale.csv", 700)); });
    await wait(() => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false);
    const table = () => tree.root.findByType(TableView);
    for (const change of ["sort", "filter"]) {
      let release!: () => void;
      holdPage(new Promise<void>((resolve) => { release = resolve; }));
      await act(async () => { table().props.onEndReached(); });
      holdPage(Promise.resolve());
      if (change === "sort") await press("Sort column 1 id descending");
      else {
        await press("Filter");
        await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("stale.csv-69"); });
      }
      await wait(() => table().props.rows[0]?.[0] === "699");
      const expected = table().props.rows;
      await act(async () => { release(); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
      assert.deepEqual(table().props.rows, expected);
    }
  });
});

test("scrolling during preparation continues from the same rows when ready", async () => {
  await panelTest(async ({ tree, zone, file, wait }) => {
    await act(async () => { zone.drop(await file("preparing.csv", 300_000)); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("Preparing"));
    const table = () => tree.root.findByType(TableView);
    await act(async () => { table().props.onEndReached(); });
    await wait(() => table().props.rows.length === 250);
    assert.equal(table().props.rows[50][0], "50");
    await wait(() => JSON.stringify(tree.toJSON()).includes("Ready"));
    await act(async () => { table().props.onEndReached(); });
    await wait(() => table().props.rows.length === 450);
    assert.equal(table().props.rows[250][0], "250");
  });
});

test("preview scrolling does not wait for the first preparation status response", async () => {
  await panelTest(async ({ tree, zone, file, wait, holdStatus }) => {
    let release!: () => void;
    holdStatus(new Promise<void>((resolve) => { release = resolve; }));
    try {
      await act(async () => { zone.drop(await file("status.csv", 500)); });
      await wait(() => tree.root.findAllByType(TableView).length > 0);
      assert.equal(tree.root.findByProps({ "aria-label": "Filter" }).props.disabled, true);
      await act(async () => { tree.root.findByType(TableView).props.onEndReached(); });
      await wait(() => tree.root.findByType(TableView).props.rows.length === 250);
    } finally { await act(async () => { release(); }); }
    await wait(() => JSON.stringify(tree.toJSON()).includes("Ready"));
    assert.equal(tree.root.findByType(TableView).props.rows[50][0], "50");
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
    await wait(() => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false);
    await press("Hide secret");
    await press("Filter");
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("needle"); });
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "1"));
    await press("Sort column 2 visible descending");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "90"));
    await press("Select row 1");
    await press("Select row 2", { ctrlKey: true });
    await press("Copy selected rows");
    assert.equal(clipboard(), "90\tzeta\n70\tgamma");
    await press("Clear search");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "90"));
    assert.equal(tree.root.findByProps({ "aria-label": "Sort mode" }).props.value, "auto");
  });
});

test("replacement clears an old page load and header switch applies to the next drop", async () => {
  await panelTest(async ({ tree, zone, file, holdPage, press, wait }) => {
    const first = await file("first.csv", 120);
    const second = await file("second.csv", 120);
    await act(async () => { zone.drop(first); });
    await wait(() => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false);
    let release!: () => void;
    holdPage(new Promise<void>((resolve) => { release = resolve; }));
    await act(async () => { tree.root.findByType(TableView).props.onEndReached(); });
    assert.ok(JSON.stringify(tree.toJSON()).includes("Loading rows…"));
    await act(async () => { zone.drop(second); });
    await wait(() => tree.root.findByProps({ "aria-label": "Workspace file path" }).props.value.endsWith("second.csv"));
    await wait(() => tree.root.findAllByType(TableView).length > 0);
    await act(async () => { release(); });
    await wait(() => !JSON.stringify(tree.toJSON()).includes("Loading rows…"));
    await press("First record is header");
    await wait(() => tree.root.findByProps({ "aria-label": "First record is header" }).props["aria-pressed"] === false);
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
    await wait(() => tree.root.findByProps({ "aria-label": "Workspace file path" }).props.value.endsWith("new.csv"));
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
    await wait(() => JSON.stringify(tree.toJSON()).includes("Ready"));
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
    await wait(() => JSON.stringify(tree.toJSON()).includes("Ready"));
    await writeFile(first, "id,value\n" + "0,changed\n".repeat(30_000));
    await wait(() => JSON.stringify(tree.toJSON()).includes("Source file changed"));
    await act(async () => {
      tree.root.findByProps({ "aria-label": "Refresh source" }).props.onClick();
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
    await wait(() => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false);
    await press("Hide secret");
    await press("Filter");
    let release!: () => void;
    holdSearch(new Promise<void>((resolve) => { release = resolve; }));
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("CAFÉ [x]%_"); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("Filtering…"));
    await press("Clear search");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "0"));
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
    await wait(() => tree.root.findAllByProps({ "aria-label": "Cancel search" }).length > 0);
    await press("Cancel search");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "0"));
    await act(async () => { releaseCancel(); });
    assert.equal(cell(tree, "id").findByType("div").children[0], "0");

    let releaseReplace!: () => void;
    holdSearch(new Promise<void>((resolve) => { releaseReplace = resolve; }));
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("café"); });
    await wait(() => tree.root.findAllByProps({ "aria-label": "Cancel search" }).length > 0);
    const replacement = await makeFile("replacement.csv", 2);
    await act(async () => { zone.drop(replacement); });
    await wait(() => tree.root.findByProps({ "aria-label": "Workspace file path" }).props.value.endsWith("replacement.csv"));
    await act(async () => { releaseReplace(); });
    assert.equal(cell(tree, "value").findByType("div").children[0], "replacement.csv-0");
  });
});


test("the path bar opens on Enter, restores edits and keeps the current table after an error", async () => {
  await panelTest(async ({ tree, file, wait, press }) => {
    const path = () => tree.root.findByProps({ "aria-label": "Workspace file path" });
    assert.equal(path().props.placeholder, "Type a path or drop a file");
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: "Open workspace file" }).length, 0);
    await file("current.csv", 3);
    await act(async () => { path().props.onChange({ currentTarget: { value: "current.csv" } }); });
    await act(async () => { path().props.onKeyDown({ key: "Enter", preventDefault() {} }); });
    await wait(() => cells(tree, "value").length > 0);
    assert.equal(path().props.value, "current.csv");
    await act(async () => { path().props.onChange({ currentTarget: { value: "abandoned.csv" } }); });
    await act(async () => { path().props.onKeyDown({ key: "Escape", preventDefault() {} }); });
    assert.equal(path().props.value, "current.csv");
    await act(async () => { path().props.onChange({ currentTarget: { value: "blurred.csv" } }); });
    await act(async () => { path().props.onBlur(); });
    assert.equal(path().props.value, "current.csv");
    await act(async () => { path().props.onChange({ currentTarget: { value: "missing.csv" } }); });
    await act(async () => { path().props.onKeyDown({ key: "Enter", preventDefault() {} }); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("ENOENT"));
    assert.equal(cell(tree, "value").findByType("div").children[0], "current.csv-0");
    await press("Refresh source");
    await wait(() => !JSON.stringify(tree.toJSON()).includes("ENOENT"));
    assert.equal(cell(tree, "value").findByType("div").children[0], "current.csv-0");
  });
});

test("the shell owns compact controls, counts, sort mode, hidden columns and short-lived copy toasts", async () => {
  await panelTest(async ({ tree, zone, write, press, clipboard, wait }) => {
    const control = (label: string) => tree.root.findByProps({ "aria-label": label });
    assert.equal(control("Reveal hidden columns").props.disabled, true);
    assert.equal(control("Sort mode").props.disabled, true);
    assert.equal(control("Copy selected rows").props.disabled, true);
    assert.ok(control("Choose local CSV or TSV").props.title);
    const source = await write("shell.csv", "id,value\n2," + "x".repeat(1190) + "\n1,small\n");
    await act(async () => { zone.drop(source); });
    await wait(() => !control("Filter").props.disabled);
    assert.equal(JSON.stringify(tree.toJSON()).includes("CSV Viewer"), false);
    await press("Hide value");
    assert.equal(control("Reveal hidden columns").props.disabled, false);
    assert.equal(control("Reveal hidden columns").findAllByType("span").at(-1)?.children[0], "1");
    await press("Select row 1");
    await press("Copy selected rows");
    assert.equal(clipboard(), "2");
    assert.equal(tree.root.findByProps({ "aria-label": "Toast" }).children[0], "Copied 1 row");
    const status = tree.root.findByProps({ "aria-label": "Source status" }).findAllByType("span").map((node) => node.children.join("")).join(" ");
    assert.ok(status.includes("2 rows"));
    assert.ok(status.includes("1 selected"));
    assert.ok(status.includes("1.2 kB"));
    assert.ok(status.includes("Ready"));
    await wait(() => tree.root.findAllByProps({ "aria-label": "Toast" }).length === 0);
    await press("Reveal hidden columns");
    assert.equal(control("Reveal hidden columns").props.disabled, true);
    await press("Sort column 1 id ascending");
    await wait(() => control("Sort mode").props.title.includes("Numeric"));
    assert.equal(control("Sort mode").props.disabled, false);
    await act(async () => { control("Sort mode").props.onChange({ currentTarget: { value: "text" } }); });
    await wait(() => control("Sort mode").props.value === "text" && !control("Sort mode").props.disabled);
  });
});


test("whole-panel file drops show an overlay without flickering over children or accepting text drags", async () => {
  await panelTest(async ({ tree, zone, file, wait }) => {
    const overlay = () => JSON.stringify(tree.toJSON()).includes("Drop to open");
    await act(async () => { zone.drag("dragenter", ["text/plain"]); });
    assert.equal(overlay(), false);
    await act(async () => { zone.drag("dragenter"); zone.drag("dragenter"); zone.drag("dragleave"); });
    assert.equal(overlay(), true);
    await act(async () => { zone.drag("dragleave"); });
    assert.equal(overlay(), false);
    await act(async () => { zone.drag("dragenter", ["application/x-paseo-workspace-file+json"]); });
    assert.equal(overlay(), true);
    await act(async () => { zone.drag("dragend"); });
    assert.equal(overlay(), false);
    const first = await file("first.csv", 2);
    const next = await file("next.csv", 2);
    await act(async () => { zone.drag("dragenter"); zone.drop(first); });
    assert.equal(overlay(), false);
    await wait(() => cells(tree, "value").length > 0);
    await act(async () => { zone.drag("dragenter"); zone.drop(next); });
    await wait(() => cell(tree, "value").findByType("div").children[0] === "next.csv-0");
    assert.equal(overlay(), false);
  });
});

test("Refresh preserves sort, filter, hidden columns and widths; header and source changes reset them", async () => {
  await panelTest(async ({ tree, zone, write, press, wait, pageCalls }) => {
    const path = await write("preserve.csv", "id,value,secret\n2,keep,b\n1,keep,a\n3,skip,c\n");
    const ready = () => tree.root.findByProps({ "aria-label": "Filter" }).props.disabled === false;
    await act(async () => { zone.drop(path); });
    await wait(ready);
    assert.equal(tree.root.findByProps({ "aria-label": "Workspace file path" }).props.value, "preserve.csv");
    await press("Hide secret");
    await press("Widen value");
    await press("Filter");
    await act(async () => { tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.onChangeText("keep"); });
    await wait(() => JSON.stringify(tree.toJSON()).includes("2 of 3 rows"));
    await press("Sort column 1 id ascending");
    await wait(() => cells(tree, "id").some((node) => node.findByType("div").children[0] === "1"));
    await press("Select row 1");
    const calls = pageCalls().length;
    await press("Refresh source");
    await wait(() => pageCalls().length > calls && ready() && cells(tree, "id").some((node) => node.findByType("div").children[0] === "1"));
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Search all columns" }).props.value, "keep");
    assert.equal(tree.root.findByProps({ "aria-label": "Sort mode" }).props.value, "auto");
    assert.equal(cells(tree, "secret").length, 0);
    assert.equal(cell(tree, "value").props.style.width, 200);
    assert.equal(tree.root.findByProps({ "aria-label": "Select row 1" }).props["aria-selected"], false);
    assert.ok(JSON.stringify(tree.toJSON()).includes("2 of 3 rows"));
    assert.equal((pageCalls().at(-1)?.sort as any).direction, "asc");
    await press("First record is header");
    await wait(() => cells(tree, "Column 1").length > 0);
    assert.equal(tree.root.findByProps({ "aria-label": "Sort mode" }).props.disabled, true);
    assert.equal(tree.root.findByProps({ "aria-label": "Reveal hidden columns" }).props.disabled, true);
    assert.equal(cell(tree, "Column 2").props.style.width, 160);
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: "Search all columns" }).length, 0);
    await press("Hide Column 3");
    await press("Widen Column 2");
    await act(async () => { zone.drop(await write("new-source.csv", "a,b,c\n1,2,3\n")); });
    await wait(() => tree.root.findByProps({ "aria-label": "Workspace file path" }).props.value === "new-source.csv");
    assert.equal(cell(tree, "Column 2").props.style.width, 160);
    assert.equal(tree.root.findByProps({ "aria-label": "Reveal hidden columns" }).props.disabled, true);
  });
});

test("shell copies raw selected visible cells as TSV, and reports clipboard errors", async () => {
  await panelTest(async ({ tree, zone, write, press, clipboard, wait }) => {
    const path = await write("copy.tsv", 'id\thidden\tnote\tempty\n001\tsecret\t"猫\t""quoted""\r\nnext"\t\n002\tmask\tplain\t\n');
    await act(async () => { zone.drop(path); });
    await wait(() => cells(tree, "note").length > 0);
    await press("Hide hidden");
    await press("Select row 2");
    await press("Select row 1", { ctrlKey: true });
    await press("Copy selected rows");
    assert.equal(clipboard(), '001\t"猫\t""quoted""\r\nnext"\t\n002\tplain\t');
    assert.equal(tree.root.findByProps({ "aria-label": "Toast" }).children[0], "Copied 2 rows");
    await press("Copy cell row 2, empty, empty cell");
    assert.equal(clipboard(), "");
    assert.equal(tree.root.findByProps({ "aria-label": "Toast" }).children[0], "Copied cell");
    navigator.clipboard.writeText = async () => { throw new Error("denied"); };
    await press("Copy selected rows");
    assert.ok(String(tree.root.findByProps({ "aria-label": "Toast" }).children[0]).includes("Clipboard unavailable"));
  });
});

test("the path bar keeps an outside source absolute and working after a rejected path", async () => {
  const outside = await mkdtemp(join(tmpdir(), "csv-viewer-outside-"));
  try {
    const source = join(outside, "external.csv");
    await writeFile(source, "id,value\n1,outside\n");
    await panelTest(async ({ tree, zone, press, wait }) => {
      const input = () => tree.root.findByProps({ "aria-label": "Workspace file path" });
      await act(async () => { zone.drop(source); });
      await wait(() => cells(tree, "value").length > 0);
      assert.equal(input().props.value, source);
      await act(async () => { input().props.onChange({ currentTarget: { value: source + ".missing" } }); });
      await act(async () => { input().props.onKeyDown({ key: "Enter", preventDefault() {} }); });
      await wait(() => tree.root.findAllByProps({ role: "alert" }).length > 0);
      await press("Select row 1");
      await press("Copy selected rows");
      assert.equal(tree.root.findByProps({ "aria-label": "Toast" }).children[0], "Copied 1 row");
      await act(async () => { input().props.onBlur(); });
      assert.equal(input().props.value, source);
    });
  } finally { await rm(outside, { recursive: true, force: true }); }
});
