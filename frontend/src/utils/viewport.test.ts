import { describe, expect, it } from 'vitest'
import { tierFromMatches, tierFromWidth, usesSideNav, TABLET_MEDIA_QUERY, WIDE_MEDIA_QUERY } from './viewport'

describe('tierFromWidth', () => {
  it.each([
    [320, 'mobile'],
    [390, 'mobile'],
    [767, 'mobile'],
    [768, 'tablet'],
    [820, 'tablet'],
    [1099, 'tablet'],
    [1100, 'wide'],
    [1180, 'wide'],
    [1440, 'wide'],
    [2560, 'wide'],
  ] as const)('%i px → %s', (w, tier) => {
    expect(tierFromWidth(w)).toBe(tier)
  })

  it('非法宽度按手机处理', () => {
    expect(tierFromWidth(Number.NaN)).toBe('mobile')
    expect(tierFromWidth(-1)).toBe('mobile')
  })
})

describe('tierFromMatches / usesSideNav', () => {
  it('宽屏优先于平板', () => {
    expect(tierFromMatches(true, true)).toBe('wide')
    expect(tierFromMatches(true, false)).toBe('tablet')
    expect(tierFromMatches(false, false)).toBe('mobile')
  })

  it('只有宽屏用侧栏，平板竖屏保留底部 Dock', () => {
    expect(usesSideNav('wide')).toBe(true)
    expect(usesSideNav('tablet')).toBe(false)
    expect(usesSideNav('mobile')).toBe(false)
  })

  it('媒体查询字符串与断点一致', () => {
    expect(TABLET_MEDIA_QUERY).toBe('(min-width: 768px)')
    expect(WIDE_MEDIA_QUERY).toBe('(min-width: 1100px)')
  })
})
