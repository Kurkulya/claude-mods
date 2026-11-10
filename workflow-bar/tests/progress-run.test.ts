// How the bar finds and runs the anomaly CLI: the fake engine answers `installed_plugins.json` (`fs.read`) and the
// `progress --json` run (`process.run`), and the tests read the command the bar started and what it then drew.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  ANOMALY_INSTALL as WINDOWS_INSTALL,
  INSTALLED_PLUGINS,
  PAUSE_MS,
  PROCESS_TIMEOUT_MS,
  PROGRESS_OPEN,
  REPO,
  draw,
  engineWorld,
  expectBand,
  progressDone,
  progressReport,
  progressRuns,
  start,
  startWithAnomaly,
  submit,
} from './harness'
import type { World } from './harness'

const NEWER_INSTALL = 'C:\\Users\\vk\\.claude\\plugins\\cache\\anomaly-local\\anomaly\\aaaaaaaaaaaa'
const POSIX_INSTALL = '/home/vk/.claude/plugins/cache/anomaly-local/anomaly/ee37bf10eead'
const OTHER_INSTALL = 'C:\\Users\\vk\\.claude\\plugins\\cache\\market\\other\\1'

// `installed_plugins.json` as Claude Code writes it: each plugin key holds a list of installs.
function installedPlugins(plugins: Record<string, string>) {
  const entries = Object.entries(plugins).map(([key, installPath]) => [key, [{ scope: 'user', installPath }]])

  return JSON.stringify({ version: 2, plugins: Object.fromEntries(entries) })
}

function install(world: World, plugins: Record<string, string>, mtimeMs = 1) {
  world.write(INSTALLED_PLUGINS, installedPlugins(plugins), mtimeMs)
  world.disk.progress.stdout = PROGRESS_OPEN
}

describe('finding and running the anomaly CLI', () => {
  test('a Windows installPath runs python -I on the first anomaly@ key', async ($, on) => {
    const world = engineWorld(on)
    install(world, {
      'other@market': OTHER_INSTALL,
      'anomaly@anomaly-local': WINDOWS_INSTALL,
      'anomaly@second': NEWER_INSTALL,
    })

    await start($, world)

    expect(progressRuns(world)).toEqual([
      ['python', '-I', `${WINDOWS_INSTALL}/scripts/anomaly.py`, 'progress', '--json', '--repo', REPO],
    ])
  })

  test('a POSIX installPath runs python3 with the same arguments', async ($, on) => {
    const world = engineWorld(on)
    install(world, { 'anomaly@anomaly-local': POSIX_INSTALL })

    await start($, world)

    expect(progressRuns(world)).toEqual([
      ['python3', '-I', `${POSIX_INSTALL}/scripts/anomaly.py`, 'progress', '--json', '--repo', REPO],
    ])
  })

  test('every run starts in the installPath, so a bare python is never looked up in the repo folder', async ($, on) => {
    const world = engineWorld(on)
    install(world, { 'anomaly@anomaly-local': WINDOWS_INSTALL })

    await start($, world)
    await submit($, world, 'go on')

    expect(world.disk.runCwds).toEqual([WINDOWS_INSTALL, WINDOWS_INSTALL])
  })

  test('after installed_plugins.json changes, the next run uses its new installPath', async ($, on) => {
    const world = engineWorld(on)
    install(world, { 'anomaly@anomaly-local': WINDOWS_INSTALL })
    await start($, world)

    install(world, { 'anomaly@anomaly-local': NEWER_INSTALL }, 2)
    await submit($, world, 'go on')

    const runs = progressRuns(world)
    expect(runs[0]?.[2]).toBe(`${WINDOWS_INSTALL}/scripts/anomaly.py`)
    expect(runs[runs.length - 1]?.[2]).toBe(`${NEWER_INSTALL}/scripts/anomaly.py`)
  })

  test('with no pin the run holds no --unit, and the bar draws the unit the CLI picked', async ($, on) => {
    const world = engineWorld(on)
    install(world, { 'anomaly@anomaly-local': POSIX_INSTALL })
    world.disk.progress.stdout = progressReport(report => {
      report.unit = 'newest-unit'
      report.picked_by = 'newest-log'
    }, PROGRESS_OPEN)

    await start($, world)

    expect(progressRuns(world)).toHaveLength(1)
    expect(progressRuns(world).flat()).not.toContain('--unit')
    expect((await draw($, 'desktop')).words).toContain('newest-unit')
    expect((await draw($, 'terminal')).line).toContain('newest-unit')
  })
})

