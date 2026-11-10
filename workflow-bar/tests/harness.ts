// The fake engine beneath the plugin and the helpers the topic files share: events in, a fake disk, store and
// anomaly CLI run, and what each surface draws out.
import { expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const PLUGIN = 'workflow-bar'
export const SURFACES = ['terminal', 'desktop'] as const
export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
// The folder the session runs in, on a Windows disk, as the tools spell its paths.
export const REPO = 'C:/work/shop'
export const SESSION_ID = 'session-1'

export type Surface = (typeof SURFACES)[number]

// The engine spells a host path its own way; the fake disk reads `c:\a\b` and `C:/a/b` as one path.
export function diskPath(path: string) {
  return path.replaceAll('\\', '/').replace(/^[a-z]:/, drive => drive.toUpperCase())
}

// What the engine answers beneath the plugin. Where no plugin draws, the band is an empty box keyed `engine`.
export function engineWorld(on: On, stored: Record<string, unknown> = {}) {
  const held = new Map<string, Promise<void>>()
  // The state writes so far, and those of the `build` atom alone.
  const state = { writes: 0, buildWrites: 0 }
  const disk = {
    files: new Map<string, { text: string; mtimeMs: number }>(),
    // What the anomaly CLI's `progress --json` run prints.
    progress: { exitCode: 0, stdout: '' },
    // How a `progress --json` run fails instead of answering: 'reject' cannot start; 'timeout' outlasts its `timeoutMs`.
    progressFault: undefined as 'reject' | 'timeout' | undefined,
    runs: [] as string[][],
    // The `cwd` each run asked for, in the order of `runs`.
    runCwds: [] as (string | undefined)[],
    // The folders that exist on the fake disk, besides the ones a file lies in.
    folders: new Set<string>(),
    // Whether `fs.exists` fails instead of answering.
    isExistsFaulty: false,
    // The path of every `fs.exists` ask so far, as the fake disk spells it.
    existsAsked: [] as string[],
    // Why the engine denies every tool call; undefined lets them through.
    toolDeny: undefined as string | undefined,
    // The folder the session runs in.
    cwd: REPO,
    // Holds the `at`-th read of state `key` until released.
    gate: undefined as { key: string; at: number; seen: number; hold: Promise<void> } | undefined,
    progressHold: undefined as Promise<void> | undefined,
    // A state key whose reads fail, as a fault inside the bar's own work.
    stateFault: undefined as string | undefined,
    // The lines the plugin logged.
    logs: [] as string[],
  }
  const store = new Map<string, unknown>(Object.entries(stored))
  const clock = mock.clock(on)

  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.cwd', () => ({ value: disk.cwd }))
  on('ui.log', (_, e) => {
    disk.logs.push(e.text)

    return { value: undefined }
  })
  on('state.get', async (_, e, next) => {
    if (e.key === disk.stateFault) {
      return { deny: 'state read failed for C:/Users/vk/secret.md' }
    }
    const gate = disk.gate

    if (gate && e.key === gate.key) {
      gate.seen += 1

      if (gate.seen === gate.at) {
        await gate.hold
      }
    }

    return next(e)
  })
  on('fs.list', (_, e) => {
    const folder = `${diskPath(e.path)}/`
    const names = new Map<string, 'file' | 'dir'>()

    for (const path of disk.files.keys()) {
      if (path.startsWith(folder)) {
        const [name = '', ...rest] = path.slice(folder.length).split('/')
        names.set(name, rest.length > 0 ? 'dir' : 'file')
      }
    }
    if (names.size === 0) {
      return { deny: 'ENOENT' }
    }
    const entries = [...names].map(([name, kind]) => {
      const file = disk.files.get(`${folder}${name}`)

      return { name, kind, size: file?.text.length ?? 0, mtimeMs: file?.mtimeMs ?? 0, isLink: false }
    })

    return { value: entries }
  })
  on('fs.read', (_, e) => {
    const file = disk.files.get(diskPath(e.path))

    return file === undefined ? { deny: 'ENOENT' } : { value: file.text }
  })
  on('fs.exists', (_, e) => {
    const path = diskPath(e.path)
    disk.existsAsked.push(path)
    if (disk.isExistsFaulty) {
      return { deny: 'EIO' }
    }
    const isFolder = disk.folders.has(path) || [...disk.files.keys()].some(file => file.startsWith(`${path}/`))

    return { value: isFolder || disk.files.has(path) }
  })
  // A tool call the plugin lets through: the engine's own tool answers an empty result, or denies it.
  on('tool.call', () => (disk.toolDeny === undefined ? { result: {}, text: '' } : { deny: disk.toolDeny }))
  // A held run answers once released, with what the CLI prints by then.
  on('process.run', async (_, e) => {
    disk.runs.push([...e.argv])
    disk.runCwds.push(e.init?.cwd)

    if (e.argv.includes('progress')) {
      await disk.progressHold

      if (disk.progressFault === 'timeout') {
        await clock.sleep(e.init?.timeoutMs ?? 30_000)
      }
      if (disk.progressFault !== undefined) {
        return { deny: `progress run: ${disk.progressFault}` }
      }

      return { value: { ...disk.progress, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }

    return { deny: 'not the anomaly CLI' }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  mock.env(on, { USERPROFILE: 'C:\\Users\\vk' })
  on('agent.spawn', async (_, e) => {
    const id = e.name ?? 'spawned'
    await held.get(id)

    return { model: 'claude-haiku-4-5', agentId: id }
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('state.set', (_, e, next) => {
    state.writes += 1
    if (e.key === 'build') {
      state.buildWrites += 1
    }

    return next(e)
  })

  // Holds the spawn of `id` until the returned release runs, as a spawn whose id is not known yet.
  function hold(id: string) {
    let release = () => {}
    held.set(id, new Promise<void>(resolve => (release = resolve)))

    return () => release()
  }

  function write(path: string, text = 'x', mtimeMs = 1) {
    disk.files.set(path, { text, mtimeMs })
  }

  // Holds the `at`-th read of state `key` (counted from now) until the returned release runs.
  function gateRead(key: string, at: number) {
    let release = () => {}
    disk.gate = { key, at, seen: 0, hold: new Promise<void>(resolve => (release = resolve)) }

    return () => release()
  }

  // Holds every CLI run started until the returned release runs.
  function holdProgress() {
    let release = () => {}
    disk.progressHold = new Promise<void>(resolve => (release = resolve))

    return () => {
      disk.progressHold = undefined
      release()
    }
  }

  return {
    hold,
    state,
    disk,
    store,
    clock,
    write,
    holdProgress,
    gateRead,
  }
}

export type World = ReturnType<typeof engineWorld>

// The argv of every `progress --json` run so far.
export function progressRuns(world: World) {
  return world.disk.runs.filter(argv => argv.includes('progress'))
}

export function spawn($: Engine, name: string, background = true) {
  return $.agent.spawn({
    tool_use_id: `spawn-${name}`,
    prompt: 'Look around',
    description: `Task ${name}`,
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-4-1',
    background,
    fork: false,
    name,
  })
}

export async function step($: Engine, agentId: string) {
  const stream = $.turn.step({ turnId: `turn-${agentId}`, index: 0, model: 'requested', messageCount: 1, agentId })
  for await (const _chunk of stream) {
    continue
  }
}

export function finish($: Engine, agentId: string | undefined, reason: 'answer' | 'aborted' = 'answer') {
  return $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: `turn-${agentId ?? 'main'}`,
    agentId,
    reason,
  })
}

export function mountBand($: Engine, surface: Surface, overrides: Partial<typeof BAND_PROPS> = {}) {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND_PROPS, ...overrides } })
}

// What VK sees in the band on one surface, 160 cells wide unless told: whether it is hidden; the Svg with its words
// and segments; the Link; the Text runs and their line.
export async function draw($: Engine, surface: Surface, overrides: Partial<typeof BAND_PROPS> = {}) {
  const ui = await mountBand($, surface, { bodyColumns: 160, ...overrides })
  const tree = await ui.drawn()
  const svgs = await ui.findAll({ type: 'Svg' })
  const links = await ui.findAll({ type: 'Link' })
  const runs = await ui.findAll({ type: 'Text' })
  const isHidden = (await ui.find({ key: 'engine' })) !== undefined
  await ui.unmount()
  const [svg] = svgs
  const source = String(svg?.props.source ?? '')

  return {
    isHidden,
    tree,
    svgs,
    svg,
    source,
    segments: segmentsOf(source),
    words: wordsOf(source),
    links,
    runs,
    line: runs.map(run => run.text).join(''),
  }
}

// The band's first words on each surface (the Svg's first <text>, the terminal's whole line), or hidden.
export async function expectBand($: Engine, shown: string | undefined) {
  for (const surface of SURFACES) {
    const drawn = await draw($, surface, { bodyColumns: BAND_PROPS.bodyColumns })

    if (shown === undefined) {
      expect(drawn.isHidden).toBe(true)
    } else {
      expect(drawn.isHidden ? undefined : surface === 'desktop' ? drawn.words[0] : drawn.line).toContain(shown)
    }
  }
}

// The bar runs the CLI after the hook that asked has returned: settle lets that run.
export async function settled<T>(world: World, work: Promise<T>) {
  const result = await work
  await world.clock.settle()

  return result
}

export function start($: Engine, world: World) {
  return settled(world, $.session.start({ cwd: REPO, surface: 'desktop', isInteractive: true }))
}

// VK presses Enter in the composer.
export function submit($: Engine, world: World, text: string) {
  return settled(world, $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } }))
}

