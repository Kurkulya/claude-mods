import type { WorkflowBarAgent } from '../types'

type Agents = WorkflowBarAgent[]

// Answers the same list when nothing changes, so the caller can skip the write.
function upsert(agents: Agents, id: string, isRunning: boolean) {
  const known = agents.find(agent => agent.id === id)

  if (known === undefined) {
    return [...agents, { id, isRunning }]
  }

  return known.isRunning === isRunning
    ? agents
    : agents.map(agent => (agent.id === id ? { id, isRunning } : agent))
}

// A step may come before the spawn resolves, and a short agent may even finish first: a known id keeps its state.
export function spawned(agents: Agents, id: string) {
  return agents.some(agent => agent.id === id) ? agents : [...agents, { id, isRunning: true }]
}

export function stepped(agents: Agents, id: string) {
  return upsert(agents, id, true)
}

export function finished(agents: Agents, id: string) {
  return upsert(agents, id, false)
}

export function runningCount(agents: Agents) {
  return agents.filter(agent => agent.isRunning).length
}
