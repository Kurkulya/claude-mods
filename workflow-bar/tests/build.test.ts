import { describe, expect, test } from 'claude-code/testing'

import { AMBER, GREEN, WHITE } from '../hooks/palette'
import { CHAR_PX, POP_MS, cellsToPx } from '../hooks/svg'
import {
  PROGRESS_BASE,
  PROGRESS_OPEN,
  PROGRESS_UNIT,
  draw,
  engineWorld,
  finish,
  progressDone,
  progressReport,
  settled,
  spawn,
  startWithAnomaly,
  submit,
} from './harness'
import type { ProgressTicket } from './harness'

// PROGRESS_OPEN with ticket 01 titled `title`.
function titled(title: string) {
  return progressReport(report => {
    Object.assign(report.tickets[0] ?? {}, { title })
  }, PROGRESS_OPEN)
}

describe('build segments', () => {
  test('hovering a segment shows its title escaped, and every segment takes the pointer', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), titled('Save <old> work & "notes"'))

    const segments = (await draw($, 'desktop')).segments
    expect(segments[0]?.title).toContain('01 Save &lt;old&gt; work &amp; &quot;notes&quot;')
    expect(segments.every(segment => segment.isHoverable)).toBe(true)
  })

  test('a ticket that turned done since the previous drawing pops once', async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    const popped = (drawn: Awaited<ReturnType<typeof draw>>) =>
      drawn.segments.filter(segment => segment.isPopped).map(segment => segment.number)

    expect(popped(await draw($, 'desktop'))).toEqual([])

    world.disk.progress.stdout = progressDone('03')
    await submit($, world, 'go on')

    const second = await draw($, 'desktop')
    expect(popped(second)).toEqual(['03'])
    expect(second.source).toContain('@keyframes pop')
    // A redraw while the pop plays still draws it.
    expect(popped(await draw($, 'desktop'))).toEqual(['03'])

    // The pop plays once: once its animation has run, a redraw (here an agent starting) draws 03 still, though
    // no new run came in between.
    await world.clock.advance(POP_MS)
    await spawn($, 'a1')
    expect(popped(await draw($, 'desktop'))).toEqual([])
    expect(world.disk.runs).toHaveLength(2)
  })

  test("dropping a pop keeps a newer read's own pop", async ($, on) => {
    const world = engineWorld(on)
    // Ticket 01 can start in every report, so the unit is never fully done and the segments stay drawn.
    const unfinished = (stdout: string) =>
      progressReport(report => {
        Object.assign(report.tickets[0] ?? {}, { status: 'ready-for-agent', kind: 'start', reason: 'can start' })
        const done = report.tickets.filter(ticket => ticket.kind === 'done').length
        const failed = report.tickets.filter(ticket => ticket.kind === 'running').length
        report.counts = { done, failed, open: report.tickets.length - done - failed }
      }, stdout)
    await startWithAnomaly($, world, unfinished(PROGRESS_OPEN))
    const popped = async () =>
      (await draw($, 'desktop')).segments.filter(segment => segment.isPopped).map(segment => segment.number)

    world.disk.progress.stdout = unfinished(progressDone('03'))
    await submit($, world, 'go on')
    expect(await popped()).toEqual(['03'])

    // 04 turns done before 03's pop is dropped: the drop of 03's pop leaves 04's, which is dropped in its own time.
    await world.clock.advance(POP_MS / 2)
    world.disk.progress.stdout = unfinished(progressDone('03', '04'))
    await submit($, world, 'and on')
    expect(await popped()).toEqual(['04'])

    await world.clock.advance(POP_MS / 2)
    expect(await popped()).toEqual(['04'])

    await world.clock.advance(POP_MS / 2)
    expect(await popped()).toEqual([])
  })

  test("an agent's end runs the CLI again", async ($, on) => {
    const world = engineWorld(on)
    await startWithAnomaly($, world)
    await spawn($, 'a1')

    world.disk.progress.stdout = progressDone('03')
    await settled(world, finish($, 'a1'))

    const desktop = await draw($, 'desktop')
    expect(desktop.words).toEqual(expect.arrayContaining(['idle', '3/4']))
    expect(desktop.segments.find(segment => segment.number === '03')?.state).toBe('done')
  })

  test('the terminal draws the segments as coloured number runs, no Svg', async ($, on) => {
    await startWithAnomaly($, engineWorld(on))

    const terminal = await draw($, 'terminal')
    const run = (text: string) => terminal.runs.find(found => found.text === text)?.props
    expect(terminal.line).toBe(`● idle  ${PROGRESS_UNIT}  wave 4  01 02  03  04  2/4`)
    expect(run('01')).toMatchObject({ backgroundColor: GREEN, color: WHITE })
    expect((await draw($, 'terminal', { bodyColumns: 120 })).svgs).toEqual([])
  })

  test('control characters in a title are left out of the SVG', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), titled('Save\u0001 the\u001b[31m work\u0000￾'))

    const desktop = await draw($, 'desktop')
    expect(desktop.segments[0]?.title).toContain('01 Save the[31m work')
    expect(desktop.source).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/)
  })
})

