import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createSessions } from "../../server/session";

const source = "/home/cua/ticket-10/storage-source.csv";
const original = "id,payload\n" + Array.from({ length: 100_000 }, (_, i) =>
  `${i},${createHash("sha256").update(String(i)).digest("hex")}\n`).join("");
await writeFile(source, original);
const hash = createHash("sha256").update(original).digest("hex");
const sessions = createSessions();
let error = "";
try {
  try {
    const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: "ticket-10", source: { kind: "local", path: source } });
    for (let i = 0; i < 200; i++) {
      const status = sessions.status(opened.sessionId);
      if (status.phase === "error") { error = status.message; break; }
      if (status.phase === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (cause) { error = String(cause); }
  assert.match(error, /temporary disk|space left|storage failed|Disk is full|write failed|I.O Error/i);
  assert.equal(createHash("sha256").update(await readFile(source)).digest("hex"), hash);
  console.log(JSON.stringify({ result: "storage error reported", error, sourceHash: hash }));
} finally {
  await sessions.dispose();
}
