import { ticketState } from './build'
import {
  EDGE,
  GREEN_TEXT_DARK,
  GREEN_TEXT_LIGHT,
  GREY,
  GREY_TEXT_LIGHT,
  LABEL_DARK,
  LABEL_LIGHT,
  WHITE,
  chipPaint,
  ticketPaint,
} from './palette'
import type { TicketPaint } from './palette'
import {
  barLabel,
  buildRung,
  chipPlan,
  countLabel,
  doneLabel,
  dotColor,
  keptChip,
  nowLabel,
  schemaNotice,
  smoothLabel,
  warningLabel,
  waveLabel,
} from './view'
import type { BuildView } from './build'
import type { Chip, PhaseView } from './phase'
import type { BarView, ChipPlan, Layout } from './view'
import type { WorkflowBarTicket } from '../types'

export const BAR_HEIGHT = 22
// CSS pixels per band cell on Desktop, as measured there.
export const PX_PER_CELL = 7.9
// The width of one 12px monospace glyph, to place the words one after another.
export const CHAR_PX = 7.2
const MID_Y = BAR_HEIGHT / 2
const DOT_X = 8
const DOT_R = 4
const LABEL_X = 18
// The words' baseline (labels and digits alike), below the middle so the text sits centred on the dot.
const LABEL_Y = MID_Y + 4
// Space between the parts (agents, unit, wave, segments, count), and after the last one.
const PART_GAP = 12
const END_GAP = 4
// One segment per ticket: about 28 px each, a wider gap between two groups. A segment holds two digits: the
// first two of the ticket's slug.
const SEGMENT_W = 24
const SEGMENT_STEP = 28
const GROUP_GAP = 10
const BOX_H = 16
const BOX_Y = (BAR_HEIGHT - BOX_H) / 2
const BOX_R = 3
// The smooth bar's stripes: STRIPE px tiles, half of each painted, turned 45 degrees, so they repeat along x
// every STRIPE_PERIOD px.
const STRIPE = 8
const STRIPE_PERIOD = STRIPE * Math.SQRT2
// The smooth bar's inner words keep this much room on either side.
const SMOOTH_PAD = 4
const ELLIPSIS = '…'
// A phase chip: its word with CHIP_PAD either side; SEP_W (with a `›`) between the chips; COUNT_GAP_PX before the
// count of chips done.
const CHIP_PAD = 6
const SEP_W = 16
const COUNT_GAP_PX = 6
// How long a done ticket's pop plays; the build drops the pop after it, so it plays once.
export const POP_MS = 600
// The warnings' hover lists this many texts, each cut to this many characters.
const WARNING_LINES = 5
const WARNING_CHARS = 160

const STYLE = [
  // Without it the isolated frame paints an opaque white canvas in the dark theme.
  ':root{color-scheme:light dark}',
  `.label{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:${LABEL_LIGHT}}`,
  '.label.name{font-weight:600}',
  // Idle and secondary words, and `M/M ✓` once every ticket is closed: a darker shade on the light theme.
  `.label.idle,.label.muted{fill:${GREY_TEXT_LIGHT}}`,
  `.label.ok{fill:${GREEN_TEXT_LIGHT}}`,
  // After the light rules, so the dark theme overrides them at equal weight.
  `@media (prefers-color-scheme: dark){.label{fill:${LABEL_DARK}}.label.idle,.label.muted{fill:${GREY}}.label.ok{fill:${GREEN_TEXT_DARK}}}`,
  '.digits{font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-anchor:middle}',
  // White words with a dark edge read on green, amber, and the empty track in either theme.
  '.inner{font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-anchor:middle}',
  `.inner{fill:${WHITE};stroke:${EDGE};stroke-width:2px;paint-order:stroke}`,
  '.pulse{animation:pulse 1.6s ease-in-out infinite}',
  '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}',
  '.shimmer{animation:shimmer 1.6s linear infinite}',
  `@keyframes shimmer{from{transform:translateX(-${SEGMENT_W}px)}to{transform:translateX(${SEGMENT_W}px)}}`,
  // A chip's shine sweeps its own width, whatever the word's length.
  '.chipshine{transform-box:fill-box;animation:chipshine 1.6s linear infinite}',
  '@keyframes chipshine{from{transform:translateX(-100%)}to{transform:translateX(100%)}}',
  '.stripes{animation:stripes .8s linear infinite}',
  `@keyframes stripes{from{transform:translateX(-${STRIPE_PERIOD}px)}to{transform:translateX(0)}}`,
  // Once, on a segment that turned done in the build being drawn (each redraw sends a new SVG).
  `.pop{animation:pop ${POP_MS}ms ease-out 1;transform-box:fill-box;transform-origin:center}`,
  '@keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}',
].join('')