// A tool call as the model makes it; with `agentId`, as a subagent's loop makes it.
export function callTool($: Engine, world: World, input: { tool: string; [key: string]: unknown }, agentId?: string) {
  return settled(world, $.tool.call({ ...input, agentId } as Parameters<Engine['tool']['call']>[0]))
}

export type Segment = {
  number: string
  state: string
  isPopped: boolean
  x: number
  fill: string
  digits: string
  title: string
  // Whether the pointer finds the box anywhere inside it, so its tooltip shows.
  isHoverable: boolean
}

// The SVG's segments in drawing order: each a `<g class="seg <state>">` with its tooltip (its lines one per row),
// box and digits.
export function segmentsOf(source: string): Segment[] {
  const groups = source.matchAll(/<g class="seg (done|running|waiting)( pop)?" data-ticket="(\d+)">([\s\S]*?)<\/g>/g)

  return [...groups].map(([, state = '', pop, number = '', body = '']) => {
    const box = /<rect x="[^>]*\/>/.exec(body)?.[0] ?? ''
    const fill = /fill="([^"]+)"/.exec(box)?.[1] ?? ''
    const digits = /<text[^>]*fill="([^"]+)"[^>]*>(\d+)<\/text>/.exec(body)

    return {
      number,
      state,
      isPopped: pop !== undefined,
      x: Number(/x="([\d.]+)"/.exec(box)?.[1]),
      fill,
      digits: digits?.[1] ?? '',
      title: /<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? '',
      isHoverable: fill !== 'none' || box.includes('pointer-events="all"'),
    }
  })
}

