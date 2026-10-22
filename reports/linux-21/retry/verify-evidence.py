"""Assert source/install identity, real-app results, and native process lifetime."""
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
assert read('evidence/install.exit') == read('evidence/npm-ci.exit') == 0
cases = [
    ('03-small.json', 'rows120.csv', '120 rows', '1000value-000other', False),
    ('05-small-sorted.json', 'rows120.csv', '120 rows', '1119value-119other', True),
    ('07-small-filtered.json', 'rows120.csv', '10 of 120 rows', '1019value-019other', True),
    ('08-30050.json', 'ui-v2-30050.csv', '30,050 rows', '100000alphaordinary', False),
    ('09-30050-sorted.json', 'ui-v2-30050.csv', '30,050 rows', '130049betaordinary', True),
    ('10-30050-filtered.json', 'ui-v2-30050.csv', '15,025 of 30,050 rows', '130048alphaordinary', True),
]
for name, path, count, first, sorted_ in cases:
    state = read('evidence/'+name)
    assert state['path'] == path and count in state['status'] and state['status'].endswith('Ready')
    assert not state.get('alert')
    assert state['rows'][1]['text'] == first
    assert ('id↓' in state['rows'][0]['text']) == sorted_
for name in ['03-processes.json','07-processes.json','08-processes.json','10-processes.json']:
    state = read('evidence/'+name)
    processes = {p['pid']:p for p in state['processes']}
    assert set(processes) == {40131,42352,42392}
    assert not processes[40131]['duckdbMappings'] and not processes[42352]['duckdbMappings']
    child = processes[42392]
    assert child['ppid'] == 42352 and processes[42352]['ppid'] == 40131
    assert child['exe'] == '/usr/local/lib/nodejs/bin/node'
    assert any('/duckdb.node' in line for line in child['duckdbMappings'])
    assert state['ownedTemporaryRoots'] == ['/tmp/csv-viewer-child-GCgR9y']
    assert all('/usr/local/bin' in p['environment']['PATH'].split(':') for p in processes.values())
closed = read('evidence/11-processes.json')
assert {p['pid'] for p in closed['processes']} == {40131,42352}
assert not closed['ownedTemporaryRoots']
assert 'status' not in read('evidence/11-last-panel-closed.json')
lifetime = read('evidence/lifetime.json')
assert not lifetime['childPresent'] and not lifetime['temporaryRootPresent']
assert lifetime['daemonPresent'] and lifetime['pluginPresent']
assert all(x['stream'] != 'stderr' for x in read('evidence/plugin-logs.json'))
assert (root/'check.exit').read_text().strip() == '0'
log = (root/'check.log').read_text()
assert 'pass 113' in log and 'fail 0' in log
result = {'evidenceAssertions':'PASS','linuxRecheck':'PASS','sourceCommit':proof['sourceCommit'],
          'integrationCommit':proof['integrationCommit'],'testsPassed':113,
          'smallOpenSortFilter':'PASS','largeOpenSortFilter':'PASS',
          'daemonAndPluginWithoutDuckDB':'PASS','nodeChildMapsDuckDB':'PASS',
          'lastCloseStopsChildAndRemovesTemporaryRoot':'PASS'}
(root/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
