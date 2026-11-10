import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import * as tracker from './agents'
import { desktopBand, terminalBand } from './band'
import { nextBuild } from './build'
import { isPlanningStage, liveSkillOf } from './phase'
import { anomalyInstallPath, isAnomalyCommand, parseProgress, progressCommand } from './progress'
import { POP_MS } from './svg'
import {
  STORE_PREFIX,
  asUnit,
  evictable,
  foldersUp,
  isUnderAnomaly,
  normalizePath,
  sameUnit,
  unitFolder,
  unitOfCommand,
  unitOfFolder,
  unitOfPath,
} from './unit'
import { barView } from './view'
import type { WorkflowBarBuild, WorkflowBarNewerSchema, WorkflowBarProgress, WorkflowBarUnit } from '../types'

const agents = atom({ plugin: 'workflow-bar', key: 'agents' } as const, [])
const unit = atom({ plugin: 'workflow-bar', key: 'unit' } as const, null)
const build = atom({ plugin: 'workflow-bar', key: 'build' } as const, null)
const live = atom({ plugin: 'workflow-bar', key: 'live' } as const, null)

const PLUGINS_FROM_HOME = '.claude/plugins'
const INSTALLED_PLUGINS = 'installed_plugins.json'
const PROCESS_TIMEOUT_MS = 5_000
// After a failed run no run starts for this long (D-5).
const PAUSE_MS = 30_000
// Files another session writes reach the bar within this long, while a ticket runs.
const REFRESH_MS = 10_000
// A unit's last planning stage is kept in `$.store` under this prefix and the unit's name: not STORE_PREFIX, so the
// eviction of old pins (`evictable`) leaves it alone.
const PLANNING_PREFIX = 'planning:'

// One refresh at a time: a trigger while one runs asks for one more pass when it ends.
let isRefreshing = false
let isRefreshWanted = false
// The anomaly plugin's `installPath`, with the size and time of the `installed_plugins.json` it came from: the file
// is read again only when they change (ADR-0002).
let install: { key: string; path: string | undefined } | undefined
// The 10-second clock: running while a ticket runs.
let ticker: Timer | undefined
// Whether a hook has run since this module loaded (see `wake`).
let isWoken = false
// Skill tool calls in flight. `skill.prompt` does not say who asked, so while a call runs, the call (which carries
// the caller) decides whether the skill is the main loop's own.
let skillCalls = 0
// Whether a fault was reported in this load: one line, not one per refresh.
let isFaultReported = false
// Whether the missing anomaly plugin was reported in this load: one line, not one per refresh.
let isMissingReported = false
// Whether a CLI without `progress --json` (exit 2) was reported in this load, and whether output that is no report
// was: one line each, not one per refresh.
let isUnsupportedReported = false
let isUnreadableReported = false
// Whether a run that could not start or timed out was reported in this load: one line, not one per refresh.
let isNotRunReported = false
// Whether `.anomaly/` lies in a session's folder or above it, kept per folder for this load; a main-loop write under
// `.anomaly/` or an `anomaly.py` command clears it (ADR-0004).
const anomalyFolders = new Map<string, boolean>()
// No run starts before this time (ms since the epoch): the pause after a failed run.
let pausedUntil = 0
// The timer that runs once when the pause ends, for a trigger that came during it.
let isPauseTimerSet = false
// The stdout of the run the build was last written from: an equal stdout writes nothing.
let lastStdout: string | undefined

// For `$.fs`, `$.process` and `$.store` calls only: a missing folder, a tool that is not installed, a timeout or a
// store that cannot answer is an answer here ("nothing"), not a fault.
async function attempt<T>(work: Promise<T>) {
  try {
    return await work
  } catch {
    return undefined
  }
}

