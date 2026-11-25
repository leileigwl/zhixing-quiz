import { describe, expect, it } from 'vitest'
import { DOMAIN_TONES, domainTone } from './domainColor'

describe('domainTone', () => {
  it('优先使用后端 color_token', () => {
    expect(domainTone('sky', 1)).toBe('sky')
    expect(domainTone('purple', 9)).toBe('brand')
    expect(domainTone('sage')).toBe('mint')
  })

  it('未知 token 或缺省时按 domain_id 稳定取色', () => {
    expect(domainTone('unknown', 2)).toBe(DOMAIN_TONES[2])
    expect(domainTone(undefined, 7)).toBe(DOMAIN_TONES[1])
    expect(domainTone(null, -3)).toBe(DOMAIN_TONES[3])
    expect(domainTone()).toBe('brand')
    expect(domainTone(null, Number.NaN)).toBe('brand')
  })
})
