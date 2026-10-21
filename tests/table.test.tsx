import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, create } from "react-test-renderer";
import { createSessions } from "../server/session";
import { useState, type ComponentProps } from "react";
import { TableView, type TablePresentation } from "../client/table";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const rendererNode = {
  addEventListener() {}, removeEventListener() {}, contains: () => false, closest: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480 }),
  querySelector: () => null, focus() {}, isConnected: false,
  ownerDocument: { addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } },
};
const rendererOptions = { createNodeMock: () => ({ ...rendererNode }) };

test("a cell copies its raw value only on double-click or keyboard activation", async () => {
  const copied: unknown[] = [];
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<TableView columns={["note"]} rows={[["猫\t\"quoted\"\r\nnext"], [""]]}
    presentation={{ hidden: [], widths: {}, selected: [] }} onPresentation={() => {}}
    onCopy={(...args) => { copied.push(args); }} theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
  try {
    const cell = (row: number) => tree.root.findByProps({ "aria-label": `Copy cell row ${row}, note, ${row === 1 ? 'value: 猫\t"quoted"\r\nnext' : "empty cell"}` });
    assert.equal(cell(1).props.onPress, undefined);
    await act(async () => { cell(1).props.onClick?.({ detail: 1 }); });
    assert.deepEqual(copied, []);
    await act(async () => { cell(1).props.onDoubleClick({ stopPropagation() {} }); });
    assert.deepEqual(copied, [['猫\t"quoted"\r\nnext', "Copied cell"]]);
    await act(async () => { cell(2).props.onKeyDown({ key: "Enter", preventDefault() {}, stopPropagation() {} }); });
    assert.deepEqual(copied.at(-1), ["", "Copied cell"]);
  } finally { await act(async () => { tree.unmount(); }); }
});

function ControlledTable(props: Omit<ComponentProps<typeof TableView>, "presentation" | "onPresentation" | "onCopy">) {
  const [presentation, onPresentation] = useState<TablePresentation>({ hidden: [], widths: {}, selected: [] });
  return <TableView {...props} presentation={presentation} onPresentation={onPresentation} onCopy={(value) => { void navigator.clipboard.writeText(value); }} />;
}

test("the table copies raw cells and exposes selection and column presentation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csv-viewer-table-"));
  const copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value: string) => { copied.push(value); } } } });
  const sessions = createSessions();
  try {
    const file = join(dir, "copy.tsv");
    await writeFile(file, 'id\thidden\tnote\tempty\n001\tsecret\t"猫\t""quoted""\r\nnext"\t\n002\tmask\tplain\t\n');
    const preview = await sessions.open({ panelId: "4b0d0a3e-8d54-4d88-92de-018e87a33fe4", workspaceId: "workspace", source: { kind: "local", path: file } });
    assert.deepEqual(preview.columns, ["id", "hidden", "note", "empty"]);
    assert.equal(preview.rows.length, 2);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ControlledTable columns={preview.columns} rows={preview.rows.toReversed()} theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
    const press = async (label: string) => {
      if (label.startsWith("Hide ")) await act(async () => {
        tree.root.findByProps({ "aria-label": `Column menu ${label.slice(5)}` }).props.onClick({ currentTarget: rendererNode, stopPropagation() {} });
      });
      const node = tree.root.findAll((node) => node.props["aria-label"] === label || node.props.accessibilityLabel === label)[0];
      await act(async () => { (node.props.onDoubleClick ?? node.props.onClick ?? node.props.onPress)({ stopPropagation() {} }); });
    };
    assert.ok(tree.root.findByProps({ "aria-label": "Copy cell row 2, id, value: 001" }));
    assert.ok(tree.root.findByProps({ "aria-label": 'Copy cell row 2, note, value: 猫\t"quoted"\r\nnext' }));
    assert.ok(tree.root.findByProps({ "aria-label": "Copy cell row 2, empty, empty cell" }));
    assert.equal(tree.root.findByProps({ "aria-label": "Copy cell row 2, id, value: 001" }).props.style.width, 160);
    await act(async () => { tree.root.findByProps({ "aria-label": "Resize id" }).props.onKeyDown({ key: "ArrowRight", preventDefault() {}, stopPropagation() {} }); });
    assert.equal(tree.root.findByProps({ "aria-label": "Copy cell row 2, id, value: 001" }).props.style.width, 170);
    await press('Copy cell row 2, note, value: 猫\t"quoted"\r\nnext');
    assert.equal(copied.at(-1), '猫\t"quoted"\r\nnext');
    await press("Copy cell row 2, empty, empty cell");
    assert.equal(copied.at(-1), "");
    await press("Hide hidden");
    assert.equal(tree.root.findAllByProps({ "aria-label": "Copy cell row 2, hidden, value: secret" }).length, 0);
    await press("Select row 2");
    await press("Select row 1");
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Select row 1" }).props.accessibilityState.checked, true);
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Select row 2" }).props.accessibilityState.checked, true);
    await press("Copy cell row 2, id, value: 001");
    assert.equal(copied.at(-1), "001");
    await act(async () => { tree.unmount(); });
  } finally {
    await sessions.dispose();
    await rm(dir, { recursive: true, force: true });
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("long column names keep visible controls compact and full accessible labels", async () => {
  const name = `payload${"_".repeat(93)}`;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ControlledTable columns={[name]} rows={[["value"]]}
    sort={{ column: 0, direction: "desc", mode: "auto" }} onSort={() => {}}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
  try {
    const header = () => tree.root.findByProps({ role: "columnheader", "aria-label": name });
    assert.equal(header().props.title, name);
    assert.equal(header().props.style.whiteSpace, "nowrap");
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: `Narrow ${name}` }).length, 0);
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: `Widen ${name}` }).length, 0);
    await act(async () => { tree.root.findByProps({ "aria-label": `Column menu ${name}` }).props.onClick({ currentTarget: rendererNode, stopPropagation() {} }); });
    await act(async () => { tree.root.findByProps({ "aria-label": `Hide ${name}` }).props.onClick({ stopPropagation() {} }); });
    assert.equal(tree.root.findAllByProps({ role: "columnheader", "aria-label": name }).length, 0);
  } finally {
    await act(async () => { tree.unmount(); });
  }
});