const DEFS = [
  '<defs>',
  '<linearGradient id="shine" x1="0" x2="1" y1="0" y2="0">',
  `<stop offset="0" stop-color="${WHITE}" stop-opacity="0"/>`,
  `<stop offset=".5" stop-color="${WHITE}" stop-opacity=".55"/>`,
  `<stop offset="1" stop-color="${WHITE}" stop-opacity="0"/>`,
  '</linearGradient>',
  `<pattern id="stripe" width="${STRIPE}" height="${STRIPE}" patternUnits="userSpaceOnUse"`,
  ' patternTransform="rotate(45)">',
  `<rect width="${STRIPE / 2}" height="${STRIPE}" fill="${WHITE}" fill-opacity=".35"/>`,
  '</pattern>',
  '</defs>',
].join('')

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
// Characters XML 1.0 does not allow, even escaped: the C0 controls but tab, newline and return; U+FFFE and U+FFFF;
// a lone surrogate. One of them in a title would make the whole SVG invalid.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDFFF]/gu

function escape(text: string) {
  return text.replace(NOT_XML, '').replace(/[&<>"']/g, char => ENTITIES[char] ?? char)
}

function textWidth(text: string) {
  return text.length * CHAR_PX
}

// The text, or as much of it as fits in `width` with an ellipsis; nothing when not even one glyph fits.
function fitText(text: string, width: number) {
  if (textWidth(text) <= width) {
    return text
  }
  const glyphs = Math.floor(width / CHAR_PX) - 1

  return glyphs < 1 ? '' : `${text.slice(0, glyphs)}${ELLIPSIS}`
}

// Rounded down, so the drawing never overshoots the band's slot.
export function cellsToPx(cells: number) {
  return Math.floor(cells * PX_PER_CELL)
}

function words(className: string, x: number, text: string) {
  return `<text class="${className}" x="${Math.round(x)}" y="${LABEL_Y}">${escape(text)}</text>`
}

function box(x: number, w: number, paint: string) {
  return `<rect x="${x}" y="${BOX_Y}" width="${w}" height="${BOX_H}" rx="${BOX_R}" ${paint}/>`
}

// A moving overlay clipped to the box at x: a nested svg is a clipping viewport that does not move with it.
function overlay(x: number, w: number, inner: string) {
  return `<svg x="${x}" y="${BOX_Y}" width="${w}" height="${BOX_H}">${inner}</svg>`
}

// A box's paint attributes: its fill, or with none an outline.
function paintAttrs(paint: TicketPaint) {
  return paint.fill === undefined ? `fill="none" stroke="${paint.outline}"` : `fill="${paint.fill}"`
}

// The words centred on a box from `x`, `w` wide, in the paint's digit colour.
function digitsText(x: number, w: number, paint: TicketPaint, text: string) {
  return `<text class="digits" x="${x + w / 2}" y="${LABEL_Y}" fill="${paint.digits}">${escape(text)}</text>`
}

// The state's paint from the palette; an in-progress segment adds a moving shine under its digits. An outline
// box takes the pointer inside it too, so hovering anywhere on it shows the tooltip.
function segmentParts(ticket: WorkflowBarTicket, x: number) {
  const state = ticketState(ticket)
  const paint = ticketPaint(state)
  const fill = paint.fill === undefined ? `${paintAttrs(paint)} pointer-events="all"` : paintAttrs(paint)
  const shine =
    state === 'running'
      ? [overlay(x, SEGMENT_W, `<rect class="shimmer" width="${SEGMENT_W}" height="${BOX_H}" fill="url(#shine)"/>`)]
      : []

  return [box(x, SEGMENT_W, fill), ...shine, digitsText(x, SEGMENT_W, paint, ticket.number)]
}

function mark(label: string, isSet: boolean) {
  return `${label} ${isSet ? '✓' : '–'}`
}

// A segment's hover, one line each: `NN <title>` and ` — <reason>` when there is one; the red, reviewed and
// verified marks; the minutes, High and fix rounds the CLI counted, when it counted any.
function hoverText(ticket: WorkflowBarTicket) {
  const reason = ticket.reason === null ? '' : ` — ${ticket.reason}`
  const marks = [mark('red', ticket.red), mark('reviewed', ticket.reviewed), mark('verified', ticket.verified)]
  const numbers = [
    ticket.buildMinutes === null ? undefined : `${ticket.buildMinutes} min`,
    ticket.high === null ? undefined : `High ${ticket.high}`,
    ticket.fixRounds === null ? undefined : `fix rounds ${ticket.fixRounds}`,
  ].filter((part): part is string => part !== undefined)
  const lines = [`${ticket.number} ${ticket.title}${reason}`, marks.join(' · ')]

  return [...lines, ...(numbers.length === 0 ? [] : [numbers.join(' · ')])].join('\n')
}

// The warnings' hover, one line each: the first WARNING_LINES texts cut to WARNING_CHARS characters (code points, so
// a cut never splits a surrogate pair), then `and <n> more`.
function warningsHover(warnings: readonly string[]) {
  const lines = warnings.slice(0, WARNING_LINES).map(warning => Array.from(warning).slice(0, WARNING_CHARS).join(''))
  const more = warnings.length - WARNING_LINES

  return [...lines, ...(more > 0 ? [`and ${more} more`] : [])].join('\n')
}

// `⚠ <count>`, with the warnings' texts as its hover; nothing when it does not fit before `end`.
function warningParts(warnings: readonly string[], x: number, end: number) {
  const label = warningLabel(warnings)

  if (x + textWidth(label) > end) {
    return ''
  }

  return `<g class="warnings"><title>${escape(warningsHover(warnings))}</title>${words('label', x, label)}</g>`
}

function segment(ticket: WorkflowBarTicket, x: number, isPopped: boolean) {
  const title = `<title>${escape(hoverText(ticket))}</title>`
  const className = `seg ${ticketState(ticket)}${isPopped ? ' pop' : ''}`

  const parts = segmentParts(ticket, x).join('')

  return `<g class="${className}" data-ticket="${escape(ticket.number)}">${title}${parts}</g>`
}

// The drawn tickets: `k/M` comes from the counts, which need not match the ticket list.
function segmentsWidth(build: BuildView) {
  const tickets = build.groups.reduce((sum, group) => sum + group.length, 0)

  return tickets * SEGMENT_STEP - (SEGMENT_STEP - SEGMENT_W) + (build.groups.length - 1) * GROUP_GAP
}

function segments(build: BuildView, x: number, popped: ReadonlySet<string>) {
  const drawn: string[] = []
  let cursor = x

  for (const group of build.groups) {
    for (const ticket of group) {
      drawn.push(segment(ticket, cursor, popped.has(ticket.number)))
      cursor += SEGMENT_STEP
    }
    cursor += GROUP_GAP
  }

  return drawn.join('')
}

// The narrowest smooth bar that still holds its words.
function smoothMinWidth(build: BuildView) {
  return textWidth(smoothLabel(build)) + 2 * SMOOTH_PAD
}

// One bar for all tickets: green done part, amber running part with moving stripes, the count inside.
function smoothBar(build: BuildView, x: number, w: number) {
  const doneW = Math.round((w * build.done) / build.total)
  const runningW = Math.round((w * build.running.length) / build.total)
  const runningX = x + doneW
  const stripesW = runningW + 2 * STRIPE_PERIOD
  const stripes = `<rect class="stripes" x="-${STRIPE_PERIOD}" width="${stripesW}" height="${BOX_H}" fill="url(#stripe)"/>`

  return [
    '<g class="smooth">',
    box(x, w, paintAttrs(ticketPaint('waiting'))),
    doneW > 0 ? box(x, doneW, paintAttrs(ticketPaint('done'))) : '',
    runningW > 0 ? box(runningX, runningW, paintAttrs(ticketPaint('running'))) + overlay(runningX, runningW, stripes) : '',
    `<text class="inner" x="${x + w / 2}" y="${LABEL_Y}">${escape(smoothLabel(build))}</text>`,
    '</g>',
  ].join('')
}

// The widest rung of the build's ladder (see `buildRung`) that fits in `room`.
function buildParts(build: BuildView, x: number, room: number, popped: ReadonlySet<string>) {
  const count = countLabel(build)
  const now = nowLabel(build)
  const nowW = PART_GAP + textWidth(now)
  const rung = buildRung(build, candidate => {
    switch (candidate) {
      case 'segments':
        return segmentsWidth(build) + PART_GAP + textWidth(count) <= room
      case 'smooth-now':
        return smoothMinWidth(build) + nowW <= room
      case 'smooth':
        return smoothMinWidth(build) <= room
      case 'count':
        return textWidth(count) <= room
    }
  })

  switch (rung) {
    case 'segments':
      return segments(build, Math.round(x), popped) + words('label', x + segmentsWidth(build) + PART_GAP, count)
    case 'smooth-now': {
      const barW = Math.floor(room - nowW)

      return smoothBar(build, Math.round(x), barW) + words('label muted', x + barW + PART_GAP, now)
    }
    case 'smooth':
      return smoothBar(build, Math.round(x), Math.floor(room))
    case 'count':
      return words('label', x, count)
    case 'none':
      return ''
  }
}

function chipWidth(chip: Chip) {
  return Math.round(textWidth(chip.label) + 2 * CHIP_PAD)
}

function planWidth(plan: ChipPlan) {
  const chips = plan.chips.reduce((sum, item, index) => sum + chipWidth(item) + (index === 0 ? 0 : SEP_W), 0)

  return chips + (plan.count === undefined ? 0 : COUNT_GAP_PX + textWidth(plan.count))
}

// The chip that stays when a row is shortened (the one `chipPlan` keeps).
function keptChipWidth(phase: PhaseView) {
  const kept = keptChip(phase.chips)

  return kept === undefined ? 0 : chipWidth(kept)
}

// A phase chip: done and current boxes filled, later ones outlined; the current one has a moving shine.
function chip(item: Chip, x: number, w: number) {
  const paint = chipPaint(item.state)
  const shine =
    item.state === 'current'
      ? overlay(x, w, `<rect class="chipshine" width="${w}" height="${BOX_H}" fill="url(#shine)"/>`)
      : ''
  const label = digitsText(x, w, paint, item.label)

  return `<g class="chip ${item.state}" data-chip="${escape(item.label)}">${box(x, w, paintAttrs(paint))}${shine}${label}</g>`
}

// The phase's chips in `room`: all of them, with a `›` between the chips (the track's and the finish's); or as many
// as `chipPlan` keeps.
function chipRow(phase: PhaseView, x: number, room: number) {
  const plan = chipPlan(phase.chips, candidate => planWidth(candidate) <= room)
  const drawn: string[] = []
  let cursor = Math.round(x)

  plan.chips.forEach((item, index) => {
    if (index > 0) {
      drawn.push(words('label muted', cursor + (SEP_W - CHAR_PX) / 2, '›'))
      cursor += SEP_W
    }
    const w = chipWidth(item)
    drawn.push(chip(item, cursor, w))
    cursor += w
  })
  if (plan.count !== undefined) {
    drawn.push(words('label muted', cursor + COUNT_GAP_PX, plan.count))
  }

  return drawn.join('')
}

// What the unit name must leave free: the build's wave and count, or the chip a narrow row keeps.
function reservedWidth(layout: Layout) {
  switch (layout.kind) {
    case 'none':
    case 'newer':
      return 0
    case 'track':
      return PART_GAP + keptChipWidth(layout.phase)
    case 'finish':
      return PART_GAP + textWidth(doneLabel(layout.build)) + PART_GAP + keptChipWidth(layout.phase)
    case 'build': {
      const wave = waveLabel(layout.build)

      return (wave === undefined ? 0 : PART_GAP + textWidth(wave)) + PART_GAP + textWidth(countLabel(layout.build))
    }
  }
}

// A label, then what follows it from the next part on; nothing when the label itself does not fit.
function labelled(className: string, label: string, x: number, end: number, rest: (x: number) => string) {
  if (x + textWidth(label) > end) {
    return ''
  }

  return words(className, x, label) + rest(x + textWidth(label) + PART_GAP)
}

// The layout from `x` to `end`: the track's chips; `M/M ✓` and the finish chips; `wave N` (none at wave 0) and the
// build.
function layoutParts(layout: Layout, x: number, end: number, popped: ReadonlySet<string>) {
  switch (layout.kind) {
    case 'none':
      return ''
    case 'newer':
      return labelled('label', schemaNotice(layout.schema), x, end, () => '')
    case 'track':
      return chipRow(layout.phase, x, end - x)
    case 'finish':
      return labelled('label ok', doneLabel(layout.build), x, end, next => chipRow(layout.phase, next, end - next))
    case 'build': {
      const wave = waveLabel(layout.build)
      const rest = (next: number) => buildParts(layout.build, next, end - next, popped)

      return wave === undefined ? rest(x) : labelled('label muted', wave, x, end, rest)
    }
  }
}

// One SVG for the whole bar: the agent part, the unit (or the repo), `⚠ N` when the report has warnings, then the
// phase track before build; in the build `wave N`, the segments (or the smooth bar) and `k/M`; after it `M/M ✓` and
// the finish chips. A report of a newer schema draws the agent part and the update notice alone.
// `popped` names the tickets that turned done in the build being drawn. A narrow band shortens the unit name
// first, so the rest keeps its room; a chip row then shortens to its current chip (see `chipPlan`).
export function barSvg(view: BarView, width: number, popped: ReadonlySet<string> = new Set()) {
  const dotClass = view.state === 'running' ? 'dot pulse' : 'dot'
  const labelClass = view.state === 'running' ? 'label' : 'label idle'
  const label = barLabel(view)
  const parts = [
    `<circle class="${dotClass}" cx="${DOT_X}" cy="${MID_Y}" r="${DOT_R}" fill="${escape(dotColor(view))}"/>`,
    words(labelClass, LABEL_X, label),
  ]
  const end = width - END_GAP
  let x = LABEL_X + textWidth(label) + PART_GAP

  const warnings = view.warnings
  const warningsReserve = warnings === undefined ? 0 : PART_GAP + textWidth(warningLabel(warnings))

  if (view.unit !== undefined) {
    const name = fitText(view.unit, end - x - reservedWidth(view.layout) - warningsReserve)

    if (name) {
      parts.push(words('label name', x, name))
      x += textWidth(name) + PART_GAP
    }
  }
  if (warnings !== undefined) {
    const drawn = warningParts(warnings, x, end)

    if (drawn) {
      parts.push(drawn)
      x += textWidth(warningLabel(warnings)) + PART_GAP
    }
  }
  parts.push(layoutParts(view.layout, x, end, popped))

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_HEIGHT}" viewBox="0 0 ${width} ${BAR_HEIGHT}">`,
    `<style>${STYLE}</style>`,
    DEFS,
    ...parts,
    '</svg>',
  ].join('')
}
