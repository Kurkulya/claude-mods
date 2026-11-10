// The contract between the bar and the anomaly CLI: the real `progress --json`, found and run with the bar's own
// `anomalyInstallPath` and `progressCommand` on ticket files written here, checked for the schema 1 fields and their
// order, and read by the bar's own `parseProgress`. `claude plugin test` cannot start a process, so this runs under
// node: `node --test "tests/contract/*.mjs"` from the plugin folder (node 22.18 or later reads the imported .ts as is).
// It skips when the anomaly plugin is not installed, its interpreter is not on the path, or the CLI has no `progress`
// (exit 2).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { anomalyInstallPath, parseProgress, progressCommand } from '../../hooks/progress.ts'

// The anomaly plugin's `installPath`, as the bar finds it in `installed_plugins.json`.
function installPath() {
  try {
    return anomalyInstallPath(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function skipReason(path) {
  if (path === undefined) {
    return 'the anomaly plugin is not installed'
  }
  const [interpreter, , script] = progressCommand(path, '.')

  if (!existsSync(script)) {
    return `${script} is not there`
  }

  return spawnSync(interpreter, ['--version']).error === undefined ? false : `${interpreter} is not on the path`
}

// A ticket file as the anomaly plugin writes it.
function ticket(title, status, blockedBy, extra = []) {
  return [`# ${title}`, `Status: ${status}`, ...extra, `Blocked by: ${blockedBy}`, 'Covers: none', 'Key: no-ticket', ''].join(
    '\n',
  )
}

// Schema 1's fields, in the order the CLI prints them.
const REPORT_KEYS = ['schema', 'unit', 'picked_by', 'stage', 'wave', 'counts', 'next', 'tickets', 'mr', 'cost', 'warnings']
const TICKET_KEYS = [
  'slug',
  'title',
  'status',
  'blocked_by',
  'kind',
  'reason',
  'red',
  'reviewed',
  'verified',
  'build_minutes',
  'high',
  'fix_rounds',
]

const INSTALL_PATH = installPath()

test(
  "progress --json holds the schema 1 fields in order, and the bar reads them: unit, wave, counts, warnings, and each ticket's slug, title, kind, reason, marks and numbers",
  { skip: skipReason(INSTALL_PATH) },
  t => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-bar-contract-'))

    try {
      const tickets = join(root, '.anomaly', 'u', 'tickets')
      mkdirSync(tickets, { recursive: true })
      const files = [
        [
          '01-save-work.md',
          ticket('01: Save work', 'done', 'none', [
            'Metrics: started 2026-10-12 18:29 · merged 2026-10-12 19:44 · High 2 · fix rounds 3',
            'Reviewed: 43c8b0c',
            'Verified: 43c8b0c',
          ]),
        ],
        ['02-draw-segments.md', ticket('02: Draw segments', 'in-progress', '01')],
        ['03-phase-track.md', ticket('03: Phase track', 'ready-for-agent', '02')],
      ]

      for (const [name, text] of files) {
        writeFileSync(join(tickets, name), text)
      }
      const [interpreter, ...args] = progressCommand(INSTALL_PATH, root, 'u')
      // In the install folder, as the bar runs it.
      const ran = spawnSync(interpreter, args, { cwd: INSTALL_PATH, encoding: 'utf8' })

      if (ran.status === 2) {
        t.skip('the anomaly CLI has no progress --json (exit 2)')

        return
      }
      assert.equal(ran.status, 0, ran.stderr)
      const report = JSON.parse(ran.stdout)

      // Each schema 1 field is there, in its order; a field the CLI adds may sit anywhere, as the bar ignores it.
      const known = (object, keys) => Object.keys(object).filter(key => keys.includes(key))

      assert.deepEqual(known(report, REPORT_KEYS), REPORT_KEYS)
      for (const each of report.tickets) {
        assert.deepEqual(known(each, TICKET_KEYS), TICKET_KEYS)
      }
      assert.equal(report.schema, 1)
      assert.equal(report.unit, 'u')
      assert.equal(typeof report.wave, 'number')
      // A ticket that is in progress counts as failed: schema 1 has no field that tells it from a failed one.
      assert.deepEqual(report.counts, { done: 1, failed: 1, open: 1 })
      assert.ok(Array.isArray(report.warnings) && report.warnings.every(warning => typeof warning === 'string'))

      const read = ({ slug, title, kind, reason, red, reviewed, verified, build_minutes, high, fix_rounds }) => ({
        slug,
        title,
        kind,
        reason,
        red,
        reviewed,
        verified,
        build_minutes,
        high,
        fix_rounds,
      })

      assert.deepEqual(report.tickets.map(read), [
        {
          slug: '01-save-work',
          title: 'Save work',
          kind: 'done',
          reason: null,
          red: false,
          reviewed: true,
          verified: true,
          build_minutes: null,
          high: 2,
          fix_rounds: 3,
        },
        {
          slug: '02-draw-segments',
          title: 'Draw segments',
          kind: 'running',
          reason: 'in progress',
          red: false,
          reviewed: false,
          verified: false,
          build_minutes: null,
          high: null,
          fix_rounds: null,
        },
        {
          slug: '03-phase-track',
          title: 'Phase track',
          kind: 'blocked',
          reason: 'blocked by 02 (in-progress)',
          red: false,
          reviewed: false,
          verified: false,
          build_minutes: null,
          high: null,
          fix_rounds: null,
        },
      ])

      const progress = parseProgress(ran.stdout)

      assert.equal(progress.unit, 'u')
      assert.equal(progress.wave, report.wave)
      assert.deepEqual(progress.counts, { done: 1, failed: 1, open: 1 })
      assert.deepEqual(progress.warnings, report.warnings)
      assert.deepEqual(progress.tickets, [
        {
          number: '01',
          title: 'Save work',
          kind: 'done',
          reason: null,
          red: false,
          reviewed: true,
          verified: true,
          buildMinutes: null,
          high: 2,
          fixRounds: 3,
        },
        {
          number: '02',
          title: 'Draw segments',
          kind: 'running',
          reason: 'in progress',
          red: false,
          reviewed: false,
          verified: false,
          buildMinutes: null,
          high: null,
          fixRounds: null,
        },
        {
          number: '03',
          title: 'Phase track',
          kind: 'blocked',
          reason: 'blocked by 02 (in-progress)',
          red: false,
          reviewed: false,
          verified: false,
          buildMinutes: null,
          high: null,
          fixRounds: null,
        },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
