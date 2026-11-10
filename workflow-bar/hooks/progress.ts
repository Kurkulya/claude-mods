import type {
  WorkflowBarMr,
  WorkflowBarNewerSchema,
  WorkflowBarProgress,
  WorkflowBarStage,
  WorkflowBarTicket,
} from '../types'

type Json = Record<string, unknown>

// What `cleanText` removes: the C0 controls, DEL, the C1 controls, the bidi controls (U+202A to U+202E and U+2066 to
// U+2069, which can reorder what the terminal shows) and a lone surrogate (with the `u` flag a whole pair is one code
// point, so only a lone half matches).
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u{202A}-\u{202E}\u{2066}-\u{2069}\uD800-\uDFFF]/gu
const SPACED = /\r\n|[\r\n\t]/g

// Every string of the report is raw local file text: a tab or a line break becomes a space and every other control is
// removed, so no escape sequence reaches the terminal (D-12).
export function cleanText(text: string) {
  return text.replace(SPACED, ' ').replace(CONTROL, '')
}

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? cleanText(value) : ''
}

function textOrNull(value: unknown) {
  return typeof value === 'string' ? cleanText(value) : null
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function count(value: unknown) {
  return numberOrNull(value) ?? 0
}

// A warning is a string; anything else is left out.
function warningOf(value: unknown) {
  return typeof value === 'string' ? [cleanText(value)] : []
}

// The newest ended stage is an object with its name and ended time; anything else is none.
function stageOf(value: unknown): WorkflowBarStage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const stage = value as Json

  return { name: text(stage.name), ended: text(stage.ended) }
}

// The MR is an object with its link, reviewed and verified fields, each a string or null; anything else is none.
function mrOf(value: unknown): WorkflowBarMr | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const mr = value as Json

  return { link: textOrNull(mr.link), reviewed: textOrNull(mr.reviewed), verified: textOrNull(mr.verified) }
}

// A ticket is drawn with the two digits of its slug.
function ticketOf(value: unknown): WorkflowBarTicket {
  const ticket = record(value)

  return {
    number: text(ticket.slug).slice(0, 2),
    title: text(ticket.title),
    kind: text(ticket.kind),
    reason: textOrNull(ticket.reason),
    red: ticket.red === true,
    reviewed: ticket.reviewed === true,
    verified: ticket.verified === true,
    buildMinutes: numberOrNull(ticket.build_minutes),
    high: numberOrNull(ticket.high),
    fixRounds: numberOrNull(ticket.fix_rounds),
  }
}

// The stdout of `progress --json` (schema 1) as the bar draws it: only the fields the bar reads, so a field schema 1
// does not name is left out, and every string cleaned. An integer `schema` above 1 is a newer report the bar does not
// read (D-6). Output that is not one JSON object, or whose `schema` is not an integer of 1 or more, is no report.
export function parseProgress(stdout: string): WorkflowBarProgress | WorkflowBarNewerSchema | undefined {
  let parsed: unknown

  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const report = parsed as Json
  const schema = numberOrNull(report.schema)

  if (schema === null || schema < 1) {
    return undefined
  }
  if (schema > 1) {
    return { newerSchema: schema }
  }
  const counts = record(report.counts)

  return {
    unit: textOrNull(report.unit),
    stage: stageOf(report.stage),
    wave: count(report.wave),
    counts: { done: count(counts.done), failed: count(counts.failed), open: count(counts.open) },
    tickets: Array.isArray(report.tickets) ? report.tickets.map(ticketOf) : [],
    mr: mrOf(report.mr),
    warnings: Array.isArray(report.warnings) ? report.warnings.flatMap(warningOf) : [],
  }
}

// `installed_plugins.json` maps each `<plugin>@<marketplace>` key to its installs: the anomaly CLI is under the
// `installPath` of the first install of the first key that starts with `anomaly@` (ADR-0002). None is undefined.
export function anomalyInstallPath(installedPlugins: string) {
  try {
    const plugins = record(record(JSON.parse(installedPlugins)).plugins)
    const installs = Object.entries(plugins).find(([key]) => key.startsWith('anomaly@'))?.[1]
    const path = Array.isArray(installs) ? record(installs[0]).installPath : undefined

    return typeof path === 'string' && path !== '' ? path : undefined
  } catch {
    return undefined
  }
}

// A Windows install path (a drive letter or a `\`) runs `python`, any other `python3` (D-3).
function interpreterOf(installPath: string) {
  return /^[A-Za-z]:/.test(installPath) || installPath.includes('\\') ? 'python' : 'python3'
}

// The anomaly CLI's script, in `<installPath>/scripts/`.
export const ANOMALY_SCRIPT = 'anomaly.py'

// Whether a shell command holds the anomaly CLI's script, so it may change what a run reports.
export function isAnomalyCommand(command: string) {
  return command.includes(ANOMALY_SCRIPT)
}

// The CLI run for a folder: no `--home`, so each platform reads its own anomaly home (ADR-0002), and `--unit` only for
// a pinned unit; without it the CLI picks the unit (ADR-0001).
export function progressCommand(installPath: string, root: string, unit?: string) {
  const script = `${installPath}/scripts/${ANOMALY_SCRIPT}`
  const pinned = unit === undefined ? [] : ['--unit', unit]

  return [interpreterOf(installPath), '-I', script, 'progress', '--json', '--repo', root, ...pinned]
}
