export type ProviderData = {
  exact_match_rate?: number
  avg_prob?: number
  avg_margin?: number
  avg_logit_rank?: number
  avg_gumbel_rank?: number
  infinite_margin_rate?: number
  total_tokens?: number
  n_sequences?: number
  vail?: {
    endpoint?: string
    divergence_ratio?: number
    date?: string
    comparison_providers?: string[]
  }
  [key: string]: unknown
}

export type AuditResult = {
  model: string
  timestamp: string
  providers: Record<string, ProviderData>
  filename?: string
}
