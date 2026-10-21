"""Package the verified release inventory directly from the merged Git revision."""
import gzip, hashlib, io, json, subprocess, tarfile
from pathlib import Path
out = Path(__file__).parent
source = subprocess.check_output(['git','rev-parse','HEAD'], text=True).strip()
previous = json.loads((out.parent/'ui-v2-evidence/provenance.json').read_text())['artifact']['files']
files = {name: subprocess.check_output(['git','show',source+':'+name]) for name in previous}
assert len(files) == 18 and 'npm-shrinkwrap.json' in files
artifact = out/'paseo-csv-viewer-0.1.0.tgz'
with artifact.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as gz, tarfile.open(fileobj=gz,mode='w|') as tar:
 for name,data in files.items():
  info=tarfile.TarInfo('package/'+name); info.size=len(data); info.mode=0o644
  tar.addfile(info,io.BytesIO(data))
with tarfile.open(artifact) as tar:
 assert {m.name.removeprefix('package/'):tar.extractfile(m).read() for m in tar if m.isfile()} == files
proof={'sourceCommit':source,'integrationCommit':subprocess.check_output(['git','rev-parse','integration/ui-v2'],text=True).strip(),'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'bytes':artifact.stat().st_size,'tarMatchesSource':True,'builtOn':'macOS source checkout; explicit previously verified 18-file release inventory; no host Paseo access','files':{n:hashlib.sha256(d).hexdigest() for n,d in files.items()}}
(out/'package-provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps({k:v for k,v in proof.items() if k!='files'}))
