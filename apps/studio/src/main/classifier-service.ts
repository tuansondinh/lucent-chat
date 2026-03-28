import { request } from 'node:https'
import { createHash } from 'node:crypto'
import type { AuthService } from './auth-service.js'

function isOAuthToken(token: string): boolean {
  return token.includes('sk-ant-oat')
}

export interface ClassifierRule {
  toolName: string
  pattern: string
  decision: 'allow' | 'deny'
}

export interface ClassifierContext {
  userMessages: string[]
  projectInstructions?: string
}

export interface ClassifierDecision {
  approved: boolean
  reason: string
  source: 'rule' | 'classifier' | 'cache' | 'fallback' | 'timeout'
}

const MAX_CONCURRENT_PER_PANE = 5

/**
 * Built-in hard deny rules for bash commands.
 * These are checked against ALL subcommands (same as user deny rules) and
 * always result in DENY regardless of LLM decision or user context.
 *
 * PHILOSOPHY: Only block genuinely catastrophic / irreversible operations that
 * have no legitimate use in a coding-agent context. Normal dev operations like
 * rm, kill, sed -i are intentionally NOT listed here — the LLM classifier
 * handles nuance. When in doubt, let it through rather than blocking legit work.
 */
const BUILT_IN_BASH_DENY_PATTERNS: string[] = [
  // Remote shell / file transfer (out of scope for coding agent)
  'ssh *', 'ssh',
  'scp *',
  'sftp *', 'sftp',
  // Arbitrary remote code execution via pipe
  'curl * | sh', 'curl * | bash', 'curl * | zsh',
  'wget * | sh', 'wget * | bash', 'wget * | zsh',
  // Netcat in listen/server mode (reverse shell risk)
  'nc -l *', 'nc -l', 'ncat -l *', 'ncat -l',
  // Credential exfiltration — sending local secrets to external hosts
  'curl * -d @*/.ssh/*', 'curl * --data @*/.ssh/*',
  'curl * -d @*/.aws/*', 'curl * --data @*/.aws/*',
  // Privilege escalation
  'sudo *', 'sudo',
  // Truly destructive recursive removal of root/system paths only
  'rm -rf /', 'rm -rf /*',
  // Disk/filesystem writes (catastrophic, irreversible)
  'dd if=* of=/dev/*',
  'mkfs *', 'mkfs.*',
  // Publishing packages (requires explicit user action, cannot be undone)
  'npm publish', 'npm publish *',
  'pip publish', 'pip publish *', 'twine upload *',
  // Destructive git remote ops (rewrites shared history)
  'git push --force *', 'git push --force',
  'git push -f *', 'git push -f',
]

/**
 * Built-in allow rules for read-only bash commands.
 * These bypass the LLM classifier entirely for known-safe operations.
 * Deny rules still run first across all subcommands, so chained destructive
 * commands (e.g. "find /tmp && rm -rf /") are still caught by deny rules.
 */
const BUILT_IN_BASH_ALLOW_PATTERNS: string[] = [
  // File search
  'find *',
  // Content search
  'grep *', 'rg *', 'ripgrep *',
  // Directory listing
  'ls', 'ls *',
  // File reading
  'cat *', 'head *', 'tail *',
  // Counting / metadata
  'wc *', 'file *', 'stat *',
  // Output / env inspection
  'echo *', 'printf *', 'pwd', 'env', 'printenv', 'printenv *',
  // Command lookup
  'which *', 'type *', 'command *',
  // Disk usage (read-only)
  'du *', 'df *',
  // Directory navigation (safe — just changes cwd, no side effects)
  'cd', 'cd *',
  // Pipe helpers — xargs passes output to another command; safety determined by the target
  'xargs *',
  // Read-only git operations
  'git status', 'git status *',
  'git log', 'git log *',
  'git diff', 'git diff *',
  'git show', 'git show *',
  'git branch', 'git branch *',
  'git remote', 'git remote *',
  'git blame *',
  'git stash list',
  'git stash list *',
  // Package inspection
  'npm list', 'npm list *',
  'npm info *',
  // Version checks
  'node --version', 'npm --version', 'npx --version',
  'node -v', 'npm -v', 'npx -v',
  // Type-check only (no emit)
  'tsc --noEmit', 'tsc --noEmit *',
  // Read-only text processing
  'sort *', 'uniq *', 'cut *',
  'awk *', 'sed -n *',
  // Paging / searching through output
  'less *', 'more *',
]

interface PaneRateLimitState {
  active: number
  queue: Array<() => void>
}

