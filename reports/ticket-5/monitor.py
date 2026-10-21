import json
import os
import time
from pathlib import Path

ROOT = Path('/tmp')
OUT = Path('/home/cua/ticket-5/reports/large-monitor.jsonl')

def rss(pid):
    try:
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return int(line.split()[1]) * 1024
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        pass
    return 0

def process_ids():
    server = []
    client = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cmd = (entry / 'cmdline').read_bytes().replace(b'\0', b' ')
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        if b'plugin-process.js' in cmd:
            server.append(int(entry.name))
        if b'--type=renderer' in cmd and b'Paseo.bin' in cmd:
            client.append(int(entry.name))
    return server, client

def allocated(path):
    try:
        return path.stat().st_blocks * 512
    except FileNotFoundError:
        return 0

with OUT.open('w', buffering=1) as out:
    while not Path('/home/cua/ticket-5/reports/stop-monitor').exists():
        server, client = process_ids()
        db = wal = spill = 0
        for directory in ROOT.glob('csv-viewer-session-*'):
            for file in directory.rglob('*'):
                if not file.is_file():
                    continue
                size = allocated(file)
                if '.wal' in file.name:
                    wal += size
                elif 'spill' in file.parts:
                    spill += size
                else:
                    db += size
        disk = os.statvfs('/home/cua/ticket-5')
        out.write(json.dumps({'time': time.time(), 'server_pids': server, 'server_rss': sum(map(rss, server)),
                              'client_pids': client, 'client_rss': sum(map(rss, client)),
                              'db_bytes': db, 'wal_bytes': wal, 'spill_bytes': spill,
                              'free_bytes': disk.f_bavail * disk.f_frsize}) + '\n')
        time.sleep(1)
