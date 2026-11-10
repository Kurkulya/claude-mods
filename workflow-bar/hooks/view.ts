import { AMBER, GREEN, GREY, chipPaint, ticketPaint } from './palette'
import type { TicketPaint } from './palette'
import { buildView, ticketState } from './build'
import type { BuildView } from './build'
import { finishOf, mrPart, trackOf } from './phase'
import type { Chip, MrPart, PhaseView } from './phase'
import type { WorkflowBarNewerSchema, WorkflowBarProgress, WorkflowBarTicket } from '../types'

type AgentPart = { state: 'running'; count: number } | { state: 'idle' }

// What follows the unit (or the repo): nothing, the phase track before build, the build's wave and segments, or
// `M/M ✓` and the finish chips after it; or, for a report of a newer schema, the update notice alone. `barView` is
// the one place that picks it; every drawing switches on it. A build whose tickets are all done draws the finish.
export type Layout =
  | { kind: 'none' }
  | { kind: 'track'; phase: PhaseView }
  | { kind: 'build'; build: BuildView }
  | { kind: 'finish'; build: BuildView; phase: PhaseView }
  | { kind: 'newer'; schema: number }

// What the bar shows, in drawing order: the agent part, the unit (or the repo), the warnings when the report has
// any, then the layout. The MR is drawn beside the bar, not in it.
export type BarView = AgentPart & { unit?: string; warnings?: readonly string[]; layout: Layout; mr?: MrPart }

type Run = { text: string; color?: string; backgroundColor?: string }

type Facts = {
  runningAgents: number
  unit?: string
  build?: WorkflowBarProgress | WorkflowBarNewerSchema
  // The last planning stage the bar kept for the unit, drawn while the report names no planning stage.
  planning?: string
  // The chip label of the pipeline skill running in this session.
  live?: string
}

const PART_GAP = '  '
const TICKET_GAP = ' '
const GROUP_GAP = '  '
const CHIP_SEPARATOR = ' › '
// Between a chip row and the count of chips done, when the row is shortened.
const COUNT_GAP = ' '

function layoutOf(build: BuildView | undefined, phase: PhaseView | undefined): Layout {
  if (phase?.kind === 'track') {
    return { kind: 'track', phase }
  }
  if (build === undefined) {
    return { kind: 'none' }
  }

  return phase?.kind === 'finish' ? { kind: 'finish', build, phase } : { kind: 'build', build }
}

// What a report of a newer schema draws in place of the bar (D-6).
export function schemaNotice(schema: number) {
  return `anomaly progress schema ${schema} > 1: update workflow-bar`
}

export function warningLabel(warnings: readonly string[]) {
  return `⚠ ${warnings.length}`
}

// Hidden (null) with no report at all; with no agents the agent part is idle. A report that names no unit draws the
// agent part and its warnings alone (ADR-0004; the caller hides the bar when the repo has no `.anomaly/`). A report of
// a newer schema names no unit either and draws the agent part and the notice alone. A report with no ticket draws
// the track of its planning stages.
export function barView({ runningAgents, unit, build, planning, live }: Facts): BarView | null {
  const agents: AgentPart = runningAgents > 0 ? { state: 'running', count: runningAgents } : { state: 'idle' }

  if (build !== undefined && 'newerSchema' in build) {
    return { ...agents, layout: { kind: 'newer', schema: build.newerSchema } }
  }
  const warnings = build?.warnings ?? []

  if (unit === undefined) {
    return build === undefined
      ? null
      : { ...agents, ...(warnings.length === 0 ? {} : { warnings }), layout: { kind: 'none' } }
  }
  const track = build?.tickets.length === 0 ? trackOf(build.stage, planning, live) : undefined
  const tickets = build && buildView(build)
  const isFinished = tickets !== undefined && tickets.total > 0 && tickets.done === tickets.total
  const link = isFinished ? build?.mr?.link : undefined

  return {
    ...agents,
    unit,
    ...(warnings.length === 0 ? {} : { warnings }),
    layout: layoutOf(tickets, isFinished ? finishOf(build?.mr ?? null) : track),
    ...(link ? { mr: mrPart(link) } : {}),
  }
}

