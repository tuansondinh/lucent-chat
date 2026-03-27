/**
 * SkillExecutor — runs skill steps sequentially, chains step N output into
 * step N+1 context, delegates to subagents for steps with agentType,
 * and emits skill-progress events per step.
 *
 * Usage:
 *   const executor = new SkillExecutor(registry)
 *   executor.on('skill-progress', handler)
 *   const skillId = await executor.execute('commit', 'user input', runStep)
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { SkillRegistry, SkillDefinition, SkillStep } from './skill-registry.js'

// ============================================================================
// Types
// ============================================================================

export type SkillStepStatus = 'pending' | 'running' | 'done' | 'error' | 'aborted'
export type SkillStatus = 'running' | 'done' | 'error' | 'aborted'

export interface SkillProgressEvent {
  skillId: string
  skillName: string
  trigger: string
  stepIndex: number
  totalSteps: number
  status: SkillStepStatus
  /** Available once a step completes (done or error). */
  output?: string
  error?: string
}

export interface SkillCompleteEvent {
  skillId: string
  skillName: string
  trigger: string
  status: SkillStatus
  outputs: string[]
}

/**
 * A function that runs a single skill step.
 * Receives the step definition and accumulated context from prior steps.
 * Returns the step's output text.
 * If agentType is set on the step, the caller should delegate to a subagent.
 */
export type StepRunner = (step: SkillStep, context: string) => Promise<string>

// ============================================================================
// SkillExecutor
// ============================================================================

export class SkillExecutor extends EventEmitter {
  private registry: SkillRegistry
  /** Map from skillId → abort controller signal */
  private abortSignals = new Map<string, { aborted: boolean }>()

  constructor(registry: SkillRegistry) {
    super()
    this.registry = registry
  }

  /**
   * Execute a skill by trigger.
   * Returns the skillId immediately; steps run asynchronously.
   * Emits 'skill-progress' per step and 'skill-complete' when done.
   *
   * @param trigger - Skill trigger string (e.g. 'commit')
   * @param userInput - Original user input, substituted into {{input}} placeholders
   * @param runStep - Async callback that executes one step (can delegate to subagent)
   */
  async execute(
    trigger: string,
    userInput: string,
    runStep: StepRunner,
  ): Promise<string> {
    const skill = this.registry.getByTrigger(trigger)
    if (!skill) {
      throw new Error(`Unknown skill trigger: "${trigger}"`)
    }

    const skillId = randomUUID()
    const abortSignal = { aborted: false }
    this.abortSignals.set(skillId, abortSignal)

    // Run steps asynchronously
    this._runSteps(skillId, skill, userInput, runStep, abortSignal).catch((err) => {
      this.emit('skill-complete', {
        skillId,
        skillName: skill.name,
        trigger: skill.trigger,
        status: 'error',
        outputs: [],
      } satisfies SkillCompleteEvent)
      console.error(`[SkillExecutor] Uncaught error in skill "${trigger}":`, err)
    })

    return skillId
  }

  /** Abort a running skill execution by skillId. */
  abort(skillId: string): void {
    const signal = this.abortSignals.get(skillId)
    if (signal) {
      signal.aborted = true
    }
  }

  private async _runSteps(
    skillId: string,
    skill: SkillDefinition,
    userInput: string,
    runStep: StepRunner,
    abortSignal: { aborted: boolean },
  ): Promise<void> {
    const outputs: string[] = []
    let previousOutput = ''

    for (let i = 0; i < skill.steps.length; i++) {
      if (abortSignal.aborted) {
        this.emit('skill-progress', {
          skillId,
          skillName: skill.name,
          trigger: skill.trigger,
          stepIndex: i,
          totalSteps: skill.steps.length,
          status: 'aborted',
        } satisfies SkillProgressEvent)

        this.emit('skill-complete', {
          skillId,
          skillName: skill.name,
          trigger: skill.trigger,
          status: 'aborted',
          outputs,
        } satisfies SkillCompleteEvent)

        this.abortSignals.delete(skillId)
        return
      }

      const step = skill.steps[i]

      // Emit running status
      this.emit('skill-progress', {
        skillId,
        skillName: skill.name,
        trigger: skill.trigger,
        stepIndex: i,
        totalSteps: skill.steps.length,
        status: 'running',
      } satisfies SkillProgressEvent)

      // Build context: chain previous output into prompt placeholders
      const context = this._buildContext(userInput, previousOutput)
      const resolvedPrompt = this._resolvePrompt(step.prompt, userInput, previousOutput)
      const stepWithResolvedPrompt: SkillStep = { ...step, prompt: resolvedPrompt }

      try {
        const output = await runStep(stepWithResolvedPrompt, context)

        if (abortSignal.aborted) {
          this.emit('skill-progress', {
            skillId,
            skillName: skill.name,
            trigger: skill.trigger,
            stepIndex: i,
            totalSteps: skill.steps.length,
            status: 'aborted',
          } satisfies SkillProgressEvent)

          this.emit('skill-complete', {
            skillId,
            skillName: skill.name,
            trigger: skill.trigger,
            status: 'aborted',
            outputs,
          } satisfies SkillCompleteEvent)

          this.abortSignals.delete(skillId)
          return
        }

        outputs.push(output)
        previousOutput = output

        this.emit('skill-progress', {
          skillId,
          skillName: skill.name,
          trigger: skill.trigger,
          stepIndex: i,
          totalSteps: skill.steps.length,
          status: 'done',
          output,
        } satisfies SkillProgressEvent)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)

        this.emit('skill-progress', {
          skillId,
          skillName: skill.name,
          trigger: skill.trigger,
          stepIndex: i,
          totalSteps: skill.steps.length,
          status: 'error',
          error,
        } satisfies SkillProgressEvent)

        this.emit('skill-complete', {
          skillId,
          skillName: skill.name,
          trigger: skill.trigger,
          status: 'error',
          outputs,
        } satisfies SkillCompleteEvent)

        this.abortSignals.delete(skillId)
        return
      }
    }

    // All steps completed
    this.emit('skill-complete', {
      skillId,
      skillName: skill.name,
      trigger: skill.trigger,
      status: 'done',
      outputs,
    } satisfies SkillCompleteEvent)

    this.abortSignals.delete(skillId)
  }

  /** Build the context string passed to the next step. */
  private _buildContext(userInput: string, previousOutput: string): string {
    const parts: string[] = []
    if (userInput) parts.push(`User input: ${userInput}`)
    if (previousOutput) parts.push(`Previous step output:\n${previousOutput}`)
    return parts.join('\n\n')
  }

  /** Resolve {{input}} and {{previousOutput}} placeholders in a prompt. */
  private _resolvePrompt(prompt: string, userInput: string, previousOutput: string): string {
    return prompt
      .replace(/\{\{input\}\}/g, userInput)
      .replace(/\{\{previousOutput\}\}/g, previousOutput)
  }
}
