import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { POP_MS } from '../hooks/svg'
import { STORE_PREFIX } from '../hooks/unit'
import {
  NO_UNIT,
  PAUSE_MS,
  PROGRESS_BASE,
  PROGRESS_OPEN,
  PROGRESS_UNIT,
  SESSION_ID,
  SURFACES,
  TICK_MS,
  callTool,
  chipsOf,
  diskPath,
  draw,
  engineWorld,
  expectBand,
  finish,
  progressDone,
  progressReport,
  progressRuns,
  settled,
  spawn,
  stagedAt,
  stagesAt,
  start,
  startWithAnomaly,
  submit,
  withAnomaly,
} from './harness'
import type { World } from './harness'

async function segmentOf($: Engine, number: string) {
  return (await draw($, 'desktop')).segments.find(segment => segment.number === number)
}

describe('the unit the CLI picked', () => {
  test('the bar stays idle between waves: open tickets, no agents', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    await spawn($, 'a1')
    await settled(world, finish($, 'a1'))

    const desktop = await draw($, 'desktop')
    expect(desktop.words[0]).toBe('idle')
    expect(desktop.segments.map(segment => segment.number)).toEqual(['01', '02', '03', '04'])
    expect((await draw($, 'terminal')).line).toContain('● idle')
  })

  test("the session's own agents count beside the unit", async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    await spawn($, 'a1')

    const desktop = await draw($, 'desktop')
    expect(desktop.words).toEqual(expect.arrayContaining(['1 agent', PROGRESS_UNIT]))
    expect(desktop.segments).toHaveLength(4)
  })

  test('a survey holds the band while a unit is shown', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    for (const surface of SURFACES) {
      expect((await draw($, surface, { hasSurvey: true, bodyColumns: 120 })).isHidden).toBe(true)
    }
  })

  test('a prompt runs the CLI again, so a unit another session started shows', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, NO_UNIT)
    await expectBand($, undefined)

    world.disk.progress.stdout = PROGRESS_OPEN
    await submit($, world, 'what is going on?')

    expect((await draw($, 'desktop')).words).toContain(PROGRESS_UNIT)
  })
})

describe('the ten-second refresh', () => {
  test("another session's ticket change shows within ten seconds", async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    expect((await segmentOf($, '03'))?.state).toBe('running')

    world.disk.progress.stdout = progressDone('03')
    await world.clock.advance(TICK_MS - 1_000)
    expect((await segmentOf($, '03'))?.state).toBe('running')

    await world.clock.advance(1_000)
    const desktop = await draw($, 'desktop')
    expect(desktop.segments.find(segment => segment.number === '03')?.state).toBe('done')
    expect(desktop.words).toContain('3/4')
    expect((await draw($, 'terminal')).line).toContain('3/4')
  })

  test('a second session start does not double the clock', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    const runs = world.disk.runs.length
    await world.clock.advance(TICK_MS)
    const oneTick = world.disk.runs.length - runs

    await start($, world)
    const again = world.disk.runs.length
    await world.clock.advance(TICK_MS)

    expect(oneTick).toBe(1)
    expect(world.disk.runs.length - again).toBe(oneTick)
  })

  test('a refresh asked for while the clock check runs is not lost', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    await spawn($, 'a1')

    // The tick's refresh finds the same stdout, so its first read of the build is the clock check's; it stops there
    // while an agent ends and the report changes.
    const release = world.gateRead('build', 1)
    await world.clock.advance(TICK_MS)
    world.disk.progress.stdout = progressDone('03')
    await finish($, 'a1')
    await world.clock.settle()
    release()
    await world.clock.settle()

    expect((await draw($, 'desktop')).words).toContain('3/4')
  })

  test('the first hook of a module that has not seen session.start runs the CLI and the clock', async ($, on) => {
    // A reload leaves $.state and drops the module's variables and timers; the bar is drawn before anything else.
    const world = engineWorld(on)
    withAnomaly(world)

    await draw($, 'desktop', { bodyColumns: 120 })
    await world.clock.settle()
    expect((await draw($, 'desktop')).segments).toHaveLength(4)

    world.disk.progress.stdout = progressDone('03')
    await world.clock.advance(TICK_MS)

    expect((await draw($, 'desktop')).words).toContain('3/4')
  })
})

