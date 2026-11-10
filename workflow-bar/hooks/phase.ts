import type { WorkflowBarChipState, WorkflowBarMr, WorkflowBarStage } from '../types'

export type Chip = { label: string; state: WorkflowBarChipState }

// The track before build, or the finish chips after it.
export type PhaseView = { kind: 'track' | 'finish'; chips: Chip[] }

// The track's chips, in order; the first three are the planning stages.
const STAGES = ['interview', 'specify', 'slice', 'conduct', 'ship']
const PLANNING_STAGES = STAGES.slice(0, 3)

// Only `interview`, `specify` and `slice` move the track; any other stage name (`review`, `build`, `diagnose`) does
// not (D-9).
export function isPlanningStage(name: string) {
  return PLANNING_STAGES.includes(name)
}

// The track of a unit with no ticket (D-9, D-27). The planning stage drawn is the report's `stage` when it is one,
// else `planning` (the last one the bar kept for the unit), else none: it and the chips before it are done. The chip
// of the `live` skill is current, else the one after the planning stage; the rest are later.
export function trackOf(stage: WorkflowBarStage | null, planning: string | undefined, live?: string): PhaseView {
  const last = stage !== null && isPlanningStage(stage.name) ? stage.name : planning
  const done = last === undefined ? 0 : STAGES.indexOf(last) + 1
  const current = live ?? STAGES[done]
  const stateOf = (label: string, index: number): WorkflowBarChipState =>
    label === current ? 'current' : index < done ? 'done' : 'later'

  return { kind: 'track', chips: STAGES.map((label, index) => ({ label, state: stateOf(label, index) })) }
}

// The MR's words beside the bar, and where it goes when the URL passed the checks.
export type MrPart = { text: string; href?: string }

// The longest `href` the engine takes.
const MAX_HREF = 2048

// The pipeline skills by their own name, each with its chip's label: the anomaly skill of each planning stage has the
// stage's name.
const LIVE_OF = new Map(PLANNING_STAGES.map(stage => [stage, stage] as const))

// A pipeline skill is invoked bare or in the anomaly namespace (`anomaly:skill`); another plugin's skill of the same
// name, or a path, is none.
export function liveSkillOf(name: string) {
  return LIVE_OF.get(/^(?:anomaly:)?([^:/]*)$/.exec(name)?.[1] ?? '')
}

// The URL as the engine takes it for a `Link`, or undefined: https, at most 2048 printable ASCII characters, no `@`,
// spelled as `new URL(href).href`. `mr.link` is the orchestrator's own field, so the host is not checked.
export function safeHref(url: string) {
  try {
    const isLink = url.length <= MAX_HREF && /^https:\/\/[!-~]+$/.test(url) && !url.includes('@')

    return isLink && new URL(url).href === url ? url : undefined
  } catch {
    return undefined
  }
}

// The longest plain text the MR part shows when its link is no Link.
const MR_TEXT_MAX = 24

// The hosts whose links the label leaves unnamed.
const KNOWN_HOSTS = new Set(['github.com', 'gitlab.com'])

// The short label of a checked link: `PR #<n>` for `/pull/<n>`, `!<n>` for `/merge_requests/<n>`, else `MR`; any host
// but github.com and gitlab.com follows as ` · <host>`, so a link to another site never reads as a known one (D-11).
function mrLabel(href: string) {
  const { host, pathname } = new URL(href)
  const pull = /\/pull\/(\d+)(?:\/|$)/.exec(pathname)?.[1]
  const request = /\/merge_requests\/(\d+)(?:\/|$)/.exec(pathname)?.[1]
  const label = pull !== undefined ? `PR #${pull}` : request === undefined ? 'MR' : `!${request}`

  return KNOWN_HOSTS.has(host) ? label : `${label} · ${shortHost(host)}`
}

// A host of at most 24 code points whole, a longer one as `…` and its last 23: a long host never takes the whole band,
// and its end, which names the real site, stays (a start can spell `github.com`) (D-11).
function shortHost(host: string) {
  const points = Array.from(host)

  return points.length <= MR_TEXT_MAX ? host : `…${points.slice(1 - MR_TEXT_MAX).join('')}`
}

// The MR part beside the bar (D-11): a link that passes `safeHref` is a Link with a short label; any other is its
// first 24 characters (code points, so the cut never leaves half of an emoji) as plain text.
export function mrPart(link: string): MrPart {
  const href = safeHref(link)

  return href === undefined ? { text: Array.from(link).slice(0, MR_TEXT_MAX).join('') } : { text: mrLabel(href), href }
}

// The chips after the last ticket: `MR`, `reviewed` and `verified`, each done when its field of the report's `mr` is
// not null (a null `mr` is three nulls); the first one not done is current.
export function finishOf(mr: WorkflowBarMr | null): PhaseView {
  const fields = [mr?.link ?? null, mr?.reviewed ?? null, mr?.verified ?? null]
  const labels = ['MR', 'reviewed', 'verified']
  const current = fields.findIndex(field => field === null)
  const stateOf = (index: number): WorkflowBarChipState =>
    fields[index] !== null ? 'done' : index === current ? 'current' : 'later'

  return { kind: 'finish', chips: labels.map((label, index) => ({ label, state: stateOf(index) })) }
}
