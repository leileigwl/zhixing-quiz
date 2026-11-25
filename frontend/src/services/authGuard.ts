/**
 * H5 启动前登录守卫。
 *
 * 线上问题（2026-11-25 复现）：无 token 时直接打开 `/#/pages/index/index`（刷新首页、书签、分享链接都会这样进来），
 * App 的 useEffect 在首页挂载过程中 `reLaunch` 到登录页，hash 变成 `#/pages/login/index`，
 * 但 Taro H5 路由随后又把首页设为可见，结果「地址是登录页、画面是首页、没有任何 API 请求」。
 *
 * 修法：在 Taro 路由初始化之前（app.ts 模块顶层）同步检查 token，没有就先把 hash 改成登录页，
 * 让路由第一次渲染的就是登录页，不再依赖挂载后的跳转时序。
 */
export const LOGIN_ROUTE = 'pages/login/index'
export const LOGIN_HASH = `#/${LOGIN_ROUTE}`

/** 从 hash 中取出路由（去掉 `#/`、开头斜杠与查询串） */
export function routeFromHash(hash: string): string {
  return (hash || '').replace(/^#/, '').replace(/^\/+/, '').split('?')[0]
}

/** 无 token 且不在登录页时需要先切到登录页 */
export function needsLoginRedirect(hash: string, hasToken: boolean): boolean {
  if (hasToken) return false
  return !routeFromHash(hash).startsWith(LOGIN_ROUTE)
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
  if (!needsLoginRedirect(loc.hash, hasToken)) return false
  hist.replaceState(null, '', `${loc.pathname}${loc.search}${LOGIN_HASH}`)
  return true
}