describe('faults', () => {
  test('a fault in the refresh is reported once, and the bar keeps its last drawing and its clock', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)

    world.disk.stateFault = 'build'
    await world.clock.advance(TICK_MS)
    await world.clock.advance(TICK_MS)
    world.disk.stateFault = undefined

    expect(world.disk.logs).toHaveLength(1)
    expect(world.disk.logs[0]).toContain('Error')
    expect(world.disk.logs[0]).not.toContain('C:/Users')
    expect((await draw($, 'desktop')).segments).toHaveLength(4)

    world.disk.progress.stdout = progressDone('03')
    await world.clock.advance(TICK_MS)
    expect((await draw($, 'desktop')).words).toContain('3/4')
  })
})

// The checkout whose unit a session pins: not the folder the session runs in, so `--repo` shows the path's own root.
const MAIN = 'C:/work/main'
const UNIT = 'checkout'
const UNIT_FOLDER = `${MAIN}/.anomaly/${UNIT}`
const PINNED = ['--repo', MAIN, '--unit', UNIT]
const WINDOWS_FILE = 'C:\\work\\main\\.anomaly\\checkout\\tickets\\01-x.md'

// A prompt asks for a run; the argv of the run it started.
async function nextRun($: Engine, world: World, text = 'go on') {
  const before = progressRuns(world).length
  await submit($, world, text)
  const runs = progressRuns(world)
  expect(runs.length).toBeGreaterThan(before)

  return runs[runs.length - 1] ?? []
}

// A session with the anomaly plugin, running in another folder than MAIN, and MAIN's unit folder on its disk, holding
// the ticket file WINDOWS_FILE names.
async function startBesideUnit($: Engine, world: World) {
  world.write(diskPath(WINDOWS_FILE))
  await startWithAnomaly($, world)
}

// MAIN's unit folder is gone from the disk, with its file.
function removeUnit(world: World) {
  world.disk.files.delete(diskPath(WINDOWS_FILE))
}

describe('the unit a main-loop path pins', () => {
  for (const tool of ['Read', 'Edit', 'Write']) {
    test(`a main-loop ${tool} of a file under <root>/.anomaly/<unit>/ pins that unit (AC-8)`, async ($, on) => {
      const world = engineWorld(on)
      await startBesideUnit($, world)
      expect(progressRuns(world)[0]).not.toContain('--unit')

      await callTool($, world, { tool, file_path: WINDOWS_FILE })

      expect((await nextRun($, world)).slice(-4)).toEqual(PINNED)
    })
  }

  test('a main-loop Read of a file that does not exist pins nothing (AC-8)', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    await callTool($, world, { tool: 'Read', file_path: 'C:\\work\\main\\.anomaly\\checkout\\missing.md' })

    expect(await nextRun($, world)).not.toContain('--unit')
  })

  test('a main-loop Read whose file check fails pins nothing (AC-8)', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    world.disk.isExistsFaulty = true

    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })

    expect(await nextRun($, world)).not.toContain('--unit')
  })

  test('a main-loop Bash command naming an absolute path under <root>/.anomaly/<unit>/ pins that unit (AC-9)', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    await callTool($, world, { tool: 'Bash', command: 'ls /c/work/main/.anomaly/checkout/tickets' })

    expect((await nextRun($, world)).slice(-4)).toEqual(PINNED)
  })

  test("a subagent's file call or command pins nothing, and the main loop's still does (AC-10)", async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE }, 'a1')
    await callTool($, world, { tool: 'Bash', command: `cat ${UNIT_FOLDER}/stories.md` }, 'a1')
    expect(await nextRun($, world)).not.toContain('--unit')

    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })
    expect((await nextRun($, world)).slice(-4)).toEqual(PINNED)
  })

  test('a denied main-loop Read pins nothing', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    world.disk.toolDeny = 'denied by the user'

    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })

    expect(await nextRun($, world)).not.toContain('--unit')
  })
})

describe('the pin across a restart', () => {
  test('a pin is kept in $.store under the session, as the unit and its folder', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })

    expect(world.store.get(`${STORE_PREFIX}${SESSION_ID}`)).toEqual({ name: UNIT, path: UNIT_FOLDER })
  })

  test('a restarted session finds its pin in $.store: its first run holds --unit (AC-11)', async ($, on) => {
    const world = engineWorld(on, { [`${STORE_PREFIX}${SESSION_ID}`]: { name: UNIT, path: UNIT_FOLDER } })

    await startBesideUnit($, world)

    expect(progressRuns(world)[0]?.slice(-4)).toEqual(PINNED)
  })
})

