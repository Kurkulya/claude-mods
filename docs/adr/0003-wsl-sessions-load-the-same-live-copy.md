# ADR-0003: WSL sessions load the bar from the same live copy through `CLAUDE_CODE_PLUGIN_DIRS`

Status: Proposed · Date: 2026-10-12 · Owner: VK · Revisit-by: 2027-01-12

Decision: the WSL `~/.claude/settings.json` gets an `env` block with `CLAUDE_CODE_PLUGIN_DIRS=/mnt/c/Work/claude-mods-live/workflow-bar` and `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`, the same live copy Windows loads as `C:/Work/claude-mods-live/workflow-bar`. One `node tools/sync-live.mjs` run serves both platforms.
Why: the bar loads only in Windows sessions today, and WSL sessions are where much of the work runs. A plugin-dir entry is the documented way to run a mod from its folder in sessions the desktop app starts, and it keeps the live-copy workflow the README describes.
Revisit: when the bar moves to a marketplace install (the retirement of the Windows `CLAUDE_CODE_PLUGIN_DIRS` entry, deferred with the side pane), when the watch proves unreliable on `/mnt/c`, or 2027-01-12.

## Context

- `CLAUDE_CODE_PLUGIN_DIRS` is read from the process environment or the `env` block of `~/.claude/settings.json`, with the platform's path-list separator (`:` on Linux, `;` on Windows); `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes a long-lived desktop or SDK session reload on a save (plugin-authoring reference).
- The WSL settings have no `env` block on 2026-10-12. The Windows entry lists two folders separated by `;`.
- A folder marketplace is the other documented way; it reloads through `/reload-plugins`, not the folder watch.

## Why

One copy means one sync, one version and the same drawing on both platforms for the same JSON.

## Alternatives rejected

- A second live copy on the WSL disk: `tools/sync-live.mjs` takes one `--to` (`tools/sync-live.mjs:17` at 514c1c4), so it needs a second run or a script change, and the two copies can drift.
- A folder marketplace installed on both platforms: it also retires the Windows entry, which is out of scope for this unit, and it trades the folder watch for `/reload-plugins`.

## Risk

The WSL watch on `/mnt/c` may miss writes made by Windows processes. A sync run from Windows may then need a restart of the WSL session.

The live folder is code that runs as the user. By default a folder made directly under `C:\` lets any signed-in Windows account modify it, and with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` a changed hook file reloads into a running session and runs as the user, on Windows and now on WSL. The owner can restrict the folder with an owner-only ACL.
