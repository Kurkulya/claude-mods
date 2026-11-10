// What the bar draws from the CLI's `progress --json` stdout, one fixture per drawn case: the real `auto-measure`
// output (harness.ts `PROGRESS_BASE`) with fields changed. The parse is `parseProgress`; the drawing is the terminal's
// runs and the Desktop's Svg, from the one `barView`. `parseProgress(stdout)` is read as the build `barView` takes.
import { describe, expect, test } from 'claude-code/testing'

import { AMBER, AMBER_DIGITS, GREEN, GREY, WHITE } from '../hooks/palette'
import * as phase from '../hooks/phase'
import { cleanText, parseProgress } from '../hooks/progress'
import { barSvg } from '../hooks/svg'
import { barView, terminalRuns } from '../hooks/view'
import {
  NO_UNIT,
  NO_UNIT_PICKED,
  PROGRESS_OPEN,
  PROGRESS_UNIT,
  STAGES,
  chipsOf,
  planningReport,
  progressReport,
  stagedAt,
  stagesAt,
  wordsOf,
} from './harness'
import type { ProgressReport, ProgressTicket } from './harness'

// `planning` is the last planning stage the bar saw for the unit (kept in $.store), which `barView` takes beside the build.
function view(stdout: string, planning?: string) {
  const facts = { runningAgents: 0, unit: PROGRESS_UNIT, build: parseProgress(stdout), planning }
  const bar = barView(facts)

  if (bar === null) {
    throw new Error('the bar is hidden')
  }

  return bar
}

// The terminal's line, 160 cells wide.
function line(stdout: string, planning?: string) {
  return terminalRuns(view(stdout, planning), 160)
    .map(run => run.text)
    .join('')
}

function runOf(stdout: string, number: string) {
  const run = terminalRuns(view(stdout), 160).find(candidate => candidate.text === number)

  if (run === undefined) {
    throw new Error(`no segment ${number} on the terminal`)
  }

  return run
}

// The Desktop's Svg, wide enough for every rung of the ladder.
function svg(stdout: string, planning?: string) {
  return barSvg(view(stdout, planning), 1200)
}

// The hover texts of the Desktop's segments, in drawing order.
function hovers(stdout: string) {
  return [...svg(stdout).matchAll(/<title>([\s\S]*?)<\/title>/g)].map(([, text = '']) => text)
}

function hover(stdout: string, number: string) {
  const text = hovers(stdout).find(candidate => candidate.startsWith(number))

  if (text === undefined) {
    throw new Error(`no hover for segment ${number}`)
  }

  return text
}

function count(source: string, pattern: string) {
  return source.match(new RegExp(pattern, 'g'))?.length ?? 0
}

// Every word the Desktop and the terminal draw: the Svg's texts and hovers, and the terminal's line.
function drawnWords(stdout: string) {
  const texts = [...svg(stdout).matchAll(/<(?:text|title)[^>]*>([^<]*)</g)].map(([, text]) => text)

  return [...texts, line(stdout)].join('\n')
}

function change(report: ProgressReport, number: string, fields: Partial<ProgressTicket>) {
  const ticket = report.tickets.find(candidate => candidate.slug.startsWith(number))

  if (ticket === undefined) {
    throw new Error(`no ticket ${number}`)
  }
  Object.assign(ticket, fields)
}

function ticketOf(number: string, kind: string): ProgressTicket {
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
}

// Two done, one that can start, one waiting. The counts are the CLI's own and say five, so k/M cannot come from
// the ticket list.
const MIXED = progressReport(report => {
  change(report, '03', { status: 'ready-for-agent', kind: 'start', reason: 'can start' })
  change(report, '04', { status: 'ready-for-agent', kind: 'waiting', reason: 'waiting for 03' })
  report.counts = { done: 2, failed: 0, open: 3 }
})

// One ticket of each kind, listed in an order that is not the drawing order.
const KINDS = progressReport(report => {
  report.tickets = [
    ticketOf('01', 'blocked'),
    ticketOf('02', 'done'),
    ticketOf('03', 'start'),
    ticketOf('04', 'waiting'),
    ticketOf('05', 'running'),
  ]
  report.counts = { done: 1, failed: 1, open: 3 }
})