test("the table windows loaded rows and independently expands multiline values at the row edge", async () => {
  const rows = Array.from({ length: 30_000 }, (_, index) => [`${index}: first\nsecond`]);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ControlledTable columns={["note"]} rows={rows}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
  try {
    const mountedCells = () => tree.root.findAll((node) => node.props.title?.endsWith?.("first\nsecond"));
    assert.ok(mountedCells().length > 0 && mountedCells().length < 100);
    const edge = (row: number) => tree.root.findByProps({ "aria-label": `Toggle row ${row} expansion` });
    const expand = async (row: number) => { await act(async () => { edge(row).props.onDoubleClick({ stopPropagation() {} }); }); };
    assert.equal(edge(1).props["aria-expanded"], false);
    assert.equal(mountedCells()[0].props.style.whiteSpace, "nowrap");
    assert.equal(mountedCells()[0].props.style.textOverflow, "ellipsis");
    await expand(1);
    await expand(2);
    assert.equal(edge(1).props["aria-expanded"], true);
    assert.equal(edge(2).props["aria-expanded"], true);
    assert.equal(mountedCells()[0].props.style.whiteSpace, "pre-wrap");
    await expand(1);
    assert.equal(edge(1).props["aria-expanded"], false);
    assert.equal(edge(2).props["aria-expanded"], true);
  } finally { await act(async () => { tree.unmount(); }); }
});


test("column edges drag with a 40 px minimum, keep manual widths above 600 and release capture", async () => {
  const captured = new Set<number>();
  const handle = { setPointerCapture: (id: number) => captured.add(id), hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: (id: number) => captured.delete(id) };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ControlledTable columns={["id"]} rows={[["001"]]}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
  try {
    const edge = () => tree.root.findByProps({ "aria-label": "Resize id" });
    const event = (x: number, id = 1) => ({ button: 0, pointerId: id, clientX: x, currentTarget: handle, preventDefault() {}, stopPropagation() {} });
    assert.equal(edge().props.tabIndex, 0);
    assert.equal(edge().props["aria-valuemin"], 40);
    await act(async () => { edge().props.onPointerDown(event(100)); });
    assert.ok(captured.has(1));
    await act(async () => { edge().props.onPointerMove(event(-200)); });
    assert.equal(edge().props["aria-valuenow"], 40);
    await act(async () => { edge().props.onPointerMove(event(800, 2)); });
    assert.equal(edge().props["aria-valuenow"], 40);
    await act(async () => { edge().props.onPointerMove(event(800)); });
    assert.equal(edge().props["aria-valuenow"], 860);
    await act(async () => { edge().props.onPointerCancel(event(800)); });
    assert.equal(captured.size, 0);
    await act(async () => { edge().props.onPointerMove(event(1000)); });
    assert.equal(edge().props["aria-valuenow"], 860);
    await act(async () => { edge().props.onKeyDown({ key: "ArrowLeft", preventDefault() {}, stopPropagation() {} }); });
    assert.equal(edge().props["aria-valuenow"], 850);
    await act(async () => { edge().props.onPointerDown(event(100)); edge().props.onLostPointerCapture(event(100)); });
    await act(async () => { edge().props.onPointerMove(event(200)); });
    assert.equal(edge().props["aria-valuenow"], 850);
    await act(async () => { edge().props.onPointerDown(event(100)); tree.unmount(); });
    assert.equal(captured.size, 0);
  } finally { await act(async () => { tree.unmount(); }); }
});


