import type { WorkflowBarChipState, WorkflowBarTicketState } from '../types'

// Every colour the bar draws with, for the SVG and the terminal alike.
export const AMBER = '#EF9F27'
// The digits on an amber (in progress) segment.
export const AMBER_DIGITS = '#412402'
// A done ticket's fill; its digits are white.
export const GREEN = '#1D9E75'
export const WHITE = '#FFFFFF'
// A mid grey that reads on a light and on a dark background: the idle dot, a waiting segment's outline and digits.
export const GREY = '#8A8A86'
// The dark edge around white words, so they read on green, amber and an empty track in either theme.
export const EDGE = 'rgba(0,0,0,.55)'
// The SVG's words: the isolated frame sees the app's light or dark theme, so they switch with it.
export const LABEL_LIGHT = '#3D3D3A'
export const LABEL_DARK = '#E8E6DC'
// The green and the grey as 12px words: darker on the light theme, lighter green on the dark one (contrast).
export const GREEN_TEXT_LIGHT = '#0F6E56'
export const GREEN_TEXT_DARK = '#3DBE94'
export const GREY_TEXT_LIGHT = '#6B6B67'

// How a state paints its box: a fill (or, with none, an outline) and the words on it.
export type TicketPaint = { fill?: string; outline?: string; digits: string }

const TICKET_PAINT: Record<WorkflowBarTicketState, TicketPaint> = {
  done: { fill: GREEN, digits: WHITE },
  running: { fill: AMBER, digits: AMBER_DIGITS },
  waiting: { outline: GREY, digits: GREY },
}

export function ticketPaint(state: WorkflowBarTicketState) {
  return TICKET_PAINT[state]
}

// A phase chip paints like a ticket: done like done, the current chip like one in progress, later like waiting.
const CHIP_PAINT: Record<WorkflowBarChipState, TicketPaint> = {
  done: TICKET_PAINT.done,
  current: TICKET_PAINT.running,
  later: TICKET_PAINT.waiting,
}

export function chipPaint(state: WorkflowBarChipState) {
  return CHIP_PAINT[state]
}