describe('the build from progress', () => {
  test('wave N, one segment per ticket by its two digits, and k/M from the counts', () => {
    expect(line(MIXED)).toBe('● idle  auto-measure  wave 4  01 02  03  04  2/5')
  })

  test('wave 0 leaves "wave" out, on both surfaces', () => {
    const noWave = progressReport(report => {
      report.wave = 0
    }, MIXED)

    expect(line(noWave)).not.toContain('wave')
    expect(line(noWave)).toContain('01 02  03  04  2/5')
    expect(wordsOf(svg(noWave)).join(' ')).not.toContain('wave')
  })

  test('done is green, running amber with a shine, start, blocked and waiting an outline; done, then running and start, then the rest', () => {
    expect(line(KINDS)).toBe('● idle  auto-measure  wave 4  02  03 05  01 04  1/5')
    expect(runOf(KINDS, '02')).toMatchObject({ backgroundColor: GREEN, color: WHITE })
    expect(runOf(KINDS, '05')).toMatchObject({ backgroundColor: AMBER, color: AMBER_DIGITS })

    for (const outlined of ['01', '03', '04']) {
      expect(runOf(KINDS, outlined).backgroundColor).toBeUndefined()
      expect(runOf(KINDS, outlined).color).toBe(GREY)
    }
    const desktop = svg(KINDS)
    expect(hovers(KINDS).map(text => text.slice(0, 2))).toEqual(['02', '03', '05', '01', '04'])
    expect(count(desktop, `<rect[^>]*fill="${GREEN}"`)).toBe(1)
    expect(count(desktop, `<rect[^>]*fill="${AMBER}"`)).toBe(1)
    expect(count(desktop, '<rect[^>]*fill="none"')).toBe(3)
    expect(count(desktop, 'class="shimmer"')).toBe(1)
  })

  // PROGRESS_OPEN is what the CLI prints for a ticket in progress: `counts.failed` is 1 and its kind is `running`.
  test('a ticket the counts call failed draws as a running one, and M holds the failed count', () => {
    expect(line(PROGRESS_OPEN)).toBe('● idle  auto-measure  wave 4  01 02  03  04  2/4')
    expect(runOf(PROGRESS_OPEN, '03')).toMatchObject({ backgroundColor: AMBER, color: AMBER_DIGITS })
    expect(count(svg(PROGRESS_OPEN), 'class="shimmer"')).toBe(1)
  })

  test('a field schema 1 does not name is ignored', () => {
    const extra = progressReport(report => {
      report.future = { anything: [1, 2, 3], title: 'not a title' }
      Object.assign(report.counts, { skipped: 9 })
      Object.assign(report.mr ?? {}, { url: 'https://example.com/other' })
      Object.assign(report.tickets[0] ?? {}, { owner: 'someone', score: 3 })
    }, PROGRESS_OPEN)

    expect(parseProgress(PROGRESS_OPEN)).toBeDefined()
    expect(parseProgress(extra)).toEqual(parseProgress(PROGRESS_OPEN))
    expect(line(extra)).toBe(line(PROGRESS_OPEN))
    expect(svg(extra)).toBe(svg(PROGRESS_OPEN))
  })

  test('the band draws no cost', () => {
    const costly = progressReport(report => {
      report.cost = { weighted_tokens: 7777777.5, merged: 6543, build_minutes: 4321 }
    }, PROGRESS_OPEN)
    const words = drawnWords(costly)

    for (const cost of ['7777777', '7778', '7.8', '4321', '6543']) {
      expect(words).not.toContain(cost)
    }
  })
})

const STAGE_ENDED = '2026-10-12 14:36'
const CHIPS_LINE = `● idle  ${PROGRESS_UNIT}  interview › specify › slice › conduct › ship`

// Each stage chip on the terminal, as `label:state`: green is done, amber current, an outline later.
function terminalChips(stdout: string, planning?: string, labels = STAGES) {
  return terminalRuns(view(stdout, planning), 160)
    .filter(run => labels.includes(run.text))
    .map(run => {
      const state = run.backgroundColor === GREEN ? 'done' : run.backgroundColor === AMBER ? 'current' : 'later'

      return `${run.text}:${state}`
    })
}

// What the bar draws of a unit with no ticket: the same words and states on the terminal and on Desktop.
function expectChips(stdout: string, expected: string[], planning?: string) {
  expect(line(stdout, planning)).toBe(CHIPS_LINE)
  expect(terminalChips(stdout, planning)).toEqual(expected)
  const separated = STAGES.flatMap(stage => [stage, '›']).slice(0, -1)

  expect(wordsOf(svg(stdout, planning))).toEqual(['idle', PROGRESS_UNIT, ...separated])
  expect(chipsOf(svg(stdout, planning))).toEqual(expected)
}