export function wordsOf(source: string) {
  return [...source.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(([, words]) => words)
}

// The stage chips of a unit with no ticket, in drawing order.
export const STAGES = ['interview', 'specify', 'slice', 'conduct', 'ship']

// The stage chips the Desktop's Svg draws, in drawing order, each as `label:state` (done, current or later).
export function chipsOf(source: string) {
  const chips = source.matchAll(/<g class="chip (done|current|later)" data-chip="([^"]*)"/g)

  return [...chips].map(([, state, label]) => `${label}:${state}`)
}

// The chips of a unit with no ticket once the first `done` stages are done: the next is current, the rest later.
export function stagesAt(done: number) {
  return STAGES.map((label, index) => `${label}:${index < done ? 'done' : index === done ? 'current' : 'later'}`)
}

export const TICK_MS = 10_000
export const PROCESS_TIMEOUT_MS = 5_000
// After a failed run no run starts for this long.
export const PAUSE_MS = 30_000

export const PROGRESS_UNIT = 'auto-measure'
// The real stdout of `anomaly.py progress --json --repo <the anomaly repo> --unit auto-measure` (anomaly ee37bf10eead):
// four tickets, all done, with the MR, the cost and the stage.
export const PROGRESS_BASE =
  '{"schema": 1, "unit": "auto-measure", "picked_by": "unit-option", "stage": {"name": "review", "ended": "2026-10-12 14:36"}, "wave": 4, "counts": {"done": 4, "failed": 0, "open": 0}, "next": [], "tickets": [{"slug": "01-measure-quiet", "title": "measure --quiet", "status": "done", "blocked_by": [], "kind": "done", "reason": null, "red": true, "reviewed": true, "verified": true, "build_minutes": 7, "high": 1, "fix_rounds": 1}, {"slug": "02-measure-lock", "title": "The measure lock", "status": "done", "blocked_by": ["01"], "kind": "done", "reason": null, "red": true, "reviewed": true, "verified": true, "build_minutes": 19, "high": 1, "fix_rounds": 4}, {"slug": "03-conduct-measures-before-report", "title": "Conduct measures before the wave report", "status": "done", "blocked_by": ["02"], "kind": "done", "reason": null, "red": true, "reviewed": true, "verified": true, "build_minutes": 7, "high": 1, "fix_rounds": 1}, {"slug": "04-start-hook-adr-and-reference", "title": "The start hook, ADR-0026 and the reference", "status": "done", "blocked_by": ["03"], "kind": "done", "reason": null, "red": true, "reviewed": true, "verified": true, "build_minutes": 10, "high": 0, "fix_rounds": 1}], "mr": {"link": "https://github.com/Kurkulya/anomaly/pull/19", "reviewed": "4009febc17b8bfbcb517ef7c64a295f1c80c5971", "verified": "4009febc17b8bfbcb517ef7c64a295f1c80c5971"}, "cost": {"weighted_tokens": 15347899.95, "merged": 4, "build_minutes": 43}, "warnings": []}'

