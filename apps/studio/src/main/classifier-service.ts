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
 * rm are intentionally NOT listed here — the LLM classifier handles nuance.
 * When in doubt, let it through rather than blocking legit work.
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
  // In-place file editing (silent overwrites — agent should use edit/write tools)
  'sed -i *', 'sed -i',
  // Killing arbitrary processes
  'kill -9 *', 'kill -9',
  'killall *', 'killall',
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

interface ClassifierDebugEvent {
  kind: string
  toolName: string
  pattern?: string
  candidate?: string
  matched?: boolean
  approved?: boolean
  source?: ClassifierDecision['source']
  reason?: string
  result?: string
}

export class ClassifierService {
  private cache = new Map<string, { approved: boolean; timestamp: number }>()
  private blockStats = new Map<string, { consecutive: number; total: number; paused: boolean }>()
  private rateLimitState = new Map<string, PaneRateLimitState>()
  private debugSink?: (event: ClassifierDebugEvent) => void

  constructor(private authService: AuthService) {}

  setDebugSink(sink?: (event: ClassifierDebugEvent) => void): void {
    this.debugSink = sink
  }

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
          const matched = this.matchPattern(pattern, text)
          this.logRuleCheck('built-in deny', toolName, pattern, text, matched)
          if (matched) {
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
          const matched = this.matchPattern(rule.pattern, text)
          this.logRuleCheck('user deny', toolName, rule.pattern, text, matched)
          if (matched) {
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
        if (this.allSubcommandsAllowed(candidates, [rule.pattern], `user allow:${rule.pattern}`)) {
          return 'allow'
        }
      }
    }

    // Built-in allow rules for known read-only bash commands.
    // Checked after deny rules so chained destructive commands are still caught.
    // For compound commands every subcommand must match a built-in allow pattern.
    if (toolName === 'bash') {
      if (this.allSubcommandsAllowed(candidates, BUILT_IN_BASH_ALLOW_PATTERNS, 'built-in allow')) {
        return 'allow'
      }
    }

