import { describe, expect, it, vi } from 'vitest'
import {
  applyInitialLoginRoute,
  initialRedirectHash,
  isPublicRoute,
  needsLoginRedirect,
  routeFromHash,
  LANDING_HASH,
  LOGIN_HASH,
} from './authGuard'

describe('routeFromHash', () => {
  it.each([
    ['', ''],
    ['#/', ''],
    ['#/pages/index/index', 'pages/index/index'],
    ['#/pages/login/index?stamp=1', 'pages/login/index'],
    ['#pages/quiz/index?quizId=a', 'pages/quiz/index'],
  ])('%s → %s', (hash, route) => {
    expect(routeFromHash(hash)).toBe(route)
  })
})

describe('needsLoginRedirect', () => {
  it('有 token 永不拦截', () => {
    expect(needsLoginRedirect('#/pages/index/index', true)).toBe(false)
    expect(needsLoginRedirect('', true)).toBe(false)
  })

  it('无 token：首页、tab 页、二级页都要先去登录页', () => {
    for (const h of ['#/pages/index/index', '#/pages/mastery/index', '#/pages/quiz/index?quizId=x']) {
      expect(needsLoginRedirect(h, false)).toBe(true)
    }
  })

  it('V3.0：无 token 的根路径去门头页而不是登录页', () => {
    for (const h of ['', '#/']) {
      expect(needsLoginRedirect(h, false)).toBe(false)
      expect(initialRedirectHash(h, false)).toBe(LANDING_HASH)
    }
  })

  it('V3.0：门头页是公开页，有无 token 都不拦截', () => {
    expect(needsLoginRedirect('#/pages/landing/index', false)).toBe(false)
    expect(initialRedirectHash('#/pages/landing/index', false)).toBeNull()
    expect(initialRedirectHash('#/pages/landing/index', true)).toBeNull()
  })

  it('无 token 但已在登录页时不动', () => {
    expect(needsLoginRedirect('#/pages/login/index', false)).toBe(false)
    expect(needsLoginRedirect('#/pages/login/index?stamp=2', false)).toBe(false)
  })
})

describe('applyInitialLoginRoute', () => {
  const make = (hash: string) => ({
    loc: { hash, pathname: '/', search: '' },
    hist: { replaceState: vi.fn() },
  })

  it('复现线上问题的入口 /#/pages/index/index：路由初始化前就改写为登录页', () => {
    const { loc, hist } = make('#/pages/index/index')
    expect(applyInitialLoginRoute(false, loc, hist)).toBe(true)
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', `/${LOGIN_HASH}`)
  })

  it('保留 pathname 与查询串', () => {
    const hist = { replaceState: vi.fn() }
    applyInitialLoginRoute(false, { hash: '#/pages/mastery/index', pathname: '/h5/', search: '?from=share' }, hist)
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', `/h5/?from=share${LOGIN_HASH}`)
  })

  it('V3.0：未登录打开根路径 → 门头页；已登录打开根路径不改写（Taro 默认进应用首页）', () => {
    const a = make('')
    expect(applyInitialLoginRoute(false, a.loc, a.hist)).toBe(true)
    expect(a.hist.replaceState).toHaveBeenCalledWith(null, '', `/${LANDING_HASH}`)
    const b = make('#/')
    expect(applyInitialLoginRoute(true, b.loc, b.hist)).toBe(false)
    expect(b.hist.replaceState).not.toHaveBeenCalled()
  })

  it('isPublicRoute 只认登录页与门头页', () => {
    expect(isPublicRoute('pages/login/index')).toBe(true)
    expect(isPublicRoute('/pages/landing/index')).toBe(true)
    expect(isPublicRoute('pages/index/index')).toBe(false)
    expect(isPublicRoute('')).toBe(false)
  })

  it('已登录或已在登录页时不改写', () => {
    const a = make('#/pages/index/index')
    expect(applyInitialLoginRoute(true, a.loc, a.hist)).toBe(false)
    const b = make('#/pages/login/index')
    expect(applyInitialLoginRoute(false, b.loc, b.hist)).toBe(false)
    expect(a.hist.replaceState).not.toHaveBeenCalled()
    expect(b.hist.replaceState).not.toHaveBeenCalled()
  })

  it('默认使用 window.location / window.history', () => {
    window.history.replaceState(null, '', '/#/pages/profile/index')
    expect(applyInitialLoginRoute(false)).toBe(true)
    expect(window.location.hash).toBe(LOGIN_HASH)
  })
})
