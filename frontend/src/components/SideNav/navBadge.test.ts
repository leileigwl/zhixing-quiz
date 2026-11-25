import { describe, expect, it, vi } from 'vitest'
import { formatNavDueCount, getNavDueCount, setNavDueCount, subscribeNavDueCount } from './navBadge'

describe('navBadge', () => {
  it('写入后通知订阅者，相同值不重复通知，退订后不再通知', () => {
    const fn = vi.fn()
    const off = subscribeNavDueCount(fn)
    setNavDueCount(3)
    setNavDueCount(3)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getNavDueCount()).toBe(3)
    off()
    setNavDueCount(5)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getNavDueCount()).toBe(5)
  })

  it('非法值归一为 null，小数向下取整', () => {
    setNavDueCount(undefined)
    expect(getNavDueCount()).toBeNull()
    setNavDueCount(-2)
    expect(getNavDueCount()).toBeNull()
    setNavDueCount(Number.NaN)
    expect(getNavDueCount()).toBeNull()
    setNavDueCount(4.7)
    expect(getNavDueCount()).toBe(4)
  })

  it('徽标文案', () => {
    expect(formatNavDueCount(null)).toBe('')
    expect(formatNavDueCount(0)).toBe('')
    expect(formatNavDueCount(7)).toBe('7')
    expect(formatNavDueCount(120)).toBe('99+')
  })
})
