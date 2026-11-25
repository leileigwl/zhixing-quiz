/**
 * V2.9 H5 响应式断点（与 docs/02-design/prototypes/v29-responsive-layout.html 一致）：
 * - mobile  < 768：手机，底部黑曜石 Dock
 * - tablet  768–1099：iPad 竖屏，仍用底部 Dock，内容居中最大宽 720
 * - wide    ≥ 1100：iPad 横屏 / 电脑，232px 左侧侧栏 + 多栏
 */
export type ViewportTier = 'mobile' | 'tablet' | 'wide'

export const TABLET_MIN_WIDTH = 768
export const WIDE_MIN_WIDTH = 1100

export const TABLET_MEDIA_QUERY = `(min-width: ${TABLET_MIN_WIDTH}px)`
export const WIDE_MEDIA_QUERY = `(min-width: ${WIDE_MIN_WIDTH}px)`

export function tierFromWidth(width: number): ViewportTier {
  if (!Number.isFinite(width) || width < TABLET_MIN_WIDTH) return 'mobile'
  return width < WIDE_MIN_WIDTH ? 'tablet' : 'wide'
}

/** 由两条媒体查询的匹配结果推出档位（matchMedia 监听回调里用） */
export function tierFromMatches(tabletUp: boolean, wideUp: boolean): ViewportTier {
  if (wideUp) return 'wide'
  return tabletUp ? 'tablet' : 'mobile'
}

/** 是否显示宽屏侧栏（只有 wide 档；平板竖屏保留底部 Dock） */
export function usesSideNav(tier: ViewportTier): boolean {
  return tier === 'wide'
}
