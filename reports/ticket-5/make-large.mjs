import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
const path = "/home/cua/ticket-5/fixtures/large.csv";
const rowBytes = 100;
const rowsPerBlock = 10_000;
const blocks = 5_000;
const count = 49_999_999;
const payload = (value) => value.padEnd(90, ".");
const row = (id, value) => {
  const text = id.toString().padStart(8, "0") + "," + payload(value) + "\n";
  if (Buffer.byteLength(text) !== rowBytes) throw new Error("row size");
  return Buffer.from(text);
};
const header = Buffer.from("id," + "payload".padEnd(96, "_") + "\n");
if (header.length !== rowBytes) throw new Error("header size");
await mkdir(dirname(path), { recursive: true });
const file = await open(path, "w");
async function writeAll(buffer, length = buffer.length) {
  let offset = 0;
  while (offset < length) {
    const result = await file.write(buffer, offset, length - offset);
    offset += result.bytesWritten;
  }
}
const chunk = Buffer.alloc(rowBytes * rowsPerBlock);
for (let i = 0; i < rowsPerBlock; i++) row(i, "body-" + i.toString().padStart(4, "0")).copy(chunk, i * rowBytes);
const tails = ["query-tail-alpha", "query-tail-bravo", "query-tail-charlie", "query-tail-delta", "query-tail-echo"];
try {
  await writeAll(header);
  for (let block = 0; block < blocks; block++) {
    row(0, "block-" + block.toString().padStart(4, "0")).copy(chunk, 0);
    if (block === blocks - 1) {
      for (let j = 0; j < tails.length; j++) row(9994 + j, tails[j]).copy(chunk, (9994 + j) * rowBytes);
    }
    await writeAll(chunk, (block === blocks - 1 ? 9999 : rowsPerBlock) * rowBytes);
    if (block % 500 === 0) process.stdout.write(JSON.stringify({ block, bytesWritten: rowBytes * (1 + block * rowsPerBlock + rowsPerBlock) }) + "\n");
  }
} finally { await file.close(); }
const size = (await stat(path)).size;
if (size !== 5_000_000_000) throw new Error("unexpected size " + size);
process.stdout.write(JSON.stringify({ path, size, rowBytes, headerBytes: 100, dataRows: count, firstDataOrdinal: 0, lastDataOrdinal: count - 1, markerOrdinals: [0, 10_000, 49_990_000, 49_999_994, 49_999_998], tails }) + "\n");
