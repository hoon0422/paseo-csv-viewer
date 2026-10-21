"""Assert the captured failure evidence; does not turn a failed recheck into a pass."""
import hashlib, json, pathlib, subprocess, tarfile

root = pathlib.Path(__file__).parent
read = lambda name: json.loads((root/name).read_text())
proof = read('package-provenance.json')
artifact = root/'paseo-csv-viewer-0.1.0.tgz'
assert hashlib.sha256(artifact.read_bytes()).hexdigest() == proof['sha256']
with tarfile.open(artifact) as tar:
    contents = {m.name.removeprefix('package/'): tar.extractfile(m).read() for m in tar if m.isfile()}
assert {n: hashlib.sha256(d).hexdigest() for n,d in contents.items()} == proof['files']
assert all(subprocess.check_output(['git','show',proof['sourceCommit']+':'+n]) == d for n,d in contents.items())
assert read('evidence/installed-provenance.json')['files'] == proof['files']
assert read('evidence/install.json')['status'] == 'running'
assert read('evidence/install.exit') == 0
for name, path in [('04-small-failed.json','rows120.csv'), ('05-30050-failed.json','ui-v2-30050.csv')]:
    state = read('evidence/'+name)
    assert state['path'] == path and state['status'] == 'No source'
    assert 'child exited (1)' in state['alert'] and not state['rows']
for name in ['04-processes.json','05-processes.json','10-processes.json']:
    state = read('evidence/'+name)
    assert not state['ownedTemporaryRoots']
    assert len(state['processes']) == 2
    assert {p['pid'] for p in state['processes']} == {40131,41938}
    assert all(not p['duckdbMappings'] for p in state['processes'])
    assert all('/usr/local/bin' in p['environment']['PATH'].split(':') for p in state['processes'])
assert 'status' not in read('evidence/10-closed.json')
logs = read('evidence/plugin-logs-final.json')
assert sum('Unable to deserialize cloned data' in x['message'] for x in logs) == 2
parent = read('evidence/paseo-runtime.json'); child = read('evidence/path-node-runtime.json')
assert parent['arch'] == child['arch'] == 'x64'
assert parent['platform'] == child['platform'] == 'linux'
assert parent['versions']['v8'] != child['versions']['v8']
for name in ['check','check-postmerge']:
    assert (root/(name+'.exit')).read_text().strip() == '0'
    log = (root/(name+'.log')).read_text()
    assert 'pass 112' in log and 'fail 0' in log
result = {'evidenceAssertions':'PASS','linuxRecheck':'FAIL','reason':'Both opens crash at advanced IPC deserialization; sort/filter and normal last-close shutdown blocked','sourceCommit':proof['sourceCommit'],'testsPassed':112}
(root/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
