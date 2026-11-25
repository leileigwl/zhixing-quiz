import { useEffect, useState } from 'react'
import { TABLET_MEDIA_QUERY, WIDE_MEDIA_QUERY, tierFromMatches, type ViewportTier } from '../utils/viewport'

type MediaQueryListLike = Pick<MediaQueryList, 'matches'> & {
  addEventListener?: (type: 'change', fn: () => void) => void
  removeEventListener?: (type: 'change', fn: () => void) => void
  addListener?: (fn: () => void) => void
  removeListener?: (fn: () => void) => void
}

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

/** 读取当前档位；非 H5 或无 matchMedia 时恒为 mobile */
export function readViewportTier(): ViewportTier {
  if (process.env.TARO_ENV !== 'h5' || !hasMatchMedia()) return 'mobile'
  return tierFromMatches(window.matchMedia(TABLET_MEDIA_QUERY).matches, window.matchMedia(WIDE_MEDIA_QUERY).matches)
}

function listen(mql: MediaQueryListLike, fn: () => void): () => void {
  if (mql.addEventListener) {
    mql.addEventListener('change', fn)
    return () => mql.removeEventListener?.('change', fn)
  }
  mql.addListener?.(fn)
  return () => mql.removeListener?.(fn)
}

/**
 * 当前视口档位（'mobile' | 'tablet' | 'wide'）。
 * 只用于 CSS 做不到的结构性切换（Dock ↔ 侧栏、键盘监听、Canvas 重绘）；纯样式一律走 SCSS 媒体查询。
 * weapp 下恒为 'mobile'，不注册任何监听。
 */
export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() => readViewportTier())

  useEffect(() => {
    if (process.env.TARO_ENV !== 'h5' || !hasMatchMedia()) return undefined
    const update = () => setTier(readViewportTier())
    const offs = [TABLET_MEDIA_QUERY, WIDE_MEDIA_QUERY].map((q) =>
      listen(window.matchMedia(q) as MediaQueryListLike, update),
    )
    update()
    return () => offs.forEach((off) => off())
  }, [])

  return tier
}
