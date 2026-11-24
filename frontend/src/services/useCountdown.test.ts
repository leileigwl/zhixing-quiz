import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCountdown } from './useCountdown'

describe('useCountdown', () => {
  it('start(60) 后逐秒递减，到 0 自动停止', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T10:00:00+08:00'))
    const { result } = renderHook(() => useCountdown())

    expect(result.current.remaining).toBe(0)
    expect(result.current.running).toBe(false)

    act(() => result.current.start(60))
    expect(result.current.remaining).toBe(60)
    expect(result.current.running).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remaining).toBe(59)

    act(() => {
      vi.advanceTimersByTime(58_000)
    })
    expect(result.current.remaining).toBe(1)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.remaining).toBe(0)
    expect(result.current.running).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('以结束时间戳为准：定时器被节流（切后台）回来后直接跳到真实剩余', () => {
    let now = 1_000_000
    vi.useFakeTimers()
    const { result } = renderHook(() => useCountdown(() => now))
    act(() => result.current.start(60))
    now += 45_000 // 时钟走了 45s，但定时器只触发一次
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current.remaining).toBe(15)
  })

  it('reset 立即结束倒计时；start(0) 不启动', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCountdown())
    act(() => result.current.start(60))
    act(() => result.current.reset())
    expect(result.current.remaining).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    act(() => result.current.start(0))
    expect(result.current.running).toBe(false)
  })

  it('卸载时清理定时器', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useCountdown())
    act(() => result.current.start(30))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
