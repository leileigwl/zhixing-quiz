import { describe, expect, it } from 'vitest'
import { normalizePercent, ringBackground } from './ringModel'

describe('normalizePercent', () => {
  it.each([
    [null, null],
    [undefined, null],
    [Number.NaN, null],
    [-5, 0],
    [42.4, 42],
    [42.5, 43],
    [180, 100],
  ])('%s → %s', (v, out) => {
    expect(normalizePercent(v as number | null | undefined)).toBe(out)
  })
})

describe('ringBackground', () => {
  it('无数据或 0 时整圈底色', () => {
    expect(ringBackground(null, '#a', '#b', '#t')).toBe('conic-gradient(#t 0 100%)')
    expect(ringBackground(0, '#a', '#b', '#t')).toBe('conic-gradient(#t 0 100%)')
  })

  it('有值时渐变扫过对应百分比', () => {
    expect(ringBackground(72, '#a', '#b', '#t')).toBe('conic-gradient(#a 0%, #b 72%, #t 72% 100%)')
  })
})
