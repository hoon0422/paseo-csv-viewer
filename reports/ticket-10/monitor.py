import json
import os
import time
from pathlib import Path

out = Path('/home/cua/ticket-10/resources.jsonl')
stop = Path('/home/cua/ticket-10/stop-monitor')

def rss(pid):
    try:
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return int(line.split()[1]) * 1024
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        pass
    return 0

with out.open('w', buffering=1) as sink:
    while not stop.exists():
        test_rss = server_rss = client_rss = 0
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                cmd = (proc / 'cmdline').read_bytes().replace(b'\0', b' ')
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
            size = rss(proc.name)
            if b'measure-5gb.mts' in cmd and b'node' in cmd:
                test_rss += size
            if b'plugin-process.js' in cmd:
                server_rss += size
            if b'--type=renderer' in cmd and b'Paseo.bin' in cmd:
                client_rss += size
        db = wal = spill = 0
        for directory in Path('/tmp').glob('csv-viewer-session-*'):
            for file in directory.rglob('*'):
                if not file.is_file():
                    continue
                size = file.stat().st_blocks * 512
                if '.wal' in file.name:
                    wal += size
                elif 'spill' in file.parts:
                    spill += size
                else:
                    db += size
        disk = os.statvfs('/home/cua/ticket-10')
        sink.write(json.dumps({'time': time.time(), 'test_rss': test_rss,
            'server_rss': server_rss, 'client_rss': client_rss, 'db_bytes': db,
            'wal_bytes': wal, 'spill_bytes': spill,
            'free_bytes': disk.f_bavail * disk.f_frsize}) + '\n')
        time.sleep(1)
