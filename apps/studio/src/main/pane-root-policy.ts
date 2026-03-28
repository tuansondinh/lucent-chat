import fs from 'node:fs/promises'
import path from 'node:path'

export async function resolveRemotePaneRoot(scopeRoot: string, absolutePath: string): Promise<string> {
  if (!path.isAbsolute(absolutePath)) {
    throw new Error('Pane root must be an absolute path')
  }

  const scopeReal = await fs.realpath(scopeRoot)
  const resolvedPath = await fs.realpath(absolutePath)
  const stat = await fs.stat(resolvedPath)
  if (!stat.isDirectory()) {
    throw new Error('Not a directory')
  }

  const rel = path.relative(scopeReal, resolvedPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Remote pane root must stay within the pane project root')
  }

  return resolvedPath
}
