# Fresh worktree and Ubuntu test setup

The project baseline is `168bb91cef429b159c3ff1b182b3e90b895bf904` on `main` and `integration/csv-viewer`. Ticket #2 is developed separately in `.worktrees/ticket-2` on `ticket/2-environment`. `CLAUDE.md` is a committed relative link to `AGENTS.md`.

`paseo.json` and `.codex/environments/environment.toml` both call `scripts/bootstrap.sh`. A new checkout runs `setup` automatically through the selected Paseo or Codex worktree route; its Check action runs `check`. Before a package exists both commands succeed without borrowing ignored files. Once `package.json` is added, commit `package-lock.json` too: setup runs `npm ci`, while Check runs available `check`, `test`, and `build` scripts. To verify the committed routes directly, run `python3 tests/bootstrap.py`; it creates and removes a temporary detached worktree.

Paseo reads `paseo.json` from the **committed base** chosen for a new worktree. Commit configuration first, then create a Paseo workspace with worktree isolation and that commit as its base. For Codex, select the repository local environment in the desktop app when creating a worktree; the generic Codex CLI does not execute its setup automatically.

For independent Ubuntu verification, reuse Cua Space `local:paseo-x64-ubuntu` (Ubuntu 24.04.5, x86_64). Transfer a Git bundle or source archive into a per-ticket guest directory, with no profile or credential files. The official Paseo 0.12.0 desktop and independent daemon use `/home/cua/.config/Paseo-x64-test`, `/home/cua/.paseo-x64-test`, and `127.0.0.1:6779`. Confirm readiness with `/opt/Paseo/resources/bin/paseo daemon status --home /home/cua/.paseo-x64-test --json` and `curl -fsS http://127.0.0.1:6779/api/health`. The [x64 Space handoff](ubuntu-paseo-arm64.md#result) has the package provenance, launch commands, and existing screenshot evidence.

Store synthetic fixtures and raw reports under `/home/cua/ticket-2`, then use Cua `download` to export them to `/tmp/csv-viewer-implementation/reports/ticket-2`. Record `git rev-parse HEAD`, `uname -m`, `node --version`, Paseo version, daemon status, a desktop screenshot, and `df -h /` with the test output. The guest has a 20 GB disk; recheck free space before later 5 GB fixture runs. Do not copy daemon or desktop profile directories into reports.

Configuration references: [Paseo worktrees](https://paseo.sh/docs/worktrees) and [Codex local environments](https://learn.chatgpt.com/docs/environments/local-environment).
