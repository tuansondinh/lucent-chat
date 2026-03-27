import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { GitService } from '../src/main/git-service.ts'

async function createRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'lucent-git-service-'))
  execFileSync('git', ['init'], { cwd: repoDir })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir })

  await writeFile(join(repoDir, 'tracked.txt'), 'alpha\nbeta\n', 'utf8')
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repoDir })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir })

  return repoDir
}

test('getChangedFiles reports modified, untracked, deleted, and renamed files', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    await writeFile(join(repoDir, 'new-file.txt'), 'new file\n', 'utf8')
    await writeFile(join(repoDir, 'delete-me.txt'), 'temporary\n', 'utf8')
    execFileSync('git', ['add', 'delete-me.txt'], { cwd: repoDir })
    execFileSync('git', ['commit', '-m', 'add delete-me'], { cwd: repoDir })
    await rm(join(repoDir, 'delete-me.txt'))
    execFileSync('git', ['mv', 'tracked.txt', 'renamed.txt'], { cwd: repoDir })

    const changedFiles = await service.getChangedFiles(repoDir)
    const byPath = new Map(changedFiles.map((file) => [file.path, file]))

    assert.equal(byPath.get('new-file.txt')?.status, '??')
    assert.equal(byPath.get('delete-me.txt')?.status, 'D')
    assert.equal(byPath.get('renamed.txt')?.status, 'R')
    assert.equal(byPath.get('renamed.txt')?.previousPath, 'tracked.txt')
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('getFileDiff returns unified diff text for modified and untracked files', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    await writeFile(join(repoDir, 'tracked.txt'), 'alpha\nbeta\ngamma\n', 'utf8')
    await writeFile(join(repoDir, 'new-file.txt'), 'new file\n', 'utf8')

    const modifiedDiff = await service.getFileDiff(repoDir, 'tracked.txt')
    const untrackedDiff = await service.getFileDiff(repoDir, 'new-file.txt')

    assert.ok(modifiedDiff)
    assert.equal(modifiedDiff?.status, 'M')
    assert.match(modifiedDiff?.diffText ?? '', /@@/)
    assert.match(modifiedDiff?.diffText ?? '', /\+gamma/)

    assert.ok(untrackedDiff)
    assert.equal(untrackedDiff?.status, '??')
    assert.match(untrackedDiff?.diffText ?? '', /new file mode/)
    assert.match(untrackedDiff?.diffText ?? '', /\+new file/)
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})
