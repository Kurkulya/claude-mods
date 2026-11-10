# claude-mods

Mods for Claude Code. A mod is a plugin that changes Claude Code's own interface.

## workflow-bar

One band above the prompt that shows where the current
[anomaly](https://github.com/Kurkulya/anomaly) work unit stands: the running agents, the tickets of the build, and the
MR steps. What the band draws, and when, is in [workflow-bar/README.md](workflow-bar/README.md).

### Requirements

- The anomaly plugin, installed, with a CLI that has `progress --json`. Its install steps are in the
  [anomaly README](https://github.com/Kurkulya/anomaly#readme).
- `python` on the `PATH` (`python3` outside Windows).

Without the anomaly plugin the band draws nothing.

### Install

At the prompt of a terminal session:

```
/plugin install workflow-bar --marketplace Kurkulya/claude-mods
```

From a shell:

```
claude plugin install workflow-bar --marketplace Kurkulya/claude-mods
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `Kurkulya/claude-mods`, then
Add plugin.

## Repository layout

- `workflow-bar/`: the mod.
- `docs/adr/`: why each decision was made.
- `tools/sync-live.mjs`: copies the committed mod into a live folder while developing it.

## License

MIT, see [LICENSE](LICENSE).