export class ClassifierService {
  private cache = new Map<string, { approved: boolean; timestamp: number }>()
  private blockStats = new Map<string, { consecutive: number; total: number; paused: boolean }>()
  private rateLimitState = new Map<string, PaneRateLimitState>()

  constructor(private authService: AuthService) {}

  /**
   * Evaluate static rules before calling the LLM classifier.
   * Deny rules are checked first, then allow rules.
   */
  evaluateRules(toolName: string, args: any, rules: ClassifierRule[]): 'allow' | 'deny' | null {
    const candidates = this.getMatchCandidates(toolName, args)
    if (candidates.length === 0) return null

    // Built-in hard deny rules — checked first, against ALL candidates.
    // These are never overridden by allow rules or the LLM.
    if (toolName === 'bash') {
      for (const pattern of BUILT_IN_BASH_DENY_PATTERNS) {
        for (const text of candidates) {
          if (this.matchPattern(pattern, text)) {
            return 'deny'
          }
        }
      }
    }

    // User-configured deny rules — match against ALL candidates (subcommands,
    // path-stripped variants, etc.) to catch evasion via command chaining,
    // absolute paths, subshells, and interpreter wrappers.
    for (const rule of rules) {
      if (rule.decision === 'deny' && rule.toolName === toolName) {
        for (const text of candidates) {
          if (this.matchPattern(rule.pattern, text)) {
            return 'deny'
          }
        }
      }
    }

    // Allow rules — match against the full command AND all subcommands.
    // A compound command like "cd /tmp && find . -name *.ts | grep foo" should
    // be allowed if ALL of its subcommands individually match allow rules.
    // This prevents a single allow match on a sub-part from letting through a
    // chain that also contains a non-allowed (but non-denied) command.
    for (const rule of rules) {
      if (rule.decision === 'allow' && rule.toolName === toolName) {
        if (this.allSubcommandsAllowed(candidates, [rule.pattern])) {
          return 'allow'
        }
      }
    }

    // Built-in allow rules for known read-only bash commands.
    // Checked after deny rules so chained destructive commands are still caught.
    // For compound commands every subcommand must match a built-in allow pattern.
    if (toolName === 'bash') {
      if (this.allSubcommandsAllowed(candidates, BUILT_IN_BASH_ALLOW_PATTERNS)) {
        return 'allow'
      }
    }

    return null
  }

