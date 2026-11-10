# ADR-0001: workflow-bar reads only `anomaly progress --json`; the `.scratch/` pipeline is dropped

Status: Proposed · Date: 2026-10-12 · Owner: VK · Revisit-by: 2027-01-12

Decision: the bar gets every fact about a work unit from one command, `anomaly.py progress --json` (schema 1). It no longer reads `.scratch/<feature>/`, runs `frontier.mjs`, reads digests, `finish.md` or the old `mr.md` shape, lights the `grill-with-docs`, `to-spec` and `to-tickets` skills, or looks up the main checkout with git. This is a breaking change: a repo with a `.scratch/` unit in progress loses its bar.
Why: anomaly moved work units to `.anomaly/<unit>/` and publishes one versioned report for UIs (anomaly ADR-0025). A second reader of the old layout would double the parsing and the tests, and that layout is no longer written.
Revisit: when `progress` raises its schema, when a UI needs a fact `progress` does not hold, or 2027-01-12.

## Context

At 514c1c4 the bar runs `~/.claude/skills/orchestrate-tickets/frontier.mjs --json` on `.scratch/<feature>/issues/` (`workflow-bar/hooks/register.tsx:43`, `:88`), watches the main checkout's `.scratch/` found through `git worktree list` (`:168`), and parses digests, `finish.md` and `mr.md` itself (`workflow-bar/hooks/build.ts:68`, `:105`; `workflow-bar/hooks/phase.ts:57`, `:112`). The anomaly pipeline writes none of these files.

## Decision

- One process per refresh: `progress --json`, with `--repo` and, for a pinned unit, `--unit`. The CLI finds the main checkout, picks the unit and classifies the tickets.
- The bar keeps what only it can see: running subagents, the session's own live skill, and the unit a main-loop path names.
- The bar checks `schema` first and draws a short notice for a newer schema instead of the report.

## Why

The parsing then lives once, in the anomaly CLI, under its unit tests. The bar's own tests shrink to drawing and hook behaviour.

## Alternatives rejected

- Keep both readers (`.scratch/` when there is no `.anomaly/`): two contracts, about 124 tests tied to the old files, for a layout no tool writes any more.
- Parse `.anomaly/` in the bar: a second copy of the ticket, log and work-unit parsing in TypeScript, which anomaly ADR-0025 rejects.