describe('dropping the pin', () => {
  test('a pinned run answering unit null with the folder gone drops the pin: a run with no --unit follows at once, and the next run holds none (AC-12)', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })
    removeUnit(world)
    world.disk.progress.stdout = NO_UNIT

    const [pinnedRun, ...after] = await runsStarted(world, () => submit($, world, 'the pinned run'))
    expect(pinnedRun?.slice(-4)).toEqual(PINNED)
    expect(after.map(argv => argv.includes('--unit'))).toEqual([false])

    expect(await nextRun($, world, 'the run after')).not.toContain('--unit')
  })

  test('a pinned run answering unit null with the folder present keeps the pin (AC-12)', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })
    world.disk.progress.stdout = NO_UNIT

    expect((await nextRun($, world, 'the pinned run')).slice(-4)).toEqual(PINNED)

    // The pin's root holds `.anomaly/`, so the agent part draws though the report names no unit (ADR-0004).
    await expectBand($, 'idle')
    expect((await draw($, 'desktop')).words).not.toContain(PROGRESS_UNIT)
    expect((await nextRun($, world, 'the run after')).slice(-4)).toEqual(PINNED)
  })

  test('a fs.exists that fails keeps the pin', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })
    removeUnit(world)
    world.disk.isExistsFaulty = true
    world.disk.progress.stdout = NO_UNIT

    expect((await nextRun($, world, 'the pinned run')).slice(-4)).toEqual(PINNED)

    expect((await nextRun($, world, 'the run after')).slice(-4)).toEqual(PINNED)
  })

  test("a newer pin that lands while the old pin's run is in flight survives that pin's drop", async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    await callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE })
    removeUnit(world)
    world.write(`${MAIN}/.anomaly/other/stories.md`)
    world.disk.progress.stdout = NO_UNIT

    const release = world.holdProgress()
    await submit($, world, 'the pinned run')
    await callTool($, world, { tool: 'Read', file_path: `${MAIN}/.anomaly/other/stories.md` })
    release()
    await world.clock.settle()

    expect(world.store.get(`${STORE_PREFIX}${SESSION_ID}`)).toEqual({ name: 'other', path: `${MAIN}/.anomaly/other` })
    expect((await nextRun($, world, 'the run after')).slice(-4)).toEqual(['--repo', MAIN, '--unit', 'other'])
  })
})

// The runs a piece of work started: the argv of each `progress --json` run that began during it.
async function runsStarted(world: World, work: () => Promise<unknown>) {
  const before = progressRuns(world).length
  await work()

  return progressRuns(world).slice(before)
}

const ANOMALY_COMMAND = 'python3 /opt/anomaly/scripts/anomaly.py ticket show 03'
const SOURCE_FILE = 'C:\\work\\main\\src\\a.ts'