    return null
  }

  /**
   * Classify a tool call using Anthropic Sonnet or Google Gemini Flash.
   * Respects per-pane rate limiting (max 5 concurrent API calls).
   */
  async classifyToolCall(
    paneId: string,
    toolName: string,
    args: any,
    context: ClassifierContext,
    provider: 'anthropic' | 'google' = 'anthropic'
  ): Promise<ClassifierDecision> {
    const stats = this.getStats(paneId)
    if (stats.paused) {
      this.logFinalDecision(false, 'fallback', 'paused')
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
      this.logFinalDecision(cached.approved, 'cache')
      return { approved: cached.approved, reason: 'Cached decision', source: 'cache' }
    }

    const apiKey = await this.authService.getApiKey(provider)
    if (!apiKey) {
      // No API key → deny and fall back to manual approval
      this.logFinalDecision(false, 'fallback', 'no_api_key')
      return { approved: false, reason: `No ${provider === 'google' ? 'Google Gemini' : 'Anthropic'} API key — requires manual approval`, source: 'fallback' }
    }

    // Rate limiting: acquire a slot before calling the API
    await this.acquireSlot(paneId)
    try {
      const approved = provider === 'google'
        ? await this.callGeminiClassifier(apiKey, toolName, argsJson, context)
        : await this.callAnthropicClassifier(apiKey, toolName, argsJson, context)

      this.cache.set(cacheKey, { approved, timestamp: Date.now() })
      this.updateStats(paneId, approved)
      this.logFinalDecision(approved, 'classifier')

      return {
        approved,
        reason: approved ? 'Classifier approved' : 'Classifier denied',
        source: 'classifier'
      }
    } catch (err: any) {
      console.error('[classifier-service] classifier call failed:', err.message)
      if (err.message === 'timeout') {
        this.logFinalDecision(false, 'timeout')
        return { approved: false, reason: 'Classifier timeout', source: 'timeout' }
      }
      this.logFinalDecision(false, 'fallback', err.message)
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
    const userMessagesContext = this.buildClassifierUserMessages(context.userMessages)
    const projectContext = this.buildClassifierProjectContext(context.projectInstructions)
    const compactArgsJson = this.limitClassifierText(argsJson, 4_000)
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

    const userPrompt = `${projectContext}RECENT USER MESSAGES:
${userMessagesContext}

PENDING TOOL CALL:
Tool: ${toolName}
Args: ${compactArgsJson}

Decision (ALLOW/DENY)?`

    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'claude-haiku-4-5',
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
            if (!result.content) {
              // API returned 200 but no content — log full body to help debug
              console.error(`[classifier] API 200 but no content — body: ${body.slice(0, 500)}`)
              reject(new Error(`API returned no content: ${body.slice(0, 200)}`))
              return
            }
            const text = result.content[0]?.text?.trim().toUpperCase()
            this.logModelResult(text ?? 'EMPTY')
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

  private async callGeminiClassifier(
    apiKey: string,
    toolName: string,
    argsJson: string,
    context: ClassifierContext
  ): Promise<boolean> {
    const userMessagesContext = this.buildClassifierUserMessages(context.userMessages)
    const projectContext = this.buildClassifierProjectContext(context.projectInstructions)
    const compactArgsJson = this.limitClassifierText(argsJson, 4_000)
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
- curl/wget sending local files or env vars to external hosts
- ssh, scp, sftp — remote shell/file access is out of scope for a coding agent
- nc/ncat in listen/server mode (-l flag) — reverse shell risk
- sudo, su — privilege escalation
- kill -9, killall — terminating arbitrary processes
- crontab — modifying scheduled jobs
- dd, mkfs — disk/filesystem writes
- sed -i — in-place file editing that can silently corrupt files
- npm publish, pip publish, twine upload — publishing packages requires explicit user action
- git push --force / git push -f — destructive remote history rewrite
- Accessing credential files unrelated to the current task

Use the user's recent messages to judge intent. Output exactly one word: ALLOW or DENY.`

    const userPrompt = `${projectContext}RECENT USER MESSAGES:
${userMessagesContext}

PENDING TOOL CALL:
Tool: ${toolName}
Args: ${compactArgsJson}

Decision (ALLOW/DENY)?`

    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          { role: 'user', parts: [{ text: userPrompt }] }
        ],
        generationConfig: { maxOutputTokens: 128, temperature: 0 }
      })

      const req = request({
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 10000
      }, (res) => {
        let body = ''
        res.on('data', (chunk) => body += chunk)
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.error(`[classifier/gemini] API ${res.statusCode}: ${body.slice(0, 500)}`)
            reject(new Error(`Gemini API error ${res.statusCode}: ${body}`))
            return
          }
          try {
            const result = JSON.parse(body)
            resolve(this.parseGeminiDecision(result, body))
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

  private parseGeminiDecision(result: any, rawBodyForLog: string): boolean {
    const candidate = result?.candidates?.[0]
    const finishReason = candidate?.finishReason
    const text = candidate?.content?.parts
      ?.map((part: any) => typeof part?.text === 'string' ? part.text : '')
      .join('')
      .trim()
      .toUpperCase()

    if (text === 'ALLOW' || text === 'DENY') {
      this.logModelResult(text)
      return text === 'ALLOW'
    }

    if (!text) {
      console.error(`[classifier/gemini] empty result — finishReason=${finishReason} body: ${rawBodyForLog.slice(0, 500)}`)
      // MAX_TOKENS means the model ran out of tokens before producing a response - this is a failure.
      // Throw an error so classifyToolCall can fallback to another provider or manual approval.
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini classifier hit max tokens without producing output')
      }
      // Gemini sometimes spends a tiny output budget without emitting visible text.
      // For this classifier, defaulting to ALLOW is safer than converting that quirk into a deny.
      if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'OTHER') {
        this.logModelResult(`ALLOW (${finishReason.toLowerCase()}-fallback)`)
        return true
      }
    }

    this.logModelResult(text || 'EMPTY')
    return false
  }

  private buildClassifierUserMessages(messages: string[]): string {
    const trimmed = messages
      .slice(-6)
      .map((message) => this.limitClassifierText(message, 1_200))
    return this.limitClassifierText(trimmed.join('\n\n'), 3_500)
  }

  private buildClassifierProjectContext(projectInstructions?: string): string {
    if (!projectInstructions) return ''
    const trimmed = this.limitClassifierText(projectInstructions, 1_500)
    return `PROJECT INSTRUCTIONS:\n${trimmed}\n\n`
  }

  private limitClassifierText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value
    const head = value.slice(0, Math.floor(maxChars * 0.7))
    const tail = value.slice(-(maxChars - head.length - 25))
    return `${head}\n...[truncated]...\n${tail}`
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
  private allSubcommandsAllowed(candidates: string[], patterns: string[], label: string): boolean {
    const full = candidates[0]
    if (!full) return false

    // Re-split the full command on shell operators to get the real subcommand parts
    const parts = full.split(/\s*(?:&&|\|\||[;|])\s*/).map((s) => s.trim()).filter(Boolean)

    // Single command — check directly
    if (parts.length === 1) {
      const part = parts[0]
      let matched = false
      for (const pattern of patterns) {
        const didMatch = this.matchPattern(pattern, part)
        this.logRuleCheck(label, 'bash', pattern, part, didMatch)
        if (didMatch) matched = true
      }
      return matched
    }

    // Compound command: every part must match a pattern
    return parts.every((part) => {
      let matched = false
      for (const pattern of patterns) {
        const didMatch = this.matchPattern(pattern, part)
        this.logRuleCheck(label, 'bash', pattern, part, didMatch)
        if (didMatch) {
          matched = true
          break
        }
      }
      return matched
    })
  }

  private logRuleCheck(kind: string, toolName: string, pattern: string, candidate: string, matched: boolean): void {
    const line = `[classifier] check: kind=${kind} tool=${toolName} pattern=${JSON.stringify(pattern)} candidate=${JSON.stringify(candidate)} matched=${matched}`
    console.log(line)
    this.debugSink?.({ kind, toolName, pattern, candidate, matched })
  }

  private logModelResult(result: string): void {
    console.log(`[classifier] model result: ${result}`)
    this.debugSink?.({ kind: 'model-result', toolName: '', result })
  }

  private logFinalDecision(approved: boolean, source: ClassifierDecision['source'], reason?: string): void {
    const suffix = reason ? ` reason=${reason}` : ''
    console.log(`[classifier] final decision: source=${source} approved=${approved}${suffix}`)
    this.debugSink?.({ kind: 'final-decision', toolName: '', approved, source, reason })
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
