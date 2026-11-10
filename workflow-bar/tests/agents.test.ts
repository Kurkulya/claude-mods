import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { AMBER } from '../hooks/palette'
import { PX_PER_CELL, cellsToPx } from '../hooks/svg'
import {
  NO_UNIT,
  NO_UNIT_PICKED,
  PROGRESS_UNIT,
  REPO,
  callTool,
  chipsOf,
  draw,
  engineWorld,
  expectBand,
  finish,
  progressRuns,
  spawn,
  startWithAnomaly,
  step,
  submit,
} from './harness'

const SVG_LIMIT = 131072
// A band of 61 cells is 61 × PX_PER_CELL CSS px on Desktop, a width with a fraction the drawing must not round up past.
const SLOT_CELLS = 61
const SLOT_PX = SLOT_CELLS * PX_PER_CELL

describe('agent count', () => {
  test('a report with no unit draws no bar, though an agent runs, in a folder with no .anomaly/ above it', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world, NO_UNIT)

    await spawn($, 'a1')

    await expectBand($, undefined)
  })

  test('two spawns count up, and the bar is idle once both finished', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    await spawn($, 'a1')
    await expectBand($, '1 agent')

    await spawn($, 'a2')
    await expectBand($, '2 agents')

    await finish($, 'a1')
    await expectBand($, '1 agent')

    await finish($, 'a2')
    await expectBand($, 'idle')
  })

  test('a foreground agent counts like a background one', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    await spawn($, 'a1')
    await spawn($, 'a2', false)

    await expectBand($, '2 agents')
  })

  test('a step of a running agent writes nothing, so the band does not redraw', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)

    await spawn($, 'a1')
    const writes = world.state.writes
    await step($, 'a1')
    await step($, 'a1')

    expect(writes).toBeGreaterThan(0)
    expect(world.state.writes).toBe(writes)
    await expectBand($, '1 agent')
  })

  test('an aborted agent counts as finished', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    await spawn($, 'a1')
    await spawn($, 'a2')
    await finish($, 'a1', 'aborted')

    await expectBand($, '1 agent')
  })

  test('a main-loop turn end leaves the agent count', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    await spawn($, 'a1')
    await finish($, undefined)

    await expectBand($, '1 agent')
  })

  test('a step of an agent whose spawn has not resolved yet is counted once', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    const release = world.hold('a1')

    const spawning = spawn($, 'a1')
    await step($, 'a1')
    await expectBand($, '1 agent')

    release()
    await spawning
    await expectBand($, '1 agent')
  })

  test('a step marks a finished agent running again', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    await spawn($, 'a1')
    await finish($, 'a1')
    await step($, 'a1')

    await expectBand($, '1 agent')
  })
})

// A report with no unit draws the agent part and the warnings when `.anomaly/` lies in the session's folder or above it;
// with no `.anomaly/` there it draws nothing (the first test of 'agent count').
describe('agent count without a unit, in a repo with .anomaly/', () => {
  const ANOMALY = `${REPO}/.anomaly`

  async function expectAgentPart($: Engine, agents: string) {
    const desktop = await draw($, 'desktop')

    expect(desktop.isHidden).toBe(false)
    expect(desktop.words).toEqual(expect.arrayContaining([agents, '⚠ 1']))
    expect(desktop.segments).toEqual([])
    expect(chipsOf(desktop.source)).toEqual([])
    expect((await draw($, 'terminal')).line).toBe(`● ${agents}  ⚠ 1`)
  }

  test('.anomaly/ in the session folder: idle, then the running count, with ⚠ 1 and no unit', async ($, on) => {
    const world = engineWorld(on)
    world.disk.folders.add(ANOMALY)
    await startWithAnomaly($, world, NO_UNIT_PICKED)

    await expectAgentPart($, 'idle')

    await spawn($, 'a1')
    await spawn($, 'a2')
    await expectAgentPart($, '2 agents')

    await finish($, 'a1')
    await expectAgentPart($, '1 agent')
  })

  test('.anomaly/ in a parent of the session folder draws the same', async ($, on) => {
    const world = engineWorld(on)
    world.disk.cwd = `${REPO}/src/deep`
    world.disk.folders.add(ANOMALY)
    await startWithAnomaly($, world, NO_UNIT_PICKED)

    await spawn($, 'a1')

    await expectAgentPart($, '1 agent')
  })

  test('the answer is asked once per folder in a load, though a new report asks the bar again', async ($, on) => {
    const world = engineWorld(on)
    world.disk.cwd = `${REPO}/src`
    world.disk.folders.add(ANOMALY)
    await startWithAnomaly($, world, NO_UNIT_PICKED)
    const asked = () => world.disk.existsAsked.filter(path => path.endsWith('/.anomaly'))
    const first = asked()

    world.disk.progress.stdout = NO_UNIT_PICKED.replace('no work unit picked', 'no work unit chosen')
    await submit($, world, 'go on')

    expect(progressRuns(world)).toHaveLength(2)
    expect(first.length).toBeGreaterThan(0)
    expect(asked()).toEqual(first)
    await expectAgentPart($, 'idle')
  })

  test('a file system that cannot answer counts as no .anomaly/: the bar hides', async ($, on) => {
    const world = engineWorld(on)
    world.disk.folders.add(ANOMALY)
    world.disk.isExistsFaulty = true
    await startWithAnomaly($, world, NO_UNIT_PICKED)

    await spawn($, 'a1')

    await expectBand($, undefined)
  })

  for (const tool of ['Edit', 'Write']) {
    test(`a ${tool} under .anomaly/ asks again, so a folder made after a "no" shows`, async ($, on) => {
      const world = engineWorld(on)
      await startWithAnomaly($, world, NO_UNIT_PICKED)
      await expectBand($, undefined)

      world.disk.folders.add(ANOMALY)
      await callTool($, world, { tool, file_path: `${ANOMALY}/notes.md` })

      await expectAgentPart($, 'idle')
    })
  }
})

describe('drawing', () => {
  test('desktop draws one interactive Svg sized to the band, readable in both themes', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))
    await spawn($, 'a1')
    await spawn($, 'a2')

    const { tree, svgs, svg, source } = await draw($, 'desktop', { bodyColumns: SLOT_CELLS })

    expect(tree.type).toBe('Svg')
    expect(svgs).toHaveLength(1)
    expect(svg?.props.isInteractive).toBe(true)
    expect(svg?.props.height).toBeGreaterThan(0)
    expect(svg?.props.width).toBe(cellsToPx(SLOT_CELLS))
    expect(svg?.props.width).toBeLessThanOrEqual(SLOT_PX)
    expect(svg?.props.alt).toBe(`2 agents · ${PROGRESS_UNIT} · wave 4 · 2/4`)
    expect(source).toContain(':root{color-scheme:light dark}')
    expect(source).toContain('prefers-color-scheme: dark')
    expect(source).toContain('@keyframes')
    expect(source).toContain(AMBER)
    expect(source).toContain('2 agents')
    expect(source.length).toBeLessThanOrEqual(SVG_LIMIT)
  })

  test('the terminal draws coloured Text and no Svg', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))
    await spawn($, 'a1')

    const { svgs, runs, line } = await draw($, 'terminal', { bodyColumns: 120 })

    expect(svgs).toEqual([])
    expect(line).toBe(`● 1 agent  ${PROGRESS_UNIT}  wave 4  01 02  03  04  2/4`)
    expect(runs.find(run => run.text.includes('●'))?.props.color).toBe(AMBER)
  })
})
