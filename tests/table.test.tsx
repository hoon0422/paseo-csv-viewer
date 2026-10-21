import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, create } from "react-test-renderer";
import { createSessions } from "../server/session";
import { TableView } from "../client/table";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("the viewer copies raw cells and selected visible columns in current row order", async () => {
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
    await act(async () => { tree = create(<TableView columns={preview.columns} rows={preview.rows.toReversed()} theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />); });
    const press = async (label: string) => {
      await act(async () => { await tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
    };
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Copy cell row 2, id" }).props.style.width, 160);
    await press("Widen id");
    assert.equal(tree.root.findByProps({ accessibilityLabel: "Copy cell row 2, id" }).props.style.width, 200);
    await press("Copy cell row 2, note");
    assert.equal(copied.at(-1), '猫\t"quoted"\r\nnext');
    await press("Hide hidden");
    assert.equal(tree.root.findAllByProps({ accessibilityLabel: "Copy cell row 2, hidden" }).length, 0);
    await press("Select row 2");
    await press("Select row 1");
    await press("Copy selected rows");
    assert.equal(copied.at(-1), '002\tplain\t\n001\t"猫\t""quoted""\r\nnext"\t');
    await press("Reveal hidden");
    assert.ok(tree.root.findAllByProps({ accessibilityLabel: "Copy cell row 2, hidden" }).length > 0);
    await press("Copy cell row 2, id");
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
  await act(async () => { tree = create(<TableView columns={[name]} rows={[["value"]]}
    sort={{ column: 0, direction: "desc", mode: "auto" }} onSort={() => {}} onSortMode={() => {}}
    theme={{ foreground: "#fff", muted: "#aaa", border: "#777" }} />); });
  try {
    const caption = (label: string) => tree.root.findByProps({ accessibilityLabel: label }).findByType("div").children[0];
    assert.equal(caption(`Narrow ${name}`), "−");
    assert.equal(caption(`Widen ${name}`), "+");
    assert.equal(caption(`Hide ${name}`), "Hide");
    assert.equal(tree.root.findByProps({ accessibilityRole: "header", accessibilityLabel: name }).props.numberOfLines, 1);
    assert.equal(tree.root.findByProps({ accessibilityLabel: `Sort ${name} descending · mode:` }).props.numberOfLines, 1);
    await act(async () => { tree.root.findByProps({ accessibilityLabel: `Hide ${name}` }).props.onPress(); });
    assert.equal(caption(`Reveal ${name}`), "Reveal");
  } finally {
    await act(async () => { tree.unmount(); });
  }
});
