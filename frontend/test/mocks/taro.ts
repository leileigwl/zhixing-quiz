/**
 * `@tarojs/taro` 的 Vitest 替身：只实现 src/ 实际用到的 API，状态全部放在内存里，
 * 每个用例前由 test/setup.ts 调用 `__resetTaroMock()` 清空。
 * 需要断言网络 / 路由行为时，直接对 `Taro.request` / `Taro.navigateTo` 等 vi.fn 做 mock。
 */
import { vi } from 'vitest'

type Handler = (...args: any[]) => void

// 用 globalThis 做单例：被测模块经 vi.resetModules() 重新加载时，拿到的仍是同一个 Taro 替身
const g = globalThis as any
const storage: Map<string, unknown> = (g.__zxTaroStorage ??= new Map<string, unknown>())
const listeners: Map<string, Set<Handler>> = (g.__zxTaroListeners ??= new Map<string, Set<Handler>>())

const eventCenterImpl = {
  on(evt: string, fn: Handler) {
    if (!listeners.has(evt)) listeners.set(evt, new Set())
    listeners.get(evt)!.add(fn)
  },
  off(evt: string, fn?: Handler) {
    if (!fn) listeners.delete(evt)
    else listeners.get(evt)?.delete(fn)
  },
  trigger(evt: string, ...args: any[]) {
    Array.from(listeners.get(evt) ?? []).forEach((fn) => fn(...args))
  },
  /** 测试辅助：当前某事件的监听器数量 */
  listenerCount(evt: string) {
    return listeners.get(evt)?.size ?? 0
  },
}

export const eventCenter: typeof eventCenterImpl = (g.__zxTaroEventCenter ??= eventCenterImpl)

const pagesRef: { current: Array<{ route: string }> } = (g.__zxTaroPages ??= {
  current: [{ route: 'pages/index/index' }],
})

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

const createTaro = () => ({
  eventCenter,
  getStorageSync: vi.fn((key: string) => (storage.has(key) ? clone(storage.get(key)) : '')),
  setStorageSync: vi.fn((key: string, value: unknown) => {
    storage.set(key, clone(value))
  }),
  removeStorageSync: vi.fn((key: string) => {
    storage.delete(key)
  }),
  getStorageInfoSync: vi.fn(() => ({ keys: Array.from(storage.keys()), currentSize: 0, limitSize: 10240 })),
  request: vi.fn(async (_opts: any): Promise<any> => {
    throw new Error('Taro.request 未在用例中 mock')
  }),
  uploadFile: vi.fn(),
  login: vi.fn(),
  showToast: vi.fn(),
  showModal: vi.fn(),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  switchTab: vi.fn(),
  navigateBack: vi.fn(),
  vibrateShort: vi.fn(),
  getCurrentPages: vi.fn(() => pagesRef.current),
  getSystemInfoSync: vi.fn(() => ({ pixelRatio: 2, windowWidth: 375, windowHeight: 812 })),
  createSelectorQuery: vi.fn(() => {
    const q: any = {
      select: () => q,
      fields: () => q,
      boundingClientRect: () => q,
      exec: (cb?: (res: any[]) => void) => cb?.([null]),
    }
    return q
  }),
  nextTick: vi.fn((cb: () => void) => cb()),
})

const Taro: ReturnType<typeof createTaro> = (g.__zxTaro ??= createTaro())

export function __setCurrentPages(pages: Array<{ route: string }>) {
  pagesRef.current = pages
}

export function __resetTaroMock() {
  storage.clear()
  listeners.clear()
  pagesRef.current = [{ route: 'pages/index/index' }]
}

export const useDidShow = (_fn: () => void) => undefined
export const useDidHide = (_fn: () => void) => undefined
export const useRouter = () => ({ params: {} })
export const useLoad = (_fn: () => void) => undefined

export default Taro
