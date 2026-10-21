"""Build an uninstalled candidate from the previously verified package inventory."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

out = Path(__file__).parent / 'final-package'
source = 'ff199b665dc22a420f5d5964196a08841dc2e5e8'
previous = json.loads((Path(__file__).parent.parent / 'ui-v2-evidence/provenance.json').read_text())['artifact']['files']
files = {name: subprocess.check_output(['git', 'show', source + ':' + name]) for name in previous}
assert len(files) == 18 and 'npm-shrinkwrap.json' in files
changed = [name for name, data in files.items() if hashlib.sha256(data).hexdigest() != previous[name]]
assert changed == ['client/panel.tsx'], changed
artifact = out / 'paseo-csv-viewer-0.1.0.tgz'
with artifact.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w|') as tar:
    for name, data in files.items():
        info = tarfile.TarInfo('package/' + name)
        info.size = len(data)
        info.mode = 0o644
        tar.addfile(info, io.BytesIO(data))
with tarfile.open(artifact) as tar:
    assert {m.name.removeprefix('package/'): tar.extractfile(m).read() for m in tar if m.isfile()} == files
proof = {'sourceCommit': source, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(), 'bytes': artifact.stat().st_size,
    'builtOn': 'macOS source checkout; explicit verified inventory, gzip/tar; no host Paseo access',
    'installedInSpace': False, 'tarMatchesSource': True, 'changedPackagedEntriesSinceInstalledCandidate': changed,
    'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
(out / 'provenance.json').write_text(json.dumps(proof, indent=2) + '\n')