// The cells the MR takes beside the bar: its words and the `gap` cells before them; none without an MR.
export function mrReserve(view: BarView, gap: number) {
  return view.mr ? view.mr.text.length + gap : 0
}

export function barLabel(view: BarView) {
  if (view.state === 'idle') {
    return 'idle'
  }

  return view.count === 1 ? '1 agent' : `${view.count} agents`
}

export function dotColor(view: BarView) {
  return view.state === 'running' ? AMBER : GREY
}

// `wave N`, left out (undefined) at wave 0.
export function waveLabel(build: BuildView) {
  return build.wave === 0 ? undefined : `wave ${build.wave}`
}

export function countLabel(build: BuildView) {
  return `${build.done}/${build.total}`
}

// The count once every ticket is closed.
export function doneLabel(build: BuildView) {
  return `${countLabel(build)} ✓`
}

export type ChipPlan = { chips: Chip[]; count?: string }

// The chip that stays when a row is shortened: the amber one, or else the last done one, or the first.
export function keptChip(chips: readonly Chip[]) {
  return chips.find(chip => chip.state === 'current') ?? chips.findLast(chip => chip.state === 'done') ?? chips[0]
}

// How much of a chip row fits, as `fits` measures it on the surface: all chips; else the kept chip with how many
// are done (`3/5`); else the kept chip alone; else nothing.
export function chipPlan(chips: readonly Chip[], fits: (plan: ChipPlan) => boolean): ChipPlan {
  const all = { chips: [...chips] }

  if (fits(all)) {
    return all
  }
  const current = keptChip(chips)

  if (current === undefined) {
    return { chips: [] }
  }
  const counted = { chips: [current], count: `${chips.filter(chip => chip.state === 'done').length}/${chips.length}` }

  if (fits(counted)) {
    return counted
  }
  const alone = { chips: [current] }

  return fits(alone) ? alone : { chips: [] }
}

// The smooth bar's words, for when the segments do not fit.
export function smoothLabel(build: BuildView) {
  return `${build.done} / ${build.total} · ${build.running.length} running`
}

export function nowLabel(build: BuildView) {
  return build.running.length > 0 ? `now ${build.running.join(' ')}` : ''
}

// How much of the build a band holds, widest first: the segments and `k/M`; the smooth bar with `now NN` (while
// tickets run); the smooth bar alone; `k/M` alone; nothing.
type BuildRung = 'segments' | 'smooth-now' | 'smooth' | 'count' | 'none'

// The widest rung that `fits`, as each surface measures it: the one narrow-band ladder for Desktop and terminal.
export function buildRung(build: BuildView, fits: (rung: Exclude<BuildRung, 'none'>) => boolean): BuildRung {
  const rungs: Exclude<BuildRung, 'none'>[] =
    build.running.length > 0 ? ['segments', 'smooth-now', 'smooth', 'count'] : ['segments', 'smooth', 'count']

  return rungs.find(fits) ?? 'none'
}

function chipWords(chip: Chip) {
  return chip.state === 'done' ? `${chip.label} ✓` : chip.state === 'current' ? `${chip.label} (now)` : chip.label
}

function layoutWords(layout: Layout) {
  switch (layout.kind) {
    case 'none':
      return []
    case 'track':
      return [layout.phase.chips.map(chipWords).join(' › ')]
    case 'build':
      return [waveLabel(layout.build), countLabel(layout.build)].filter((words): words is string => words !== undefined)
    case 'finish':
      return [doneLabel(layout.build), layout.phase.chips.map(chipWords).join(' › ')]
    case 'newer':
      return [schemaNotice(layout.schema)]
  }
}

// The bar in one line, for the Svg's `alt`.
export function summary(view: BarView) {
  const unit = view.unit === undefined ? [] : [view.unit]

  return [barLabel(view), ...unit, ...layoutWords(view.layout)].join(' · ')
}

// The terminal has no outline: a filled state is a background, an empty one its words alone.
function paintRun(text: string, paint: TicketPaint): Run {
  return paint.fill === undefined
    ? { text, color: paint.digits }
    : { text, color: paint.digits, backgroundColor: paint.fill }
}

