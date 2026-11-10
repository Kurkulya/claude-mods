// The path rule of hooks/unit.ts: which `{ root, unit }` a file path or a Bash command names (AC-8, AC-9, AC-10).
// `root` is the path before `/.anomaly/`, spelled the way the bar compares folders (`C:/a/b`).
import { describe, expect, test } from 'claude-code/testing'

import { foldersUp, unitOfCommand, unitOfPath } from '../hooks/unit'

const WINDOWS = { path: 'C:\\repo\\.anomaly\\bar\\tickets\\01-x.md', named: { root: 'C:/repo', unit: 'bar' } }
const GIT_BASH = { path: '/c/repo/.anomaly/bar/stories.md', named: { root: 'C:/repo', unit: 'bar' } }
const POSIX = { path: '/home/u/repo/.anomaly/bar/log.md', named: { root: '/home/u/repo', unit: 'bar' } }

describe('the unit a file path names', () => {
  for (const [spelling, { path, named }] of Object.entries({ Windows: WINDOWS, 'Git Bash': GIT_BASH, POSIX })) {
    test(`a ${spelling} path under <root>/.anomaly/<unit>/ names the root and the unit`, () => {
      expect(unitOfPath(path)).toEqual(named)
    })
  }

  test('a path under .anomaly/adhoc/ names nothing', () => {
    expect(unitOfPath('C:\\repo\\.anomaly\\adhoc\\notes.md')).toBeUndefined()
    expect(unitOfPath('/home/u/repo/.anomaly/adhoc/notes.md')).toBeUndefined()
  })

  test('.anomaly with no unit folder under it names nothing', () => {
    expect(unitOfPath('/home/u/repo/.anomaly/')).toBeUndefined()
    expect(unitOfPath('C:\\repo\\.anomaly\\')).toBeUndefined()
  })

  test('the unit folder alone, or a file directly under .anomaly/, names nothing', () => {
    expect(unitOfPath('/home/u/repo/.anomaly/bar')).toBeUndefined()
    expect(unitOfPath('C:\\repo\\.anomaly\\bar\\')).toBeUndefined()
    expect(unitOfPath('/home/u/repo/.anomaly/notes.md')).toBeUndefined()
  })

  test('. and .. under .anomaly/ name nothing', () => {
    expect(unitOfPath('/home/u/repo/.anomaly/./log.md')).toBeUndefined()
    expect(unitOfPath('/home/u/repo/.anomaly/../src/a.ts')).toBeUndefined()
  })

  test('a unit name or a root that holds & | ^ % < > or " names nothing', () => {
    for (const character of ['&', '|', '^', '%', '<', '>', '"']) {
      expect(unitOfPath(`C:\\repo\\.anomaly\\a${character}b\\log.md`)).toBeUndefined()
      expect(unitOfPath(`C:\\re${character}po\\.anomaly\\bar\\log.md`)).toBeUndefined()
    }
  })
})

// The folders where the bar looks for `<folder>/.anomaly` when a run names no unit: the session's folder, then each
// parent up to the drive root, spelled the bar's way. A drive's root is `C:` (what `normalizePath` gives, so
// `${folder}/.anomaly` is `C:/.anomaly`).
describe('the folders from a session folder up to the root', () => {
  const UP = ['C:/Work/repo/src', 'C:/Work/repo', 'C:/Work', 'C:']

  for (const [spelling, path] of Object.entries({
    Windows: 'C:\\Work\\repo\\src',
    'lower-case drive': 'c:/Work/repo/src',
    'Git Bash': '/c/Work/repo/src',
    'Windows, trailing separator': 'C:\\Work\\repo\\src\\',
  })) {
    test(`a ${spelling} path lists its folder, each parent and the drive root`, () => {
      expect(foldersUp(path)).toEqual(UP)
    })
  }

  test('a worktree under .claude/worktrees/ reaches the repo it belongs to', () => {
    const folders = foldersUp('C:\\Work\\repo\\.claude\\worktrees\\x')

    expect(folders[0]).toBe('C:/Work/repo/.claude/worktrees/x')
    expect(folders).toContain('C:/Work/repo')
    expect(folders.indexOf('C:/Work/repo')).toBeLessThan(folders.indexOf('C:/Work'))
  })

  test('a POSIX path lists its folder and each parent', () => {
    expect(foldersUp('/home/u/repo').slice(0, 3)).toEqual(['/home/u/repo', '/home/u', '/home'])
  })
})

describe('the unit a Bash command names', () => {
  test('a quoted Windows path with a space names the root and the unit', () => {
    expect(unitOfCommand('cat "C:\\my repo\\.anomaly\\bar\\stories.md" | head')).toEqual({
      root: 'C:/my repo',
      unit: 'bar',
    })
  })

  test('a quoted POSIX path with a space names the root and the unit', () => {
    expect(unitOfCommand("grep -n AC- '/home/u/my repo/.anomaly/bar/log.md'")).toEqual({
      root: '/home/u/my repo',
      unit: 'bar',
    })
  })

  test('a Git Bash path among other words names the root and the unit', () => {
    expect(unitOfCommand('grep -n AC- /c/repo/.anomaly/bar/tickets/01-x.md')).toEqual(GIT_BASH.named)
  })

  test('the unit folder named alone names nothing', () => {
    expect(unitOfCommand('ls /home/u/repo/.anomaly/bar')).toBeUndefined()
  })

  for (const name of ['*', '$U', '{a,b}', '-x']) {
    test(`a unit word ${name}, a glob, a variable or an option, names nothing`, () => {
      expect(unitOfCommand(`cat /home/u/repo/.anomaly/${name}/log.md`)).toBeUndefined()
    })
  }

  for (const command of [
    'cd /home/u/repo/.anomaly/bar/x && ls',
    'ls > /home/u/repo/.anomaly/bar/log.md',
    'cmd 2>/home/u/repo/.anomaly/bar/err.txt',
    'cmd;cat /home/u/repo/.anomaly/bar/log.md',
  ]) {
    test(`a shell operator ends a word: ${command}`, () => {
      expect(unitOfCommand(command)).toEqual({ root: '/home/u/repo', unit: 'bar' })
    })
  }

  test('a relative path names nothing, as AC-9 asks for an absolute one', () => {
    expect(unitOfCommand('cat .anomaly/bar/log.md')).toBeUndefined()
    expect(unitOfCommand('cat ../repo/.anomaly/bar/log.md')).toBeUndefined()
  })

  test('a command with no .anomaly path names nothing', () => {
    expect(unitOfCommand('ls /home/u/repo/src')).toBeUndefined()
  })
})