describe('no anomaly plugin to run', () => {
  test('no readable installed_plugins.json: no command, one transcript line per load, nothing drawn', async ($, on) => {
    const world = engineWorld(on)

    await start($, world)
    await submit($, world, 'go on')

    expect(world.disk.logs).toHaveLength(1)
    expect(world.disk.logs[0]).toContain('anomaly')
    expect(world.disk.runs).toEqual([])
    await expectBand($, undefined)
  })

  test('no anomaly@ key: no command, one transcript line per load, nothing drawn', async ($, on) => {
    const world = engineWorld(on)
    world.write(INSTALLED_PLUGINS, installedPlugins({ 'other@market': OTHER_INSTALL }))
    world.disk.progress.stdout = PROGRESS_OPEN

    await start($, world)
    await submit($, world, 'go on')

    expect(world.disk.logs).toHaveLength(1)
    expect(world.disk.logs[0]).toContain('anomaly')
    expect(world.disk.runs).toEqual([])
    await expectBand($, undefined)
  })
})

// A CLI that has no `progress` answers exit 2.
describe('a CLI without progress --json', () => {
  test('exit code 2: one transcript line per load naming progress --json, nothing drawn', async ($, on) => {
    const world = engineWorld(on)
    world.disk.progress.exitCode = 2
    await startWithAnomaly($, world)
    // Past any pause, so the second run is allowed.
    await world.clock.advance(PAUSE_MS + 1_000)
    await submit($, world, 'go on')

    expect(progressRuns(world)).toHaveLength(2)
    expect(world.disk.logs).toHaveLength(1)
    expect(world.disk.logs[0]).toContain('progress --json')
    await expectBand($, undefined)
  })

  test('exit code 2 after a drawing hides the bar', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    await expectBand($, 'idle')

    world.disk.progress.exitCode = 2
    await submit($, world, 'go on')

    await expectBand($, undefined)

    // The CLI answers again with the stdout it printed before the hide: the bar draws it again.
    world.disk.progress.exitCode = 0
    await submit($, world, 'and again')

    await expectBand($, 'idle')
  })
})

describe('a report of a newer schema', () => {
  test('draws the agent part and the update notice, and no unit or ticket', async ($, on) => {
    const world = engineWorld(on)
    const newer = progressReport(report => {
      report.schema = 2
    }, PROGRESS_OPEN)
    await startWithAnomaly($, world, newer)

    const desktop = await draw($, 'desktop')

    // The Svg escapes the `>` of the notice.
    expect(desktop.words).toEqual(['idle', 'anomaly progress schema 2 &gt; 1: update workflow-bar'])
    expect(desktop.segments).toEqual([])
    expect((await draw($, 'terminal')).line).toBe('● idle  anomaly progress schema 2 > 1: update workflow-bar')
  })
})

// A run that fails (D-5), as the CLI fails it. The stdout is not the report the bar drew before, so a drawing of it
// would show.
const CANNOT_START: [string, (world: World) => void] = [
  'a run that cannot start',
  world => Object.assign(world.disk, { progressFault: 'reject' }),
]
const TIMES_OUT: [string, (world: World) => void] = [
  'a run that times out',
  world => Object.assign(world.disk, { progressFault: 'timeout' }),
]
const FAILED_RUNS: [string, (world: World) => void][] = [
  CANNOT_START,
  TIMES_OUT,
  ['a run that exits 1', world => Object.assign(world.disk.progress, { exitCode: 1, stdout: 'x' })],
]
// Broken JSON keeping the last drawing is checked under "output that is no report"; only its pause is checked here.
const BROKEN_JSON_RUN: [string, (world: World) => void] = [
  'a run that prints broken JSON',
  world => Object.assign(world.disk.progress, { stdout: 'x' }),
]