describe('what starts a run (AC-30)', () => {
  test('a main-loop turn end starts a run', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)

    const runs = await runsStarted(world, () => settled(world, finish($, undefined)))

    expect(runs).toHaveLength(1)
  })

  test('the first turn end after a load runs the CLI once', async ($, on) => {
    // A reload drops the module's variables; no session.start came before this turn end.
    const world = engineWorld(on)
    withAnomaly(world)

    const runs = await runsStarted(world, () => settled(world, finish($, undefined)))

    expect(runs).toHaveLength(1)
  })

  for (const tool of ['Edit', 'Write']) {
    test(`a main-loop ${tool} of a file under .anomaly/ starts a run that holds the new --unit; a subagent's ${tool} starts none`, async ($, on) => {
      const world = engineWorld(on)
      await startBesideUnit($, world)

      expect(await runsStarted(world, () => callTool($, world, { tool, file_path: WINDOWS_FILE }, 'a1'))).toEqual([])

      const runs = await runsStarted(world, () => callTool($, world, { tool, file_path: WINDOWS_FILE }))

      expect(runs).toHaveLength(1)
      expect(runs[0]?.slice(-4)).toEqual(PINNED)
    })
  }

  test('a main-loop Edit of a file outside .anomaly/ starts no run; one under it does', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    expect(await runsStarted(world, () => callTool($, world, { tool: 'Edit', file_path: SOURCE_FILE }))).toEqual([])

    expect(await runsStarted(world, () => callTool($, world, { tool: 'Edit', file_path: WINDOWS_FILE }))).toHaveLength(1)
  })

  test('a main-loop Edit under .anomaly/ that names no unit starts a run with no --unit', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    for (const file_path of ['C:\\work\\main\\.anomaly\\adhoc\\notes.md', 'C:\\work\\main\\.anomaly\\stories.md']) {
      const runs = await runsStarted(world, () => callTool($, world, { tool: 'Edit', file_path }))

      expect(runs).toHaveLength(1)
      expect(runs[0]).not.toContain('--unit')
    }
  })

  test('a main-loop Read under .anomaly/ starts no run; a Write there does', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    expect(await runsStarted(world, () => callTool($, world, { tool: 'Read', file_path: WINDOWS_FILE }))).toEqual([])

    expect(await runsStarted(world, () => callTool($, world, { tool: 'Write', file_path: WINDOWS_FILE }))).toHaveLength(1)
  })

  test('a main-loop Bash command holding anomaly.py starts a run; one with a unit path and no anomaly.py starts none', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)

    const listing = { tool: 'Bash', command: 'ls /c/work/main/.anomaly/checkout/tickets' }
    expect(await runsStarted(world, () => callTool($, world, listing))).toEqual([])

    const runs = await runsStarted(world, () => callTool($, world, { tool: 'Bash', command: ANOMALY_COMMAND }))

    expect(runs).toHaveLength(1)
  })

  test("a subagent's Bash command holding anomaly.py starts no run, nor does a denied one", async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    const command = { tool: 'Bash', command: ANOMALY_COMMAND }

    expect(await runsStarted(world, () => callTool($, world, command, 'a1'))).toEqual([])

    world.disk.toolDeny = 'denied by the user'
    expect(await runsStarted(world, () => callTool($, world, command))).toEqual([])
  })

  test('a Bash command holding anomaly.py and a unit path pins first, so its run holds --unit', async ($, on) => {
    const world = engineWorld(on)
    await startBesideUnit($, world)
    const command = `${ANOMALY_COMMAND} /c/work/main/.anomaly/checkout/tickets/01-x.md`

    const runs = await runsStarted(world, () => callTool($, world, { tool: 'Bash', command }))

    expect(runs).toHaveLength(1)
    expect(runs[0]?.slice(-4)).toEqual(PINNED)
  })
})

describe('the clock runs only while a ticket runs (AC-31)', () => {
  test('the clock stops when the last running ticket is done, though the report still names the unit', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)

    world.disk.progress.stdout = progressDone('03')
    await world.clock.advance(TICK_MS)
    const stopped = progressRuns(world).length
    expect((await draw($, 'desktop')).words).toContain('3/4')

    await world.clock.advance(3 * TICK_MS)
    expect(progressRuns(world)).toHaveLength(stopped)

    // A ticket running again, seen by a prompt's run, starts the clock again.
    world.disk.progress.stdout = PROGRESS_OPEN
    await submit($, world, 'go on')
    const restarted = progressRuns(world).length
    await world.clock.advance(TICK_MS)

    expect(progressRuns(world)).toHaveLength(restarted + 1)
  })

  test('a report that names a unit and has no running ticket starts no clock', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, progressDone('03'))
    const first = progressRuns(world).length

    await world.clock.advance(3 * TICK_MS)
    expect(progressRuns(world)).toHaveLength(first)

    world.disk.progress.stdout = PROGRESS_OPEN
    await submit($, world, 'go on')
    const restarted = progressRuns(world).length
    await world.clock.advance(TICK_MS)

    expect(progressRuns(world)).toHaveLength(restarted + 1)
  })
})

// A report that names no unit and has no running ticket: no clock runs, whatever rule decides it.
const NO_CLOCK = progressReport(report => {
  report.unit = null
}, PROGRESS_BASE)
const FAILING_RUN = { exitCode: 1, stdout: 'x' }

