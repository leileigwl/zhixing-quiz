/**
 * V3.0 知识域分色：每个知识域固定一种辅助色，口袋、曲线页胶囊等处一致。
 * 优先用后端给的 color_token（sky / butter / purple / sage），否则按 domain_id 稳定取色。
 */
export const DOMAIN_TONES = ['brand', 'coral', 'mint', 'sky', 'butter', 'berry'] as const
export type DomainTone = (typeof DOMAIN_TONES)[number]

const TOKEN_TO_TONE: Record<string, DomainTone> = {
  purple: 'brand',
  sky: 'sky',
  butter: 'butter',
  sage: 'mint',
  coral: 'coral',
  berry: 'berry',
}

export function domainTone(colorToken?: string | null, domainId?: number | null): DomainTone {
  const fromToken = colorToken ? TOKEN_TO_TONE[colorToken] : undefined
  if (fromToken) return fromToken
  const id = Number.isFinite(domainId) ? Math.abs(Math.trunc(domainId as number)) : 0
  return DOMAIN_TONES[id % DOMAIN_TONES.length]
}
