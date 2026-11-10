# ADR-0002: the bar finds the anomaly CLI through `installed_plugins.json` and picks the interpreter from its path

Status: Proposed · Date: 2026-10-12 · Owner: VK · Revisit-by: 2027-01-12

Decision: the bar reads `~/.claude/plugins/installed_plugins.json`, takes `installPath` of the first key that starts with `anomaly@`, and runs `<installPath>/scripts/anomaly.py`. It runs `python` when that path is a Windows path (a drive letter or a `\`) and `python3` otherwise, always with `-I`. It reads the file again only when its size or time changes. It passes no `--home`.
Why: anomaly installs into a cache folder whose name is the version (`…/cache/anomaly-local/anomaly/ee37bf10eead` on both platforms on 2026-10-12), so a fixed path breaks on every update. The hooks engine has no API that finds another plugin's folder and none that names the platform.
Revisit: when the engine offers a plugin lookup or a platform value, when `installed_plugins.json` leaves `"version": 2`, or 2027-01-12.

## Context

- Windows: `installPath` is `C:\Users\<user>\.claude\plugins\cache\anomaly-local\anomaly\ee37bf10eead`; `where python` finds Python 3.13.13 first; anomaly's own hooks run `python`.
- WSL: `installPath` is `/home/<user>/.claude/plugins/cache/anomaly-local/anomaly/ee37bf10eead`; the interpreter is `python3`.
- The engine API (`claude-code/index.d.ts`) gives `$.env`, `$.plugin.root` (the bar's own folder) and `$.process.run`, and no platform or plugin list.
- A probe on 2026-10-12: `python -I <installPath>\scripts\anomaly.py progress --json --repo C:\Work\claude-mods` exits 0 with schema 1 JSON; the earlier version 06ddb2f exits 2 (`invalid choice: 'progress'`).

## Decision

- No `--home`: each platform reads its own anomaly home (side-pane D-12). The two homes differ, so one unit can show different stages in WSL and Windows sessions.
- A missing file or key is one transcript line per load, and the bar draws nothing; exit 2 is a separate line that asks for an anomaly update.

## Why

`installed_plugins.json` names the newest installed copy, the one every session started after the update runs; a session started before keeps its old copy until it restarts. The path's own form tells the platform with no extra process.

## Alternatives rejected

- A fixed path or an env var the user sets: breaks on each update, or is setup work on two machines.
- `python3` then `python` on failure: on Windows the only `python3.exe` is the one in `AppData\Local\Microsoft\WindowsApps` (the Store app alias), not the installed Python 3.13, so the first try does not fail cleanly.
- Reading the platform from an env var such as `USERPROFILE`: no env var is a documented platform signal for the hooks engine.

## Risk

`installed_plugins.json` is Claude Code's own state, not a public contract. A format change hides the bar behind the transcript line until this lookup follows it.
