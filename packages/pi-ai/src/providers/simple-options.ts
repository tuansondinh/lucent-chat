import type { Api, Model, SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel } from "../types.js";

export function buildBaseOptions(model: Model<Api>, options?: SimpleStreamOptions, apiKey?: string): StreamOptions {
	return {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
	};
}

/**
 * Normalise a ThinkingLevel for providers that don't support "xhigh", "off", or "auto".
 * - "off" / undefined → undefined (thinking disabled)
 * - "auto"            → "medium" (fallback for non-adaptive providers)
 * - "xhigh"           → "high"   (clamp for providers that don't support xhigh)
 */
export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh" | "off" | "auto"> | undefined {
	if (!effort || effort === "off") return undefined;
	if (effort === "auto") return "medium";
	return effort === "xhigh" ? "high" : effort;
}

/**
 * Resolve a ThinkingLevel for providers that support "xhigh".
 * - "off" / undefined → undefined (thinking disabled)
 * - "auto"            → "medium" (fallback for non-adaptive providers)
 * - level unchanged (including "xhigh")
 */
export function resolveReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "off" | "auto"> | undefined {
	if (!effort || effort === "off") return undefined;
	if (effort === "auto") return "medium";
	return effort;
}

export function adjustMaxTokensForThinking(
	baseMaxTokens: number,
	modelMaxTokens: number,
	reasoningLevel: ThinkingLevel,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	const defaultBudgets: ThinkingBudgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
	};
	const budgets = { ...defaultBudgets, ...customBudgets };

	const minOutputTokens = 1024;
	const level = clampReasoning(reasoningLevel)!;
	let thinkingBudget = budgets[level]!;
	const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

	if (maxTokens <= thinkingBudget) {
		thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	}

	return { maxTokens, thinkingBudget };
}