describe('smooth bar', () => {
  // Thirty tickets: ten done, two in progress, the rest waiting.
  function thirty(unit = PROGRESS_UNIT) {
    return progressReport(report => {
      report.unit = unit
      report.wave = 1
      report.tickets = Array.from({ length: 30 }, (_, index): ProgressTicket => {
        const number = String(index + 1).padStart(2, '0')
        const kind = index < 10 ? 'done' : index < 12 ? 'running' : 'waiting'

        return {
          slug: `${number}-ticket-${number}`,
          title: `Ticket ${number}`,
          status: kind === 'done' ? 'done' : kind === 'running' ? 'in-progress' : 'ready-for-agent',
          blocked_by: [],
          kind,
          reason: kind === 'done' ? null : kind,
          red: false,
          reviewed: false,
          verified: false,
          build_minutes: null,
          high: null,
          fix_rounds: null,
        }
      })
      report.counts = { done: 10, failed: 2, open: 18 }
    }, PROGRESS_OPEN)
  }

  test('segments that do not fit become one smooth bar with the count and what runs now', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), thirty())

    const narrow = await draw($, 'desktop', { bodyColumns: 80 })
    expect(narrow.segments).toEqual([])
    expect(narrow.words).toEqual(expect.arrayContaining(['10 / 30 · 2 running', 'now 11 12']))
    expect(narrow.source).toContain(GREEN)
    expect(narrow.source).toContain(AMBER)
    expect(narrow.source).toContain('class="stripes"')
    expect(narrow.source).toContain('@keyframes stripes')
    expect(narrow.svg?.props.width).toBe(cellsToPx(80))

    const wide = await draw($, 'desktop', { bodyColumns: 200 })
    expect(wide.segments).toHaveLength(30)
  })

  test('a long unit name in a narrow band: no empty bar, nothing past the edge', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), thirty('a-very-long-feature-name-that-goes-on-and-on'))

    for (const bodyColumns of [30, 45, 60]) {
      const narrow = await draw($, 'desktop', { bodyColumns })
      const width = cellsToPx(bodyColumns)
      const rects = [...narrow.source.matchAll(/<rect x="[^"]*"[^>]*width="([^"]+)"/g)].map(([, w]) => Number(w))
      expect(narrow.words.join(' ')).toContain('a-very')
      expect(rects.every(w => w > 0)).toBe(true)
      // A glyph is at most CHAR_PX wide; centred words reach half their width past x.
      for (const [, attributes = '', text = ''] of narrow.source.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)) {
        const x = Number(/x="([\d.]+)"/.exec(attributes)?.[1])
        const isCentred = /class="(inner|digits)"/.test(attributes)
        expect(x + (isCentred ? 0.5 : 1) * text.length * CHAR_PX).toBeLessThanOrEqual(width)
      }
    }
  })

  test('the terminal falls back to the same words', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), thirty())

    const terminal = await draw($, 'terminal', { bodyColumns: 60 })
    expect(terminal.line).toBe(`● idle  ${PROGRESS_UNIT}  wave 1  10 / 30 · 2 running  now 11 12`)
    expect(terminal.runs.find(run => run.text === '13')).toBeUndefined()
  })

  test('a narrow terminal shortens like the Desktop: `now` goes first, then the smooth words, `k/M` stays', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), thirty())

    expect((await draw($, 'terminal', { bodyColumns: 50 })).line).toBe(
      `● idle  ${PROGRESS_UNIT}  wave 1  10 / 30 · 2 running`,
    )
    expect((await draw($, 'terminal', { bodyColumns: 40 })).line).toBe(`● idle  ${PROGRESS_UNIT}  wave 1  10/30`)
  })
})

describe('the MR after the last ticket (AC-23)', () => {
  // PROGRESS_BASE: every ticket done, `mr.link` a GitHub pull link. The label cases are the unit tests'.
  test('a report with every ticket done and a pull link draws a Link labelled PR #19 on both surfaces', async ($, on) => {
    await startWithAnomaly($, engineWorld(on), PROGRESS_BASE)
    const link = { href: 'https://github.com/Kurkulya/anomaly/pull/19', label: 'PR #19' }

    const desktop = await draw($, 'desktop')
    expect(desktop.links).toHaveLength(1)
    expect(desktop.links[0]?.props).toMatchObject(link)
    expect(desktop.words).toContain('4/4 ✓')
    expect(desktop.svg?.props.alt).toBe(`idle · ${PROGRESS_UNIT} · 4/4 ✓ · MR ✓ › reviewed ✓ › verified ✓`)

    const terminal = await draw($, 'terminal')
    expect(terminal.links).toHaveLength(1)
    expect(terminal.links[0]?.props).toMatchObject(link)
  })
})
