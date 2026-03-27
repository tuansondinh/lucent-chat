const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  groq: 'Groq',
  mistral: 'Mistral',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  bedrock: 'Amazon Bedrock',
  azure: 'Azure OpenAI',
  vertex: 'Vertex AI',
}

export function formatProviderName(provider: string): string {
  if (!provider) return 'Unknown'
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

export function splitModelRef(modelRef: string): { provider: string; modelId: string } {
  if (!modelRef) return { provider: '', modelId: '' }
  const [provider, ...rest] = modelRef.split('/')
  return { provider, modelId: rest.join('/') }
}

export function getModelRefFromState(state: Record<string, unknown> | null | undefined): string {
  if (!state) return ''
  const model = state.model
  if (!model || typeof model !== 'object') return ''
  const provider = typeof (model as Record<string, unknown>).provider === 'string'
    ? (model as Record<string, unknown>).provider as string
    : ''
  const modelId = typeof (model as Record<string, unknown>).id === 'string'
    ? (model as Record<string, unknown>).id as string
    : ''
  if (!provider || !modelId) return ''
  return `${provider}/${modelId}`
}

export function formatModelDisplay(
  modelRef: string,
  options?: { includeProvider?: boolean; fallback?: string },
): string {
  const includeProvider = options?.includeProvider ?? false
  const fallback = options?.fallback ?? 'No model'

  if (!modelRef) return fallback

  const { provider, modelId } = splitModelRef(modelRef)
  if (!provider || !modelId) return modelRef
  if (!includeProvider) return modelId
  return `${formatProviderName(provider)} / ${modelId}`
}