export type ProgressTicket = {
  slug: string
  title: string
  status: string
  blocked_by: string[]
  kind: string
  reason: string | null
  red: boolean
  reviewed: boolean
  verified: boolean
  build_minutes: number | null
  high: number | null
  fix_rounds: number | null
}

export type ProgressReport = {
  schema: number
  unit: string | null
  picked_by: string
  stage: { name: string; ended: string } | null
  wave: number
  counts: { done: number; failed: number; open: number }
  next: string[]
  tickets: ProgressTicket[]
  mr: { link: string | null; reviewed: string | null; verified: string | null } | null
  cost: { weighted_tokens: number; merged: number; build_minutes: number } | null
  warnings: string[]
  [key: string]: unknown
}

// A case of the CLI's stdout: the base fixture (or the stdout `from`) with some fields changed.
export function progressReport(change: (report: ProgressReport) => void = () => {}, from = PROGRESS_BASE) {
  const report = JSON.parse(from) as ProgressReport
  change(report)

  return JSON.stringify(report)
}

// A unit with no ticket yet, whose newest ended stage is `stage` (null for none), and its warnings.
export function planningReport(stage: ProgressReport['stage'], warnings: string[] = []) {
  return progressReport(report => {
    report.tickets = []
    report.counts = { done: 0, failed: 0, open: 0 }
    report.wave = 0
    report.stage = stage
    report.mr = null
    report.cost = null
    report.warnings = warnings
  })
}

// A unit with no ticket whose newest ended stage is `name`, ended at `ended`.
export const stagedAt = (name: string, ended: string, warnings: string[] = []) =>
  planningReport({ name, ended }, warnings)

// The base with its last two tickets not done: 03 is running (the CLI counts it as failed) and 04 is blocked by it.
export const PROGRESS_OPEN = progressReport(report => {
  const [, , third, fourth] = report.tickets as [ProgressTicket, ProgressTicket, ProgressTicket, ProgressTicket]
  Object.assign(third, {
    status: 'in-progress',
    kind: 'running',
    reason: 'in progress',
    reviewed: false,
    verified: false,
    build_minutes: null,
    high: null,
    fix_rounds: null,
  })
  Object.assign(fourth, {
    status: 'ready-for-agent',
    blocked_by: ['03'],
    kind: 'blocked',
    reason: 'blocked by 03 (in-progress)',
    red: false,
    reviewed: false,
    verified: false,
    build_minutes: null,
    high: null,
    fix_rounds: null,
  })
  report.counts = { done: 2, failed: 1, open: 1 }
  report.mr = { link: null, reviewed: null, verified: null }
})

// PROGRESS_OPEN with no unit: the CLI found none, so the bar draws nothing.
export const NO_UNIT = progressReport(report => {
  report.unit = null
}, PROGRESS_OPEN)

// The real stdout of `progress --json` in a repo with `.anomaly/` whose units are all finished: the CLI picks no unit.
export const NO_UNIT_PICKED =
  '{"schema": 1, "unit": null, "warnings": ["no work unit picked: none matches the current branch and none is unfinished"]}'

export const INSTALLED_PLUGINS = 'C:/Users/vk/.claude/plugins/installed_plugins.json'
export const ANOMALY_INSTALL = 'C:\\Users\\vk\\.claude\\plugins\\cache\\anomaly-local\\anomaly\\ee37bf10eead'

// The anomaly plugin installed, and what its `progress --json` prints.
export function withAnomaly(world: World, stdout = PROGRESS_OPEN) {
  const plugins = { 'anomaly@anomaly-local': [{ scope: 'user', installPath: ANOMALY_INSTALL }] }
  world.write(INSTALLED_PLUGINS, JSON.stringify({ version: 2, plugins }))
  world.disk.progress.stdout = stdout
}

// A session started with the anomaly plugin installed: the bar draws the report of PROGRESS_OPEN (or `stdout`).
export async function startWithAnomaly($: Engine, world: World, stdout = PROGRESS_OPEN) {
  withAnomaly(world, stdout)
  await start($, world)
}

// PROGRESS_OPEN once the tickets named are done too, with the counts the CLI then prints.
export function progressDone(...numbers: string[]) {
  return progressReport(report => {
    const named = report.tickets.filter(ticket => numbers.some(number => ticket.slug.startsWith(number)))

    for (const ticket of named) {
      Object.assign(ticket, { status: 'done', kind: 'done', reason: null })
    }
    const done = report.tickets.filter(ticket => ticket.kind === 'done').length
    const failed = report.tickets.filter(ticket => ticket.kind === 'running').length
    report.counts = { done, failed, open: report.tickets.length - done - failed }
  }, PROGRESS_OPEN)
}
