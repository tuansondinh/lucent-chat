/**
 * WorkerRegistry — tracks active subagent workers for UI visibility.
 *
 * Provides a lightweight in-memory registry of running subagent workers
 * so the IPC layer can serve the current active-worker list to the renderer.
 * Ported from GSD upstream with @gsd/* imports removed (standalone module).
 */

// ============================================================================
// Types
// ============================================================================

export type WorkerStatus = 'spawning' | 'running' | 'done' | 'error' | 'aborted'

export interface WorkerEntry {
  /** Unique worker/subagent ID. */
  id: string
  /** ID of the parent turn that spawned this worker. */
  parentTurnId: string
  /** Agent type key (e.g. "researcher", "coder"). */
  agentType: string
  /** Short description / task prompt (may be truncated). */
  label: string
  /** Current lifecycle status. */
  status: WorkerStatus
  /** Unix timestamp (ms) when the worker was registered. */
  startedAt: number
  /** Unix timestamp (ms) when the worker completed/errored/aborted, if known. */
  endedAt?: number
  /** Accumulated cost in USD for this worker's token usage. */
  totalCost: number
}

// ============================================================================
// Registry state (module-level singleton, reset on reload in tests)
// ============================================================================

const registry = new Map<string, WorkerEntry>()

// ============================================================================
// Public API
// ============================================================================

/**
 * Register a newly spawned worker. Overwrites any existing entry with the
 * same id (idempotent re-registration is fine).
 */
export function registerWorker(entry: Omit<WorkerEntry, 'totalCost'> & { totalCost?: number }): void {
  registry.set(entry.id, {
    totalCost: 0,
    ...entry,
  })
}

/**
 * Update mutable fields on an existing worker entry.
 * Silently no-ops if the id is unknown (race-safe).
 */
export function updateWorker(
  id: string,
  patch: Partial<Pick<WorkerEntry, 'status' | 'endedAt' | 'totalCost'>>,
): void {
  const existing = registry.get(id)
  if (!existing) return
  Object.assign(existing, patch)
}

/**
 * Remove a worker from the registry.
 * Called after a terminal state is reached and the entry is no longer needed.
 */
export function clearWorker(id: string): void {
  registry.delete(id)
}

/**
 * Return a snapshot of all currently-tracked worker entries.
 * Returns entries in insertion order.
 */
export function getActiveWorkers(): WorkerEntry[] {
  return Array.from(registry.values())
}

/**
 * Clear the entire registry (used in tests and on app restart).
 */
export function clearAllWorkers(): void {
  registry.clear()
}