describe('the planning stages before any ticket (AC-13)', () => {
  test('the stage of the report is read as its name and ended time, or null', () => {
    expect(parseProgress(stagedAt('specify', STAGE_ENDED))).toMatchObject({ stage: { name: 'specify', ended: STAGE_ENDED } })
    expect(parseProgress(planningReport(null))).toMatchObject({ stage: null })
  })

  const cases = [
    ['no stage seen', planningReport(null), 0],
    ['interview', stagedAt('interview', STAGE_ENDED), 1],
    ['specify', stagedAt('specify', STAGE_ENDED), 2],
    ['slice', stagedAt('slice', STAGE_ENDED), 3],
  ] as const

  for (const [seen, stdout, done] of cases) {
    test(`${seen}: the stages before it done, the next one current, the rest later`, () => {
      expectChips(stdout, stagesAt(done))
    })
  }
})

describe('a stage that is no planning stage (AC-14)', () => {
  for (const name of ['review', 'build', 'diagnose']) {
    test(`${name} draws the stored planning stage, and interview current when none is stored`, () => {
      expectChips(stagedAt(name, STAGE_ENDED), stagesAt(2), 'specify')
      expectChips(stagedAt(name, STAGE_ENDED), stagesAt(0))
    })
  }
})

describe('the skills that set a live chip', () => {
  test('a planning skill bare or in the anomaly namespace sets its chip; another namespace or a path sets none', () => {
    for (const stage of ['interview', 'specify', 'slice']) {
      expect(phase.liveSkillOf(stage)).toBe(stage)
      expect(phase.liveSkillOf(`anomaly:${stage}`)).toBe(stage)
    }
    for (const name of ['other-plugin:slice', '/some/dir/specify', 'anomaly:review', 'conduct']) {
      expect(phase.liveSkillOf(name)).toBeUndefined()
    }
  })
})

describe('the hover of a segment on Desktop', () => {
  // Ticket 01 holds every number and mark; 04 is blocked, with a reason.
  function hoverCase(edit: (report: ProgressReport) => void = () => {}) {
    return progressReport(report => {
      change(report, '01', { build_minutes: 47, high: 12, fix_rounds: 38 })
      edit(report)
    }, PROGRESS_OPEN)
  }

  test('NN and the title, then " — " and the reason when the reason is not null', () => {
    const stdout = hoverCase()

    expect(hover(stdout, '04').startsWith('04 The start hook, ADR-0026 and the reference — blocked by 03 (in-progress)')).toBe(
      true,
    )
    expect(hover(stdout, '01').startsWith('01 measure --quiet')).toBe(true)
    expect(hover(stdout, '01').startsWith('01 measure --quiet — ')).toBe(false)
  })

  test('the red, reviewed and verified marks each show', () => {
    const shown = hover(hoverCase(), '01')

    for (const unmarked of [{ red: false }, { reviewed: false }, { verified: false }]) {
      expect(hover(hoverCase(report => change(report, '01', unmarked)), '01')).not.toBe(shown)
    }
  })

  test('the minutes, High and fix rounds show when they are not null, a zero too', () => {
    const shown = hover(hoverCase(), '01')

    for (const [value, nulled] of [
      ['47', { build_minutes: null }],
      ['12', { high: null }],
      ['38', { fix_rounds: null }],
    ] as const) {
      expect(shown).toContain(value)
      expect(hover(hoverCase(report => change(report, '01', nulled)), '01')).not.toContain(value)
    }
    expect(hover(hoverCase(report => change(report, '01', { high: 0 })), '01')).not.toBe(
      hover(hoverCase(report => change(report, '01', { high: null })), '01'),
    )
  })
})

// Whether `parseProgress` reads the stdout as a report the bar can draw (it names tickets).
function isReport(stdout: string) {
  const parsed: unknown = parseProgress(stdout)

  return typeof parsed === 'object' && parsed !== null && 'tickets' in parsed
}

