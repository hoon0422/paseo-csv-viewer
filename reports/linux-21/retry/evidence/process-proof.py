"""Read process ownership, selected environment, and native mappings in the Space."""
import json, os, pathlib, subprocess, sys

rows = []
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit():
        continue
    try:
        argv = (proc / 'cmdline').read_bytes().replace(b'\0', b' ').decode().strip()
        if argv != 'Paseo Daemon' and not any(s in argv for s in ['plugins/plugin-process.js', '/home/cua/linux-21-retry/package/server/child.cjs']):
            continue
        if 'python' in argv or '/bin/sh' in argv:
            continue
        env = dict(s.split('=', 1) for s in (proc / 'environ').read_bytes().decode().split('\0') if '=' in s)
        maps = (proc / 'maps').read_text().splitlines()
        rows.append({'pid': int(proc.name), 'ppid': int((proc/'stat').read_text().rsplit(')', 1)[1].split()[1]),
                     'argv': argv, 'exe': os.readlink(proc/'exe'),
                     'environment': {k: env[k] for k in ['PATH', 'PASEO_HOME'] if k in env},
                     'duckdbMappings': [s for s in maps if 'duckdb' in s.lower()]})
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        pass
result = {'utc': subprocess.check_output(['date', '-u', '+%FT%TZ'], text=True).strip(), 'processes': rows,
          'ownedTemporaryRoots': [str(p) for p in pathlib.Path('/tmp').glob('csv-viewer-child-*')]}
pathlib.Path(sys.argv[1]).write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
