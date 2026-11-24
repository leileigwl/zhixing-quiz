import { describe, expect, it, vi } from 'vitest'
import Taro from '@tarojs/taro'
import { __setCurrentPages } from '../../test/mocks/taro'

type ApiModule = typeof import('./api')

async function loadApi(): Promise<ApiModule> {
  vi.resetModules()
  return import('./api')
}

const requestMock = () => vi.mocked(Taro.request)
const ok = <T>(data: T) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
const fail = (statusCode: number, code: number, message: string) => ({
  statusCode,
  data: { code, message, data: null },
})

describe('sendEmailCode', () => {
  it('POST /auth/email/send-code，邮箱规范化且不带 Authorization', async () => {
    Taro.setStorageSync('zx_token', 'stale-token')
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(
      ok({ message: '已发送', cooldown_seconds: 60, expires_in_seconds: 600 }) as any,
    )

    await expect(api.sendEmailCode('  Julia@163.COM ')).resolves.toEqual({
      message: '已发送',
      cooldown_seconds: 60,
      expires_in_seconds: 600,
    })
    const call = requestMock().mock.calls[0][0] as any
    expect(call.url).toBe('https://api.test/api/v1/auth/email/send-code')
    expect(call.method).toBe('POST')
    expect(call.data).toEqual({ email: 'julia@163.com' })
    expect(call.header.Authorization).toBeUndefined()
  })

  it('429 冷却：抛出带 code=4290 的 AuthApiError', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(fail(429, 4290, '验证码发送过于频繁，请 60 秒后再试') as any)
    const err = await api.sendEmailCode('a@qq.com').catch((e) => e)
    expect(err).toBeInstanceOf(api.AuthApiError)
    expect(err.code).toBe(4290)
    expect(err.statusCode).toBe(429)
    expect(err.message).toBe('验证码发送过于频繁，请 60 秒后再试')
  })

  it('网络异常：AuthApiError 无 code（映射为网络提示）', async () => {
    const api = await loadApi()
    requestMock().mockRejectedValueOnce(new Error('request:fail'))
    const err = await api.sendEmailCode('a@qq.com').catch((e) => e)
    expect(err).toBeInstanceOf(api.AuthApiError)
    expect(err.code).toBeUndefined()
  })

  it('非 ApiResponse 结构（422 / 网关 502）给出兜底 code', async () => {
    const api = await loadApi()
    requestMock()
      .mockResolvedValueOnce({ statusCode: 422, data: { detail: [] } } as any)
      .mockResolvedValueOnce({ statusCode: 502, data: '<html>' } as any)
    expect((await api.sendEmailCode('a@qq.com').catch((e) => e)).code).toBe(4000)
    expect((await api.sendEmailCode('a@qq.com').catch((e) => e)).code).toBe(5000)
  })
})

describe('verifyEmailCode', () => {
  it('成功：保存 token 与用户信息，后续业务请求携带新 token', async () => {
    const api = await loadApi()
    const user = { id: 100, nickname: '学习者', avatar_url: '', total_xp: 0, streak_days: 0 }
    requestMock()
      .mockResolvedValueOnce(ok({ token: 'jwt-email', user }) as any)
      .mockResolvedValueOnce(ok({ id: 100 }) as any)

    const res = await api.verifyEmailCode(' A@QQ.com', '123456')
    expect(res.token).toBe('jwt-email')
    expect((requestMock().mock.calls[0][0] as any).data).toEqual({ email: 'a@qq.com', code: '123456' })
    expect(api.getToken()).toBe('jwt-email')
    expect(api.getCachedUser()).toEqual(user)

    await api.request('/user/profile')
    expect((requestMock().mock.calls[1][0] as any).header.Authorization).toBe('Bearer jwt-email')
    await expect(api.waitForLogin()).resolves.toBeUndefined()
  })

  it('验证码错误：抛 4012，不写 token', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(fail(400, 4012, '验证码错误，还可尝试 4 次') as any)
    const err = await api.verifyEmailCode('a@qq.com', '000000').catch((e) => e)
    expect(err.code).toBe(4012)
    expect(err.message).toBe('验证码错误，还可尝试 4 次')
    expect(api.getToken()).toBe('')
  })

  it('次数超限 4013 / 服务不可用 5030 透传业务码', async () => {
    const api = await loadApi()
    requestMock()
      .mockResolvedValueOnce(fail(400, 4013, '验证码错误次数过多，请重新获取') as any)
      .mockResolvedValueOnce(fail(503, 5030, '邮箱登录暂未开放，请稍后再试') as any)
    expect((await api.verifyEmailCode('a@qq.com', '000000').catch((e) => e)).code).toBe(4013)
    expect((await api.verifyEmailCode('a@qq.com', '000000').catch((e) => e)).code).toBe(5030)
  })

  it('成功响应缺 token 时视为失败', async () => {
    const api = await loadApi()
    requestMock().mockResolvedValueOnce(ok({ token: '', user: null }) as any)
    await expect(api.verifyEmailCode('a@qq.com', '123456')).rejects.toThrow('登录失败')
    expect(api.getToken()).toBe('')
  })
})

describe('redirectToLogin', () => {
  it('H5 下 reLaunch 到登录页，短时间内去重', async () => {
    const api = await loadApi()
    expect(api.usesEmailLoginPage()).toBe(true)
    expect(api.redirectToLogin()).toBe(true)
    expect(api.redirectToLogin()).toBe(false)
    expect(Taro.reLaunch).toHaveBeenCalledTimes(1)
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: api.LOGIN_PAGE_URL })
  })

  it('已在登录页（含前导斜杠的路由）时不跳转', async () => {
    __setCurrentPages([{ route: '/pages/login/index' }])
    const api = await loadApi()
    expect(api.redirectToLogin()).toBe(false)
    expect(Taro.reLaunch).not.toHaveBeenCalled()
  })

  it('getCurrentPages 异常时仍可跳转', async () => {
    const api = await loadApi()
    vi.mocked(Taro.getCurrentPages).mockImplementationOnce(() => {
      throw new Error('no pages')
    })
    expect(api.redirectToLogin()).toBe(true)
  })
})