describe('a report the bar cannot trust', () => {
  const NOTICE = (schema: number) => `anomaly progress schema ${schema} > 1: update workflow-bar`
  // Warnings and the unit are there to show they are not drawn beside the notice.
  const newer = (schema: number) =>
    progressReport(report => {
      report.schema = schema
      report.warnings = ['a warning']
    }, PROGRESS_OPEN)

  test('an integer schema above 1 draws the update notice after the agent part, and no other part', () => {
    for (const schema of [2, 12]) {
      expect(line(newer(schema))).toBe(`● idle  ${NOTICE(schema)}`)
      // The Svg escapes the `>` of the notice, as it does every word.
      expect(wordsOf(svg(newer(schema)))).toEqual(['idle', NOTICE(schema).replace('>', '&gt;')])
      expect(svg(newer(schema))).not.toContain('data-ticket')
    }
    expect(drawnWords(PROGRESS_OPEN)).not.toContain('anomaly progress schema')
  })

  test('output that is not one JSON object is no report, and not the newer schema', () => {
    expect(isReport(PROGRESS_OPEN)).toBe(true)

    for (const stdout of ['x', '[]', 'null']) {
      expect(isReport(stdout)).toBe(false)
      expect(parseProgress(stdout)).not.toEqual(parseProgress(newer(2)))
    }
  })

  test('a schema that is not an integer is no report, and not the newer schema', () => {
    for (const schema of [1.5, '1']) {
      const stdout = progressReport(report => Object.assign(report, { schema }), PROGRESS_OPEN)

      expect(isReport(stdout)).toBe(false)
      expect(parseProgress(stdout)).not.toEqual(parseProgress(newer(2)))
    }
  })
})

describe('warnings', () => {
  // `count` warnings of 203 characters each, so the hover must cut them.
  const texts = (count: number) =>
    Array.from({ length: count }, (_, index) => `W${index + 1} ${String(index + 1).repeat(200)}`)
  const warned = (warnings: string[]) =>
    progressReport(report => {
      report.warnings = warnings
    }, PROGRESS_OPEN)
  // The warnings' hover: the one title that is not a segment's.
  const warningHover = (stdout: string) => hovers(stdout).find(text => text.includes('W1')) ?? ''

  test('one warning draws ⚠ 1, seven draw ⚠ 7, none draw no ⚠, on both surfaces', () => {
    expect(line(warned(texts(1)))).toContain('⚠ 1')
    expect(wordsOf(svg(warned(texts(1))))).toContain('⚠ 1')
    expect(line(warned(texts(7)))).toContain('⚠ 7')
    expect(wordsOf(svg(warned(texts(7))))).toContain('⚠ 7')
    expect(drawnWords(PROGRESS_OPEN)).not.toContain('⚠')
  })

  test('the Desktop hover lists 5 texts at most, each cut to 160 characters, then "and 2 more"', () => {
    const all = texts(7)
    const hover = warningHover(warned(all))

    for (const text of all.slice(0, 5)) {
      expect(hover).toContain(text.slice(0, 160))
      expect(hover).not.toContain(text.slice(0, 161))
    }
    for (const text of all.slice(5)) {
      expect(hover).not.toContain(text.slice(0, 2))
    }
    expect(hover).toContain('and 2 more')
    expect(warningHover(warned(all.slice(0, 5)))).not.toContain('more')
  })

  test('the hover cut keeps an emoji at the 160th character whole', () => {
    const emoji = `W1 ${'a'.repeat(156)}😀tail`

    expect(warningHover(warned([emoji]))).toContain(`W1 ${'a'.repeat(156)}😀`)
    expect(warningHover(warned([emoji]))).not.toContain('tail')
  })
})