test("double-click fit measures loaded cells outside the render window, multiline values and the header", async () => {
  const context = { font: "", measureText: (text: string) => ({ width: text.length * 10 }) };
  const options = { createNodeMock: () => ({
    addEventListener() {}, removeEventListener() {},
    ownerDocument: { createElement: () => ({ getContext: () => context }),
      defaultView: { getComputedStyle: () => ({ fontSize: "14px", fontFamily: "system-ui", fontWeight: "700" }) } },
  }) };
  const rows = Array.from({ length: 300 }, () => ["x"]);
  rows[299] = ["abcdefghij\nklmnopqrst"];
  let tree!: ReturnType<typeof create>;
  const render = (name: string, values = rows) => <ControlledTable columns={[name]} rows={values}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />;
  await act(async () => { tree = create(render("id"), options); });
  try {
    const edge = (name = "id") => tree.root.findByProps({ "aria-label": `Resize ${name}` });
    assert.equal(tree.root.findAllByProps({ title: rows[299][0] }).length, 0);
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); });
    assert.equal(edge().props["aria-valuenow"], 112);
    await act(async () => { tree.update(render("id", [["a\tb"]])); });
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); });
    assert.equal(edge().props["aria-valuenow"], 102);
    await act(async () => { tree.update(render("id", [["x".repeat(100)]])); });
    await act(async () => { edge().props.onDoubleClick({ stopPropagation() {} }); });
    assert.equal(edge().props["aria-valuenow"], 600);
    await act(async () => { tree.update(render("long header", [])); });
    await act(async () => { edge("long header").props.onKeyDown({ key: "Enter", preventDefault() {}, stopPropagation() {} }); });
    assert.equal(edge("long header").props["aria-valuenow"], 158);
  } finally { await act(async () => { tree.unmount(); }); }
});


test("headers expose a labelled menu with sort, clear, hide, checks and keyboard dismissal", async () => {
  const changes: unknown[] = [];
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ControlledTable columns={["id"]} rows={[["001"]]}
    sort={{ column: 0, direction: "desc", mode: "auto" }} onSort={(...args) => { changes.push(args); }}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
  try {
    const trigger = () => tree.root.findByProps({ "aria-label": "Column menu id" });
    assert.equal(trigger().props["aria-haspopup"], "menu");
    assert.equal(trigger().children[0], "⋮");
    assert.equal(tree.root.findByProps({ role: "columnheader" }).props.onClick, undefined);
    assert.equal(tree.root.findByProps({ role: "columnheader" }).props["aria-sort"], "descending");
    assert.equal(tree.root.findAllByProps({ "aria-label": "Hide id" }).length, 0);
    const open = async () => { await act(async () => { trigger().props.onClick({ currentTarget: rendererNode, stopPropagation() {} }); }); };
    await open();
    assert.equal(trigger().props["aria-expanded"], true);
    assert.equal(tree.root.findByProps({ "aria-label": "Sort column 1 id descending" }).props["aria-checked"], true);
    assert.ok(JSON.stringify(tree.toJSON()).includes("✓"));
    assert.equal(tree.root.findAllByProps({ role: "separator" }).length, 2);
    await act(async () => { tree.root.findByProps({ "aria-label": "Sort column 1 id ascending" }).props.onClick({ stopPropagation() {} }); });
    assert.deepEqual(changes, [[0, "asc"]]);
    assert.equal(trigger().props["aria-expanded"], false);
    await open();
    await act(async () => { tree.root.findByProps({ "aria-label": "Clear sort" }).props.onClick({ stopPropagation() {} }); });
    assert.deepEqual(changes.at(-1), [0, null]);
    await open();
    await act(async () => { tree.root.findByProps({ role: "menu" }).props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }); });
    assert.equal(trigger().props["aria-expanded"], false);
    await open();
    await act(async () => { tree.root.findByProps({ "aria-label": "Hide id" }).props.onClick({ stopPropagation() {} }); });
    assert.equal(tree.root.findAllByProps({ role: "columnheader" }).length, 0);
  } finally { await act(async () => { tree.unmount(); }); }
});

