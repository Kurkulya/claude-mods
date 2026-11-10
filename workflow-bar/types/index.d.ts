// One subagent of this session, by the id its spawn resolved and its turns carry.
export type WorkflowBarAgent = { id: string; isRunning: boolean }

// The work unit this session pinned: its name and its folder, spelled `C:/a/b` on Windows.
export type WorkflowBarUnit = { name: string; path: string }

// How a ticket's box paints: filled green, filled amber, or an outline.
export type WorkflowBarTicketState = 'done' | 'running' | 'waiting'

// One ticket of the report, its strings cleaned: the two digits of its slug, its title, kind and reason, the red,
// reviewed and verified marks, and the minutes, High and fix rounds the CLI counted (null when it did not).
export type WorkflowBarTicket = {
  number: string
  title: string
  kind: string
  reason: string | null
  red: boolean
  reviewed: boolean
  verified: boolean
  buildMinutes: number | null
  high: number | null
  fixRounds: number | null
}

// The unit's newest ended stage: its name and when it ended, as the report spells them.
export type WorkflowBarStage = { name: string; ended: string }

// The unit's MR as the report names it: the link, and the commits reviewed and verified (null for none), cleaned.
export type WorkflowBarMr = { link: string | null; reviewed: string | null; verified: string | null }

// What the bar reads of one `progress --json` report (schema 1): the unit the CLI picked (null for none), its newest
// ended stage (null for none), the wave (0 for none), the counts, the tickets, the MR (null for none) and the
// warnings, their strings cleaned.
export type WorkflowBarProgress = {
  unit: string | null
  stage: WorkflowBarStage | null
  wave: number
  counts: { done: number; failed: number; open: number }
  tickets: WorkflowBarTicket[]
  mr: WorkflowBarMr | null
  warnings: string[]
}

// The last good report, the tickets that turned done in it (they pop once), and, for a unit with no ticket whose
// stage is no planning stage, the last planning stage the bar kept for it in `$.store`.
export type WorkflowBarBuild = WorkflowBarProgress & { popped: string[]; planning?: string }

// A report of a schema above 1: the bar reads none of it and draws only the update notice for that schema.
export type WorkflowBarNewerSchema = { newerSchema: number }

// A phase chip: done (green), current (amber, shimmering) or later (outline).
export type WorkflowBarChipState = 'done' | 'current' | 'later'

// The pipeline skill running in this session, by its chip's label, with its baseline: the unit and the stage of the
// report shown when it started, taken again from each new report of another unit. `unit` is null while that is
// unknown (no schema-1 report with a unit was shown), and missing from a record kept before the bar kept it: the next
// report of a unit then gives both.
export type WorkflowBarLive = { skill: string; unit: string | null; stage: WorkflowBarStage | null }

declare module 'claude-code' {
  interface PluginState {
    'workflow-bar': {
      agents: WorkflowBarAgent[]
      // The unit this session pinned; a run holds it as `--repo <root> --unit <unit>`.
      unit: WorkflowBarUnit | null
      build: WorkflowBarBuild | WorkflowBarNewerSchema | null
      // Set by a pipeline skill started in this session.
      live: WorkflowBarLive | null
    }
  }
}
