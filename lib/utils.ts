import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getExactMatchRateTextColor(score: number) {
  if (!Number.isFinite(score)) return "text-muted-foreground"
  if (score >= 0.95) return "text-[var(--chart-5)]"
  if (score >= 0.9) return "text-[var(--neutral-text)]"
  return "text-[var(--brand-primary)]"
}
