/**
 * E2E 假后端：用 Playwright route 拦截 H5 构建里写死的占位接口地址（CI 构建用 https://api.example.com）。
 * 两套数据：newUser（无答题无文档）/ withData（有口袋、曲线、错题）。数据只用于测试，不代表真实用户。
 */
import type { BrowserContext, Route } from '@playwright/test'
import mock from './mock-data.json'

export type MockProfile = 'newUser' | 'withData'

export const API_ORIGIN = process.env.E2E_API_ORIGIN || 'https://api.example.com'

/** Taro H5 的 setStorageSync 把值包一层 {data: ...} 再 JSON 序列化 */
export const LOGIN_INIT_SCRIPT = `
  localStorage.setItem('zx_token', JSON.stringify({ data: 'jwt-e2e-mock' }));
  localStorage.setItem('zx_login_email', JSON.stringify({ data: 'e2e@example.com' }));
`

function ok(data: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data }) }
}

export function respond(profile: MockProfile, method: string, url: string) {
  const d = mock[profile] as Record<string, unknown>
  const path = url.includes('/api/v1') ? url.split('/api/v1')[1] : new URL(url).pathname
  const route = path.split('?')[0]
  if (route === '/auth/email/send-code') return ok({ expires_in: 600, resend_after: 60 })
  if (route === '/auth/email/verify') {
    return ok({ token: 'jwt-e2e-mock', user: { id: 1, nickname: '学习者', avatar_url: '' } })
  }
  if (route.startsWith('/mastery/overview')) return ok(d.overview)
  if (route.startsWith('/reviews/due')) return ok(d.due)
  if (route === '/user/profile') return ok(method === 'PUT' ? null : d.profile)
  if (route === '/user/quizzes') return ok(d.quizzes)
  if (route === '/user/quizzes/q1') return ok(d.quizDetail ?? {})
  if (route.startsWith('/user/quizzes/')) return ok(d.quizDetailDone ?? {})
  if (route === '/knowledge/documents') return ok(d.documents)
  if (route.startsWith('/report/')) return ok(d.report ?? {})
  return ok({})
}

/** 给 context 装上假后端；返回收到的请求列表（"METHOD /path"） */
export async function installMockApi(ctx: BrowserContext, profile: MockProfile): Promise<string[]> {
  const calls: string[] = []
  await ctx.route(`${API_ORIGIN}/**`, async (route: Route) => {
    const req = route.request()
    if (req.url().includes('/static/')) {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    calls.push(`${req.method()} ${req.url().split('/api/v1')[1] ?? req.url()}`)
    await route.fulfill(respond(profile, req.method(), req.url()))
  })
  return calls
}