// The anomaly plugin's `installPath` from `~/.claude/plugins/installed_plugins.json`; undefined without a readable
// file or an `anomaly@` key. A failed read is not kept, so the next refresh reads again.
async function anomalyInstall($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  if (home === undefined) {
    return undefined
  }
  const folder = `${normalizePath(home)}/${PLUGINS_FROM_HOME}`
  const entry = ((await attempt($.fs.list(folder))) ?? []).find(listed => listed.name === INSTALLED_PLUGINS)

  if (entry === undefined) {
    return undefined
  }
  const key = `${entry.size}:${entry.mtimeMs}`

  if (install?.key !== key) {
    const text = await attempt($.fs.read(`${folder}/${INSTALLED_PLUGINS}`))

    if (text === undefined) {
      return undefined
    }
    install = { key, path: anomalyInstallPath(text) }
  }

  return install.path
}

// The report the build holds; undefined for none and for the notice of a newer schema, which holds no report.
function reportOf(shown: WorkflowBarBuild | WorkflowBarNewerSchema | null) {
  return shown !== null && 'tickets' in shown ? shown : undefined
}

// No anomaly plugin to run: one line in the transcript per load.
function reportMissing($: EngineInterface) {
  if (isMissingReported) {
    return
  }
  isMissingReported = true
  $.ui.log('workflow-bar: no anomaly plugin in installed_plugins.json, so the bar has nothing to draw')
}

// A CLI without `progress --json`: one line in the transcript per load.
function reportUnsupported($: EngineInterface) {
  if (isUnsupportedReported) {
    return
  }
  isUnsupportedReported = true
  $.ui.log(
    'workflow-bar: the anomaly CLI has no progress --json, so the bar has nothing to draw; update the anomaly plugin',
  )
}

// Output that is no report the bar can read: one line in the transcript per load.
function reportUnreadable($: EngineInterface) {
  if (isUnreadableReported) {
    return
  }
  isUnreadableReported = true
  $.ui.log('workflow-bar: progress --json printed no report the bar can read; the bar keeps its last drawing')
}

// A run that cannot start or times out: one line in the transcript per load, with no path and no output in it.
function reportNotRun($: EngineInterface) {
  if (isNotRunReported) {
    return
  }
  isNotRunReported = true
  $.ui.log('workflow-bar: progress --json could not start or timed out; the bar keeps its last drawing')
}

// Whether `.anomaly/` lies in the session's folder or in a parent of it, asked once per folder until `anomalyFolders`
// is cleared. This approximates the CLI's own root (the git root); a folder the file system cannot answer for counts
// as having none.
async function hasAnomalyAbove($: EngineInterface, cwd: string) {
  const known = anomalyFolders.get(cwd)

  if (known !== undefined) {
    return known
  }
  let isFound = false

  for (const folder of foldersUp(cwd)) {
    if ((await attempt($.fs.exists(`${folder}/.anomaly`))) === true) {
      isFound = true
      break
    }
  }
  anomalyFolders.set(cwd, isFound)

  return isFound
}

// Nothing to draw: the bar hides.
async function hide($: EngineInterface) {
  lastStdout = undefined
  if ((await read($, build)) !== null) {
    await update($, build, () => null)
  }
}

