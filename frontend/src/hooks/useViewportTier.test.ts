import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readViewportTier, useViewportTier } from './useViewportTier'

type Listener = () => void

function installMatchMedia(width: number) {
  const state = { width }
  const lists: Array<{ query: string; listeners: Set<Listener> }> = []
  const parse = (q: string) => Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0)
  const mm = vi.fn((query: string) => {
    const entry = { query, listeners: new Set<Listener>() }
    lists.push(entry)
    return {
      get matches() {
        return state.width >= parse(query)
      },
      media: query,
      addEventListener: (_t: string, fn: Listener) => entry.listeners.add(fn),
      removeEventListener: (_t: string, fn: Listener) => entry.listeners.delete(fn),
    }
  })
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: mm })
  return {
    resize(w: number) {
      state.width = w
      lists.forEach((l) => l.listeners.forEach((fn) => fn()))
    },
    listenerCount: () => lists.reduce((n, l) => n + l.listeners.size, 0),
  }
}

describe('useViewportTier', () => {
  afterEach(() => {
    // @ts-expect-error 测试清理
    delete window.matchMedia
  })

  it('无 matchMedia 时按手机处理', () => {
    // @ts-expect-error 模拟旧环境
    delete window.matchMedia
    expect(readViewportTier()).toBe('mobile')
    const { result } = renderHook(() => useViewportTier())
    expect(result.current).toBe('mobile')
  })

  it('初始档位 + 窗口变化时跟随，卸载后移除监听', () => {
    const mm = installMatchMedia(1440)
    const { result, unmount } = renderHook(() => useViewportTier())
    expect(result.current).toBe('wide')

    act(() => mm.resize(820))
    expect(result.current).toBe('tablet')
    act(() => mm.resize(390))
    expect(result.current).toBe('mobile')
    act(() => mm.resize(1100))
    expect(result.current).toBe('wide')

    expect(mm.listenerCount()).toBe(2)
    unmount()
    expect(mm.listenerCount()).toBe(0)
  })

  it('兼容只支持 addListener 的旧版 Safari', () => {
    const fns = new Set<Listener>()
    let width = 800
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (q: string) => ({
        get matches() {
          return width >= Number(/(\d+)px/.exec(q)?.[1])
        },
        addListener: (fn: Listener) => fns.add(fn),
        removeListener: (fn: Listener) => fns.delete(fn),
      }),
    })
    const { result, unmount } = renderHook(() => useViewportTier())
    expect(result.current).toBe('tablet')
    act(() => {
      width = 1200
      fns.forEach((fn) => fn())
    })
    expect(result.current).toBe('wide')
    unmount()
    expect(fns.size).toBe(0)
  })
})
