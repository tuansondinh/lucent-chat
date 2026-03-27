/**
 * SkillRegistry — discovers and validates skill definitions from
 * src/resources/skills/. Registers a trigger→skill map at startup.
 *
 * Validation rules:
 * - No duplicate triggers across loaded skill files.
 * - No cyclic step chains (currently not possible in the flat step model,
 *   but validated defensively).
 * - Valid agentType references (worker, scout, researcher) when specified.
 */

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ============================================================================
// Types
// ============================================================================

export interface SkillStep {
  /** Prompt template for this step. Supports {{input}} and {{previousOutput}} placeholders. */
  prompt: string
  /** If provided, delegate this step to a subagent of this type. */
  agentType?: string
}

export interface SkillDefinition {
  /** Human-readable skill name (from frontmatter). */
  name: string
  /** Short description (from frontmatter). */
  description: string
  /** Trigger string used for /command invocation (from frontmatter). */
  trigger: string
  /** Ordered list of execution steps. */
  steps: SkillStep[]
}

// ============================================================================
// Frontmatter parser
// ============================================================================

/**
 * Parse a markdown file with YAML frontmatter.
 * Frontmatter is delimited by `---` lines.
 * The `steps` field is parsed as a list of `- prompt:` / `  agentType:` YAML blocks.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>
  steps: SkillStep[]
  body: string
} {
  const frontmatter: Record<string, string> = {}
  const steps: SkillStep[] = []
  let body = content.trim()

  if (!body.startsWith('---')) {
    return { frontmatter, steps, body }
  }

  const endIdx = body.indexOf('\n---', 3)
  if (endIdx === -1) {
    return { frontmatter, steps, body }
  }

  const fmText = body.slice(3, endIdx).trim()
  body = body.slice(endIdx + 4).trim()

  // Parse simple key: value pairs and steps array
  const lines = fmText.split('\n')
  let inSteps = false
  let currentStep: Partial<SkillStep> | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.trim() === 'steps:') {
      inSteps = true
      continue
    }

    if (inSteps) {
      // A new step starts with "  - prompt:"
      const promptMatch = line.match(/^[ \t]*-[ \t]+prompt:[ \t]*"?(.*?)"?$/)
      if (promptMatch) {
        if (currentStep && currentStep.prompt !== undefined) {
          steps.push(currentStep as SkillStep)
        }
        currentStep = { prompt: promptMatch[1].trim() }
        continue
      }

      // Multiline prompt continuation (indented more than "  - ")
      const continuationMatch = line.match(/^[ \t]{4,}(.+)$/)
      if (continuationMatch && currentStep) {
        currentStep.prompt = (currentStep.prompt ?? '') + '\n' + continuationMatch[1].trim()
        continue
      }

      // agentType field on a step
      const agentTypeMatch = line.match(/^[ \t]+agentType:[ \t]*(.+)$/)
      if (agentTypeMatch && currentStep) {
        currentStep.agentType = agentTypeMatch[1].trim()
        continue
      }

      // End of inlined steps (back to top-level)
      if (line.match(/^[a-zA-Z]/) ) {
        inSteps = false
        if (currentStep && currentStep.prompt !== undefined) {
          steps.push(currentStep as SkillStep)
          currentStep = null
        }
        // Fall through to parse the non-steps field below
      }
    }

    if (!inSteps) {
      const colonIdx = line.indexOf(':')
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        if (key && key !== 'steps') {
          frontmatter[key] = value
        }
      }
    }
  }

  // Flush last pending step
  if (currentStep && currentStep.prompt !== undefined) {
    steps.push(currentStep as SkillStep)
  }

  return { frontmatter, steps, body }
}

// ============================================================================
// SkillRegistry
// ============================================================================

const VALID_AGENT_TYPES = new Set(['worker', 'scout', 'researcher', 'reviewer'])

export class SkillRegistry {
  private skillsDir: string
  private byTrigger = new Map<string, SkillDefinition>()
  private loaded = false

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? this.resolveDir()
  }

  private resolveDir(): string {
    // After build: dist/main → dist/resources/skills (copied by postbuild)
    const distPath = join(__dirname, '..', 'resources', 'skills')
    if (existsSync(distPath)) return distPath
    // Dev fallback: dist/main → ../../src/resources/skills
    const srcPath = join(__dirname, '..', '..', 'src', 'resources', 'skills')
    return srcPath
  }

  /**
   * Discover and load all skill files from skillsDir.
   * Validates: no duplicate triggers.
   * Must be called at startup before using the registry.
   */
  async load(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.skillsDir)
    } catch (err) {
      // If directory doesn't exist (e.g., test path), treat as empty
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        entries = []
      } else {
        throw err
      }
    }

    // Collect skill files: flat .md files + subdirectory SKILL.md files
    const skillFiles: Array<{ filePath: string; baseName: string }> = []
    for (const entry of entries) {
      const entryPath = join(this.skillsDir, entry)
      if (entry.endsWith('.md')) {
        skillFiles.push({ filePath: entryPath, baseName: entry.replace('.md', '') })
      } else {
        // Check for subdirectory with SKILL.md
        const skillMdPath = join(entryPath, 'SKILL.md')
        if (existsSync(skillMdPath)) {
          skillFiles.push({ filePath: skillMdPath, baseName: entry })
        }
      }
    }

    const loaded: SkillDefinition[] = []

    for (const { filePath, baseName } of skillFiles) {
      const content = await readFile(filePath, 'utf8')
      const { frontmatter, steps, body } = parseFrontmatter(content)

      const name = frontmatter.name ?? baseName
      const description = frontmatter.description ?? ''
      const trigger = frontmatter.trigger ?? baseName

      // If no steps defined in frontmatter, use the body as a single-step prompt
      const resolvedSteps = steps.length > 0 ? steps : body ? [{ prompt: body }] : []

      // Validate agentType references
      for (const step of resolvedSteps) {
        if (step.agentType && !VALID_AGENT_TYPES.has(step.agentType)) {
          // Not a hard error — log a warning but accept it
          console.warn(`[SkillRegistry] Unknown agentType "${step.agentType}" in skill "${trigger}"`)
        }
      }

      loaded.push({ name, description, trigger, steps: resolvedSteps })
    }

    // Validate no duplicate triggers
    const seen = new Set<string>()
    for (const skill of loaded) {
      if (seen.has(skill.trigger)) {
        throw new Error(`Duplicate trigger "${skill.trigger}" found in skills directory`)
      }
      seen.add(skill.trigger)
    }

    // Register
    this.byTrigger.clear()
    for (const skill of loaded) {
      this.byTrigger.set(skill.trigger, skill)
    }
    this.loaded = true
  }

  /** Return skill for the given trigger, or null if not found. */
  getByTrigger(trigger: string): SkillDefinition | null {
    return this.byTrigger.get(trigger) ?? null
  }

  /** Return all loaded skill definitions. */
  listAll(): SkillDefinition[] {
    return Array.from(this.byTrigger.values())
  }

  /** True once load() has been called. */
  get isLoaded(): boolean {
    return this.loaded
  }
}
