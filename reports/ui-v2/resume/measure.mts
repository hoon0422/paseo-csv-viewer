import { strict as assert } from 'node:assert';
import { stat, statfs, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createSessions } from '/home/cua/ui-v2-artifact/package/server/session';

// Exact extracted package code/native runtime; source checkout supplies tsx/SDK.
const path = process.argv[2];
assert.ok(path);
const sessions = createSessions();
const start = performance.now();
const record = (event: string, data: object = {}) => console.log(JSON.stringify({event,utc:new Date().toISOString(),elapsedMs:performance.now()-start,...data}));
let monitor: ReturnType<typeof setInterval>;
let cancelledForDisk = false;
try {
  const bytes = (await stat(path)).size;
  const disk = await statfs('/tmp');
  const free = disk.bavail * disk.bsize;
  assert.ok(free > (bytes >= 5e9 ? 5e9 : 1e9), 'Not enough temporary space; do not run');
  record('start',{path,bytes,tempDirectory:'/tmp',freeBytes:free,memoryLimit:'4GB',sourceCommit:'284d9d9f5a4875e2310a4ec3208d3b731b490695'});
  monitor = setInterval(async () => {
    const disk = await statfs('/tmp');
    record('resource',{freeBytes:disk.bavail*disk.bsize,rss:process.memoryUsage().rss});
    if(disk.bavail*disk.bsize<750e6 && !cancelledForDisk){cancelledForDisk=true;record('disk-stop');await sessions.dispose();}
  },1000);
  const preview = await sessions.open({panelId:crypto.randomUUID(),workspaceId:'ui-v2',source:{kind:'local',path}});
  assert.equal(preview.rows.length,50);
  record('preview',{rows:preview.rows.length});
  let previous = '';
  for (;;) {
    const status = sessions.status(preview.sessionId);
    if(status.phase!==previous){record('phase',status);previous=status.phase;}
    if(status.phase==='error')throw Error(status.message);
    if(status.phase==='complete')break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  record('loaded',sessions.status(preview.sessionId));
  let requestId=0;
  for(const sort of [
    {column:0,direction:'asc' as const,mode:'auto' as const},
    {column:1,direction:'desc' as const,mode:'text' as const},
    {column:0,direction:'asc' as const,mode:'numeric' as const},
  ]) {
    const began=performance.now();
    const first=await sessions.page(preview.sessionId,0,200,{sort,requestId:++requestId});
    assert.equal(first.rows.length,200);assert.equal(first.totalRows,bytes/100-1);
    if(sort.column===0)assert.equal(first.rows[0][0],'00000000');
    if(bytes===5e9 && sort.mode==='text')assert.deepEqual(first.rows.slice(0,5).map(row=>row[1].split('.')[0]),['query-tail-echo','query-tail-delta','query-tail-charlie','query-tail-bravo','query-tail-alpha']);
    record('first-sorted-page',{sort,durationMs:performance.now()-began,totalRows:first.totalRows,sortMode:first.sortMode,first:first.rows[0]});
    let cursor=first.nextPosition!;
    for(let page=1;page<=5;page++) {
      const began=performance.now();
      const next=await sessions.page(preview.sessionId,page*200,200,{sort,requestId:++requestId,afterPosition:cursor});
      assert.equal(next.rows.length,200);assert.ok(next.nextPosition!>cursor);cursor=next.nextPosition!;
      record('retained-order-page',{mode:sort.mode,page,durationMs:performance.now()-began});
    }
  }
} finally {
  clearInterval(monitor!);await sessions.dispose();
  record('cleanup',{remainingSessionDirectories:(await readdir('/tmp')).filter(name=>name.startsWith('csv-viewer-session-'))});
}
