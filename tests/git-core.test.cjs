const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildRemoteGitCommand,
  parsePorcelainStatus,
  parseShortStat,
  quoteRemoteShellArg,
  validateGitDirectory,
} = require('../electron/git-core.cjs')

test('quotes remote Git directories and permits only fixed read-only operations', () => {
  assert.equal(quoteRemoteShellArg("/srv/team's app"), "'/srv/team'\"'\"'s app'")
  assert.equal(buildRemoteGitCommand("/srv/team's app", 'status'), "LC_ALL=C git -C '/srv/team'\"'\"'s app' status --porcelain=v1 -z --untracked-files=all")
  assert.throws(() => buildRemoteGitCommand('/srv/app', 'reset'), /not allowed/i)
  assert.throws(() => validateGitDirectory('../app'), /absolute/i)
  assert.equal(validateGitDirectory('C:\\work\\app', 'win32'), 'C:\\work\\app')
})

test('parses NUL-delimited Git status including renames and conflicts', () => {
  const result = parsePorcelainStatus(' M src/app.ts\0R  src/new.ts\0src/old.ts\0?? notes.txt\0UU conflict.txt\0')
  assert.deepEqual(result.files, [
    { path: 'src/app.ts', originalPath: null, code: ' M', staged: false, unstaged: true, untracked: false, conflicted: false },
    { path: 'src/new.ts', originalPath: 'src/old.ts', code: 'R ', staged: true, unstaged: false, untracked: false, conflicted: false },
    { path: 'notes.txt', originalPath: null, code: '??', staged: false, unstaged: true, untracked: true, conflicted: false },
    { path: 'conflict.txt', originalPath: null, code: 'UU', staged: true, unstaged: true, untracked: false, conflicted: true },
  ])
  assert.equal(result.truncated, false)
})

test('parses staged and unstaged short diff summaries', () => {
  assert.deepEqual(parseShortStat(' 3 files changed, 12 insertions(+), 4 deletions(-)\n'), { files: 3, insertions: 12, deletions: 4 })
  assert.deepEqual(parseShortStat(''), { files: 0, insertions: 0, deletions: 0 })
})