// One run of `progress --json`: for the pinned unit under its own root, else for the session's folder. Without the
// anomaly plugin, or with a CLI that has no `progress` (exit 2), there is no run or no report and nothing to draw. A
// run that cannot start, times out, exits with another code or prints no report keeps the last drawing and pauses the
// runs for PAUSE_MS (D-5).
async function refreshOnce($: EngineInterface) {
  const installPath = await anomalyInstall($)

  if (installPath === undefined) {
    reportMissing($)
    await hide($)

    return
  }
  const now = await $.clock.now()

  if (now < pausedUntil) {
    runWhenPauseEnds($, pausedUntil - now)

    return
  }
  const pinned = await read($, unit)
  const named = pinned ? unitOfFolder(pinned.path) : undefined
  const cwd = await $.session.cwd()
  const command = named
    ? progressCommand(installPath, named.root, named.unit)
    : progressCommand(installPath, cwd)
  // The run starts in the install folder, not the session's: on Windows a bare `python` is looked up in the child's
  // folder before the PATH, so one planted in the repo would run (D-3).
  const ran = await attempt($.process.run(command, { cwd: installPath, timeoutMs: PROCESS_TIMEOUT_MS }))

  if (ran?.exitCode === 2) {
    reportUnsupported($)
    await hide($)

    return
  }
  const progress = ran?.exitCode === 0 ? parseProgress(ran.stdout) : undefined

  if (progress === undefined) {
    if (ran === undefined) {
      reportNotRun($)
    } else if (ran.exitCode === 0) {
      reportUnreadable($)
    }
    pausedUntil = (await $.clock.now()) + PAUSE_MS

    return
  }
  // A failing git call also answers no unit, so only a unit folder that is gone drops the pin (D-18).
  // This assumes the CLI and the bar see the same `<root>/.anomaly/<unit>`: a worktree's own copy keeps the pin.
  if (pinned && named && !('newerSchema' in progress) && progress.unit === null) {
    if ((await attempt($.fs.exists(pinned.path))) === false) {
      await unpin($, pinned)
      // The next pass runs with no `--unit`, so the unit the CLI picks shows without waiting for a trigger.
      isRefreshWanted = true
    }
  }
  // A run for the session's folder that names no unit draws the agent part only where `.anomaly/` lies in the folder or
  // above it; elsewhere there is nothing to draw (ADR-0004).
  if (!named && !('newerSchema' in progress) && progress.unit === null && !(await hasAnomalyAbove($, cwd))) {
    await hide($)

    return
  }
  // The stdout of the last run writes nothing, also right after a pop (the pop clears on its own timer).
  if (ran?.stdout === lastStdout) {
    return
  }
  const shown = await read($, build)
  const next = 'newerSchema' in progress ? progress : await withPlanning($, nextBuild(progress, reportOf(shown)))

  // Only a new stdout can name a new stage, so the live skill's end depends on stdout alone. It runs right before the
  // build write, with no store call between them, so a render seldom sees the new chip state with the old stage.
  await endLive($, reportOf(next))
  // An unchanged build is not written, so the band does not redraw and restart its animations.
  if (JSON.stringify(next) !== JSON.stringify(shown)) {
    await update($, build, () => next)
    if ('popped' in next) {
      dropPopLater($, next.popped)
    }
  }
  lastStdout = ran?.stdout
}

// A report with no ticket, with the planning stage the bar keeps for its unit in `$.store` (D-27): a report whose
// stage is a planning stage writes it there; any other stage draws the one kept there, if any. It runs only for a
// stdout the last run did not print, so the write depends on stdout alone.
async function withPlanning($: EngineInterface, report: WorkflowBarBuild): Promise<WorkflowBarBuild> {
  if (report.unit === null || report.tickets.length > 0) {
    return report
  }
  const key = `${PLANNING_PREFIX}${report.unit}`
  const { stage } = report

  if (stage !== null && isPlanningStage(stage.name)) {
    await attempt($.store.set(key, stage.name))

    return report
  }
  const kept = await attempt($.store.get(key))

  return typeof kept === 'string' && isPlanningStage(kept) ? { ...report, planning: kept } : report
}

// A trigger that came during the pause runs once when it ends; further triggers share that one run.
function runWhenPauseEnds($: EngineInterface, delayMs: number) {
  if (isPauseTimerSet) {
    return
  }
  isPauseTimerSet = true
  $.clock.after(delayMs, () => {
    isPauseTimerSet = false
    void refresh($)
  })
}

// A pop plays once: when its animation has run, the build drops it, so a later redraw draws the segment still. A
// newer read that popped other tickets keeps its own pop.
function dropPopLater($: EngineInterface, popped: readonly string[]) {
  if (popped.length === 0) {
    return
  }
  $.clock.after(POP_MS, () => {
    void guarded($, () => dropPop($, popped))
  })
}

