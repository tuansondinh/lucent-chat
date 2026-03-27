/**
 * AgentDefinitionLoader — reads agent definition markdown files from
 * src/resources/agents/, parses YAML frontmatter (name, description),
 * and extracts the system prompt body.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface AgentDefinition {
  /** Canonical agent type name (e.g. "worker", "scout"). */
  name: string
  /** Short human-readable description from frontmatter. */
  description: string
  /** Full system prompt (everything after the frontmatter block). */
  systemPrompt: string
}

/**
 * Resolve the agents resources directory.
 * At dev time: src/main → src → studio → resources/agents
 * At runtime (dist): dist/main → studio/dist/main → (go up to find resources)
 */
function resolveAgentsDir(): string {
  // In dev, __dirname is studio/src/main
  // After build, __dirname is studio/dist/main
  // The resources are always at studio/src/resources/agents (not bundled by default),
  // so we walk up from __dirname to find them.
  // Try relative to src/main first (dev), then dist/main (prod, resources copied).
  const candidates = [
    join(__dirname, '..', 'resources', 'agents'),  // dev: src/main → src/resources/agents
    join(__dirname, '..', '..', 'src', 'resources', 'agents'), // prod: dist/main → studio/src/resources/agents
    join(__dirname, 'resources', 'agents'), // alt prod layout
  ]
  return candidates[0] // We'll handle errors in load()
}

/**
 * Parse a markdown file with YAML frontmatter.
 * Frontmatter is delimited by `---` at the start and end.
 * Returns { frontmatter: Record<string, string>, body: string }
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>
  body: string
} {
  const frontmatter: Record<string, string> = {}
  let body = content.trim()

  if (!body.startsWith('---')) {
    return { frontmatter, body }
  }

  const endIdx = body.indexOf('\n---', 3)
  if (endIdx === -1) {
    return { frontmatter, body }
  }

  const fmText = body.slice(3, endIdx).trim()
  body = body.slice(endIdx + 4).trim()

  for (const line of fmText.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key) {
      frontmatter[key] = value
    }
  }

  return { frontmatter, body }
}

export class AgentDefinitionLoader {
  private agentsDir: string
  private cache = new Map<string, AgentDefinition>()

  constructor(agentsDir?: string) {
    // Allow injecting dir for tests; otherwise resolve automatically
    this.agentsDir = agentsDir ?? this.resolveDir()
  }

  private resolveDir(): string {
    const candidates = [
      join(__dirname, '..', 'resources', 'agents'),
      join(__dirname, '..', '..', 'src', 'resources', 'agents'),
      join(__dirname, 'resources', 'agents'),
    ]
    return candidates[0]
  }

  /**
   * Load an agent definition by type name (e.g. "worker").
   * Throws if the file doesn't exist.
   */
  async load(agentType: string): Promise<AgentDefinition> {
    const cached = this.cache.get(agentType)
    if (cached) return cached

    // Try primary dir first, then alternates
    const dirs = [
      join(__dirname, '..', 'resources', 'agents'),
      join(__dirname, '..', '..', 'src', 'resources', 'agents'),
      join(__dirname, 'resources', 'agents'),
    ]

    let content: string | null = null
    let lastError: Error | null = null

    for (const dir of dirs) {
      try {
        const filePath = join(dir, `${agentType}.md`)
        content = await readFile(filePath, 'utf8')
        break
      } catch (err) {
        lastError = err as Error
      }
    }

    if (content === null) {
      throw lastError ?? new Error(`Agent definition not found: ${agentType}`)
    }

    const { frontmatter, body } = parseFrontmatter(content)

    const definition: AgentDefinition = {
      name: frontmatter.name ?? agentType,
      description: frontmatter.description ?? '',
      systemPrompt: body,
    }

    this.cache.set(agentType, definition)
    return definition
  }

  /**
   * List all available agent types (file names without .md extension).
   */
  async listAll(): Promise<string[]> {
    const dirs = [
      join(__dirname, '..', 'resources', 'agents'),
      join(__dirname, '..', '..', 'src', 'resources', 'agents'),
      join(__dirname, 'resources', 'agents'),
    ]

    for (const dir of dirs) {
      try {
        const entries = await readdir(dir)
        return entries
          .filter((f) => f.endsWith('.md'))
          .map((f) => f.slice(0, -3))
      } catch {
        // Try next dir
      }
    }

    return []
  }
}
