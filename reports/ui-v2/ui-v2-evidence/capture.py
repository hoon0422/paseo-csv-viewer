"""Capture each T20-* renderer checkpoint without changing the application."""
import json
import subprocess
import time
from pathlib import Path

out = Path('/home/cua/ui-v2-evidence')
seen = set()
with (out / 'capture.jsonl').open('w', buffering=1) as log:
    while not (out / 'stop-capture').exists():
        title = subprocess.check_output(['xprop', '-id', '29360132', '_NET_WM_NAME'], env={'DISPLAY': ':1', 'PATH': '/usr/bin:/bin'}).decode().strip().split('"')
        title = title[1] if len(title) > 1 else ''
        if title.startswith('T20-') and title not in seen:
            seen.add(title)
            name = ''.join(c for c in title if c.isalnum() or c == '-')
            subprocess.run(['import', '-window', '29360132', str(out / (name + '.png'))], env={'DISPLAY': ':1', 'PATH': '/usr/bin:/bin'}, check=True)
            log.write(json.dumps({'utc': time.time(), 'checkpoint': title, 'file': name + '.png'}) + '\n')
        time.sleep(.1)
