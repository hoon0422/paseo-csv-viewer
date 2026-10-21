import { strict as assert } from 'node:assert';
import { readdir, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createSessions } from '../../server/session';

const file = '/home/cua/ticket-5/fixtures/large.csv';
const sessions = createSessions();
const started = performance.now();
try {
  const opened = await sessions.open({ panelId: crypto.randomUUID(), workspaceId: 'large-fixture',
    source: { kind: 'local', path: file }, hasHeader: true });
  const previewMs = performance.now() - started;
  let status = sessions.status(opened.sessionId);
  while (status.phase === 'scanning' && status.bytesScanned < 128_000_000) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = sessions.status(opened.sessionId);
  }
  assert.equal(status.phase, 'scanning');
  assert.ok(status.bytesScanned < 5_000_000_000);
  const cancelStarted = performance.now();
  assert.equal(sessions.close(opened.sessionId), true);
  const closeMs = performance.now() - cancelStarted;
  await sessions.dispose();
  const stoppedMs = performance.now() - cancelStarted;
  const remaining = (await readdir('/tmp')).filter((name) => name.startsWith('csv-viewer-session-'));
  assert.deepEqual(remaining, []);
  assert.equal((await stat(file)).size, 5_000_000_000);
  console.log(JSON.stringify({ sourceBytes: 5_000_000_000, previewMs,
    phaseAtCancel: status.phase, bytesScannedAtCancel: status.bytesScanned,
    closeMs, stoppedMs, remainingSessionDirs: remaining, sourceBytesAfter: (await stat(file)).size }));
} finally { await sessions.dispose(); }
