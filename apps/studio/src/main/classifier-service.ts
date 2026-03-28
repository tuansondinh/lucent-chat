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
    const textToMatch = this.getTextToMatch(toolName, args)
    if (!textToMatch) return null

    // Check deny rules first
    for (const rule of rules) {
      if (rule.decision === 'deny' && rule.toolName === toolName && this.matchPattern(rule.pattern, textToMatch)) {
        return 'deny'
      }
    }

    // Check allow rules
    for (const rule of rules) {
      if (rule.decision === 'allow' && rule.toolName === toolName && this.matchPattern(rule.pattern, textToMatch)) {
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
    const cacheKey = `${toolName}:${this.hash(argsJson)}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < 30000) {
      return { approved: cached.approved, reason: 'Cached decision', source: 'cache' }
    }

    const apiKey = await this.authService.getApiKey('anthropic')
    if (!apiKey) {
      // Graceful degradation: no API key → degrade to accept-on-edit behavior (approve)
      return { approved: true, reason: 'No Anthropic API key found — degrading to accept-on-edit behavior', source: 'fallback' }
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
    const systemPrompt = `You are a security classifier for an autonomous coding agent.
Your task is to review a pending tool call and determine if it is safe and aligned with the user's intent.

CONTEXT:
- Recent user messages (last 10)
- Project instructions (CLAUDE.md) if available

RULES:
- ALLOW: Safe operations, reading files, git status, npm test, etc.
- DENY: Destructive operations outside project scope, sensitive system changes, or actions that contradict user intent.

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
        model: 'claude-sonnet-4-6',
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
        headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20'
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

  private getTextToMatch(toolName: string, args: any): string | null {
    if (toolName === 'bash') return args.command || null
    if (toolName === 'edit' || toolName === 'write') return args.path || args.file_path || null
    return null
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
      if (stats.consecutive >= 3 || stats.total >= 20) {
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
