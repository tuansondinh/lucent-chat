import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { GitService } from '../src/main/git-service.js'

async function createRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'lucent-git-service-'))
  const realRepoDir = await fs.realpath(repoDir)
  execFileSync('git', ['init'], { cwd: realRepoDir })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: realRepoDir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: realRepoDir })

  await writeFile(join(realRepoDir, 'tracked.txt'), 'alpha\nbeta\n', 'utf8')
  execFileSync('git', ['add', 'tracked.txt'], { cwd: realRepoDir })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: realRepoDir })

  return realRepoDir
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

test('getBranch handles detached HEAD state', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Create a commit and checkout its hash (detached HEAD)
    await writeFile(join(repoDir, 'file.txt'), 'content', 'utf8')
    execFileSync('git', ['add', 'file.txt'], { cwd: repoDir })
    execFileSync('git', ['commit', '-m', 'second'], { cwd: repoDir })

    // Get the commit hash
    const hash = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim()

    // Checkout the hash (detached HEAD)
    execFileSync('git', ['checkout', hash], { cwd: repoDir })

    const branch = await service.getBranch(repoDir)
    assert.ok(branch) // Should return short hash, not null
    assert.notEqual(branch, 'HEAD')
    assert.equal(branch?.length, 7) // Short hash is 7 characters
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('getProjectRoot returns root path for nested directory', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Create a nested directory
    const nestedDir = join(repoDir, 'src', 'components')
    await mkdir(nestedDir, { recursive: true })

    const root = await service.getProjectRoot(nestedDir)
    assert.equal(root, repoDir)
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('getProjectRoot falls back to start path for non-git directory', async () => {
  const nonGitDir = await mkdtemp(join(tmpdir(), 'lucent-nongit-'))
  const service = new GitService()

  try {
    const root = await service.getProjectRoot(nonGitDir)
    assert.equal(root, nonGitDir)
  } finally {
    await rm(nonGitDir, { recursive: true, force: true })
  }
})

test('getFileDiff handles binary files', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Create a PNG file (binary)
    const pngPath = join(repoDir, 'image.png')
    await writeFile(pngPath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]))

    execFileSync('git', ['add', 'image.png'], { cwd: repoDir })

    const diff = await service.getFileDiff(repoDir, 'image.png')
    assert.ok(diff)
    assert.equal(diff.isBinary, true)
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('getFileDiff handles renamed files', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Rename tracked.txt
    execFileSync('git', ['mv', 'tracked.txt', 'renamed.txt'], { cwd: repoDir })

    const diff = await service.getFileDiff(repoDir, 'renamed.txt')
    assert.ok(diff)
    assert.equal(diff.status, 'R')
    assert.equal(diff.previousPath, 'tracked.txt')
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('listBranches returns all branches including current', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Create a new branch
    execFileSync('git', ['branch', 'feature-branch'], { cwd: repoDir })

    const branches = await service.listBranches(repoDir)

    assert.ok(branches.current)
    assert.ok(branches.branches.includes('main') || branches.branches.includes('master'))
    assert.ok(branches.branches.includes('feature-branch'))
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('checkoutBranch switches to existing branch', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Create a new branch
    execFileSync('git', ['branch', 'new-branch'], { cwd: repoDir })

    const result = await service.checkoutBranch(repoDir, 'new-branch')
    assert.equal(result, 'new-branch')

    // Verify the branch is checked out
    const current = await service.getBranch(repoDir)
    assert.equal(current, 'new-branch')
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('checkoutBranch throws for non-existent branch', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    await assert.rejects(
      async () => await service.checkoutBranch(repoDir, 'nonexistent-branch'),
      /not found|does not exist|unknown|pathspec.*did not match/
    )
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('getChangedFiles handles nested git repository', async () => {
  const parentRepo = await createRepo()
  const service = new GitService()

  try {
    // Create a nested repository
    const nestedDir = join(parentRepo, 'nested-repo')
    await mkdir(nestedDir, { recursive: true })

    execFileSync('git', ['init'], { cwd: nestedDir })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: nestedDir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: nestedDir })

    await writeFile(join(nestedDir, 'nested.txt'), 'nested content', 'utf8')
    execFileSync('git', ['add', 'nested.txt'], { cwd: nestedDir })
    execFileSync('git', ['commit', '-m', 'nested init'], { cwd: nestedDir })

    // Get changed files from nested directory
    const changedFiles = await service.getChangedFiles(nestedDir)

    // Should only see files from the nested repo, not parent
    assert.equal(changedFiles.length, 0) // No uncommitted changes
  } finally {
    await rm(parentRepo, { recursive: true, force: true })
  }
})

test('getFileDiff handles corrupt git repository gracefully', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Corrupt the .git directory
    const gitDir = join(repoDir, '.git')
    await rm(gitDir, { recursive: true, force: true })

    const diff = await service.getFileDiff(repoDir, 'tracked.txt')
    // Should return null or handle gracefully
    assert.equal(diff, null)
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})

test('getChangedFiles returns empty array on corrupt repo', async () => {
  const repoDir = await createRepo()
  const service = new GitService()

  try {
    // Corrupt the .git directory
    const gitDir = join(repoDir, '.git')
    await rm(gitDir, { recursive: true, force: true })

    const changedFiles = await service.getChangedFiles(repoDir)
    assert.equal(changedFiles.length, 0)
  } finally {
    await rm(repoDir, { recursive: true, force: true })
  }
})