async function dropPop($: EngineInterface, popped: readonly string[]) {
  const shown = reportOf(await read($, build))

  if (shown && JSON.stringify(shown.popped) === JSON.stringify(popped)) {
    await update($, build, current => {
      const report = reportOf(current)

      return report ? { ...report, popped: [] } : current
    })
  }
}

// A fault in the bar's own work: one line in the transcript per load, with the error's kind only (its message may
// hold a path or a file's words). The bar keeps its last drawing, and the next refresh runs as usual.
function report($: EngineInterface, error: unknown) {
  if (isFaultReported) {
    return
  }
  isFaultReported = true
  const kind = error instanceof Error ? error.name : typeof error
  $.ui.log(`workflow-bar: a refresh failed (${kind}); the bar keeps its last drawing and tries again`)
}

// The bar's own work, in a hook or a refresh pass: a fault is reported (see `report`), never thrown, so a hook that
// already called `next` never fails after it.
async function guarded($: EngineInterface, work: () => Promise<void>) {
  try {
    await work()
  } catch (error) {
    report($, error)
  }
}

async function refresh($: EngineInterface) {
  if (isRefreshing) {
    isRefreshWanted = true

    return
  }
  isRefreshing = true

  try {
    do {
      isRefreshWanted = false
      await guarded($, async () => {
        await refreshOnce($)
        // Inside the loop: a trigger that arrives while the clock is checked still gets its pass.
        await syncClock($)
      })
    } while (isRefreshWanted)
  } finally {
    isRefreshing = false
  }
}

