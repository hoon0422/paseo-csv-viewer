"""Assert claims from exported evidence; this does not drive the app."""
import hashlib, json, re, subprocess, tarfile
from pathlib import Path
p=Path(__file__).parent
read=lambda name:json.loads((p/name).read_text())
results=[]
def passed(name): results.append({'name':name,'status':'passed'})
def controls(s):return {c['label']:c for c in s['controls']}
def rows(s):return [r for r in s['rows'] if (r.get('label') or '').startswith('Select row ')]
a=read('package-provenance.json');b=read('installed-provenance.json')
assert a['sha256']==hashlib.sha256((p/'paseo-csv-viewer-0.1.0.tgz').read_bytes()).hexdigest()==b['artifactSHA256']
assert len(a['files'])==18 and a['files']==b['files']
with tarfile.open(p/'paseo-csv-viewer-0.1.0.tgz') as tar:
 files={m.name.removeprefix('package/'):tar.extractfile(m).read() for m in tar if m.isfile()}
for name,data in files.items():
 assert hashlib.sha256(data).hexdigest()==a['files'][name]
 assert data==subprocess.check_output(['git','show',a['sourceCommit']+':'+name])
assert read('install.json')['status']=='running'
passed('All 18 package entries equal merged source and installed Space files; plugin running')
native=[x for x in read('native-500mb.json') if x['event'] in ('first-sorted-page','appended-page')]
assert len(native)==23 and all(x['pass'] and x['durationMs']<=x['targetMs'] for x in native)
passed('All 23 native ADR 0003 timing checks pass')
s=read('19-state.json');selected=[r['label'] for r in rows(s) if r['selected']=='true']
assert selected==[f'Select row {i}' for i in range(1,18)] and 'Showing 50' in s['status']
passed('Native viewport Ctrl+A selected rows 1–17 only')
events=[json.loads(line) for line in (p/'ui-events.jsonl').read_text().splitlines()]
cap=[x for x in events if x.get('toast')=="Can't select more than 10,000 rows"]
assert cap and all('1 selected' in x['status'] for x in cap)
assert (p/'1027319-toast.png').stat().st_size>0
passed('Native oversized Shift range preserved one selected row and showed the cap toast')
w=read('wheel-result.json');assert w['status'].startswith('30,050 rows') and w['mountedRows']==104
assert len(w['wheels'])==4 and all(x['trusted'] and x['afterTop']!=x['top'] and x['frameMs']>=x['scrollMs'] for x in w['wheels'])
assert '30,050 rows' in read('load-rows-fast-result.json')['status']
passed('30,050 loaded rows, 104 mounted rows, trusted native wheel input measured')
s=read('57-regex-state.json');assert s['status'].startswith('3 of 30,050')
assert all(v in ''.join(r['text'] for r in rows(s)) for v in ['00002','00003','00004'])
passed('Corrected regex returns the three expected IDs')
before=read('62-state.json');assert controls(before)['Resize id']['width']=='150'
assert controls(before)['Toggle row 1 expansion']['expanded']=='true' and '1 selected' in before['status']
for name in ['63-header-reset-state.json','71-ok-state.json']:
 s=read(name);c=controls(s)
 assert c['Sort mode']['disabled'] and c['Reveal hidden columns']['disabled']
 assert all(x['width']=='160' for x in s['controls'] if x['role']=='separator')
 assert all(x.get('expanded')=='false' for x in s['controls'] if (x['label'] or '').startswith('Toggle row '))
 assert '0 selected' in s['status'] and not any((x['label'] or '').startswith('Filter value') for x in s['controls'])
assert read('63-header-reset-state.json')['status'].startswith('Showing 50 of 30,051')
passed('Header toggle and confirmed new source reset sort/filter/hidden/width/selection/expansion')
for name in ['67-path-state.json','69-cancel-state.json']:
 s=read(name);c=controls(s)
 assert s['status'].startswith('1 of 30,050 rows1 selected')
 assert c['Resize id']['width']=='150' and c['Toggle row 1 expansion']['expanded']=='true'
 assert not c['Reveal hidden columns']['disabled'] and not c['Sort mode']['disabled']
assert read('69-cancel-state.json')['path']=='ui-v2-30050.csv'
passed('Rejected path preserves matching count; warning Cancel retains changed presentation')
load=read('warning-load-result.json');assert load['completed'] and load['events'][0]['trusted']
assert load['events'][-1]['status'].endswith('Ready') and '5,000,000 rows' in load['events'][-1]['status']
passed('Native warning OK opens 500000100-byte fixture and reaches Ready')
copy=read('native-copy-17.json');assert copy['success'] and copy['content']==(p/'native-copy-17.tsv').read_text()==(p/'expected-copy-17.tsv').read_text()
assert len(copy['content'].splitlines())==17 and all(len(line.split('\t'))==2 for line in copy['content'].splitlines())
assert read('native-cell-copy.json')=={'content':'00000034','success':True}
passed('Native row TSV and double-click cell clipboard values match exactly')
assert read('final-health.json')['owned5GBBenchmarkProcesses']==[]
passed('Final readback confirms no owned 5 GB benchmark remains')
for link in re.findall(r'\]\(([^)]+)\)',(p.parent/'README.md').read_text()):
 if link=='final/verification.json': continue  # This invocation writes the result below.
 if not link.startswith(('https:','http:','#')): assert (p.parent/link.split('#')[0]).exists(),link
passed('All relative README evidence links resolve')
(p/'verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(f'{len(results)} evidence assertions passed')