  /**
   * Classify a tool call using Anthropic Sonnet.
   * Respects per-pane rate limiting (max 5 concurrent API calls).
   */
  async classifyToolCall(
    paneId: string,
    toolName: string,
    args: any,
    context: ClassifierContext
  ): Promise<ClassifierDecision> {
    const stats = this.getStats(paneId)
    if (stats.paused) {
      return { approved: false, reason: 'Auto mode paused due to frequent blocks', source: 'fallback' }
    }

    const argsJson = JSON.stringify(args)
    // Include the latest user message in the cache key so intent changes
    // invalidate cached decisions (e.g. ALLOW for a file op that the user
    // has since asked to cancel or change).
    const latestMessage = context.userMessages.at(-1) ?? ''
    const cacheKey = `${toolName}:${this.hash(argsJson)}:${this.hash(latestMessage)}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < 30000) {
      return { approved: cached.approved, reason: 'Cached decision', source: 'cache' }
    }

    const apiKey = await this.authService.getApiKey('anthropic')
    if (!apiKey) {
      // No API key → deny and fall back to manual approval
      return { approved: false, reason: 'No Anthropic API key — requires manual approval', source: 'fallback' }
    }

    // Rate limiting: acquire a slot before calling the API
    await this.acquireSlot(paneId)
    try {
      const approved = await this.callAnthropicClassifier(apiKey, toolName, argsJson, context)

      this.cache.set(cacheKey, { approved, timestamp: Date.now() })
      this.updateStats(paneId, approved)

      return {
        approved,
        reason: approved ? 'Classifier approved' : 'Classifier denied',
        source: 'classifier'
      }
    } catch (err: any) {
      console.error('[classifier-service] classifier call failed:', err.message)
      if (err.message === 'timeout') {
        return { approved: false, reason: 'Classifier timeout', source: 'timeout' }
      }
      return { approved: false, reason: `Classifier error: ${err.message}`, source: 'fallback' }
    } finally {
      this.releaseSlot(paneId)
    }
  }

  private async callAnthropicClassifier(
    apiKey: string,
    toolName: string,
    argsJson: string,
    context: ClassifierContext
  ): Promise<boolean> {
    const systemPrompt = `You are a security classifier for an autonomous coding agent. Your job is to decide ALLOW or DENY for a pending tool call.

DEFAULT: ALLOW. The user enabled auto mode because they trust the agent. Only deny clear security violations.

ALWAYS ALLOW:
- Any read-only operation: find, grep, ls, cat, head, tail, wc, stat, file, du, df, echo, pwd, env, which, sort, awk, sed -n
- Any git read operation: git status, git log, git diff, git show, git branch, git blame, git remote
- Build/test/lint: npm run *, npx *, tsc, eslint, jest, vitest, cargo, make
- Writing or editing files inside the project directory
- Installing packages: npm install, pip install, cargo add
- Operations clearly implied by the user's recent messages

DENY only these specific violations:
- Deleting files with rm, unlink, rmdir (unless user explicitly said "delete" or "remove" that file)
- Commands outside the project directory targeting system paths (/etc, /usr, /bin, /System, ~/.ssh)
- sudo, su, chmod/chown on system paths
- curl/wget piped directly to sh/bash (arbitrary code execution)
- curl/wget sending local files or env vars to external hosts (e.g. -d @~/.ssh/id_rsa, -d "$(env)")
- ssh, scp, sftp — remote shell/file access is out of scope for a coding agent
- nc/ncat in listen/server mode (-l flag) — reverse shell risk
- sudo, su — privilege escalation
- kill -9, killall — terminating arbitrary processes
- crontab — modifying scheduled jobs
- dd, mkfs — disk/filesystem writes
- sed -i — in-place file editing that can silently corrupt files; agent should use proper edit tools
- npm publish, pip publish, twine upload — publishing packages requires explicit user action
- git push --force / git push -f — destructive remote history rewrite
- Accessing credential files unrelated to the current task (~/.aws, ~/.ssh/id_rsa, /etc/passwd)
- Commands that clearly contradict the user's stated intent

Use the user's recent messages to judge intent. If the user asked for something and the tool call implements it, ALLOW.

Output exactly one word: ALLOW or DENY.`

    const userMessagesContext = context.userMessages.join('\n\n')
    const projectContext = context.projectInstructions ? `PROJECT INSTRUCTIONS:\n${context.projectInstructions}\n\n` : ''

    const userPrompt = `${projectContext}RECENT USER MESSAGES:
${userMessagesContext}

PENDING TOOL CALL:
Tool: ${toolName}
Args: ${argsJson}

Decision (ALLOW/DENY)?`

    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })

      const isOAuth = isOAuthToken(apiKey)
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data),
      }
      if (isOAuth) {
        headers['Authorization'] = `Bearer ${apiKey}`
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14'
        headers['user-agent'] = 'claude-cli/2.1.62'
        headers['x-app'] = 'cli'
      } else {
        headers['x-api-key'] = apiKey
      }

      const req = request({
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers,
        timeout: 10000 // 10s timeout
      }, (res) => {
        let body = ''
        res.on('data', (chunk) => body += chunk)
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.error(`[classifier] API ${res.statusCode}: ${body.slice(0, 500)}`)
            reject(new Error(`API error ${res.statusCode}: ${body}`))
            return
          }
          try {
            const result = JSON.parse(body)
            const text = result.content[0]?.text?.trim().toUpperCase()
            resolve(text === 'ALLOW')
          } catch (e) {
            reject(e)
          }
        })
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('timeout'))
      })
      req.write(data)
      req.end()
    })
  }

  /**
   * Build match candidates for rule evaluation.
   * For bash: full command + subcommands + path-stripped + env-stripped variants.
   * For file ops: just the file path.
   */
  private getMatchCandidates(toolName: string, args: any): string[] {
    if (toolName === 'bash') {
      const command = args.command as string | undefined
      if (!command) return []
      return this.extractBashSubcommands(command)
    }
    if (toolName === 'edit' || toolName === 'write') {
      const filePath = (args.path || args.file_path) as string | undefined
      return filePath ? [filePath] : []
    }
    return []
  }

  /**
   * Extract match candidates from a bash command string.
   * Returns [fullCommand, ...subcommands, ...variants].
   *
   * Catches common evasion patterns:
   *   - Chained commands:     cd /tmp && rm -rf /
   *   - Absolute paths:       /usr/bin/rm -rf /
   *   - Subshells:            $(rm -rf /) or `rm -rf /`
   *   - Interpreter wrappers: bash -c "rm -rf /"
   *   - Env prefixes:         FORCE=1 rm -rf /
   */
  private extractBashSubcommands(command: string): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    const add = (text: string) => {
      const trimmed = text.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        result.push(trimmed)
      }
    }

    // Full command is always the first candidate
    add(command)

    // Split on shell operators: &&, ||, ;, |
    for (const part of command.split(/\s*(?:&&|\|\||[;|])\s*/)) {
      add(part)
    }

    // Extract from $(...) subshells
    for (const m of command.matchAll(/\$\(([^)]+)\)/g)) {
      add(m[1])
    }

    // Extract from backtick subshells
    for (const m of command.matchAll(/`([^`]+)`/g)) {
      add(m[1])
    }

    // Extract from interpreter wrappers: bash/sh/zsh -c "..."
    for (const m of command.matchAll(/\b(?:bash|sh|zsh)\s+-c\s+["']([^"']+)["']/g)) {
      add(m[1])
      // Also split the inner command on operators
      for (const sub of m[1].split(/\s*(?:&&|\|\||[;|])\s*/)) {
        add(sub)
      }
    }

    // Generate path-stripped variants: /usr/bin/rm → rm, ./script.sh → script.sh
    const snapshot = [...result]
    for (const cmd of snapshot) {
      const stripped = cmd.replace(/^(?:\.\/+|(?:\/[\w._-]+)+\/)/, '')
      add(stripped)
    }

    // Generate env-var-stripped variants: VAR=val cmd → cmd
    const snapshot2 = [...result]
    for (const cmd of snapshot2) {
      const stripped = cmd.replace(/^(?:\w+=\S*\s+)+/, '')
      add(stripped)
    }

    return result
  }

