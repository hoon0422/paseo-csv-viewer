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

const rendererOptions = { createNodeMock: () => ({ addEventListener() {}, removeEventListener() {} }) };

function ControlledTable(props: Omit<ComponentProps<typeof TableView>, "presentation" | "onPresentation" | "onCopy">) {
  const [presentation, onPresentation] = useState<TablePresentation>({ hidden: [], widths: {}, selected: [] });
  return <TableView {...props} presentation={presentation} onPresentation={onPresentation} onCopy={(value) => { void navigator.clipboard.writeText(value); }} />;
}

test("the table copies raw cells and exposes column presentation", async () => {
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
      await act(async () => { await tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
    };
    assert.ok(tree.root.findByProps({ accessibilityLabel: "Copy cell row 2, id, value: 001" }));
    assert.ok(tree.root.findByProps({ accessibilityLabel: 'Copy cell row 2, note, value: 猫\t"quoted"\r\nnext' }));
    assert.ok(tree.root.findByProps({ accessibilityLabel: "Copy cell row 2, empty, empty cell" }));
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Copy cell row 2, id, value: 001" }).props.style.width, 160);
    await press("Widen id");
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Copy cell row 2, id, value: 001" }).props.style.width, 200);
    await press('Copy cell row 2, note, value: 猫\t"quoted"\r\nnext');
    assert.equal(copied.at(-1), '猫\t"quoted"\r\nnext');
    await press("Copy cell row 2, empty, empty cell");
    assert.equal(copied.at(-1), "");
    await press("Hide hidden");
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: "Copy cell row 2, hidden, value: secret" }).length, 0);
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
    const caption = (label: string) => tree.root.findByProps({ accessibilityLabel: label }).findByType("div").children[0];
    assert.equal(caption(`Narrow ${name}`), "−");
    assert.equal(caption(`Widen ${name}`), "+");
    assert.equal(caption(`Hide ${name}`), "Hide");
    assert.equal(tree.root.findByProps({ accessibilityRole: "header", accessibilityLabel: name }).props.numberOfLines, 1);
    await act(async () => { tree.root.findByProps({ accessibilityLabel: `Hide ${name}` }).props.onPress(); });
    assert.equal(tree.root.findAllByProps({ accessibilityRole: "header", accessibilityLabel: name }).length, 0);
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
