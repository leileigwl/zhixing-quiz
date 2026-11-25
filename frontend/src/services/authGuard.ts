/**
 * H5 启动前路由守卫。
 *
 * 线上问题（2026-11-25 复现）：无 token 时直接打开 `/#/pages/index/index`（刷新首页、书签、分享链接都会这样进来），
 * App 的 useEffect 在首页挂载过程中 `reLaunch` 到登录页，hash 变成 `#/pages/login/index`，
 * 但 Taro H5 路由随后又把首页设为可见，结果「地址是登录页、画面是首页、没有任何 API 请求」。
 * 修法：在 Taro 路由初始化之前（app.ts 模块顶层）同步检查 token，按需先改写 hash，让路由第一次渲染的就是目标页。
 *
 * V3.0（2026-11-26）新增公开门头页 `pages/landing/index`：
 * - 根路径（`/`、`/#/`）：未登录 → 门头页；已登录 → 不改写（Taro 打开 pages[0] 即应用首页）
 * - 门头页、登录页是公开页：谁都可以直接访问，不改写
 * - 其余应用内页面：未登录 → 登录页（与 V2.9 行为一致）
 */
export const LOGIN_ROUTE = 'pages/login/index'
export const LANDING_ROUTE = 'pages/landing/index'
export const LOGIN_HASH = `#/${LOGIN_ROUTE}`
export const LANDING_HASH = `#/${LANDING_ROUTE}`

/** 公开页：未登录也能直接访问 */
export const PUBLIC_ROUTES = [LOGIN_ROUTE, LANDING_ROUTE] as const

/** 从 hash 中取出路由（去掉 `#/`、开头斜杠与查询串） */
export function routeFromHash(hash: string): string {
  return (hash || '').replace(/^#/, '').replace(/^\/+/, '').split('?')[0]
}

export function isPublicRoute(route: string): boolean {
  const r = (route || '').replace(/^\/+/, '')
  return PUBLIC_ROUTES.some((p) => r.startsWith(p))
}

/**
 * 启动时应改写到的 hash；不需要改写时返回 null。
 */
export function initialRedirectHash(hash: string, hasToken: boolean): string | null {
  const route = routeFromHash(hash)
  if (!route) return hasToken ? null : LANDING_HASH
  if (isPublicRoute(route)) return null
  return hasToken ? null : LOGIN_HASH
}

/** 无 token 且访问应用内页面（非公开页、非根路径）时需要先切到登录页 */
export function needsLoginRedirect(hash: string, hasToken: boolean): boolean {
  return initialRedirectHash(hash, hasToken) === LOGIN_HASH
}

interface LocationLike {
  hash: string
  pathname: string
  search: string
}
interface HistoryLike {
  replaceState: (data: unknown, unused: string, url?: string) => void
}

/**
 * 在路由初始化前调用；返回是否改写了地址。
 * 用 replaceState 而不是 location.hash=，避免留下一条历史记录、也不触发 hashchange。
 */
export function applyInitialLoginRoute(
  hasToken: boolean,
  loc: LocationLike = window.location,
  hist: HistoryLike = window.history,
): boolean {
  const target = initialRedirectHash(loc.hash, hasToken)
  if (!target) return false
  hist.replaceState(null, '', `${loc.pathname}${loc.search}${target}`)
  return true
}
