import type { WorkflowBarBuild, WorkflowBarProgress, WorkflowBarTicket, WorkflowBarTicketState } from '../types'

export type BuildView = {
  // 0 when the report names none.
  wave: number
  // The done tickets, then the running and the startable ones, then the rest; empty groups left out.
  groups: WorkflowBarTicket[][]
  done: number
  total: number
  running: string[]
}

// How a ticket paints: done green, running amber, every other kind (start, blocked, waiting) an outline.
export function ticketState({ kind }: WorkflowBarTicket): WorkflowBarTicketState {
  return kind === 'done' || kind === 'running' ? kind : 'waiting'
}

function isNow({ kind }: WorkflowBarTicket) {
  return kind === 'running' || kind === 'start'
}

// The tickets done now that were not done in the build before; none without a build before (a unit's first
// read in this session), so a ticket pops only when it turned done while the bar watched.
function newlyDone(before: readonly WorkflowBarTicket[] | undefined, after: readonly WorkflowBarTicket[]) {
  if (before === undefined) {
    return []
  }
  const wasDone = new Set(before.filter(ticket => ticket.kind === 'done').map(ticket => ticket.number))

  return after.filter(ticket => ticket.kind === 'done' && !wasDone.has(ticket.number)).map(ticket => ticket.number)
}

// `k/M` is the CLI's own count: k the done tickets, M all three counts. Schema 1 counts a ticket still building as
// failed and gives it no kind of its own, so a failed ticket draws as the running one it is (D-10).
export function buildView({ wave, counts, tickets }: WorkflowBarProgress): BuildView | undefined {
  if (tickets.length === 0) {
    return undefined
  }
  const groups = [
    tickets.filter(ticket => ticket.kind === 'done'),
    tickets.filter(isNow),
    tickets.filter(ticket => ticket.kind !== 'done' && !isNow(ticket)),
  ]

  return {
    wave,
    groups: groups.filter(group => group.length > 0),
    done: counts.done,
    total: counts.done + counts.failed + counts.open,
    running: tickets.filter(ticket => ticket.kind === 'running').map(ticket => ticket.number),
  }
}

// The report as the bar keeps it, with the tickets that turned done since `before` (the last report, when it was
// of the same unit).
export function nextBuild(progress: WorkflowBarProgress, before?: WorkflowBarBuild): WorkflowBarBuild {
  const same = before?.unit === progress.unit ? before : undefined

  return { ...progress, popped: newlyDone(same?.tickets, progress.tickets) }
}