// A report whose unit is null, with agents running: the agent part and the warnings, no unit and nothing after them.
describe('a report with no unit', () => {
  const warned = parseProgress(NO_UNIT_PICKED)
  const tickets = parseProgress(NO_UNIT)

  test('draws the agent part and the warnings of the report, with no unit and no layout', () => {
    const bar = barView({ runningAgents: 2, unit: undefined, build: warned })

    expect(bar).toMatchObject({ state: 'running', count: 2, layout: { kind: 'none' } })
    expect(bar?.warnings).toEqual(['no work unit picked: none matches the current branch and none is unfinished'])
    expect(bar?.unit).toBeUndefined()
    expect(barView({ runningAgents: 0, unit: undefined, build: warned })).toMatchObject({
      state: 'idle',
      layout: { kind: 'none' },
    })
  })

  test('draws no track and no build, whatever stage or tickets the report holds', () => {
    expect(barView({ runningAgents: 0, unit: undefined, build: tickets, planning: 'specify', live: 'slice' })?.layout).toEqual(
      { kind: 'none' },
    )
  })

  test('with no warning draws the agent part alone', () => {
    const bar = barView({ runningAgents: 1, unit: undefined, build: parseProgress('{"schema": 1, "unit": null}') })

    expect(bar).toMatchObject({ state: 'running', count: 1, layout: { kind: 'none' } })
    expect(bar?.warnings).toBeUndefined()
  })

  test('on the terminal and on Desktop it is the dot, the agent words and ⚠ N', () => {
    const bar = barView({ runningAgents: 2, unit: undefined, build: warned })

    if (bar === null) {
      throw new Error('the bar is hidden')
    }
    expect(
      terminalRuns(bar, 160)
        .map(run => run.text)
        .join(''),
    ).toBe('● 2 agents  ⚠ 1')
    expect(wordsOf(barSvg(bar, 1200))).toEqual(expect.arrayContaining(['2 agents', '⚠ 1']))
  })

  test('with no report at all the bar is hidden', () => {
    expect(barView({ runningAgents: 2, unit: undefined, build: undefined })).toBeNull()
  })
})

describe('strings from the JSON', () => {
  test('a title with an ESC, a C1 control or a newline is drawn without the controls, and a space for the newline', () => {
    const stdout = progressReport(report => {
      change(report, '04', { title: 'A\u001b[31mred\u009b\u0085X\nB', reason: 'blocked by\n03\u001b' })
    }, PROGRESS_OPEN)
    const text = hover(stdout, '04')

    expect(text.startsWith('04 A[31mredX B — blocked by 03')).toBe(true)
    // Every control but the newline, which a hover may use between its lines.
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
  })

  test('DEL and a lone surrogate are removed, and a tab becomes a space', () => {
    expect(cleanText('A\u007fB')).toBe('AB')
    expect(cleanText('A\uD800B\uDC00C')).toBe('ABC')
    expect(cleanText('A\tB')).toBe('A B')
  })

  test('a carriage return or CRLF becomes one space, and a surrogate pair is kept', () => {
    expect(cleanText('A\rB')).toBe('A B')
    expect(cleanText('A\r\nB')).toBe('A B')
    expect(cleanText('😀')).toBe('😀')
  })

  test('the bidi controls U+202A to U+202E and U+2066 to U+2069 are removed', () => {
    expect(cleanText('A\u{202a}B\u{202b}C\u{202c}D\u{202d}E\u{202e}F')).toBe('ABCDEF')
    expect(cleanText('A\u{2066}B\u{2067}C\u{2068}D\u{2069}E')).toBe('ABCDE')
  })
})

const MR_LINK = 'https://github.com/Kurkulya/anomaly/pull/19'
const MR_SHA = '4009febc17b8bfbcb517ef7c64a295f1c80c5971'
const FINISH_LABELS = ['MR', 'reviewed', 'verified']
const FINISH_LINE = `● idle  ${PROGRESS_UNIT}  4/4 ✓  MR › reviewed › verified`

// PROGRESS_BASE has every ticket done; only its `mr` changes.
const finishedWith = (mr: ProgressReport['mr']) =>
  progressReport(report => {
    report.mr = mr
  })

// The finish chips on both surfaces, each as `label:state`.
function expectFinish(stdout: string, expected: string[]) {
  expect(terminalChips(stdout, undefined, FINISH_LABELS)).toEqual(expected)
  expect(chipsOf(svg(stdout))).toEqual(expected)
}

