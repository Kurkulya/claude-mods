import type { WorkflowBarUnit } from '../types'

// One key per session; `$.store` is shared by every session on the machine, so only the newest entries stay.
export const STORE_PREFIX = 'feature:'
const MAX_REMEMBERED = 50

const ABSOLUTE_PATH = /^([A-Z]:)?\//
// A path inside `<root>/.anomaly/<unit>/`, spelled the bar's way; `<root>` is the path before the first `/.anomaly/`.
const UNIT_FILE = /^((?:[A-Z]:)?\/.*?)\/\.anomaly\/([^/]+)\/./
// Anything inside `<root>/.anomaly/`, a unit or not, spelled the bar's way.
const UNDER_ANOMALY = /^(?:[A-Z]:)?\/.*?\/\.anomaly\/./
// A pin's folder: `<root>/.anomaly/<unit>` itself.
const UNIT_FOLDER = /^((?:[A-Z]:)?\/.*?)\/\.anomaly\/([^/]+)$/
// The folders under `.anomaly/` that are no unit, as the CLI refuses them for `--unit`.
const NOT_UNITS = new Set(['adhoc', '.', '..'])
// A glob, a variable or a home folder names no one folder, and a leading `-` reads as an option after `--unit`.
const NOT_A_NAME = /[*?[\]{}$`~]|^-/
// cmd.exe's special characters: a unit name or root that holds one pins nothing, so no argv of a run holds one.
const CMD_SPECIAL = /[&|^%<>"]/
// Git Bash spells `C:/Work/x` as `/c/Work/x`; only a one-letter first segment is a drive (`/cx/` and `/usr/` stay).
const GIT_BASH_DRIVE = /^\/([A-Za-z])\//
// A shell command is words, some quoted; a shell operator or whitespace ends a bare word.
const COMMAND_WORD = /"([^"]*)"|'([^']*)'|[^\s"'<>|;&()]+/g

// The root a unit lies under and the unit's name.
export type NamedUnit = { root: string; unit: string }

// Windows tools spell `c:\a\b`; the bar keeps `C:/a/b`, so two spellings of one folder compare equal.
export function normalizePath(path: string) {
  return path
    .replaceAll('\\', '/')
    .replace(/^[a-z]:/, drive => drive.toUpperCase())
    .replace(/\/+$/, '')
}

// The root and unit a rule's match names, when the name is a unit `--unit` can take.
function namedBy(match: RegExpExecArray | null): NamedUnit | undefined {
  const root = match?.[1]
  const name = match?.[2]
  const isName = name !== undefined && !NOT_UNITS.has(name) && !NOT_A_NAME.test(name) && !CMD_SPECIAL.test(name)

  return root !== undefined && !CMD_SPECIAL.test(root) && isName ? { root, unit: name } : undefined
}

function spelled(path: string) {
  return normalizePath(path.replace(GIT_BASH_DRIVE, (_, drive: string) => `${drive.toUpperCase()}:/`))
}

// The unit an absolute path inside `<root>/.anomaly/<unit>/` names; `adhoc` names none.
export function unitOfPath(path: string): NamedUnit | undefined {
  return namedBy(UNIT_FILE.exec(spelled(path)))
}

// Whether an absolute path lies inside `<root>/.anomaly/`, whatever it names there (`adhoc`, a file, a folder that is
// no unit).
export function isUnderAnomaly(path: string) {
  return UNDER_ANOMALY.test(spelled(path))
}

// The unit a pin's folder `<root>/.anomaly/<unit>` names.
export function unitOfFolder(path: string): NamedUnit | undefined {
  return namedBy(UNIT_FOLDER.exec(spelled(path)))
}

// The folders where `.anomaly/` may lie for a session's folder: the folder itself, then each parent up to the root,
// spelled the bar's way. A drive's root is `C:` and a POSIX root is the empty string, so `${folder}/.anomaly` is the
// root's own `.anomaly`.
export function foldersUp(path: string): string[] {
  const folders: string[] = []
  let folder = spelled(path)

  for (;;) {
    folders.push(folder)
    const slash = folder.lastIndexOf('/')

    if (slash < 0) {
      return folders
    }
    folder = folder.slice(0, slash)
  }
}

// The unit the first absolute path under `<root>/.anomaly/<unit>/` in a shell command names; a quoted word is one
// path and may hold spaces. A relative path names nothing, as for the file tools.
export function unitOfCommand(command: string): NamedUnit | undefined {
  for (const [word, doubleQuoted, singleQuoted] of command.matchAll(COMMAND_WORD)) {
    const named = unitOfPath(doubleQuoted ?? singleQuoted ?? word)

    if (named) {
      return named
    }
  }

  return undefined
}

// The folder of a named unit, as the session's pin keeps it.
export function unitFolder({ root, unit }: NamedUnit): WorkflowBarUnit {
  return { name: unit, path: `${root}/.anomaly/${unit}` }
}

export function sameUnit(a: WorkflowBarUnit | null | undefined, b: WorkflowBarUnit | null | undefined) {
  return a?.name === b?.name && a?.path === b?.path
}

// What the store gave back, if it is still a unit.
export function asUnit(value: unknown): WorkflowBarUnit | undefined {
  const { name, path } = (value ?? {}) as Record<string, unknown>

  if (typeof name !== 'string' || name.length === 0 || typeof path !== 'string' || !ABSOLUTE_PATH.test(path)) {
    return undefined
  }

  return { name, path }
}

// The oldest remembered keys past the limit, never this session's own (keys come in insertion order).
export function evictable(keys: readonly string[], own: string) {
  const remembered = keys.filter(key => key.startsWith(STORE_PREFIX))

  return remembered.filter(key => key !== own).slice(0, Math.max(0, remembered.length - MAX_REMEMBERED))
}