function ticketRun(ticket: WorkflowBarTicket): Run {
  return paintRun(ticket.number, ticketPaint(ticketState(ticket)))
}

function segmentRuns(build: BuildView): Run[] {
  return build.groups.flatMap((group, groupIndex) => [
    ...(groupIndex === 0 ? [] : [{ text: GROUP_GAP }]),
    ...group.flatMap((ticket, index) => [...(index === 0 ? [] : [{ text: TICKET_GAP }]), ticketRun(ticket)]),
  ])
}

function width(runs: readonly Run[]) {
  return runs.reduce((sum, run) => sum + run.text.length, 0)
}

function chipRun(chip: Chip): Run {
  return paintRun(chip.label, chipPaint(chip.state))
}

function chipRunsOf(plan: ChipPlan): Run[] {
  const runs = plan.chips.flatMap((chip, index): Run[] => {
    const separator: Run = { text: CHIP_SEPARATOR, color: GREY }

    return [...(index === 0 ? [] : [separator]), chipRun(chip)]
  })

  return plan.count === undefined ? runs : [...runs, { text: `${COUNT_GAP}${plan.count}`, color: GREY }]
}

// The phase's chips as runs, shortened to what `room` cells hold.
function phaseRuns(phase: PhaseView, room: number): Run[] {
  const plan = chipPlan(phase.chips, candidate => width(chipRunsOf(candidate)) <= room)

  return chipRunsOf(plan)
}

// The terminal's runs: the dot in its colour, the words in the terminal's own foreground (grey while idle), then
// the unit, and the phase track before build; in the build the wave and one coloured number per ticket (or the
// smooth bar's words when they do not fit); after it `M/M ✓` in green and the finish chips.
export function terminalRuns(view: BarView, columns: number): Run[] {
  const words = view.state === 'idle' ? { text: ` ${barLabel(view)}`, color: GREY } : { text: ` ${barLabel(view)}` }
  const head: Run[] = [{ text: '●', color: dotColor(view) }, words]

  if (view.unit !== undefined) {
    head.push({ text: `${PART_GAP}${view.unit}` })
  }
  if (view.warnings !== undefined) {
    head.push({ text: `${PART_GAP}${warningLabel(view.warnings)}` })
  }
  const { layout } = view

  switch (layout.kind) {
    case 'none':
      return head
    case 'newer':
      return [...head, { text: `${PART_GAP}${schemaNotice(layout.schema)}` }]
    case 'track':
      return [...head, { text: PART_GAP }, ...phaseRuns(layout.phase, columns - width(head) - PART_GAP.length)]
    case 'finish': {
      const total: Run[] = [{ text: PART_GAP }, { text: doneLabel(layout.build), color: GREEN }]
      const room = columns - width(head) - width(total) - PART_GAP.length

      return [...head, ...total, { text: PART_GAP }, ...phaseRuns(layout.phase, room)]
    }
    case 'build':
      return [...head, ...buildRuns(layout.build, columns - width(head))]
  }
}

// One rung of the build's ladder as terminal runs: the smooth bar is its words.
function rungRuns(build: BuildView, rung: BuildRung): Run[] {
  const count: Run = { text: `${PART_GAP}${countLabel(build)}` }
  const smooth: Run = { text: `${PART_GAP}${smoothLabel(build)}` }

  switch (rung) {
    case 'segments':
      return [{ text: PART_GAP }, ...segmentRuns(build), count]
    case 'smooth-now':
      return [smooth, { text: `${PART_GAP}${nowLabel(build)}` }]
    case 'smooth':
      return [smooth]
    case 'count':
      return [count]
    case 'none':
      return []
  }
}

// The build on the terminal in `room` cells: `wave N` (none at wave 0), then the widest rung that fits.
function buildRuns(build: BuildView, room: number): Run[] {
  const wave = waveLabel(build)
  const head: Run[] = wave === undefined ? [] : [{ text: `${PART_GAP}${wave}` }]
  const rung = buildRung(build, candidate => width(head) + width(rungRuns(build, candidate)) <= room)

  return [...head, ...rungRuns(build, rung)]
}