test("the column menu stays inside a compact panel, moves focus and dismisses cleanly", async () => {
  const listeners = new Map<string, (event?: any) => void>();
  const doc = { activeElement: null as unknown, addEventListener: (name: string, fn: any) => listeners.set(`document:${name}`, fn),
    removeEventListener: (name: string) => listeners.delete(`document:${name}`), defaultView: {
      addEventListener: (name: string, fn: any) => listeners.set(`window:${name}`, fn),
      removeEventListener: (name: string) => listeners.delete(`window:${name}`),
    } };
  const buttons = Array.from({ length: 4 }, () => ({ focus() { doc.activeElement = this; } }));
  const inside = {};
  const anchor = { ...rendererNode, isConnected: true, focus() { doc.activeElement = this; },
    getBoundingClientRect: () => ({ left: 160, right: 220, top: 20, bottom: 60 }) };
  const options = { createNodeMock: (element: { props: any }) => ({ ...rendererNode, ownerDocument: doc,
    getBoundingClientRect: () => ({ left: 10, right: 190, top: 20, bottom: 110, width: 180,
      height: element.props.role === "menu" ? Math.min(156, element.props.style.maxHeight ?? Infinity) : 90 }),
    addEventListener: (name: string, fn: any) => { listeners.set(`root:${name}`, fn); },
    removeEventListener: (name: string) => { listeners.delete(`root:${name}`); },
    querySelector: () => buttons[0], querySelectorAll: () => buttons, contains: (target: unknown) => target === inside,
  }) };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ControlledTable columns={["id"]} rows={[["001"]]} onSort={() => {}}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, options); });
  try {
    const open = async () => { await act(async () => {
      tree.root.findByProps({ "aria-label": "Column menu id" }).props.onClick({ currentTarget: anchor, stopPropagation() {} });
    }); };
    const menu = () => tree.root.findByProps({ role: "menu" });
    await open();
    assert.equal(menu().props.style.left, 0);
    assert.equal(menu().props.style.top, 0);
    assert.equal(menu().props.style.width, 180);
    assert.equal(menu().props.style.maxHeight, 90);
    assert.equal(doc.activeElement, buttons[0]);
    const target = { querySelectorAll: () => buttons, ownerDocument: doc };
    for (const [key, expected] of [["ArrowUp", 3], ["Home", 0], ["End", 3], ["ArrowDown", 0]] as const) {
      await act(async () => { menu().props.onKeyDown({ key, currentTarget: target, preventDefault() {}, stopPropagation() {} }); });
      assert.equal(doc.activeElement, buttons[expected]);
    }
    await act(async () => { listeners.get("root:scroll")?.({ target: inside }); });
    assert.equal(tree.root.findAllByProps({ role: "menu" }).length, 1);
    await act(async () => { listeners.get("root:scroll")?.({ target: {} }); });
    assert.equal(tree.root.findAllByProps({ role: "menu" }).length, 0);
    await open();
    await act(async () => { listeners.get("document:pointerdown")?.({ target: {} }); });
    assert.equal(tree.root.findAllByProps({ role: "menu" }).length, 0);
    await open();
    await act(async () => { menu().props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }); });
    assert.equal(doc.activeElement, anchor);
    assert.equal(listeners.has("document:pointerdown"), false);
    assert.equal(listeners.has("window:resize"), false);
  } finally { await act(async () => { tree.unmount(); }); }
});

test("preparation disables sort menu actions while hide, resize and cell copy stay available", async () => {
  const copied: string[] = [];
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<TableView columns={["id"]} rows={[["001"]]} sortBusy onSort={() => {}}
    presentation={{ hidden: [], widths: {}, selected: [] }} onPresentation={() => {}} onCopy={(value) => { copied.push(value); }}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />, rendererOptions); });
  try {
    await act(async () => { tree.root.findByProps({ "aria-label": "Column menu id" }).props.onClick({ currentTarget: rendererNode, stopPropagation() {} }); });
    for (const label of ["Sort column 1 id ascending", "Sort column 1 id descending", "Clear sort"]) {
      assert.equal(tree.root.findByProps({ "aria-label": label }).props.disabled, true);
    }
    assert.equal(tree.root.findByProps({ "aria-label": "Hide id" }).props.disabled, false);
    assert.equal(tree.root.findByProps({ "aria-label": "Resize id" }).props.tabIndex, 0);
    await act(async () => { tree.root.findByProps({ "aria-label": "Copy cell row 1, id, value: 001" }).props.onDoubleClick({ stopPropagation() {} }); });
    assert.deepEqual(copied, ["001"]);
  } finally { await act(async () => { tree.unmount(); }); }
});