describe('a trigger during a run, or during the pause after a failed one (AC-32)', () => {
  test('several triggers during a held run cause exactly one more run', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    const release = world.holdProgress()
    await submit($, world, 'the held run')
    const held = progressRuns(world).length

    await submit($, world, 'a second prompt')
    await submit($, world, 'a third prompt')
    await spawn($, 'a1')
    await settled(world, finish($, 'a1'))
    expect(progressRuns(world)).toHaveLength(held)

    world.disk.progress.stdout = progressDone('03', '04')
    release()
    await world.clock.settle()

    expect(progressRuns(world)).toHaveLength(held + 1)
    // The bar draws the newest report: every ticket done, so the finish row, `4/4 ✓`.
    expect((await draw($, 'desktop')).words).toContain('4/4 ✓')
  })

  test('a held run that fails: the follow-up a trigger asked for runs when the pause ends, not before', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, NO_CLOCK)
    const release = world.holdProgress()
    Object.assign(world.disk.progress, FAILING_RUN)
    await submit($, world, 'the run that fails')
    await submit($, world, 'a trigger during it')
    const held = progressRuns(world).length

    release()
    await world.clock.settle()
    Object.assign(world.disk.progress, { exitCode: 0, stdout: NO_CLOCK })

    await world.clock.advance(PAUSE_MS - 1_000)
    expect(progressRuns(world)).toHaveLength(held)

    await world.clock.advance(1_000)
    await world.clock.settle()
    expect(progressRuns(world)).toHaveLength(held + 1)
  })

  test('a trigger during the pause runs when the pause ends, not before', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, NO_CLOCK)
    Object.assign(world.disk.progress, FAILING_RUN)
    await submit($, world, 'the run that fails')
    Object.assign(world.disk.progress, { exitCode: 0, stdout: NO_CLOCK })
    const failed = progressRuns(world).length

    await world.clock.advance(10_000)
    await submit($, world, 'a trigger in the pause')
    await world.clock.advance(PAUSE_MS - 10_000 - 1_000)
    expect(progressRuns(world)).toHaveLength(failed)

    await world.clock.advance(1_000)
    await world.clock.settle()
    expect(progressRuns(world)).toHaveLength(failed + 1)
  })
})

describe('a run whose stdout equals the last one writes no state (AC-33)', () => {
  test('runs with the same stdout write the build once', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    expect(world.state.buildWrites).toBe(1)

    await submit($, world, 'go on')
    await submit($, world, 'and on')

    expect(progressRuns(world)).toHaveLength(3)
    expect(world.state.buildWrites).toBe(1)
  })

  test('right after a pop an equal stdout writes nothing, so the pop plays on', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    world.disk.progress.stdout = progressDone('03')
    await submit($, world, 'a ticket finished')
    expect(world.state.buildWrites).toBe(2)
    expect((await segmentOf($, '03'))?.isPopped).toBe(true)

    await submit($, world, 'and nothing changed')

    expect(progressRuns(world)).toHaveLength(3)
    expect(world.state.buildWrites).toBe(2)
    expect((await segmentOf($, '03'))?.isPopped).toBe(true)

    await world.clock.advance(POP_MS)
    expect((await segmentOf($, '03'))?.isPopped).toBe(false)
  })
})

// Three times a stage ended, oldest first.
const FIRST = '2026-10-12 14:36'
const SECOND = '2026-10-12 15:02'
const THIRD = '2026-10-12 15:30'

// The stage chips the Desktop draws now, as `label:state`.
async function chipsNow($: Engine) {
  return chipsOf((await draw($, 'desktop')).source)
}

// The labels of the chips drawn as current now.
async function currentNow($: Engine) {
  return (await chipsNow($)).filter(chip => chip.endsWith(':current')).map(chip => chip.split(':')[0])
}

// The last planning stage seen for a unit is kept in $.store under `planning:<unit>`, as the stage name.
const planningKey = (unit: string) => `planning:${unit}`

describe('the planning stage kept for the unit (AC-14)', () => {
  test('a session sees specify, then review: the chips still show specify done, and the store holds specify', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, stagedAt('specify', FIRST))
    expect(await chipsNow($)).toEqual(stagesAt(2))

    world.disk.progress.stdout = stagedAt('review', SECOND)
    await submit($, world, 'go on')

    expect(await chipsNow($)).toEqual(stagesAt(2))
    expect(world.store.get(planningKey(PROGRESS_UNIT))).toBe('specify')
  })

  // A new session has no state of its own, only its store.
  test('a new session whose store holds the planning stage of that unit draws it on stage review', async ($, on) => {
    const world = engineWorld(on, { [planningKey(PROGRESS_UNIT)]: 'specify' })

    await startWithAnomaly($, world, stagedAt('review', SECOND))

    expect(await chipsNow($)).toEqual(stagesAt(2))
  })

  test('a store that holds the planning stage of another unit is not drawn for this one', async ($, on) => {
    const world = engineWorld(on, { [planningKey('other-unit')]: 'specify' })

    await startWithAnomaly($, world, stagedAt('review', SECOND))

    expect(await chipsNow($)).toEqual(stagesAt(0))
  })
})

const LIVE_SKILL = 'anomaly:specify'

// Ways the main loop runs `specify`: typed in the composer, and the Skill tool namespaced and bare.
const MAIN_LOOP_SKILLS = [
  ['a typed /anomaly:specify', ($: Engine, world: World) => submit($, world, `/${LIVE_SKILL}`)],
  ['a Skill call anomaly:specify', ($: Engine, world: World) => callTool($, world, { tool: 'Skill', skill: LIVE_SKILL })],
  ['a Skill call specify', ($: Engine, world: World) => callTool($, world, { tool: 'Skill', skill: 'specify' })],
] as const