describe('the finish after the last ticket (AC-22)', () => {
  test('an mr of three nulls draws M/M ✓ and the chips MR, reviewed and verified, none done and MR current', () => {
    const stdout = finishedWith({ link: null, reviewed: null, verified: null })

    expect(line(stdout)).toBe(FINISH_LINE)
    expect(wordsOf(svg(stdout))).toEqual(['idle', PROGRESS_UNIT, '4/4 ✓', 'MR', '›', 'reviewed', '›', 'verified'])
    expect(svg(stdout)).not.toContain('data-ticket')
    expectFinish(stdout, ['MR:current', 'reviewed:later', 'verified:later'])
  })

  const cases = [
    ['the link set', { link: MR_LINK, reviewed: null, verified: null }, ['MR:done', 'reviewed:current', 'verified:later']],
    ['the link and reviewed set', { link: MR_LINK, reviewed: MR_SHA, verified: null }, ['MR:done', 'reviewed:done', 'verified:current']],
    ['all three set', { link: MR_LINK, reviewed: MR_SHA, verified: MR_SHA }, ['MR:done', 'reviewed:done', 'verified:done']],
    ['reviewed set without the link', { link: null, reviewed: MR_SHA, verified: null }, ['MR:current', 'reviewed:done', 'verified:later']],
  ] as const

  for (const [name, mr, expected] of cases) {
    test(`${name}: each field not null is done, the first not done is current`, () => {
      expectFinish(finishedWith(mr), [...expected])
    })
  }

  test('an mr that is null draws the same as an mr of three nulls', () => {
    const stdout = finishedWith(null)

    expect(line(stdout)).toBe(FINISH_LINE)
    expectFinish(stdout, ['MR:current', 'reviewed:later', 'verified:later'])
  })

  test('a report with a ticket not done and an mr link draws no MR part (D-9: after the last ticket)', () => {
    const open = progressReport(report => {
      report.mr = { link: MR_LINK, reviewed: null, verified: null }
    }, PROGRESS_OPEN)

    expect(view(open).mr).toBeUndefined()
  })

  test('tickets with counts of 0/0/0 draw the build, not 0/0 ✓', () => {
    const empty = progressReport(report => {
      report.counts = { done: 0, failed: 0, open: 0 }
    })

    expect(view(empty).layout.kind).toBe('build')
    expect(line(empty)).not.toContain('✓')
  })
})

describe('the MR link (AC-23, AC-24)', () => {
  const GITLAB_LINK = 'https://gitlab.com/group/sub/project/-/merge_requests/42'
  const OTHER_LINK = 'https://example.com/reviews/7'

  // `phase.mrPart(link)` is the part drawn beside the bar: its words, and its href when the link passed the check. A
  // host other than github.com and gitlab.com is named after the label.
  for (const [link, label] of [
    [MR_LINK, 'PR #19'],
    [GITLAB_LINK, '!42'],
    ['https://github.com/Kurkulya/anomaly', 'MR'],
    ['https://git.example.com/team/shop/pull/3', 'PR #3 · git.example.com'],
    ['https://code.example.org/group/shop/-/merge_requests/5', '!5 · code.example.org'],
    [OTHER_LINK, 'MR · example.com'],
    // A named host over 24 characters is `…` and its last 23, so its end, which names the real site, shows.
    ['https://a-very-long-review-host.example.com/pull/8', 'PR #8 · …review-host.example.com'],
    ['https://github.com.pulls.review.evil.example/pull/1', 'PR #1 · …lls.review.evil.example'],
  ]) {
    test(`${link} is a Link labelled ${label}`, () => {
      expect(phase.mrPart(link)).toEqual({ text: label, href: link })
    })
  }

  // An http link and a link with `@` are long enough to show the cut at 24 characters.
  for (const link of ['!42', 'http://github.com/Kurkulya/anomaly/pull/19', 'https://user@github.com/Kurkulya/anomaly/pull/19']) {
    test(`${link} is plain text cut to 24 characters, with no href`, () => {
      const part = phase.mrPart(link)

      expect(part?.text).toBe(link.slice(0, 24))
      expect(part?.href).toBeUndefined()
    })
  }

  test('a cut that falls inside an emoji keeps the whole emoji or drops it, never half (D-12)', () => {
    // The emoji takes UTF-16 indices 23 and 24, so a cut at 24 units would keep its first half and drop its second.
    const part = phase.mrPart(`${'a'.repeat(23)}😀 and more`)

    expect(() => encodeURIComponent(part.text)).not.toThrow()
    expect(part.href).toBeUndefined()
  })

  // Each fails one check of `safeHref` alone: the length, and the spelling `new URL(link).href` gives.
  const TOO_LONG = `https://x.io/${'a'.repeat(2036)}`

  test('the long link is one character over the 2048 the check allows', () => {
    expect(TOO_LONG).toHaveLength(2049)
  })

  for (const [name, link] of [
    ['a 2049-character https link', TOO_LONG],
    ['a link not spelled as new URL(link).href', 'https://GitHub.com/a/b/pull/1'],
  ]) {
    test(`${name} is plain text cut to 24 characters, with no href`, () => {
      const part = phase.mrPart(link)

      expect(part.text).toBe(link.slice(0, 24))
      expect(part.href).toBeUndefined()
    })
  }
})