// A session drawing PROGRESS_OPEN (03 running), then one refresh whose run fails as `fail` says; a timed-out run
// ends at its timeout. Returns the time the failed run ended.
async function failOnce($: Engine, world: World, fail: (world: World) => void) {
  await startWithAnomaly($, world)
  world.disk.progress.stdout = progressDone('03')
  fail(world)
  await submit($, world, 'go on')
  if (world.disk.progressFault === 'timeout') {
    await world.clock.advance(PROCESS_TIMEOUT_MS)
  }

  return world.clock.now()
}

// The CLI works again and prints 03 done.
function recover(world: World) {
  world.disk.progressFault = undefined
  Object.assign(world.disk.progress, { exitCode: 0, stdout: progressDone('03') })
}

async function expectKept($: Engine) {
  const desktop = await draw($, 'desktop')
  expect(desktop.segments.find(segment => segment.number === '03')?.state).toBe('running')
  expect(desktop.words).not.toContain('3/4')
  expect((await draw($, 'terminal')).line).not.toContain('3/4')
}

describe('a run that fails', () => {
  for (const [name, fail] of FAILED_RUNS) {
    test(`${name} keeps the last drawing`, async ($, on) => {
      const world = engineWorld(on)
      await failOnce($, world, fail)

      expect(progressRuns(world)).toHaveLength(2)
      await expectKept($)
    })
  }

  for (const [name, fail] of [...FAILED_RUNS, BROKEN_JSON_RUN]) {
    test(`${name} starts no run for 30 s, then one does`, async ($, on) => {
      const world = engineWorld(on)
      const failedAt = await failOnce($, world, fail)
      const runs = progressRuns(world).length

      // The 10 s clock ticks and a prompt asks for a run in the pause: none starts.
      await world.clock.set(failedAt + 10_000)
      await submit($, world, 'again')
      await world.clock.set(failedAt + PAUSE_MS - 1_000)

      expect(progressRuns(world)).toHaveLength(runs)
      await expectKept($)

      recover(world)
      await world.clock.set(failedAt + PAUSE_MS)
      await submit($, world, 'once more')

      expect(progressRuns(world).length).toBeGreaterThan(runs)
      expect((await draw($, 'desktop')).words).toContain('3/4')
    })
  }
})

describe('a run that cannot start or times out', () => {
  for (const [name, fail] of [CANNOT_START, TIMES_OUT]) {
    test(`${name} writes one transcript line per load, with no path and no output in it`, async ($, on) => {
      const world = engineWorld(on)
      await failOnce($, world, fail)
      expect(world.disk.logs).toHaveLength(1)

      // A second failed run, after the pause.
      await world.clock.advance(PAUSE_MS + 1_000)
      await world.clock.advance(PROCESS_TIMEOUT_MS)

      expect(progressRuns(world).length).toBeGreaterThanOrEqual(3)
      expect(world.disk.logs).toHaveLength(1)
      expect(world.disk.logs[0]).toContain('progress --json')
      for (const left of ['C:', 'python', 'anomaly.py', 'progress run']) {
        expect(world.disk.logs[0]).not.toContain(left)
      }
      await expectKept($)
    })
  }
})

describe('output that is no report', () => {
  const BROKEN = [
    ['not JSON', 'x'],
    ['a schema that is not an integer', progressReport(report => Object.assign(report, { schema: '1' }), PROGRESS_OPEN)],
  ] as const

  for (const [name, stdout] of BROKEN) {
    test(`${name} keeps the last drawing and writes one transcript line per load`, async ($, on) => {
      const world = engineWorld(on)
      await startWithAnomaly($, world)
      world.disk.progress.stdout = stdout

      // Two runs print it: the prompt's, then the clock's after the pause.
      await submit($, world, 'go on')
      await world.clock.advance(PAUSE_MS + 1_000)
      await submit($, world, 'again')

      expect(progressRuns(world).length).toBeGreaterThanOrEqual(3)
      expect(world.disk.logs).toHaveLength(1)
      await expectKept($)
    })
  }
})