describe('the live skill chip (AC-15)', () => {
  // specify ended at FIRST, so the next chip, slice, is current until the skill runs again.
  async function runningSpecify($: Engine, world: World, invoke: (typeof MAIN_LOOP_SKILLS)[number][1]) {
    await startWithAnomaly($, world, stagedAt('specify', FIRST))
    expect(await currentNow($)).toEqual(['slice'])

    await invoke($, world)
    expect(await currentNow($)).toEqual(['specify'])
  }

  for (const [how, invoke] of MAIN_LOOP_SKILLS) {
    test(`${how} makes the specify chip current while stage keeps its ended time, and ends it when stage names specify with a new one`, async ($, on) => {
      const world = engineWorld(on)
      await runningSpecify($, world, invoke)

      // A run that prints other words around the same stage, ended at the same time.
      world.disk.progress.stdout = stagedAt('specify', FIRST, ['a warning'])
      await submit($, world, 'go on')
      expect(await currentNow($)).toEqual(['specify'])

      world.disk.progress.stdout = stagedAt('specify', SECOND)
      await submit($, world, 'go on')
      expect(await currentNow($)).toEqual(['slice'])
    })
  }

  test('a stage that is no planning stage does not end it; a planning stage of another name with a new ended time does', async ($, on) => {
    const world = engineWorld(on)
    await runningSpecify($, world, MAIN_LOOP_SKILLS[1][1])

    world.disk.progress.stdout = stagedAt('review', SECOND)
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['specify'])

    world.disk.progress.stdout = stagedAt('slice', THIRD)
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['conduct'])
  })
})

describe('a Skill call that sets no chip (AC-16)', () => {
  test("a subagent's Skill call, namespaced or bare, sets no chip", async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, stagedAt('specify', FIRST))

    for (const skill of [LIVE_SKILL, 'specify']) {
      await callTool($, world, { tool: 'Skill', skill }, 'a1')
    }

    expect(await chipsNow($)).toEqual(stagesAt(2))
  })

  test('a denied Skill call sets no chip', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, stagedAt('specify', FIRST))
    world.disk.toolDeny = 'denied by the user'

    await callTool($, world, { tool: 'Skill', skill: LIVE_SKILL })

    expect(await chipsNow($)).toEqual(stagesAt(2))
  })
})

// The same stdout for another unit, named `other-unit`.
const ofOtherUnit = (stdout: string) => progressReport(report => (report.unit = 'other-unit'), stdout)

describe('the unit and stage a live skill started on', () => {
  test('a skill typed before the first report keeps its chip on that report, and ends on a newer stage', async ($, on) => {
    const world = engineWorld(on)
    const release = world.holdProgress()
    await startWithAnomaly($, world, stagedAt('specify', FIRST))
    await submit($, world, `/${LIVE_SKILL}`)

    release()
    await world.clock.settle()
    expect(await currentNow($)).toEqual(['specify'])

    world.disk.progress.stdout = stagedAt('specify', SECOND)
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['slice'])
  })

  test("the live chip follows the unit shown: another unit's stage takes the baseline again, and only a new planning stage of the unit shown ends it", async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, stagedAt('specify', FIRST))
    await callTool($, world, { tool: 'Skill', skill: LIVE_SKILL })
    expect(await currentNow($)).toEqual(['specify'])

    world.disk.progress.stdout = ofOtherUnit(stagedAt('slice', SECOND))
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['specify'])

    world.disk.progress.stdout = stagedAt('specify', FIRST)
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['specify'])

    world.disk.progress.stdout = stagedAt('specify', SECOND)
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['slice'])
  })

  test('a skill started again while the bar is hidden takes its baseline again: the next report keeps its chip', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, stagedAt('specify', FIRST))
    await callTool($, world, { tool: 'Skill', skill: LIVE_SKILL })

    // A CLI without `progress --json` hides the bar; specify runs again meanwhile.
    Object.assign(world.disk.progress, { exitCode: 2, stdout: '' })
    await submit($, world, 'go on')
    await submit($, world, `/${LIVE_SKILL}`)

    Object.assign(world.disk.progress, { exitCode: 0, stdout: stagedAt('specify', SECOND) })
    await submit($, world, 'go on')
    expect(await currentNow($)).toEqual(['specify'])
  })
})
