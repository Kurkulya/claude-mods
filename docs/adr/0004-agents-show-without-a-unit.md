# ADR-0004: the bar draws the agents count and the warnings when the report names no unit, in a repo that has `.anomaly/`

Status: Proposed · Date: 2026-10-13 · Owner: VK · Revisit-by: 2027-01-13
Supersedes: bar-progress D-8 (`.anomaly/bar-progress/decisions.md:11`), "`unit` null draws nothing, the agents chip included".

Decision: when `progress --json` answers `unit: null` for the session's folder, the bar draws the agent part and `⚠ N` (no unit, track, build or MR) if `.anomaly/` lies in that folder or in a parent of it, and hides as before if it does not. The bar checks the folder itself with `$.fs.exists`, walking up from the session's folder, and keeps the answer per folder until a write under `.anomaly/` clears it. A run that cannot start or times out also writes one transcript line per load.
Why: the user decided on 2026-10-13 that agents show in every repo that uses anomaly. The CLI tells "no `.anomaly/` here" from "no unit picked" only by the text of a warning, so the bar cannot read the difference from the report.
Revisit: when the CLI reports its `.anomaly/` root in the JSON, when a worktree outside its repo folder is a common case, or 2027-01-13.

## Context

- `timm-mock-client` has one unit, and it is finished. On branch `develop` no unit matches and none is unfinished, so the CLI answers `unit: null` with the warning `no work unit picked: none matches the current branch and none is unfinished`. D-8 hid the whole band, so the agents count was gone in a repo that uses anomaly.
- The same `unit: null` also comes from a folder with no `.anomaly/` at all, where the bar has nothing to say (side-pane D-12). The two answers differ only in the warning's words.
- A run for a pinned unit holds `--repo <root>` of a `.anomaly/` folder the bar already saw, so the check applies to runs for the session's folder only.

## Decision

- `foldersUp(path)` in `workflow-bar/hooks/unit.ts` lists the session's folder and each parent up to the root, in the bar's spelling (`C:/Work/repo/src`, `C:/Work/repo`, `C:/Work`, `C:`; for a POSIX root the empty string). `refreshOnce` asks `$.fs.exists("<folder>/.anomaly")` for each until one answers yes.
- Found: the report is kept, and `barView` draws the agent part and the report's warnings with layout `none`. Not found: the bar hides, as D-8 did.
- The answer, yes or no, is kept per session folder in a module variable, so it is asked once per folder in a load. A main-loop Edit or Write under `.anomaly/`, or an `anomaly.py` command, clears it, so a `.anomaly/` made after a "no" shows. A file system that cannot answer counts as "nothing" (the bar hides).
- With no report at all the bar still draws nothing.

## Why

The folder is the fact the bar needs, and `$.fs.exists` answers it with no warning text and no second CLI call. Keeping the answer means a render or a new report does not ask the file system again.

## Alternatives rejected

- A new additive field in the CLI's JSON, such as `anomaly_root`: cleaner, since the CLI already knows its root. It needs a second repo change, an anomaly plugin update on every machine, and a new key order in the contract the bar's tests pin.
- Matching the warning text (`no work unit picked`): breaks silently the day anomaly rewords it, and the bar would hide again with no error.
- Agents in every session, with or without `.anomaly/`: the band would appear in repos that do not use anomaly.
- Agents only while they run: the band would come and go with each agent, and the bar would differ from how it draws with a unit.

## Accepted risks

- [ ] A worktree created outside its repo folder finds no `.anomaly/` in any parent, so the bar hides there though the repo uses anomaly. Owner: VK · Revisit: 2027-01-13
- [ ] The walk-up approximates the CLI's own root, which is the git root (the shared root of a worktree), not a walk up the folders. It differs for a nested repo without `.anomaly/` under a folder that has one: the bar draws the band, with the CLI's warning that the repo has no `.anomaly/` folder. Owner: VK · Revisit: 2027-01-13

## Sources

- a1edcae: the tests for this decision.
- 2265ca8: the walk-up, the drawing of the agent part and the transcript line.
