import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FileService } from '../src/main/file-service.js'

// Helper to create a test directory structure
async function createTestDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'lucent-fileservice-'))

  // Create test files
  await writeFile(join(base, 'text.txt'), 'Hello, World!\n', 'utf8')
  await writeFile(join(base, 'small.txt'), 'abc', 'utf8')

  // Create a subdirectory with files
  const subdir = join(base, 'subdir')
  await mkdir(subdir, { recursive: true })
  await writeFile(join(subdir, 'nested.txt'), 'Nested content\n', 'utf8')

  // Create a binary file (PNG magic bytes + some data)
  const binaryPath = join(base, 'image.png')
  await writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]))

  // Create large file (> 1MB)
  const largePath = join(base, 'large.txt')
  const largeContent = 'x'.repeat(2 * 1024 * 1024) // 2MB
  await writeFile(largePath, largeContent, 'utf8')

  // Create ignored directory
  await mkdir(join(base, 'node_modules'), { recursive: true })
  await writeFile(join(base, 'node_modules', 'package.json'), '{}', 'utf8')

  return base
}

test('FileService: listDirectory returns sorted entries with directories first', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const result = await service.listDirectory(base, '.')

    assert.ok(result.entries.length > 0)
    assert.equal(result.truncated, false)

    // Find directory entries
    const subdir = result.entries.find((e) => e.name === 'subdir')
    assert.ok(subdir)
    assert.equal(subdir.type, 'directory')

    // Find file entries
    const textFile = result.entries.find((e) => e.name === 'text.txt')
    assert.ok(textFile)
    assert.equal(textFile.type, 'file')

    // Verify node_modules is ignored
    const nodeModules = result.entries.find((e) => e.name === 'node_modules')
    assert.equal(nodeModules, undefined)

    // Verify sorting: directories should come before files
    const firstDirIndex = result.entries.findIndex((e) => e.type === 'directory')
    const firstFileIndex = result.entries.findIndex((e) => e.type === 'file')
    if (firstDirIndex !== -1 && firstFileIndex !== -1) {
      assert.ok(firstDirIndex < firstFileIndex, 'Directories should be listed before files')
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: listDirectory handles path traversal attempts', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Try to escape with ..
    await assert.rejects(
      async () => await service.listDirectory(base, '../../../etc'),
      /Path traversal detected/
    )

    // Try to escape with absolute path
    await assert.rejects(
      async () => await service.listDirectory(base, '/etc/passwd'),
      /Path traversal detected/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: listDirectory handles symlinks securely', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create a symlink that escapes the base directory
    const escapeLink = join(base, 'escape-link')
    await symlink('/etc', escapeLink)

    const result = await service.listDirectory(base, '.')
    // The symlink should be silently skipped, not included
    const linkEntry = result.entries.find((e) => e.name === 'escape-link')
    assert.equal(linkEntry, undefined)

    // Create a safe symlink within base
    const safeLink = join(base, 'safe-link')
    await symlink(join(base, 'text.txt'), safeLink)

    const result2 = await service.listDirectory(base, '.')
    // Safe symlink should appear as a file
    const safeEntry = result2.entries.find((e) => e.name === 'safe-link')
    assert.ok(safeEntry)
    assert.equal(safeEntry.type, 'file')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: listDirectory handles broken symlinks', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create a symlink to a non-existent target
    const brokenLink = join(base, 'broken-link')
    await symlink('/nonexistent/path', brokenLink)

    const result = await service.listDirectory(base, '.')
    // Broken symlinks should be silently skipped
    const brokenEntry = result.entries.find((e) => e.name === 'broken-link')
    assert.equal(brokenEntry, undefined)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: listDirectory caps at MAX_ENTRIES', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create many files (> 500)
    for (let i = 0; i < 600; i++) {
      await writeFile(join(base, `file-${i}.txt`), `content ${i}`, 'utf8')
    }

    const result = await service.listDirectory(base, '.')
    assert.equal(result.entries.length, 500)
    assert.equal(result.truncated, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile reads text files with metadata', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const result = await service.readFile(base, 'text.txt')

    assert.equal(result.content, 'Hello, World!\n')
    assert.equal(result.size, 14) // "Hello, World!\n".length
    assert.equal(result.truncated, false)
    assert.equal(result.isBinary, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile detects binary files', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const result = await service.readFile(base, 'image.png')

    assert.equal(result.content, '')
    assert.equal(result.isBinary, true)
    assert.equal(result.truncated, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile truncates files larger than MAX_FILE_BYTES', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const result = await service.readFile(base, 'large.txt')

    assert.equal(result.content.length, 1 * 1024 * 1024) // 1MB
    assert.equal(result.isBinary, false)
    assert.equal(result.truncated, true)
    assert.ok(result.size > 1 * 1024 * 1024)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile handles path traversal attempts', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    await assert.rejects(
      async () => await service.readFile(base, '../../../etc/passwd'),
      /Path traversal detected/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile handles TOCTOU symlink swap attacks', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create a safe file first
    const safePath = join(base, 'safe.txt')
    await writeFile(safePath, 'safe content', 'utf8')

    // Read the file - this should resolve the real path and check it
    const result1 = await service.readFile(base, 'safe.txt')
    assert.equal(result1.content, 'safe content')

    // Now try to replace it with a symlink (simulating TOCTOU attack)
    await rm(safePath)
    await symlink('/etc/passwd', safePath)

    // The service should detect this as path traversal
    await assert.rejects(
      async () => await service.readFile(base, 'safe.txt'),
      /Path traversal detected/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile handles unicode paths', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create file with unicode name
    const unicodeName = '文件.txt'
    await writeFile(join(base, unicodeName), 'Unicode content\n', 'utf8')

    const result = await service.readFile(base, unicodeName)
    assert.equal(result.content, 'Unicode content\n')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile throws on non-existent files', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    await assert.rejects(
      async () => await service.readFile(base, 'nonexistent.txt'),
      /File not found/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile handles null bytes in file (binary detection)', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create a file with null bytes
    const binaryPath = join(base, 'with-nulls.bin')
    await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x00]))

    const result = await service.readFile(base, 'with-nulls.bin')
    assert.equal(result.isBinary, true)
    assert.equal(result.content, '')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFile handles files with many non-printable characters', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Create a file with many non-printable characters (> 10% threshold)
    const binaryPath = join(base, 'many-nonprintable.bin')
    const buffer = Buffer.alloc(1024)
    for (let i = 0; i < 1024; i++) {
      buffer[i] = i % 32 // Lots of low non-printable values
    }
    await writeFile(binaryPath, buffer)

    const result = await service.readFile(base, 'many-nonprintable.bin')
    assert.equal(result.isBinary, true)
    assert.equal(result.content, '')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ============================================================================
// Phase 2: writeFile tests
// ============================================================================

test('FileService: writeFile writes content to an existing file', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    await service.writeFile(base, 'text.txt', 'new content')
    const actual = await readFile(join(base, 'text.txt'), 'utf8')
    assert.equal(actual, 'new content')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: writeFile creates a new file if it does not exist', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    await service.writeFile(base, 'newfile.txt', 'brand new')
    const actual = await readFile(join(base, 'newfile.txt'), 'utf8')
    assert.equal(actual, 'brand new')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: writeFile rejects path traversal attempts', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    await assert.rejects(
      async () => await service.writeFile(base, '../../../etc/passwd', 'evil'),
      /Path traversal detected/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: writeFile preserves LF line endings', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const content = 'line1\nline2\nline3'
    await service.writeFile(base, 'lf.txt', content)
    const actual = await readFile(join(base, 'lf.txt'), 'utf8')
    assert.equal(actual, content)
    assert.ok(!actual.includes('\r\n'), 'Should not contain CRLF')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: writeFile preserves CRLF line endings when content has CRLF', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const content = 'line1\r\nline2\r\nline3'
    await service.writeFile(base, 'crlf.txt', content)
    const actual = await readFile(join(base, 'crlf.txt'), 'utf8')
    assert.equal(actual, content)
    assert.ok(actual.includes('\r\n'), 'Should preserve CRLF')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: writeFile writes atomically (temp rename)', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Write original
    await writeFile(join(base, 'atomic.txt'), 'original', 'utf8')
    // Write via service
    await service.writeFile(base, 'atomic.txt', 'updated atomically')
    const actual = await readFile(join(base, 'atomic.txt'), 'utf8')
    assert.equal(actual, 'updated atomically')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

// ============================================================================
// Phase 2: readFileFull tests
// ============================================================================

test('FileService: readFileFull reads full file content bypassing truncation', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // readFile truncates at 1MB; readFileFull should return all bytes
    const result = await service.readFileFull(base, 'large.txt')
    assert.equal(result.content.length, 2 * 1024 * 1024) // full 2MB
    assert.equal(result.truncated, false)
    assert.equal(result.isBinary, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFileFull validates paths securely (absolute path)', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    // Using an absolute path that definitely resolves outside root
    await assert.rejects(
      async () => await service.readFileFull(base, '/tmp'),
      /Path traversal detected/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('FileService: readFileFull detects binary files', async () => {
  const base = await createTestDir()
  const service = new FileService()

  try {
    const result = await service.readFileFull(base, 'image.png')
    assert.equal(result.isBinary, true)
    assert.equal(result.content, '')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
