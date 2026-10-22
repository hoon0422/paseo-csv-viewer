import { strict as assert } from 'node:assert';
import { readdir, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createSessions } from '../../server/session';

const file = '/home/cua/ticket-5/fixtures/large.csv';
const sessions = createSessions();
const started = performance.now();
const sourceBytes = (await stat(file)).size;
let preview;
try {
  preview = await sessions.open({
    panelId: crypto.randomUUID(), workspaceId: 'large-fixture',
    source: { kind: 'local', path: file }, hasHeader: true,
  });
  const previewMs = performance.now() - started;
  assert.equal(preview.sourceBytes, 5_000_000_000);
  assert.equal(preview.rows.length, 50);
  assert.equal(preview.rows[0][0], '00000000');
  assert.equal(preview.rows[49][0], '00000049');
  let status = sessions.status(preview.sessionId);
  const phaseAtPreview = status.phase;
  const reports: object[] = [];
  let lastPhase = '';
  while (status.phase !== 'complete' && status.phase !== 'error') {
    if (status.phase !== lastPhase) {
      reports.push({ phase: status.phase, elapsedMs: performance.now() - started,
        bytesScanned: status.bytesScanned, percent: status.percent });
      lastPhase = status.phase;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = sessions.status(preview.sessionId);
  }
  assert.equal(status.phase, 'complete', status.message);
  assert.equal(status.rowCount, 49_999_999);
  const preparationMs = performance.now() - started;
  const page50Start = performance.now();
  const page50 = await sessions.page(preview.sessionId, 50, 50);
  const page50Ms = performance.now() - page50Start;
  assert.equal(page50.rows.length, 50);
  assert.equal(page50.rows[0][0], '00000050');
  const tailStart = performance.now();
  const tail = await sessions.page(preview.sessionId, 49_999_949, 50);
  const tailMs = performance.now() - tailStart;
  assert.equal(tail.rows.length, 50);
  assert.equal(tail.rows[0][0], '00009949');
  for (let i = 0; i < 5; i++) {
    assert.equal(tail.rows[45 + i][0], String(9994 + i).padStart(8, '0'));
    assert.ok(tail.rows[45 + i][1].startsWith(['query-tail-alpha', 'query-tail-bravo', 'query-tail-charlie', 'query-tail-delta', 'query-tail-echo'][i]));
  }
  const result = {
    sourceBytes, rowBytes: 100, headerBytes: 100, dataRows: status.rowCount,
    firstDataOrdinal: 0, lastDataOrdinal: 49_999_998,
    previewMs, phaseAtPreview, preparationMs,
    phases: reports, page50Ms, page50First: page50.rows[0], tailMs,
    tailFirstOrdinal: 49_999_949, tailFirst: tail.rows[0],
    tailLastFive: tail.rows.slice(-5), sourceBytesAfter: (await stat(file)).size,
  };
  console.log(JSON.stringify(result));
} finally {
  await sessions.dispose();
  const remaining = (await readdir('/tmp')).filter((name) => name.startsWith('csv-viewer-session-'));
  console.error(JSON.stringify({ remainingSessionDirs: remaining }));
}
