"""Exercise both published setup routes from a clean committed worktree."""

import json
import pathlib
import subprocess
import tempfile
import tomllib


source = pathlib.Path(__file__).resolve().parents[1]


def run(command, cwd):
    completed = subprocess.run(command, cwd=cwd, shell=True, text=True, capture_output=True)
    assert completed.returncode == 0, f"{command}: {completed.stdout}\n{completed.stderr}"
    return completed.stdout.strip()


with tempfile.TemporaryDirectory(prefix="csv-viewer-bootstrap-") as temp:
    checkout = pathlib.Path(temp) / "checkout"
    subprocess.run(["git", "worktree", "add", "--detach", str(checkout), "HEAD"], cwd=source, check=True, capture_output=True)
    try:
        assert (checkout / "CLAUDE.md").is_symlink()
        assert (checkout / "CLAUDE.md").readlink() == pathlib.Path("AGENTS.md")
        assert not (checkout / "node_modules").exists()

        paseo = json.loads((checkout / "paseo.json").read_text())
        codex = tomllib.loads((checkout / ".codex/environments/environment.toml").read_text())
        actions = {action["name"]: action["command"] for action in codex["actions"]}

        results = {
            "base_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip(),
            "paseo_setup": run(paseo["worktree"]["setup"], checkout),
            "codex_setup": run(codex["setup"]["script"], checkout),
            "paseo_check": run(paseo["scripts"]["check"]["command"], checkout),
            "codex_check": run(actions["Check"], checkout),
            "agent_symlink": "CLAUDE.md -> AGENTS.md",
        }
        print(json.dumps(results, indent=2))
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(checkout)], cwd=source, check=True, capture_output=True)