  /**
   * Returns true if every actual subcommand from a compound command matches
   * at least one of the given patterns.
   *
   * `candidates` contains [fullCommand, splitParts..., pathStrippedVariants..., envStrippedVariants...].
   * We only want to check the directly split subcommand parts — not the path/env stripped variants,
   * which are synthetic and don't represent real commands to evaluate.
   *
   * To do this we re-split the full command (candidates[0]) ourselves, keeping only the direct parts.
   */
  private allSubcommandsAllowed(candidates: string[], patterns: string[]): boolean {
    const full = candidates[0]
    if (!full) return false

    // Re-split the full command on shell operators to get the real subcommand parts
    const parts = full.split(/\s*(?:&&|\|\||[;|])\s*/).map((s) => s.trim()).filter(Boolean)

    // Single command — check directly
    if (parts.length === 1) {
      return patterns.some((p) => this.matchPattern(p, parts[0]))
    }

    // Compound command: every part must match a pattern
    return parts.every((part) =>
      patterns.some((p) => this.matchPattern(p, part))
    )
  }

  private matchPattern(pattern: string, text: string): boolean {
    const regexSource = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexSource}$`)
    return regex.test(text)
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16)
  }

  private getStats(paneId: string) {
    if (!this.blockStats.has(paneId)) {
      this.blockStats.set(paneId, { consecutive: 0, total: 0, paused: false })
    }
    return this.blockStats.get(paneId)!
  }

  private updateStats(paneId: string, approved: boolean): void {
    const stats = this.getStats(paneId)
    if (approved) {
      stats.consecutive = 0
    } else {
      stats.consecutive++
      stats.total++
      // Only pause after a very high number of denials to avoid interrupting legit work.
      // 10 consecutive or 50 total is the threshold.
      if (stats.consecutive >= 10 || stats.total >= 50) {
        stats.paused = true
      }
    }
  }

  private getRateLimitState(paneId: string): PaneRateLimitState {
    if (!this.rateLimitState.has(paneId)) {
      this.rateLimitState.set(paneId, { active: 0, queue: [] })
    }
    return this.rateLimitState.get(paneId)!
  }

  private acquireSlot(paneId: string): Promise<void> {
    const state = this.getRateLimitState(paneId)
    if (state.active < MAX_CONCURRENT_PER_PANE) {
      state.active++
      return Promise.resolve()
    }
    // Queue the caller — they will be resumed when a slot is released
    return new Promise<void>((resolve) => {
      state.queue.push(resolve)
    })
  }

  private releaseSlot(paneId: string): void {
    const state = this.getRateLimitState(paneId)
    const next = state.queue.shift()
    if (next) {
      // Hand the slot directly to the next waiter without decrementing
      next()
    } else {
      state.active--
    }
  }

  resume(paneId: string): void {
    const stats = this.getStats(paneId)
    stats.consecutive = 0
    stats.paused = false
  }

  getPaneState(paneId: string) {
    return this.getStats(paneId)
  }
}