// The clock runs while the last report holds a running ticket.
async function syncClock($: EngineInterface) {
  const isWatched = reportOf(await read($, build))?.tickets.some(ticket => ticket.kind === 'running') ?? false

  if (isWatched && ticker === undefined) {
    ticker = $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })
  } else if (!isWatched && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

// A reload runs `register` again in a fresh environment: the timers and this module's variables are gone, the
// host's `$.state` stays. The first hook that runs afterwards (a render, a Skill call, a prompt, an agent event or
// `session.start`) asks for a read, and the read starts the clock.
function wake($: EngineInterface) {
  if (!isWoken) {
    refreshSoon($)
  }
}

// Running the CLI outlives the hook's dispatch, so it runs from a timer: the hook that asked returns at once, and
// a slow run holds no tool call, turn end or session start. A hook's own state work (a live skill) runs in the
// hook, so it never waits for that run.
function refreshSoon($: EngineInterface) {
  isWoken = true
  $.clock.after(0, () => {
    void refresh($)
  })
}

// This session's key in `$.store`, where its pin is kept.
async function ownKey($: EngineInterface) {
  return `${STORE_PREFIX}${await $.session.id()}`
}

async function remember($: EngineInterface, named: WorkflowBarUnit) {
  const own = await ownKey($)
  await attempt($.store.set(own, named))

  for (const key of evictable((await attempt($.store.keys())) ?? [], own)) {
    await attempt($.store.delete(key))
  }
}

// The pin the run held goes, in the state and the store, unless a newer pin replaced it meanwhile.
async function unpin($: EngineInterface, pinned: WorkflowBarUnit) {
  await update($, unit, current => (sameUnit(current, pinned) ? null : current))
  const own = await ownKey($)

  if (sameUnit(asUnit(await attempt($.store.get(own))), pinned)) {
    await attempt($.store.delete(own))
  }
}

// A restarted session has no state, but its id finds the unit it pinned.
async function restore($: EngineInterface) {
  if (!(await read($, unit))) {
    const saved = asUnit(await attempt($.store.get(await ownKey($))))

    if (saved) {
      await update($, unit, () => saved)
    }
  }
}

// The main loop started a pipeline skill: its chip is current until another one starts or `endLive` ends it. The
// unit and stage of the shown report are the baseline `endLive` compares with; with no schema-1 report of a unit
// shown (none yet, hidden, a newer schema, unit null) the baseline is unknown. A skill started again takes its
// baseline again; an equal record is not written, so the band does not redraw.
async function startLive($: EngineInterface, skill: string) {
  const kind = liveSkillOf(skill)

  if (kind === undefined) {
    return
  }
  const shown = reportOf(await read($, build))
  const started =
    shown === undefined || shown.unit === null
      ? { skill: kind, unit: null, stage: null }
      : { skill: kind, unit: shown.unit, stage: shown.stage }

  if (JSON.stringify(await read($, live)) !== JSON.stringify(started)) {
    await update($, live, () => started)
  }
}

// The live chip follows the unit the bar shows. A new report of another unit than the baseline's takes the baseline
// again as its unit and stage; so does any report when the baseline is unknown (`unit` null, or missing from a record
// kept before the bar kept the unit). Of the baseline's unit, the live skill ends when the report names a planning
// stage whose `ended` is not the baseline's (AC-15); any other stage name or the same ended time keeps it.
async function endLive($: EngineInterface, report: WorkflowBarProgress | undefined) {
  const running = await read($, live)

  if (running === null || report === undefined || report.unit === null) {
    return
  }
  const { unit: name, stage } = report

  if (running.unit !== name) {
    await update($, live, current => (current === null ? null : { ...current, unit: name, stage }))
  } else if (stage !== null && isPlanningStage(stage.name) && stage.ended !== running.stage?.ended) {
    await update($, live, () => null)
  }
}

// A pipeline skill's chip shows at once; the report is read after.
async function startLiveNow($: EngineInterface, skill: string) {
  if (liveSkillOf(skill) !== undefined) {
    await guarded($, () => startLive($, skill))
    refreshSoon($)
  }
}

// A unit a main-loop path names becomes this session's pin, kept in the store. The path rule (`unitOfPath`) already
// leaves `adhoc` out, and a pinned folder that is gone is dropped by the run (D-18).
async function follow($: EngineInterface, named: WorkflowBarUnit) {
  if ((await read($, unit))?.path === named.path) {
    return
  }
  await update($, unit, () => named)
  await remember($, named)
}

// The path of a main-loop file call; none for a subagent's call (it carries `agentId`), a denied one or no path.
function ownFile(result: { deny?: unknown }, e: { agentId?: unknown; file_path?: unknown }) {
  return result.deny === undefined && e.agentId === undefined && typeof e.file_path === 'string'
    ? e.file_path
    : undefined
}

// A main-loop file call pins the unit its path names, if it names one. With `mustExist` (a Read) the file must be
// there, as `$.fs.exists` answers it: a Read of a missing file pins nothing (AC-8).
async function pinFile($: EngineInterface, file: string | undefined, mustExist = false) {
  if (file === undefined) {
    return
  }
  const named = unitOfPath(file)

  if (named === undefined || (mustExist && (await attempt($.fs.exists(file))) !== true)) {
    return
  }
  await guarded($, () => follow($, unitFolder(named)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A new session may start with no build while the stdout of the last run is still held here.
    lastStdout = undefined
    // A restarted session's first run already holds the unit it pinned.
    await guarded($, () => restore($))
    refreshSoon($)

    return result
  })

  // A prompt runs the CLI again: the bar has no clock without a running ticket, so it would not notice one another
  // session started.
  on('prompt.submit', async ($, e, next) => {
    const typed = /^\s*\/(\S+)/.exec(e.text)?.[1]

    if (typed !== undefined) {
      await guarded($, () => startLive($, typed))
    }
    refreshSoon($)

    return next(e)
  })

  // A main-loop Read of a file under `<root>/.anomaly/<unit>/` pins that unit (D-18); a subagent's call (it carries
  // `agentId`), a denied one or one of a file that does not exist pins nothing. A Read starts no run: its pin shows at
  // the next trigger.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    await pinFile($, ownFile(result, e), true)

    return result
  })

  // A main-loop Edit or Write pins like a Read. One anywhere under `<root>/.anomaly/` (a unit or not) also starts a
  // run: it changes what the CLI reports, and the run holds the new `--unit`.
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const result = await next(e)
    const file = ownFile(result, e)

    await pinFile($, file)
    if (file !== undefined && isUnderAnomaly(file)) {
      // The write may have made `.anomaly/`: ask again, so an answer kept before it is not stale.
      anomalyFolders.clear()
      refreshSoon($)
    }

    return result
  })

  // A main-loop command that names an absolute path under `<root>/.anomaly/<unit>/` pins that unit like a file call;
  // one that holds `anomaly.py` also starts a run, after the pin.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const command = e.command
    const isOwn = result.deny === undefined && e.agentId === undefined && typeof command === 'string'
    const named = isOwn ? unitOfCommand(command) : undefined

    if (named) {
      await guarded($, () => follow($, unitFolder(named)))
    }
    if (isOwn && isAnomalyCommand(command)) {
      // `anomaly.py` may have made `.anomaly/` (see the Edit and Write hook above).
      anomalyFolders.clear()
      refreshSoon($)
    }

    return result
  })

  // The Skill tool knows its caller (`agentId`): a subagent's call never sets the phase, nor does a denied one.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    wake($)
    skillCalls += 1
    const skill = e.skill

    try {
      const result = await next(e)

      if (result.deny === undefined && e.agentId === undefined && typeof skill === 'string') {
        await startLiveNow($, skill)
      }

      return result
    } finally {
      // Paired with the count above, also when the tool throws. A call in flight across a reload counts down the
      // old load's counter, never the new one.
      skillCalls -= 1
    }
  })

  // A typed `/name` or a preload arrives here alone. The event does not say whether a subagent asked, so while a
  // Skill tool call runs, that call decides (above); `prompt.submit` sees a typed name regardless.
  on('skill.prompt', async ($, e, next) => {
    wake($)
    if (skillCalls <= 0) {
      await startLiveNow($, e.skill)
    }

    return next(e)
  })

  // The spawn input has no id: the started agent's id comes back from the engine.
  on('agent.spawn', async ($, e, next) => {
    wake($)
    const result = await next(e)
    const id = result.agentId

    if (id) {
      await update($, agents, list => tracker.spawned(list, id))
    }

    return result
  })

  on('turn.step', async function* ($, e, next) {
    wake($)
    const id = e.agentId

    // Every model request of an agent steps: write only when it was not running, so a step does not redraw the band.
    if (id) {
      const list = await read($, agents)

      if (tracker.stepped(list, id) !== list) {
        await update($, agents, current => tracker.stepped(current, id))
      }
    }

    return yield* next(e)
  })

  // An aborted turn (TaskStop, an interrupt) ends the agent too; the main loop's turn carries no agentId. A turn end,
  // an agent's or the main loop's, is when a ticket usually changes, so the CLI runs again.
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId

    if (id) {
      await update($, agents, list => tracker.finished(list, id))
    }
    refreshSoon($)

    return next(e)
  })

  // The unit the CLI picked, with this session's agents beside it; a report with no unit draws the agents alone, and
  // no report draws nothing (ADR-0004).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    wake($)
    if (e.props.hasSurvey) {
      return next(e)
    }
    const runningAgents = tracker.runningCount(await read($, agents))
    const shown = await read($, build)
    const report = reportOf(shown)
    const view = barView({
      runningAgents,
      unit: report?.unit ?? undefined,
      build: shown ?? undefined,
      planning: report?.planning,
      // The live record follows the unit shown (see `endLive`), so its chip is drawn on that unit's track.
      live: (await read($, live))?.skill,
    })

    if (view === null) {
      return next(e)
    }

    const band = { view, bodyColumns: e.props.bodyColumns, popped: report?.popped ?? [] }

    return e.surface === 'desktop' ? desktopBand($.ui.resolve(e), band) : terminalBand($.ui.resolve(e), band)
  })
}
