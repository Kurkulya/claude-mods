# workflow-bar

A Claude Code mod (function hooks) that draws one band above the prompt: where this session's work unit stands, with
the running agents first.

## What it shows today

A work unit (short form `unit`) is anomaly's word for the thing the bar draws; its folder is
`<root>/.anomaly/<unit>/`. The bar gets every fact about it from one command, `anomaly.py progress --json` (schema 1).

- `.scratch/` and `frontier.mjs` are no longer read.
- **When the bar shows:** when the last report names a unit: the one this session pinned (see **Unit**), else the one
  the CLI picks for the folder the session runs in. A missing anomaly plugin hides the bar, also while subagents run. A
  report with no unit (`unit` null) for the session's folder draws the agent part and `⚠ N` alone (no unit, track,
  build or MR) when `.anomaly/` lies in that folder or in a parent of it; with no `.anomaly/` there it hides the bar
  (see **Unit**). A report of a newer schema is read too (see **Newer schema**).
- **Agents:** while subagents run (any type, foreground or background), a pulsing amber dot and `N agents`
  (`1 agent`); with none running, a grey dot and `idle`.
- **Unit:** a Read, Edit or Write of the main loop (not a subagent's, not a denied one) of a file inside
  `<root>/.anomaly/<unit>/` pins that unit, and so does a main-loop Bash command that names an absolute path there
  (any slash, quoted or bare; Git Bash's `/c/Work/...` reads as `C:/Work/...`). With several paths in one command the
  first one that pins wins. These pin nothing: the name `adhoc`, `.` or `..`, a name that holds `*` `?` `[` `]` `{`
  `}` `$` `` ` `` or `~` or starts with `-`, a name or root that holds `&` `|` `^` `%` `<` `>` or `"`, the unit
  folder alone, a file directly under `.anomaly/`, a Read of a file that does not exist, a relative path, and a
  subagent's or a denied call. The runs then hold `--repo <root> --unit <unit>`, with `<root>` the path before
  `/.anomaly/`; with no pin they hold `--repo` for the session's folder and the CLI picks the unit. The pin is kept in
  `$.store` per session, so a restarted session finds it again. It is dropped only when a run for the pinned unit
  answers unit `null` and the pinned folder is gone; one run with no `--unit` then starts at once, so the unit the CLI
  picks shows without waiting for the next trigger. For a run with no pin that answers unit `null`, the bar looks for
  `.anomaly/` itself (the CLI tells "no `.anomaly/`" from "no unit picked" only by a warning's words): it asks
  `$.fs.exists` for `<folder>/.anomaly` in the session's folder, then each parent up to the drive root (`C:`) or `/`,
  and stops at the first that exists. This approximates the CLI's own root (the git root), so a nested repo without
  `.anomaly/` under a folder that has one still draws the band, and a worktree outside its repo folder hides it. The
  answer is kept per session folder until the module reloads, so the file system is asked once per folder in a load;
  a main-loop Edit or Write under `.anomaly/`, or an `anomaly.py` command, clears it, so a `.anomaly/` made later shows.
  A file system that cannot answer counts as "no `.anomaly/`" (ADR-0004).
- **Build:** `wave N` (the report's `wave`, left out at 0), one segment per ticket with the two digits of its slug,
  and `k/M` (the report's counts: done / done, failed and open together; schema 1 counts a ticket still building as
  failed). A ticket of kind `done` is green with white digits, `running` amber with a moving shine, any other kind
  (`start`, `waiting`, `blocked`) an outline. Segments are in three groups with a gap between them: the `done`
  tickets, then the `running` and `start` ones, then the rest. On Desktop, hovering a segment shows `NN title` and ` —
  reason` when there is one, the `red`, `reviewed` and `verified` marks, and the minutes, High findings and fix rounds
  the CLI counted. A ticket that turned done between two reports of the same unit pops once (the pop is dropped when
  its animation has run, so a later redraw does not play it again).
- **Smooth bar:** when one segment per ticket (about 28 px each) no longer fits, one bar replaces them: a green
  done part, an amber running part with moving stripes, `k / M · r running` inside, and `now NN NN` after it (only
  while tickets run). In a very narrow Desktop band the unit name is shortened with `…` first, then `now`, then the bar
  itself is left out (`k/M` stays while it fits). The terminal drops `now` and then the smooth bar's words the same way.
- **Warnings:** a report with warnings draws `⚠ N` after the unit name (after the agent part when it names no unit). On Desktop its hover lists at most 5 texts,
  160 characters each, then `and <n> more`; the terminal draws `⚠ N` alone.
- **Newer schema:** a report whose `schema` is above 1 draws the agent part and the notice
  `anomaly progress schema N > 1: update workflow-bar` alone, with no unit.
- **Requirements:** `python` (`python3` when the plugin's path is not a Windows path) on the `PATH` and an anomaly
  plugin whose CLI has `progress --json`. The bar reads `.claude/plugins/installed_plugins.json` in the home
  folder (`USERPROFILE`, else `HOME`), takes the `installPath` of the first key that starts with `anomaly@` and runs
  `<installPath>/scripts/anomaly.py progress --json` with a 5-second timeout and no `--home`: as `python -I` when the
  path is a Windows path (a drive letter or a `\`), else as `python3 -I`. The run starts in `installPath`, not in the
  session's folder, so a bare `python` is never looked up in the repo. The file is read again only when its size or
  time changes. Without a readable file or an `anomaly@` key the transcript gets one line per load and the bar draws
  nothing. A CLI without `progress` (exit code 2) gets one line per load that asks for an anomaly plugin update, and
  the bar draws nothing.
- **When a run starts:** at session start, when a prompt is submitted, at every turn end (the main loop's and a
  subagent's), after a main-loop Edit or Write of a file under `<root>/.anomaly/` (a unit's or not), after a main-loop
  Bash command that holds `anomaly.py`, when a main-loop skill of the planning track starts (see **Planning track**;
  typed or by the Skill tool), and right after a run that dropped the pin (see **Unit**; that one run holds no
  `--unit`). A Read starts no run: its pin shows at the next run. The run starts from a timer after the hook returns,
  so no tool call waits for it. One run happens at a time; a trigger during a run asks for one more when it ends. A
  run whose stdout equals the last one's writes nothing, so the band does not redraw and restart its animations.
- **Clock:** a clock (`$.clock.every`) runs the CLI every 10 seconds only while the last report holds a running
  ticket, so what another session writes shows within about 10 seconds. With no running ticket there is no clock; the
  triggers above are what notice a change. A reload drops the clock and the module's variables but keeps `$.state`;
  the first of a render, a Skill call, a prompt, an agent event or session start that runs afterwards asks for a run
  (a Read asks for none), and that run starts the clock again.
- **Faults:** a missing file or a store that cannot answer is "nothing" to the bar. A run that cannot start, times out,
  exits with a code other than 0 or 2, or prints output the bar cannot read keeps the last drawing and pauses the runs
  for 30 seconds; a trigger that comes during the pause runs once when the pause ends. Unreadable output, after exit
  code 0, also gets one transcript line per load, and so does a run that cannot start or times out:
  `workflow-bar: progress --json could not start or timed out; the bar keeps its last drawing` (one line for both,
  with no path and no output in it). A report of a newer schema is read: it draws its notice and starts no
  pause. Any other error in its own work is reported once per load as one transcript line naming the error's kind
  (never its message, which may hold a path or a file's words); the bar keeps its last drawing and the next run starts
  as usual.
- Desktop draws the band as one interactive SVG that follows the light or dark app theme. The terminal draws
  the same content as coloured text, without animation (segments as coloured `NN` runs, the smooth bar as words).
- **Planning track:** a unit with no ticket draws the chips `interview › specify › slice › conduct › ship` in place of
  the build. Done is green, the current chip amber with a moving shine, later ones an outline. Only the stages
  `interview`, `specify` and `slice` move the chips: the report's `stage` marks that chip and the ones before it done,
  and the next one is current. Any other stage name (`review`, `build`, `diagnose`) keeps the stage the bar kept in
  `$.store` under `planning:<unit>`; with none kept, `interview` is current.
- **Live skill:** a main-loop `interview`, `specify` or `slice` skill (typed as `/name` or started by the Skill tool,
  bare or `anomaly:`-namespaced) makes its chip the only current one on the track, until the report's `stage` names a
  planning stage of the unit the bar shows with an `ended` time other than the one the skill started on. The live chip
  follows the unit the bar shows: a report of another unit takes the start again. A subagent's Skill call and a denied
  one set none; a subagent that preloads one of these skills still sets the chip, as the preload makes no tool call
  to tell whose it is.
- **Finish:** with every ticket done the bar draws `M/M ✓` in green (no `wave N`, no segments), then the chips `MR`,
  `reviewed` and `verified`. A chip is done when the report's `mr.link`, `mr.reviewed` or `mr.verified` is not null;
  the first one not done is current, and an `mr` that is null counts as three nulls.
- **MR:** an `mr.link` that passes the link check (`https`, at most 2048 printable ASCII characters, no `@`, and equal
  to `new URL(link).href`) is a `Link` labelled `PR #<n>` (path `/pull/<n>`), `!<n>` (path `/merge_requests/<n>`) or
  `MR`. The host is not checked, but any host other than `github.com` and `gitlab.com` is named after the label:
  `PR #<n> · <host>`, `!<n> · <host>`, `MR · <host>`. A host over 24 characters shows as `…` and its last 23, so its
  end, which names the real site, stays. Any other link is plain text, cut to 24 characters, and an empty link draws
  no MR part. The MR part shows only with the finish chips, as a `Link` beside the SVG on Desktop (the link's cells
  come off the SVG's width) and after the runs on the terminal.
- **Colours:** `M/M ✓` and the muted words (`wave N`, `idle`, `›`, the chip-row count) use a darker shade on the light
  theme and a lighter one on the dark theme; the terminal keeps the plain green.
- **Narrow band:** on Desktop the unit name shortens first, leaving room for the chip a narrow row keeps. Then a chip
  row (track or finish) shrinks to its current chip with how many are done (`slice 2/5`), then to the current chip
  alone, then to nothing. The terminal never shortens the unit name: only the chip-row steps apply there, to the cells
  left after the MR link.

## Loading

The bar is loaded from a live copy outside the repo, not from the repo itself: Claude Code treats a folder loaded as
a plugin dir as a protected path, so editing it always prompts, whatever the allow rules say. Edit the bar in the
repo (`C:/Work/claude-mods/workflow-bar`) and let a script mirror the committed files into the live folder.

Add the live folder to the `env` block of `~/.claude/settings.json`, with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` so a synced
change reloads it in a running Desktop session. On Windows:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "C:/Work/claude-mods-live/workflow-bar",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

In WSL the same live copy is on the Windows disk, so the `~/.claude/settings.json` of the WSL home gets:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/mnt/c/Work/claude-mods-live/workflow-bar",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

The folders of the list are separated by `;` on Windows and by `:` on Linux. The folder watch on `/mnt/c` may miss
writes that Windows processes make, so after a sync run from Windows a WSL session may need a restart to load the
change.

A folder made directly under `C:\` lets any signed-in Windows account modify it by default, and with the folder watch
on a changed hook file there reloads into a running session and runs as you, so restrict the live folder to its owner
by running this yourself in a cmd prompt (`%USERNAME%` expands only there):

    icacls C:\Work\claude-mods-live /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"

After a commit on `main`, from the repo root:

    node tools/sync-live.mjs

To try a branch first, pass it: `node tools/sync-live.mjs <branch>`. The script mirrors exactly the files git tracks
under `workflow-bar/` at that ref (so uncommitted edits are not loaded), removes live files the ref no longer has, and
leaves a file alone when its content did not change. `--to <dir>` picks another target; the default is
`claude-mods-live/workflow-bar` next to the repo folder, and a target inside the repo is refused. The target must
be missing, empty, or an earlier live copy (its `.claude-plugin/plugin.json` names `workflow-bar`); any other
folder is refused untouched, so a wrong `--to` cannot wipe it. Files the engine writes into the live copy
(`.claude-plugin/types/`, `tsconfig.json`) are removed by each sync and written again on the next load. To sync on every
commit to `main`, you can add a `.git/hooks/post-commit` of your own with
`[ "$(git symbolic-ref --short HEAD)" = main ] && node tools/sync-live.mjs`; nothing installs it for you.

## Checks

From the repo root:

    claude plugin validate --strict workflow-bar
    claude plugin test workflow-bar

The contract test (`tests/contract/progress.contract.mjs`) finds and runs the real `progress` command with the bar's
own `anomalyInstallPath` and `progressCommand`, on ticket files it writes to a temp folder. It checks the order of the
report's top-level keys and of each ticket's keys; the report's `schema`, `unit`, `wave`, `counts`, `warnings` and, for
each ticket, `slug`, `title`, `kind`, `reason`, `red`, `reviewed`, `verified`, `build_minutes`, `high` and
`fix_rounds` (not the values of `stage` or `mr`); and what the bar's `parseProgress` reads from it. It skips when the
anomaly plugin is not installed, its interpreter is not on the path, or the CLI has no `progress` (exit code 2).
`claude plugin test` cannot start a process, so it runs under node (22.18 or later, which reads the imported `.ts` as
is), from the plugin folder:

    node --test "tests/contract/*.mjs"

The sync script has its own tests, run from the repo root (the quotes matter: Node 24 reads a bare `tools/` as a
file name):

    node --test "tools/*.test.mjs"

## Layout

- `hooks/register.tsx`: the hooks module and the only file that uses `$` (it cannot cross an import).
- `hooks/agents.ts`, `hooks/unit.ts`, `hooks/progress.ts`, `hooks/build.ts`, `hooks/phase.ts`, `hooks/view.ts`,
  `hooks/svg.ts`, `hooks/palette.ts`: pure helpers that take plain values: agent tracking, the unit path rule and the
  pin, the CLI lookup, command and report parse, the ticket groups and pops, the planning track, the live skill names,
  the finish chips and the link check, the view model and terminal runs, the SVG markup and the colours.
- `hooks/band.tsx`: the band's tree on each surface (the Svg and the MR link on Desktop, the Text runs on the
  terminal), from the elements the hooks module resolved and plain values.
- `types/index.d.ts`: the `$.state` contract.
- `tests/*.test.ts`: drive the hooks from outside (agent events, tool calls, a fake disk, store and CLI run)
  and check the band each surface draws, by topic: `agents`, `build` (segments, smooth bar, the MR), `unit` (the path
  rule), `progress` (the report drawn: build, track, live chip, finish, warnings), `progress-run` (finding and running
  the CLI, exit code 2, a newer schema, failed runs) and `follow` (the unit the CLI picked, the pin, what starts a run,
  the clock, the pause, faults). `tests/harness.ts` holds the fake engine and the drawing helpers they share.
  `tests/contract/progress.contract.mjs` is the contract test above.
